from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Optional

from pydantic import ValidationError

from app.services.personalization.teaching.teaching_plan_schema import TeachingPlan
from app.services.personalization.teaching.teacher_planner_prompt import (
    TEACHER_PLANNER_VERSION,
    TEACHER_PLANNER_SYSTEM_PROMPT,
    TEACHER_PLANNER_USER_PROMPT,
)
from app.services.personalization.profile_retrieval.snapshot_builder import (
    build_shadow_snapshot,
    SNAPSHOT_BUILDER_VERSION,
)
from app.services.personalization.profile_retrieval.snapshot_schema import (
    ShadowLearnerSnapshot,
)

logger = logging.getLogger(__name__)

PLANNER_TIMEOUT_SECONDS = 25
MAX_RETRIES = 1


def _compute_plan_input_hash(
    project_id: int,
    qa_record_id: int,
    question: str,
) -> str:
    return hashlib.sha256(
        f"planner-input:{project_id}:{qa_record_id}:{question[:100]}".encode("utf-8")
    ).hexdigest()[:16]


def _get_planner_settings() -> dict[str, Any]:
    try:
        from app.services.storage import get_llm_settings
        llm = get_llm_settings()
        return {
            "provider": llm.get("provider", "deepseek"),
            "base_url": llm.get("base_url", ""),
            "model": llm.get("model", ""),
            "api_key": llm.get("api_key", ""),
            "timeout": PLANNER_TIMEOUT_SECONDS,
        }
    except Exception:
        return {}


def _is_planner_enabled() -> bool:
    try:
        from app.services.storage import get_setting
        return get_setting("personalization.teacher_planner.enabled") == "true"
    except Exception:
        return False


def _always_run_for_followups() -> bool:
    try:
        from app.services.storage import get_setting
        val = get_setting("personalization.teacher_planner.always_run_for_followups")
        return val != "false"
    except Exception:
        return True


def _get_planner_sample_rate() -> float:
    try:
        from app.services.storage import get_setting
        val = get_setting("personalization.teacher_planner.sample_rate")
        if val is not None:
            return float(val)
    except (ValueError, TypeError):
        pass
    return 0.35


def extract_json_from_planner(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("Planner output does not contain a JSON object")
    return json.loads(text[start : end + 1])


def parse_teaching_plan(raw: str) -> TeachingPlan:
    data = extract_json_from_planner(raw)
    return TeachingPlan.model_validate(data)


def _call_planner_model(messages: list[dict[str, str]], settings: dict[str, Any]) -> str:
    from app.services.llm_client import call_openai_compatible_chat
    return call_openai_compatible_chat(
        base_url=settings["base_url"],
        api_key=settings["api_key"],
        model=settings["model"],
        messages=messages,
        timeout=settings.get("timeout", PLANNER_TIMEOUT_SECONDS),
    )


def _build_planner_messages(
    question: str,
    selected_text: str,
    source_summary: str,
    parent_question: str,
    parent_answer_summary: str,
    recent_history: str,
    snapshot_json: str,
    manual_prefs_json: str,
) -> list[dict[str, str]]:
    user_prompt = TEACHER_PLANNER_USER_PROMPT.format(
        current_question=question[:2000],
        selected_text=(selected_text or "")[:1800],
        source_summary=source_summary[:2500],
        parent_question=(parent_question or "")[:1000],
        parent_answer_summary=(parent_answer_summary or "")[:2500],
        recent_history=recent_history,
        shadow_snapshot=snapshot_json,
        manual_preferences=manual_prefs_json,
    )
    return [
        {"role": "system", "content": TEACHER_PLANNER_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def _save_snapshot(
    project_id: int,
    session_id: int | None,
    target_qa_record_id: int,
    as_of_qa_record_id: int | None,
    snapshot: ShadowLearnerSnapshot,
    conn,
) -> str:
    snapshot_id = f"snapshot:{project_id}:{target_qa_record_id}:{SNAPSHOT_BUILDER_VERSION}"
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()

    conn.execute(
        """INSERT OR IGNORE INTO shadow_learner_snapshots
           (id, project_id, session_id, target_qa_record_id, as_of_qa_record_id,
            builder_version, input_hash, snapshot_hash, payload_json,
            source_observation_ids_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            snapshot_id, project_id, session_id, target_qa_record_id,
            as_of_qa_record_id, SNAPSHOT_BUILDER_VERSION,
            _compute_plan_input_hash(project_id, target_qa_record_id, ""),
            snapshot.snapshot_hash,
            snapshot.model_dump_json(exclude_none=True),
            json.dumps(snapshot.source_observation_ids),
            now,
        ),
    )
    return snapshot_id


def _save_plan(
    run_id: str,
    project_id: int,
    session_id: int | None,
    qa_record_id: int,
    snapshot_id: str,
    plan: TeachingPlan,
    conn,
) -> str:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    plan_id = f"plan:{project_id}:{qa_record_id}:{TEACHER_PLANNER_VERSION}"

    conn.execute(
        """INSERT OR IGNORE INTO teacher_plans
           (id, run_id, project_id, session_id, qa_record_id,
            snapshot_id, planner_version, payload_json, plan_confidence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            plan_id, run_id, project_id, session_id, qa_record_id,
            snapshot_id, TEACHER_PLANNER_VERSION,
            plan.model_dump_json(exclude_none=True),
            plan.plan_confidence,
            now,
        ),
    )
    return plan_id


def execute_teacher_planner(
    project_id: int,
    session_id: int | None,
    qa_record_id: int,
    parent_qa_id: int | None,
    question: str,
    selected_text: str,
    source_type: str | None,
    source_path: str | None,
) -> None:
    from app.services.storage import (
        get_qa_record,
        get_qa_session,
        list_recent_qa_records,
        list_all_concepts,
        get_concept_mastery,
        get_learner_preferences,
        run_in_transaction,
    )

    run_id = f"planner-run:{project_id}:{qa_record_id}:{TEACHER_PLANNER_VERSION}"

    try:
        settings = _get_planner_settings()
        if not settings.get("api_key") or not settings.get("base_url"):
            return

        qa_record = get_qa_record(project_id, qa_record_id)
        if qa_record is None:
            return

        parent_question = ""
        parent_answer_summary = ""
        if parent_qa_id:
            parent = get_qa_record(project_id, parent_qa_id)
            if parent:
                parent_question = parent.question
                parent_answer_summary = (parent.answer_md or "")[:2500]

        recent = (
            list_recent_qa_records(project_id, session_id=session_id, limit=4)
            if session_id
            else []
        )
        recent_history = json.dumps(
            [
                {"q": r.question[:600], "a": (r.answer_md or "")[:600]}
                for r in recent if r.id != qa_record_id
            ],
            ensure_ascii=False,
        )[:2000]

        source_summary = json.dumps({
            "source_type": source_type or "unknown",
            "source_path": source_path or "",
        }, ensure_ascii=False)[:2500]

        relevant_keys: list[str] = []
        if source_type in ("course", "qa") and source_path:
            from app.services.storage import list_document_terms
            terms = list_document_terms(project_id, source_type, source_path)
            for t in terms[:12]:
                if t.concept_id and t.concept_id not in relevant_keys:
                    relevant_keys.append(t.concept_id)

        as_of_qa_id = (qa_record_id - 1) if qa_record_id > 0 else None

        def _tx(conn):
            snapshot = build_shadow_snapshot(
                project_id=project_id,
                session_id=session_id,
                target_qa_record_id=qa_record_id,
                as_of_qa_record_id=as_of_qa_id,
                relevant_concept_keys=relevant_keys,
                question=question,
                conn=conn,
            )

            snapshot_id = _save_snapshot(
                project_id=project_id,
                session_id=session_id,
                target_qa_record_id=qa_record_id,
                as_of_qa_record_id=as_of_qa_id,
                snapshot=snapshot,
                conn=conn,
            )

            manual_prefs = _get_manual_preferences(project_id, conn)
            snapshot_json = snapshot.model_dump_json(exclude_none=True)[:5000]

            messages = _build_planner_messages(
                question=question,
                selected_text=selected_text or "",
                source_summary=source_summary,
                parent_question=parent_question,
                parent_answer_summary=parent_answer_summary,
                recent_history=recent_history,
                snapshot_json=snapshot_json,
                manual_prefs_json=json.dumps(manual_prefs, ensure_ascii=False),
            )

            from datetime import datetime, timezone
            now = datetime.now(timezone.utc).isoformat()
            plan = None
            last_error = None

            for attempt in range(MAX_RETRIES + 1):
                try:
                    raw = _call_planner_model(messages, settings)
                    plan = parse_teaching_plan(raw)
                    break
                except (ValueError, ValidationError) as exc:
                    last_error = str(exc)
                    if attempt < MAX_RETRIES:
                        messages.append({
                            "role": "user",
                            "content": "Please output ONLY valid JSON matching the schema.",
                        })
                        continue
                    raise

            if plan is None:
                raise ValueError(f"Planner failed after retries: {last_error}")

            conn.execute(
                """INSERT OR IGNORE INTO teacher_plan_runs
                   (id, idempotency_key, project_id, session_id, qa_record_id,
                    snapshot_id, mode, provider, model, planner_version,
                    input_hash, status, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    run_id, run_id, project_id, session_id, qa_record_id,
                    snapshot_id, "shadow", settings.get("provider"),
                    settings.get("model"), TEACHER_PLANNER_VERSION,
                    _compute_plan_input_hash(project_id, qa_record_id, question),
                    "completed", now, now,
                ),
            )

            _save_plan(
                run_id=run_id,
                project_id=project_id,
                session_id=session_id,
                qa_record_id=qa_record_id,
                snapshot_id=snapshot_id,
                plan=plan,
                conn=conn,
            )

        run_in_transaction(_tx)

    except Exception:
        logger.exception(
            "Teacher planner failed",
            extra={"project_id": project_id, "qa_record_id": qa_record_id},
        )
        try:
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc).isoformat()
            from app.services.storage import _connect

            with _connect() as conn:
                conn.execute(
                    """INSERT OR IGNORE INTO teacher_plan_runs
                       (id, idempotency_key, project_id, session_id, qa_record_id,
                        snapshot_id, mode, planner_version, input_hash, status,
                        error_message, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        run_id, run_id, project_id, session_id, qa_record_id,
                        "", "shadow", TEACHER_PLANNER_VERSION,
                        _compute_plan_input_hash(project_id, qa_record_id, question),
                        "failed", str(locals().get("last_error", "Unknown"))[:500],
                        now, now,
                    ),
                )
        except Exception:
            pass


def _get_manual_preferences(project_id: int, conn) -> dict[str, object]:
    row = conn.execute(
        "SELECT * FROM learner_preferences WHERE scope_type = 'project' AND scope_id = ?",
        (str(project_id),),
    ).fetchone()
    if row:
        return {"answer_depth": float(row[3]), "code_ratio": float(row[4]), "explanation_order": row[5]}
    row = conn.execute(
        "SELECT * FROM learner_preferences WHERE scope_type = 'global' AND scope_id = 'local-user'"
    ).fetchone()
    if row:
        return {"answer_depth": float(row[3]), "code_ratio": float(row[4]), "explanation_order": row[5]}
    return {}
