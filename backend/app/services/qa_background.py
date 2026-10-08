"""Durable, idempotent answer follow-up work, outside the response stream."""
from __future__ import annotations

import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor

from app.models.schemas import QAAskRequest
from app.services.storage import _connect, get_qa_record
from app.services.qa_work_scheduler import background_work

logger = logging.getLogger(__name__)
_executor: ThreadPoolExecutor | None = None
_lock = threading.Lock()
_queued: set[int] = set()


def saved_learner_summary(project_id: int) -> str:
    """Read existing data only: no concept inference/creation or model calls."""
    from app.services.personalization_service import effective_preferences, render_preference_directives
    with _connect() as conn, conn:
        rows = conn.execute(
            """SELECT summary FROM learner_inferences WHERE status='active'
               AND ((scope_type='project' AND scope_id=?) OR
                    (scope_type='global' AND scope_id='local-user'))
               ORDER BY updated_at DESC LIMIT 4""", (str(project_id),)
        ).fetchall()
    summary = "\n".join(row["summary"][:600] for row in rows)
    return ("<learner_context>\n" + render_preference_directives(effective_preferences(project_id))
            + "\n" + summary + "\n历史推断仅供调整讲解，不证明已经掌握；本次明确要求优先。\n</learner_context>")


def enqueue_answer(record, payload: QAAskRequest, context: str, terms: list) -> None:
    # Store the actual authorized material, never reopen source files in workers.
    with _connect() as conn, conn:
        conn.execute(
            """INSERT OR IGNORE INTO qa_postprocess_jobs
               (qa_record_id,project_id,payload_json,context_snapshot,terms_json,metadata_done)
               VALUES(?,?,?,?,?,?)""",
            (record.id, record.project_id, payload.model_dump_json(), context, json.dumps(terms, ensure_ascii=False),
             0 if payload.defer_metadata else 1),
        )


def authorized_context(project_id: int, record_id: int) -> str:
    with _connect() as conn, conn:
        row = conn.execute(
            "SELECT context_snapshot FROM qa_postprocess_jobs WHERE project_id=? AND qa_record_id=?",
            (project_id, record_id),
        ).fetchone()
    # Legacy jobs have no authorization snapshot: fail closed.
    return row["context_snapshot"] if row else ""


def _mark(record_id: int, field: str) -> None:
    assert field in {"evidence_done", "observer_done", "planner_done"}
    with _connect() as conn, conn:
        conn.execute(f"UPDATE qa_postprocess_jobs SET {field}=1 WHERE qa_record_id=?", (record_id,))


@background_work()
def _run(project_id: int, record_id: int) -> None:
    try:
        with _connect() as conn, conn:
            job = conn.execute("SELECT * FROM qa_postprocess_jobs WHERE qa_record_id=?", (record_id,)).fetchone()
            if not job or job["status"] == "completed":
                return
            conn.execute("UPDATE qa_postprocess_jobs SET status='running' WHERE qa_record_id=?", (record_id,))
        record = get_qa_record(project_id, record_id)
        if record is None:
            return
        terms = json.loads(job["terms_json"])
        if not job["metadata_done"]:
            from app.services.qa_metadata import extract_answer_metadata
            from app.services.continuity_service import persist_teaching_handoff
            metadata = (json.loads(job["metadata_json"]) if job["metadata_json"] else
                        extract_answer_metadata(record, QAAskRequest.model_validate_json(job["payload_json"]), job["context_snapshot"]))
            # Save the model result before applying it, so crash recovery does not
            # request or infer the same metadata twice.
            with _connect() as conn, conn:
                conn.execute("UPDATE qa_postprocess_jobs SET metadata_json=? WHERE qa_record_id=?",
                             (json.dumps(metadata, ensure_ascii=False), record_id))
            if get_qa_record(project_id, record_id) is None:
                return
            persist_teaching_handoff(record, metadata["handoff"])
            terms = metadata["terms"]
            with _connect() as conn, conn:
                conn.execute("UPDATE qa_postprocess_jobs SET metadata_done=1,terms_json=? WHERE qa_record_id=?",
                             (json.dumps(terms, ensure_ascii=False), record_id))
        if not job["evidence_done"]:
            from app.services.qa_service import postprocess_answer
            postprocess_answer(record, QAAskRequest.model_validate_json(job["payload_json"]), terms)
            _mark(record_id, "evidence_done")
        if not job["observer_done"]:
            from app.services.personalization.interaction_observer import schedule_interaction_observation
            schedule_interaction_observation(project_id, record_id, record.parent_qa_id, record.relation_type, record.question)
            _mark(record_id, "observer_done")
        if not job["planner_done"]:
            from app.services.personalization.teaching.teacher_planner import execute_teacher_planner
            from app.services.personalization.teaching.planner_scheduler import _should_plan
            if _should_plan(project_id, record_id, record.parent_qa_id, record.relation_type):
                execute_teacher_planner(project_id, record.session_id, record.id, record.parent_qa_id,
                                        record.question, record.selected_text, record.source_type, record.source_path)
                with _connect() as conn, conn:
                    result = conn.execute("SELECT status FROM teacher_plan_runs WHERE project_id=? AND qa_record_id=? ORDER BY created_at DESC LIMIT 1", (project_id, record_id)).fetchone()
                if result and result["status"] == "failed":
                    raise RuntimeError("Background teaching planner failed; retry on restart")
            _mark(record_id, "planner_done")
        with _connect() as conn, conn:
            conn.execute("UPDATE qa_postprocess_jobs SET status='completed',last_error=NULL WHERE qa_record_id=?", (record_id,))
    except Exception as exc:
        logger.exception("Answer follow-up failed", extra={"qa_record_id": record_id})
        with _connect() as conn, conn:
            conn.execute("UPDATE qa_postprocess_jobs SET status='failed',last_error=? WHERE qa_record_id=?", (str(exc)[:500], record_id))
    finally:
        with _lock:
            _queued.discard(record_id)


def dispatch_answer(project_id: int, record_id: int) -> None:
    global _executor
    with _lock:
        if record_id in _queued:
            return
        _queued.add(record_id)
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="qa-followup")
        executor = _executor
    try:
        executor.submit(_run, project_id, record_id)
    except RuntimeError:
        with _lock:
            _queued.discard(record_id)
        # Durable pending row is recovered on next startup.


def recover_answers() -> None:
    with _connect() as conn, conn:
        rows = conn.execute("SELECT project_id,qa_record_id FROM qa_postprocess_jobs WHERE status!='completed'").fetchall()
    for row in rows:
        dispatch_answer(row["project_id"], row["qa_record_id"])


def shutdown_answers() -> None:
    global _executor
    with _lock:
        executor, _executor = _executor, None
    if executor is not None:
        executor.shutdown(wait=False)


from app.services.qa_answer_context import complete_answer_context  # compatibility export
