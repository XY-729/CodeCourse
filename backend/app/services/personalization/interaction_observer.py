from __future__ import annotations

import hashlib
import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, Future
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from pydantic import ValidationError

from app.services.qa_work_scheduler import background_work

from app.services.personalization.observation_schema import InteractionObservation
from app.services.personalization.observer_prompt import (
    OBSERVER_PROMPT_VERSION,
    OBSERVER_SYSTEM_PROMPT,
    OBSERVER_USER_PROMPT_TEMPLATE,
)
from app.services.personalization.shadow_learner_model_updater import (
    apply_shadow_updates,
)
from app.services.personalization.evidence_validator import (
    validate_evidence_quote,
)

logger = logging.getLogger(__name__)

_OBSERVER_EXECUTOR: Optional[ThreadPoolExecutor] = None
_OBSERVER_LOCK = threading.Lock()
_QUEUED_KEYS: set[str] = set()

MAX_WORKERS = 1
MAX_QUEUE_DEPTH = 64
OBSERVER_TIMEOUT_SECONDS = 60
DEFAULT_SAMPLE_RATE = 0.35
MAX_RETRIES = 1


def _get_executor() -> ThreadPoolExecutor:
    global _OBSERVER_EXECUTOR
    if _OBSERVER_EXECUTOR is None:
        with _OBSERVER_LOCK:
            if _OBSERVER_EXECUTOR is None:
                _OBSERVER_EXECUTOR = ThreadPoolExecutor(
                    max_workers=MAX_WORKERS,
                    thread_name_prefix="codecourse-observer",
                )
    return _OBSERVER_EXECUTOR


def _mark_run_failed_async(
    run_key: str,
    project_id: int,
    qa_record_id: int,
    reason: str,
) -> None:
    try:
        from app.services.storage import (
            insert_observer_run,
            update_observer_run_status,
        )
        now = datetime.now(timezone.utc).isoformat()
        insert_observer_run(
            run_id=run_key,
            idempotency_key=run_key,
            project_id=project_id,
            session_id=None,
            qa_record_id=qa_record_id,
            parent_qa_record_id=None,
            mode="shadow",
            provider=None,
            model=None,
            prompt_version=OBSERVER_PROMPT_VERSION,
            input_hash=_compute_input_hash(project_id, qa_record_id),
            status="failed",
        )
        update_observer_run_status(run_key, "failed", error_message=reason)
    except Exception:
        logger.exception("Failed to mark observer run as failed", extra={"run_key": run_key})


def recover_stale_runs() -> int:
    return _retire_observer_work()


def shutdown_observer(wait: bool = True) -> None:
    global _OBSERVER_EXECUTOR
    if _OBSERVER_EXECUTOR is not None:
        _OBSERVER_EXECUTOR.shutdown(wait=wait)
        _OBSERVER_EXECUTOR = None


def deterministic_sample(
    project_id: int,
    qa_record_id: int,
    sample_rate: float,
) -> bool:
    rate = max(0.0, min(1.0, sample_rate))
    digest = hashlib.sha256(
        f"{project_id}:{qa_record_id}:observer-v1".encode("utf-8")
    ).hexdigest()
    value = int(digest[:8], 16) / 0xFFFFFFFF
    return value < rate


def _idempotency_key(project_id: int, qa_record_id: int) -> str:
    return f"observer:v1:project:{project_id}:qa:{qa_record_id}"


def _observation_idempotency_key(
    qa_record_id: int, obs_type: str, index: int
) -> str:
    return f"observer:v1:qa:{qa_record_id}:{obs_type}:{index}"


def _is_observer_enabled() -> bool:
    # Always-on evidence analysis is the local manifest/action flow, not this
    # retired second model request. Imported legacy true cannot reactivate it.
    return False


def _get_observer_mode() -> str:
    try:
        from app.services.storage import get_setting
        return get_setting("personalization.observer.mode") or "shadow"
    except Exception:
        return "shadow"


def _get_observer_sample_rate() -> float:
    try:
        from app.services.storage import get_setting
        rate = get_setting("personalization.observer.sample_rate")
        if rate is not None:
            return float(rate)
    except (ValueError, TypeError):
        pass
    return DEFAULT_SAMPLE_RATE


def _should_observer_run(
    project_id: int,
    qa_record_id: int,
    parent_qa_id: Optional[int],
    relation_type: Optional[str],
    question: str,
) -> bool:
    return False


def _enqueue_observer_job(project_id: int, qa_record_id: int, reason: str) -> None:
    """Retired queue producer: never enqueue legacy observation work."""
    return None


def _set_observer_job_status(
    project_id: int,
    qa_record_id: int,
    status: str,
    error: str | None = None,
) -> None:
    from app.services.storage import _connect
    stamp = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """UPDATE observer_jobs
               SET status = ?, last_error = ?, updated_at = ?,
                   locked_at = CASE WHEN ? = 'running' THEN ? ELSE locked_at END,
                   attempt_count = attempt_count + CASE WHEN ? = 'running' THEN 1 ELSE 0 END
               WHERE project_id = ? AND qa_record_id = ?""",
            (status, error, stamp, status, stamp, status, project_id, qa_record_id),
        )
        conn.commit()


def _get_observer_settings() -> dict[str, Any]:
    try:
        from app.services.storage import get_llm_settings
        llm = get_llm_settings()
        return {
            "provider": llm.get("provider", "deepseek"),
            "base_url": llm.get("base_url", ""),
            "model": llm.get("model", ""),
            "api_key": llm.get("api_key", ""),
            "timeout": OBSERVER_TIMEOUT_SECONDS,
        }
    except Exception:
        return {}


def extract_json_object(raw: str) -> dict[str, Any]:
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
        raise ValueError("Observer output does not contain a JSON object")

    candidate = text[start : end + 1]
    parsed = json.loads(candidate)

    if not isinstance(parsed, dict):
        raise ValueError("Observer output root must be a JSON object")

    return parsed


def parse_observer_output(raw: str) -> InteractionObservation:
    try:
        data = extract_json_object(raw)
        return InteractionObservation.model_validate(data)
    except (json.JSONDecodeError, ValidationError, ValueError, TypeError) as exc:
        raise ValueError(f"Invalid observer output: {exc}") from exc


def _build_observer_messages(
    question: str,
    selected_text: str,
    source_type: Optional[str],
    source_path: Optional[str],
    parent_question: Optional[str],
    parent_answer: Optional[str],
    recent_qa_json: str,
    manual_known: str,
    manual_unfamiliar: str,
    preferences_summary: str,
    previous_trial_json_for_msg: str = "",
    source_excerpt: str = "",
) -> list[dict[str, str]]:
    user_prompt = OBSERVER_USER_PROMPT_TEMPLATE.format(
        previous_applied_teaching=previous_trial_json_for_msg or "(no previous teaching to evaluate)",
        current_user_message=question[:2000],
        current_selected_text=(selected_text or "")[:1500],
        source_type=source_type or "unknown",
        source_path=source_path or "",
        parent_question=(parent_question or "")[:500],
        parent_answer=(parent_answer or "")[:3000],
        recent_conversations=recent_qa_json,
        manual_known_concepts=manual_known,
        manual_unfamiliar_concepts=manual_unfamiliar,
        current_preferences=preferences_summary,
    )

    if previous_trial_json_for_msg:
        user_prompt = user_prompt.replace(
            "(no previous teaching to evaluate)",
            previous_trial_json_for_msg,
        )
    schema_json = json.dumps(
        InteractionObservation.model_json_schema(),
        ensure_ascii=False,
        separators=(",", ":"),
    )
    user_prompt += (
        "\n\n<required_json_schema>\n"
        + schema_json
        + "\n</required_json_schema>\n"
        + "严格按该 Schema 输出；新输出使用 schema_version=2。"
    )

    user_prompt += (
        "\nDiagnostic candidate rules: return null unless a short check is useful; "
        "ground it in supplied course, code, selection, or prior answer; use a "
        "locally gradeable type with exactly one answer and no fixed question bank."
    )
    user_prompt += (
        "\n\n<trusted_source_excerpt>\n"
        + (source_excerpt[:2200] if source_excerpt else "(none; diagnostic_candidate must be null)")
        + "\n</trusted_source_excerpt>"
    )
    return [
        {"role": "system", "content": OBSERVER_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def _validate_all_evidence(
    observation: InteractionObservation,
    user_message_set: set[str],
) -> tuple[list[dict], list[dict]]:
    accepted: list[dict] = []
    rejected: list[dict] = []

    def _check(obs_type: str, subject_key: str | None, payload: dict, quote: str, idx: int):
        result = validate_evidence_quote(quote, user_message_set)
        entry = {
            "obs_type": obs_type,
            "subject_key": subject_key,
            "payload": payload,
            "evidence_text": quote,
            "idx": idx,
        }
        if result.valid:
            accepted.append(entry)
        else:
            entry["rejection_reason"] = result.rejection_reason
            rejected.append(entry)
            logger.warning(
                "Observer evidence quote REJECTED",
                extra={
                    "obs_type": obs_type,
                    "reason": result.rejection_reason,
                    "quote": quote[:100],
                },
            )

    idx = 0
    cs = observation.current_state.model_dump()
    # Session intent is a model interpretation, not a quoted mastery claim.
    # The schema has no evidence_quote here; applying quote validation rejected
    # every state and consequently prevented ALL accepted evidence from applying.
    accepted.append({
        "obs_type": "current_state", "subject_key": None, "payload": cs,
        "evidence_text": "", "idx": idx,
    })
    idx += 1

    if observation.previous_teaching_outcome:
        pto = observation.previous_teaching_outcome.model_dump()
        _check("previous_teaching_outcome", None, pto, observation.previous_teaching_outcome.evidence_quote, idx); idx += 1

    for i, ev in enumerate(observation.knowledge_evidence):
        _check("knowledge_evidence", ev.concept_key or ev.concept_text, ev.model_dump(), ev.evidence_quote, idx); idx += 1

    for i, ev in enumerate(observation.behavior_evidence):
        _check("behavior_evidence", ev.hypothesis_key or f"behavior:{i}", ev.model_dump(), ev.evidence_quote, idx); idx += 1

    for i, ev in enumerate(observation.possible_misconceptions):
        _check("misconception", ev.concept_key or ev.concept_text, ev.model_dump(), ev.evidence_quote, idx); idx += 1

    for i, ev in enumerate(observation.explicit_user_facts):
        _check("explicit_user_fact", f"fact:{ev.fact_type}:{i}", ev.model_dump(), ev.evidence_quote, idx); idx += 1

    return accepted, rejected


def _call_observer_model(
    messages: list[dict[str, str]],
    settings: dict[str, Any],
) -> Any:
    try:
        from app.services.llm_client import call_openai_compatible_chat_result
    except ImportError:
        raise RuntimeError("LLM client not available for observer")

    return call_openai_compatible_chat_result(
        base_url=settings["base_url"],
        api_key=settings["api_key"],
        model=settings["model"],
        messages=messages,
        timeout=settings.get("timeout", OBSERVER_TIMEOUT_SECONDS),
        max_attempts=1,
        max_tokens=8192,
    )


def _manual_mastery_names() -> tuple[list[str], list[str]]:
    from app.services.storage import _connect
    with _connect() as conn:
        rows = conn.execute("""SELECT c.display_name, m.manual_status
            FROM concepts c JOIN concept_mastery m ON m.concept_id=c.id
            WHERE m.scope_type='global' AND m.scope_id='local-user'
              AND m.manual_status IN ('known','unknown')
            ORDER BY c.domain,c.canonical_name""").fetchall()
    return ([row["display_name"] for row in rows if row["manual_status"] == "known"],
            [row["display_name"] for row in rows if row["manual_status"] == "unknown"])


@background_work()
def _execute_observer_run(
    project_id: int,
    qa_record_id: int,
) -> None:
    """Retired execution boundary, including direct calls from old workers."""
    return None


def _compute_input_hash(project_id: int, qa_record_id: int) -> str:
    return hashlib.sha256(
        f"observer-input:{project_id}:{qa_record_id}".encode("utf-8")
    ).hexdigest()[:16]


def schedule_interaction_observation(
    project_id: int,
    qa_record_id: int,
    parent_qa_id: Optional[int] = None,
    relation_type: Optional[str] = None,
    question: str = "",
) -> None:
    """Normal content already carries its validated teaching manifest."""
    return None


def recover_pending_observer_jobs() -> int:
    """Cancel legacy durable work locally; recovery must never request AI."""
    _retire_observer_work()
    return 0


def _retire_observer_work() -> int:
    """Keep queued history auditable while making restart deterministic."""
    from app.services.storage import _connect
    stamp = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        jobs = conn.execute(
            """UPDATE observer_jobs SET status='cancelled', locked_at=NULL,
               last_error='retired_by_teaching_facts_v1', updated_at=?
               WHERE status IN ('queued','pending','running','retry')""", (stamp,),
        ).rowcount
        runs = conn.execute(
            """UPDATE observer_runs SET status='skipped',
               error_message='retired_by_teaching_facts_v1'
               WHERE status IN ('pending','running')""",
        ).rowcount
        conn.commit()
    return jobs + runs
