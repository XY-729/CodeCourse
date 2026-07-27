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

from app.services.personalization.observation_schema import InteractionObservation
from app.services.personalization.observer_prompt import (
    OBSERVER_PROMPT_VERSION,
    OBSERVER_SYSTEM_PROMPT,
    OBSERVER_USER_PROMPT_TEMPLATE,
)
from app.services.personalization.shadow_learner_model_updater import (
    apply_shadow_updates,
)

logger = logging.getLogger(__name__)

_OBSERVER_EXECUTOR: Optional[ThreadPoolExecutor] = None
_OBSERVER_LOCK = threading.Lock()
_QUEUED_KEYS: set[str] = set()

MAX_WORKERS = 1
MAX_QUEUE_DEPTH = 64
OBSERVER_TIMEOUT_SECONDS = 20
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
    try:
        from app.services.storage import get_setting
        enabled = get_setting("personalization.observer.enabled")
        return enabled == "true"
    except Exception:
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
    if not _is_observer_enabled():
        return False

    if parent_qa_id is not None:
        return True

    if relation_type == "term_explanation":
        return True

    question_lower = question.casefold()
    knowledge_triggers = [
        "我懂", "我学过", "我了解", "我熟悉", "我会",
        "我明白", "我理解", "我精通", "我掌握",
    ]
    if any(trigger in question_lower for trigger in knowledge_triggers):
        return True

    preference_triggers = [
        "以后", "今后", "尽量", "总是", "每次",
        "不要", "别", "希望", "更喜欢",
    ]
    if any(trigger in question_lower for trigger in preference_triggers):
        return True

    outcome_triggers = [
        "没懂", "还是不懂", "明白了", "懂了",
        "换种方式", "换个说法", "再说一遍",
    ]
    if any(trigger in question_lower for trigger in outcome_triggers):
        return True

    sample_rate = _get_observer_sample_rate()
    return deterministic_sample(project_id, qa_record_id, sample_rate)


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
) -> list[dict[str, str]]:
    user_prompt = OBSERVER_USER_PROMPT_TEMPLATE.format(
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

    return [
        {"role": "system", "content": OBSERVER_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def _validate_evidence_quotes(
    observation: InteractionObservation,
    user_message_set: set[str],
) -> InteractionObservation:
    all_quotes: list[tuple[str, str]] = []

    for i, ev in enumerate(observation.knowledge_evidence):
        all_quotes.append(("knowledge_evidence", ev.evidence_quote))
    for i, ev in enumerate(observation.behavior_evidence):
        all_quotes.append(("behavior_evidence", ev.evidence_quote))
    for i, ev in enumerate(observation.possible_misconceptions):
        all_quotes.append(("misconception", ev.evidence_quote))
    for i, ev in enumerate(observation.explicit_user_facts):
        all_quotes.append(("explicit_user_fact", ev.evidence_quote))

    for field, quote in all_quotes:
        found = False
        quote_lower = quote.strip().casefold()
        for msg in user_message_set:
            if quote_lower in msg.casefold():
                found = True
                break
        if not found:
            logger.warning(
                "Observer evidence quote not found in user messages",
                extra={"field": field, "quote": quote[:100]},
            )

    return observation


def _call_observer_model(
    messages: list[dict[str, str]],
    settings: dict[str, Any],
) -> str:
    try:
        from app.services.llm_client import call_openai_compatible_chat  # type: ignore[import-untyped]
    except ImportError:
        raise RuntimeError("LLM client not available for observer")

    return call_openai_compatible_chat(
        base_url=settings["base_url"],
        api_key=settings["api_key"],
        model=settings["model"],
        messages=messages,
        timeout=settings.get("timeout", OBSERVER_TIMEOUT_SECONDS),
    )


def _execute_observer_run(
    project_id: int,
    qa_record_id: int,
) -> None:
    from app.services.storage import (
        ObservationRun,
        InteractionObservationRow,
        get_qa_record,
        get_qa_session,
        get_observer_run,
        insert_observer_run,
        update_observer_run_status,
        insert_interaction_observation,
        get_concept_mastery,
        list_recent_qa_records,
        get_learner_preferences,
        list_all_concepts,
        run_in_transaction,
    )

    run_key = _idempotency_key(project_id, qa_record_id)

    try:
        qa_record = get_qa_record(project_id, qa_record_id)
        if qa_record is None:
            logger.warning("QA record not found for observer", extra={"qa_record_id": qa_record_id})
            return

        existing = get_observer_run(run_key)
        if existing is not None and existing.status in ("completed", "running"):
            return

        insert_observer_run(
            run_id=run_key,
            idempotency_key=run_key,
            project_id=project_id,
            session_id=qa_record.session_id,
            qa_record_id=qa_record_id,
            parent_qa_record_id=qa_record.parent_qa_id,
            mode=_get_observer_mode(),
            provider=None,
            model=None,
            prompt_version=OBSERVER_PROMPT_VERSION,
            input_hash=_compute_input_hash(project_id, qa_record_id),
            status="running",
        )
    except Exception:
        logger.exception("Failed to create observer run record")
        return

    try:
        settings = _get_observer_settings()
        if not settings.get("api_key") or not settings.get("base_url"):
            update_observer_run_status(run_key, "skipped", error_message="No LLM settings configured")
            return

        recent = list_recent_qa_records(project_id, session_id=qa_record.session_id, limit=4) if qa_record.session_id else []

        recent_qa_json = json.dumps(
            [
                {
                    "question": r.question[:500],
                    "answer": (r.answer_md or "")[:1200],
                }
                for r in recent
                if r.id != qa_record_id
            ],
            ensure_ascii=False,
        ) if recent else "[]"

        parent_question = None
        parent_answer = None
        if qa_record.parent_qa_id:
            parent = get_qa_record(project_id, qa_record.parent_qa_id)
            if parent:
                parent_question = parent.question
                parent_answer = parent.answer_md

        concepts = list_all_concepts()
        manual_known: list[str] = []
        manual_unfamiliar: list[str] = []
        for c in concepts:
            mastery = get_concept_mastery(c.id, "global", "local-user")
            if mastery and mastery.manual_status == "known":
                manual_known.append(c.display_name)
            elif mastery and mastery.manual_status == "unknown":
                manual_unfamiliar.append(c.display_name)

        prefs = get_learner_preferences("global", "local-user")
        preferences_summary = json.dumps({
            "answer_depth": prefs.answer_depth if prefs else 0.5,
            "code_ratio": prefs.code_ratio if prefs else 0.5,
            "explanation_order": prefs.explanation_order if prefs else "balanced",
            "feedback_count": prefs.feedback_count if prefs else 0,
        }, ensure_ascii=False)

        user_message_set = {qa_record.question}
        if qa_record.selected_text:
            user_message_set.add(qa_record.selected_text)

        messages = _build_observer_messages(
            question=qa_record.question,
            selected_text=qa_record.selected_text or "",
            source_type=qa_record.source_type,
            source_path=qa_record.source_path,
            parent_question=parent_question,
            parent_answer=parent_answer,
            recent_qa_json=recent_qa_json,
            manual_known=", ".join(manual_known) if manual_known else "(none)",
            manual_unfamiliar=", ".join(manual_unfamiliar) if manual_unfamiliar else "(none)",
            preferences_summary=preferences_summary,
        )

        raw_output: Optional[str] = None
        last_error: Optional[str] = None

        for attempt in range(MAX_RETRIES + 1):
            try:
                raw_output = _call_observer_model(messages, settings)
                observation = parse_observer_output(raw_output)
                observation = _validate_evidence_quotes(observation, user_message_set)
                break
            except ValueError as exc:
                last_error = str(exc)
                if attempt < MAX_RETRIES:
                    messages.append({
                        "role": "user",
                        "content": "The previous output had errors. Please output ONLY valid JSON matching the schema.",
                    })
                    continue
                raise

        should_store_raw = False
        try:
            from app.services.storage import get_setting
            should_store_raw = get_setting("personalization.observer.store_raw_output") == "true"
        except Exception:
            pass

        def _write_observations(conn):
            update_observer_run_status(
                run_key, "completed",
                raw_output_json=raw_output if should_store_raw else None,
                latency_ms=0,
                provider=settings.get("provider"),
                model=settings.get("model"),
                conn=conn,
            )

            idx = 0
            obs_rows: list[tuple[str, str, Any, str]] = []

            current_state = observation.current_state
            obs_rows.append((
                "current_state",
                None,
                current_state.model_dump(),
                "",
            ))

            if observation.previous_teaching_outcome:
                obs_rows.append((
                    "previous_teaching_outcome",
                    None,
                    observation.previous_teaching_outcome.model_dump(),
                    observation.previous_teaching_outcome.evidence_quote,
                ))

            for i, ev in enumerate(observation.knowledge_evidence):
                obs_rows.append((
                    "knowledge_evidence",
                    ev.concept_key or ev.concept_text,
                    ev.model_dump(),
                    ev.evidence_quote,
                ))

            for i, ev in enumerate(observation.behavior_evidence):
                obs_rows.append((
                    "behavior_evidence",
                    ev.hypothesis_key or f"behavior:{i}",
                    ev.model_dump(),
                    ev.evidence_quote,
                ))

            for i, ev in enumerate(observation.possible_misconceptions):
                obs_rows.append((
                    "misconception",
                    ev.concept_key or ev.concept_text,
                    ev.model_dump(),
                    ev.evidence_quote,
                ))

            for i, ev in enumerate(observation.explicit_user_facts):
                obs_rows.append((
                    "explicit_user_fact",
                    f"fact:{ev.fact_type}:{i}",
                    ev.model_dump(),
                    ev.evidence_quote,
                ))

            for obs_type, subject_key, payload, evidence_text in obs_rows:
                obs_key = _observation_idempotency_key(qa_record_id, obs_type, idx)
                scope_type = "project"
                scope_id = str(project_id)
                if obs_type == "current_state" or obs_type == "previous_teaching_outcome":
                    scope_type = "session"
                    scope_id = str(qa_record.session_id) if qa_record.session_id else str(qa_record_id)

                insert_interaction_observation(
                    obs_id=obs_key,
                    idempotency_key=obs_key,
                    run_id=run_key,
                    project_id=project_id,
                    session_id=qa_record.session_id,
                    qa_record_id=qa_record_id,
                    observation_type=obs_type,
                    subject_key=subject_key,
                    scope_type=scope_type,
                    scope_id=scope_id,
                    confidence=0.5 if obs_type in ("current_state", "previous_teaching_outcome") else (
                        payload.get("confidence", 0.5) if isinstance(payload, dict) else 0.5
                    ),
                    payload_json=json.dumps(payload, ensure_ascii=False),
                    evidence_text=evidence_text,
                    status="candidate",
                    conn=conn,
                )
                idx += 1

            apply_shadow_updates(
                project_id=project_id,
                session_id=qa_record.session_id,
                observation=observation,
                conn=conn,
            )

        run_in_transaction(_write_observations)

    except Exception:
        logger.exception(
            "Observer run failed",
            extra={
                "project_id": project_id,
                "qa_record_id": qa_record_id,
                "run_key": run_key,
            },
        )
        try:
            update_observer_run_status(run_key, "failed", error_message=str(
                last_error if last_error else "Unknown observer error"
            )[:500])
        except Exception:
            pass


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
    if not _should_observer_run(project_id, qa_record_id, parent_qa_id, relation_type, question):
        return

    run_key = _idempotency_key(project_id, qa_record_id)

    global _QUEUED_KEYS
    with _OBSERVER_LOCK:
        if run_key in _QUEUED_KEYS:
            return
        if len(_QUEUED_KEYS) >= MAX_QUEUE_DEPTH:
            logger.warning("Observer queue full, dropping run", extra={"run_key": run_key})
            return
        _QUEUED_KEYS.add(run_key)

    def _run_and_cleanup():
        try:
            _execute_observer_run(project_id, qa_record_id)
        finally:
            with _OBSERVER_LOCK:
                _QUEUED_KEYS.discard(run_key)

    try:
        executor = _get_executor()
        executor.submit(_run_and_cleanup)
    except Exception:
        with _OBSERVER_LOCK:
            _QUEUED_KEYS.discard(run_key)
        logger.exception(
            "Failed to submit observer task",
            extra={
                "project_id": project_id,
                "qa_record_id": qa_record_id,
            },
        )
