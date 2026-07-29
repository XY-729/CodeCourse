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
from app.services.personalization.evidence_validator import (
    validate_evidence_quote,
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
    try:
        from app.services.storage import (
            list_observer_runs,
            update_observer_run_status,
        )
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        timeout = timedelta(seconds=OBSERVER_TIMEOUT_SECONDS * 2)
        recovered = 0

        for status in ("pending", "running"):
            runs = list_observer_runs(project_id=0, status=status, limit=200)
            for run in runs:
                created = datetime.fromisoformat(run.created_at)
                if now - created > timeout:
                    update_observer_run_status(
                        run.idempotency_key, "failed",
                        error_message=f"stale_{status}",
                    )
                    recovered += 1
        return recovered
    except Exception:
        logger.exception("Failed to recover stale observer runs")
        return 0


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
    try:
        from app.services.storage import _connect, get_qa_record
        record = get_qa_record(project_id, qa_record_id)
        if record is None:
            return False
        if (
            parent_qa_id is not None
            or relation_type in {"term_explanation", "alternate"}
            or bool(record.selected_text)
        ):
            return True
        with _connect() as conn:
            prior_runs = int(
                conn.execute(
                    "SELECT COUNT(*) FROM observer_runs WHERE project_id = ?",
                    (project_id,),
                ).fetchone()[0]
            )
            if prior_runs == 0:
                return True
            completed = int(
                conn.execute(
                    """SELECT COUNT(*) FROM qa_records
                       WHERE project_id = ? AND answer_md <> ''""",
                    (project_id,),
                ).fetchone()[0]
            )
            if completed % 5 == 0:
                return True
            # A concept mentioned for the first time is a high-information event.
            concept_rows = conn.execute(
                """SELECT id, canonical_name, display_name FROM concepts
                   WHERE length(canonical_name) >= 2"""
            ).fetchall()
            folded = question.casefold()
            for concept in concept_rows:
                names = {
                    str(concept["canonical_name"]).casefold(),
                    str(concept["display_name"]).casefold(),
                }
                if not any(name and name in folded for name in names):
                    continue
                has_state = conn.execute(
                    """SELECT 1 FROM knowledge_states_v2
                       WHERE concept_id = ? LIMIT 1""",
                    (concept["id"],),
                ).fetchone()
                if has_state is None:
                    return True
        return False
    except Exception:
        logger.exception("Failed to classify observer event")
        return False


def _enqueue_observer_job(project_id: int, qa_record_id: int, reason: str) -> None:
    from app.services.storage import _connect
    stamp = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO observer_jobs
               (id, project_id, qa_record_id, reason, payload_json, status,
                attempt_count, available_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, '{}', 'pending', 0, ?, ?, ?)""",
            (
                _idempotency_key(project_id, qa_record_id),
                project_id,
                qa_record_id,
                reason,
                stamp,
                stamp,
                stamp,
            ),
        )
        conn.commit()


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
    user_prompt = OBSERVER_USER_PROMPT_TEMPLATE.replace(
        "{previous_applied_teaching}", ""
    ).format(
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
    _check("current_state", None, cs, "", idx); idx += 1

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
        from app.services.storage import _connect
        with _connect() as count_conn:
            completed_answer_count = int(
                count_conn.execute(
                    "SELECT COUNT(*) FROM qa_records WHERE answer_md <> ''"
                ).fetchone()[0]
            )
        preferences_summary = json.dumps({
            "answer_depth": prefs.answer_depth if prefs else 0.5,
            "code_ratio": prefs.code_ratio if prefs else 0.5,
            "explanation_order": prefs.explanation_order if prefs else "balanced",
            "feedback_count": prefs.feedback_count if prefs else 0,
            "completed_answer_count": completed_answer_count,
        }, ensure_ascii=False)

        user_message_set = {qa_record.question}
        if qa_record.selected_text:
            user_message_set.add(qa_record.selected_text)

        source_excerpt = ""
        if qa_record.source_path:
            try:
                from pathlib import Path
                from app.services.generation_service import project_course_dir
                from app.services.scanner import read_text_file
                from app.services.storage import get_project
                project = get_project(project_id)
                root = (
                    Path(project.local_path)
                    if qa_record.source_type == "file" and project is not None
                    else project_course_dir(project_id)
                )
                source_excerpt = read_text_file(root, qa_record.source_path)[0][:2200]
            except Exception:
                source_excerpt = ""

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
            source_excerpt=source_excerpt,
        )

        previous_trial_json = ""
        previous_trial_record = None
        trial = None
        if qa_record.session_id:
            try:
                from app.services.personalization.teaching.teaching_history import (
                    get_latest_evaluable_teaching_trial,
                )
                from app.services.storage import _connect as _db_connect
                with _db_connect() as trial_conn:
                    trial = get_latest_evaluable_teaching_trial(
                        project_id=project_id,
                        session_id=qa_record.session_id,
                        before_qa_record_id=qa_record_id,
                        conn=trial_conn,
                    )
            except Exception:
                pass

        if trial is not None:
            previous_trial_record = trial
            taught_question = ""
            taught_answer = ""
            try:
                taught_qa = get_qa_record(project_id, trial["qa_record_id"])
                if taught_qa is not None:
                    taught_question = taught_qa.question[:1000]
                    taught_answer = (taught_qa.answer_md or "")[:2500]
            except Exception:
                pass
            previous_trial_json = json.dumps({
                "trial_id": trial["id"],
                "taught_question": taught_question,
                "taught_answer": taught_answer,
                "teaching_goal": trial.get("teaching_goal", ""),
                "strategies": trial.get("strategies", []),
            }, ensure_ascii=False)
            messages[1]["content"] = messages[1]["content"].replace(
                "(no previous teaching to evaluate)",
                previous_trial_json,
            )

        raw_output: Optional[str] = None
        model_usage: dict[str, int] = {}
        model_latency_ms: Optional[int] = None
        resolved_model = settings.get("model")
        last_error: Optional[str] = None

        start_time = __import__("time").time()
        for attempt in range(MAX_RETRIES + 1):
            try:
                call_result = _call_observer_model(messages, settings)
                if isinstance(call_result, str):
                    raw_output = call_result
                else:
                    raw_output = call_result.content
                    model_usage = call_result.usage
                    model_latency_ms = call_result.latency_ms
                    resolved_model = call_result.model
                observation = parse_observer_output(raw_output)
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
        elapsed_ms = int((__import__("time").time() - start_time) * 1000)

        should_store_raw = False
        try:
            from app.services.storage import get_setting
            should_store_raw = get_setting("personalization.observer.store_raw_output") == "true"
        except Exception:
            pass

        accepted, rejected = _validate_all_evidence(observation, user_message_set)

        def _build_accepted_observation() -> InteractionObservation | None:
            if not accepted:
                return None
            from app.services.personalization.observation_schema import (
                CurrentLearningState, PreviousTeachingOutcome,
                KnowledgeEvidence, BehaviorEvidence,
                MisconceptionObservation as MisObs, ExplicitUserFact,
            )
            cs_data = None
            pto_data = None
            k_evs: list[dict] = []
            b_evs: list[dict] = []
            m_evs: list[dict] = []
            f_evs: list[dict] = []
            for a in accepted:
                t = a["obs_type"]
                p = a["payload"]
                if t == "current_state": cs_data = p
                elif t == "previous_teaching_outcome": pto_data = p
                elif t == "knowledge_evidence": k_evs.append(p)
                elif t == "behavior_evidence": b_evs.append(p)
                elif t == "misconception": m_evs.append(p)
                elif t == "explicit_user_fact": f_evs.append(p)
            if cs_data is None:
                return None
            return InteractionObservation(
                schema_version=observation.schema_version,
                current_state=CurrentLearningState(**cs_data),
                previous_teaching_outcome=PreviousTeachingOutcome(**pto_data) if pto_data else None,
                knowledge_evidence=[KnowledgeEvidence(**e) for e in k_evs],
                behavior_evidence=[BehaviorEvidence(**e) for e in b_evs],
                possible_misconceptions=[MisObs(**e) for e in m_evs],
                explicit_user_facts=[ExplicitUserFact(**e) for e in f_evs],
                concept_relations=observation.concept_relations,
                domain_assessments=observation.domain_assessments,
                survey_candidate=observation.survey_candidate,
                diagnostic_candidate=observation.diagnostic_candidate,
                notes=observation.notes,
            )

        filtered_obs = _build_accepted_observation()

        def _write_observations(conn):
            update_observer_run_status(
                run_key, "completed",
                raw_output_json=raw_output if should_store_raw else None,
                latency_ms=elapsed_ms,
                provider=settings.get("provider"),
                model=settings.get("model"),
                conn=conn,
            )

            for entry in accepted + rejected:
                obs_type = entry["obs_type"]
                subject_key = entry.get("subject_key")
                payload = entry["payload"]
                evidence_text = entry["evidence_text"]
                obs_key = _observation_idempotency_key(qa_record_id, obs_type, entry["idx"])
                scope_type = "project"
                scope_id = str(project_id)
                if obs_type == "current_state" or obs_type == "previous_teaching_outcome":
                    scope_type = "session"
                    scope_id = str(qa_record.session_id) if qa_record.session_id else str(qa_record_id)

                status = "accepted_shadow" if entry in accepted else "rejected"
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
                    status=status,
                    conn=conn,
                )

            if filtered_obs is not None:
                apply_shadow_updates(
                    project_id=project_id,
                    session_id=qa_record.session_id,
                    observation=filtered_obs,
                    conn=conn,
                )
                from app.services.personalization.learner_inference_service import (
                    apply_inference_updates,
                )
                apply_inference_updates(
                    project_id=project_id,
                    qa_record_id=qa_record_id,
                    observer_run_id=run_key,
                    observation=filtered_obs,
                    conn=conn,
                )
                if filtered_obs.diagnostic_candidate is not None:
                    from app.services.personalization.learner_inference_service import (
                        _concept_row,
                    )
                    from app.services.personalization.knowledge_state_service import (
                        create_diagnostic_item,
                    )
                    candidate = filtered_obs.diagnostic_candidate.model_dump()
                    source_refs = candidate.get("source_refs") or []
                    source_is_verified = bool(
                        qa_record.source_path
                        and source_excerpt
                        and all(
                            ref.get("source_path") == qa_record.source_path
                            and str(ref.get("excerpt") or "") in source_excerpt
                            for ref in source_refs
                        )
                    )
                    if not source_is_verified:
                        candidate = {}
                    concept_ids: list[str] = []
                    for concept_key in candidate.pop("concept_keys", []):
                        concept = _concept_row(conn, concept_key, concept_key)
                        if concept is not None:
                            concept_ids.append(str(concept["id"]))
                    candidate["concept_ids"] = concept_ids
                    create_diagnostic_item(
                        project_id=project_id,
                        candidate=candidate,
                        source_qa_record_id=qa_record_id,
                        session_id=(
                            str(qa_record.session_id)
                            if qa_record.session_id is not None
                            else None
                        ),
                        strategy_version=OBSERVER_PROMPT_VERSION,
                        conn=conn,
                    )

            from app.services.personalization.learner_inference_service import (
                record_model_call,
            )
            record_model_call(
                project_id=project_id,
                purpose="observer",
                provider=settings.get("provider"),
                model=resolved_model,
                status="completed",
                latency_ms=model_latency_ms or elapsed_ms,
                input_tokens=model_usage.get("input_tokens"),
                output_tokens=model_usage.get("output_tokens"),
                conn=conn,
            )

            if previous_trial_record is not None and filtered_obs is not None and filtered_obs.previous_teaching_outcome is not None:
                pto = filtered_obs.previous_teaching_outcome
                if pto.confidence >= 0.55 and qa_record_id > previous_trial_record["qa_record_id"]:
                    outcome_key = f"teaching-outcome:v1:trial:{previous_trial_record['id']}:evaluation-qa:{qa_record_id}"
                    from app.services.personalization.teaching.outcome_service import (
                        record_teaching_outcome,
                    )
                    record_teaching_outcome(
                        conn=conn,
                        idempotency_key=outcome_key,
                        project_id=project_id,
                        teaching_trial_id=str(previous_trial_record["id"]),
                        result=pto.result,
                        confidence=pto.confidence,
                        reason=pto.reason,
                        evidence_quote=pto.evidence_quote,
                        evidence_type="observer_inference",
                        evidence_ref_id=f"qa:{qa_record_id}",
                        evaluation_qa_record_id=qa_record_id,
                        source_observation_id=(
                            f"observer:v1:qa:{qa_record_id}:"
                            "previous_teaching_outcome:0"
                        ),
                        observer_run_id=run_key,
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
            from app.services.personalization.learner_inference_service import (
                record_model_call,
            )
            record_model_call(
                project_id=project_id,
                purpose="observer",
                provider=(locals().get("settings") or {}).get("provider"),
                model=(locals().get("settings") or {}).get("model"),
                status="failed",
                error_message=str(last_error if last_error else "Unknown observer error"),
            )
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
    reason = (
        "followup" if parent_qa_id is not None
        else "linked_interaction" if relation_type in {"term_explanation", "alternate"}
        else "high_information"
    )
    _enqueue_observer_job(project_id, qa_record_id, reason)

    global _QUEUED_KEYS
    with _OBSERVER_LOCK:
        if run_key in _QUEUED_KEYS:
            return
        if len(_QUEUED_KEYS) >= MAX_QUEUE_DEPTH:
            _mark_run_failed_async(run_key, project_id, qa_record_id, "observer_queue_full")
            return
        _QUEUED_KEYS.add(run_key)

    def _run_and_cleanup():
        try:
            _set_observer_job_status(project_id, qa_record_id, "running")
            _execute_observer_run(project_id, qa_record_id)
            try:
                from app.services.storage import get_observer_run
                run = get_observer_run(run_key)
                status = run.status if run is not None else "failed"
                _set_observer_job_status(
                    project_id,
                    qa_record_id,
                    "completed" if status in ("completed", "skipped") else "failed",
                    None if status in ("completed", "skipped") else getattr(run, "error_message", "observer_failed"),
                )
            except Exception:
                _set_observer_job_status(project_id, qa_record_id, "failed", "status_sync_failed")
        finally:
            with _OBSERVER_LOCK:
                _QUEUED_KEYS.discard(run_key)

    try:
        executor = _get_executor()
        executor.submit(_run_and_cleanup)
    except Exception:
        with _OBSERVER_LOCK:
            _QUEUED_KEYS.discard(run_key)
        _mark_run_failed_async(run_key, project_id, qa_record_id, "executor_submit_failed")
        logger.exception(
            "Failed to submit observer task",
            extra={
                "project_id": project_id,
                "qa_record_id": qa_record_id,
            },
        )


def recover_pending_observer_jobs() -> int:
    """Resume jobs left pending/running after an app restart."""
    try:
        from app.services.storage import _connect
        stamp = datetime.now(timezone.utc).isoformat()
        with _connect() as conn:
            conn.execute(
                """UPDATE observer_jobs SET status='pending', locked_at=NULL,
                   updated_at=? WHERE status='running'""",
                (stamp,),
            )
            rows = conn.execute(
                """SELECT project_id, qa_record_id FROM observer_jobs
                   WHERE status='pending' AND available_at <= ?
                   ORDER BY created_at LIMIT ?""",
                (stamp, MAX_QUEUE_DEPTH),
            ).fetchall()
            conn.commit()
        resumed = 0
        for row in rows:
            project_id = int(row["project_id"])
            qa_record_id = int(row["qa_record_id"])
            run_key = _idempotency_key(project_id, qa_record_id)
            with _OBSERVER_LOCK:
                if run_key in _QUEUED_KEYS:
                    continue
                _QUEUED_KEYS.add(run_key)

            def _resume(pid=project_id, qid=qa_record_id, key=run_key):
                try:
                    _set_observer_job_status(pid, qid, "running")
                    _execute_observer_run(pid, qid)
                    from app.services.storage import get_observer_run
                    run = get_observer_run(key)
                    status = run.status if run is not None else "failed"
                    _set_observer_job_status(
                        pid,
                        qid,
                        "completed" if status in ("completed", "skipped") else "failed",
                        None if status in ("completed", "skipped") else "observer_failed",
                    )
                finally:
                    with _OBSERVER_LOCK:
                        _QUEUED_KEYS.discard(key)

            _get_executor().submit(_resume)
            resumed += 1
        return resumed
    except Exception:
        logger.exception("Failed to recover observer jobs")
        return 0
