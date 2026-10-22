"""Durable course-completion evidence, separate from understanding/mastery."""
from __future__ import annotations

import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from app.services.storage import _connect, _row_to_learning_state, run_in_transaction
from app.services.qa_work_scheduler import background_work

logger = logging.getLogger(__name__)
_lock = threading.Lock()
_queued: set[tuple[int, str]] = set()
_executor: ThreadPoolExecutor | None = None


def revoke_source(conn, project_id: int, source_path: str | None = None) -> None:
    from app.services.personalization.knowledge_state_service import void_evidence
    rows = conn.execute(
        """SELECT e.id FROM learning_evidence_v2 e
           WHERE e.source='course_completion' AND e.voided=0
             AND json_extract(e.object_json,'$.projectId')=?
             AND (? IS NULL OR json_extract(e.object_json,'$.sourcePath')=?)
             AND NOT EXISTS (SELECT 1 FROM learning_evidence_v2 v
                 WHERE v.target_evidence_id=e.id AND v.action='void_evidence' AND v.voided=0)""",
        (project_id, source_path, source_path),
    ).fetchall()
    for row in rows:
        void_evidence(row["id"], f"course-completion:void:{row['id']}", "课程完成已取消或来源已删除", conn=conn)


def prepare_completion(conn, row) -> None:
    # Runs in the progress write transaction. Cancellation invalidates in-flight work.
    revoke_source(conn, row["project_id"], row["source_path"])
    conn.execute(
        """UPDATE learning_states SET profile_status=?,profile_error=NULL,
           profile_concept_count=0,profile_request=? WHERE id=?""",
        ("pending" if row["status"] == "completed" else "none", str(uuid4()), row["id"]),
    )


def retry_completion(project_id: int, state_id: int):
    def operation(conn):
        row = conn.execute("SELECT * FROM learning_states WHERE id=? AND project_id=? AND source_type='course' AND status='completed'",
                           (state_id, project_id)).fetchone()
        if row is None:
            return None
        if row["profile_status"] not in {"pending", "running"}:
            prepare_completion(conn, row)
        return _row_to_learning_state(conn.execute("SELECT * FROM learning_states WHERE id=?", (state_id,)).fetchone())
    return run_in_transaction(operation)


@background_work()
def _run(state_id: int, request: str) -> None:
    try:
        with _connect() as conn, conn:
            row = conn.execute("SELECT * FROM learning_states WHERE id=? AND profile_request=? AND status='completed'",
                               (state_id, request)).fetchone()
            if row is None or row["profile_status"] == "completed":
                return
            conn.execute("UPDATE learning_states SET profile_status='running' WHERE id=? AND profile_request=?", (state_id, request))
        from app.services import teaching_index as index
        state = index.document_state(row["project_id"], "course", row["source_path"])
        if state["indexStatus"] != "complete":
            raise ValueError("知识清单未就绪；课程进度已保留，请单独补录知识清单后重试本地应用")
        # Each concept receives ONE familiarity event, irrespective of paragraph count.
        groups = {}
        for passage in state["passages"]:
            if passage["kind"] in {"brief", "explained"}:
                groups.setdefault(passage["concept_id"], []).append(passage)

        def apply(conn):
            current = conn.execute("SELECT * FROM learning_states WHERE id=? AND profile_request=? AND status='completed'",
                                   (state_id, request)).fetchone()
            document = conn.execute("SELECT content_hash FROM teaching_documents WHERE id=?", (state["documentId"],)).fetchone()
            if current is None:
                return  # Unmarked, reset, renamed during scan, or deleted.
            if current["source_path"] != state["sourcePath"] or document is None or document["content_hash"] != state["contentHash"]:
                raise ValueError("课件在画像更新期间已变更，请重试")
            if index.fingerprint(index._read_source(current["project_id"], "course", current["source_path"])) != state["contentHash"]:
                raise ValueError("课件在画像更新期间已变更，请重试")
            from app.services.personalization.knowledge_state_service import append_evidence
            from app.services.personalization_service import concept_scope
            from app.services.storage import get_concept
            for concept_id, passages in groups.items():
                scope_type, scope_id = concept_scope(get_concept(concept_id), current["project_id"])
                ranges = [{"aspect": p["aspect"], "dimension": p["dimension"], "kind": p["kind"],
                           "passageId": p["id"]} for p in passages]
                append_evidence({
                    "idempotencyKey": f"course-completion:{request}:{concept_id}",
                    "conceptId": concept_id, "scopeType": scope_type, "scopeId": scope_id,
                    "dimension": "familiarity", "source": "course_completion", "action": "course_studied",
                    "direction": "positive", "strength": 0.25, "reliability": 0.6,
                    "object": {"type": "course", "projectId": current["project_id"], "sourcePath": current["source_path"],
                               "learningStateId": state_id, "contentHash": state["contentHash"]},
                    "result": {"ranges": ranges, "evidenceQuote": passages[0]["quote"][:600],
                               "explanation": "用户标记本课完成，已学习这些讲解范围；仅增加熟悉度证据，不确认理解或掌握。"},
                    "eventTime": current["completed_at"],
                }, conn=conn)
            conn.execute("UPDATE learning_states SET profile_status='completed',profile_error=NULL,profile_concept_count=? WHERE id=? AND profile_request=?",
                         (len(groups), state_id, request))
        run_in_transaction(apply)
    except Exception as exc:
        logger.exception("Course completion profile update failed", extra={"learning_state_id": state_id})
        with _connect() as conn, conn:
            conn.execute("UPDATE learning_states SET profile_status='failed',profile_error=? WHERE id=? AND profile_request=? AND status='completed'",
                         (str(exc)[:500], state_id, request))
    finally:
        with _lock:
            _queued.discard((state_id, request))


def dispatch_completion(state_id: int) -> None:
    global _executor
    with _connect() as conn:
        row = conn.execute("SELECT profile_request FROM learning_states WHERE id=? AND status='completed' AND profile_status IN ('pending','running')", (state_id,)).fetchone()
    if row is None:
        return
    key = (state_id, row["profile_request"])
    with _lock:
        if key in _queued:
            return
        _queued.add(key)
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="course-profile")
        _executor.submit(_run, *key)


def recover_completions() -> None:
    with _connect() as conn:
        rows = conn.execute("SELECT id FROM learning_states WHERE source_type='course' AND status='completed' AND profile_status IN ('pending','running')").fetchall()
    for row in rows:
        dispatch_completion(row["id"])


def shutdown_completions() -> None:
    global _executor
    with _lock:
        executor, _executor = _executor, None
    if executor:
        executor.shutdown(wait=False, cancel_futures=True)


def learned_course_context(project_id: int, query: str = "") -> str:
    """Complete learned ranges, independently of understanding declarations."""
    with _connect() as conn:
        rows = conn.execute(
            """SELECT e.result_json,e.object_json,c.display_name,e.event_time
               FROM learning_evidence_v2 e JOIN concepts c ON c.id=e.concept_id
               JOIN learning_states l ON l.id=json_extract(e.object_json,'$.learningStateId')
               JOIN teaching_documents d ON d.project_id=l.project_id AND d.source_type='course' AND d.source_path=l.source_path
               WHERE e.source='course_completion' AND e.voided=0 AND l.status='completed'
                 AND d.content_hash=json_extract(e.object_json,'$.contentHash')
                 AND ((e.scope_type='global' AND e.scope_id='local-user') OR (e.scope_type='project' AND e.scope_id=?))
                 AND NOT EXISTS (SELECT 1 FROM learning_evidence_v2 v WHERE v.target_evidence_id=e.id AND v.action='void_evidence' AND v.voided=0)
               ORDER BY e.concept_id,e.event_time,e.id""",
            (str(project_id),),
        ).fetchall()
    records = []
    for row in rows:
        result, obj = json.loads(row["result_json"]), json.loads(row["object_json"])
        ranges = result.get("ranges", [])
        records.append({"concept": row["display_name"], "ranges": ranges, "rangeCount": len(ranges), "sourcePath": obj["sourcePath"], "status": "studied_not_verified"})
    encoded = json.dumps(records, ensure_ascii=False).replace("<", "\\u003c")
    return ("\n<completed_course_learning>\n" + encoded + "\n</completed_course_learning>\n"
            "以上仅表示用户已学过的具体范围，不确认理解或掌握。相同基础简短衔接并优先引用原讲解；"
            "保留新范围、进阶应用和必要示例。明确困惑、不会或要求重讲时正常展开；未列出不等于不会。\n")
