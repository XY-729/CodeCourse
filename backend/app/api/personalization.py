"""
Personalization API — atomic concept feedback, events, mastery projection.

Desktop: Python mirror of TypeScript masteryEngine.ts.
Cross-platform consistency verified by shared golden vectors.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import (
    AnswerFeedbackRequest,
    LearnerPreferencesUpdate,
    PersonalizationResolveRequest,
    TermImpressionsBatchRequest,
)
from app.services.personalization_service import (
    GLOBAL_SCOPE_ID,
    apply_preference_feedback,
    concept_scope,
    effective_preferences,
    resolve_concept,
    update_preferences,
)
from app.services.storage import (
    Concept,
    ConceptMastery,
    LearningEventRecord,
    delete_concept_mastery_by_scope,
    delete_events_by_scope,
    delete_preferences_by_scope,
    get_all_learning_events_for_scope,
    get_concept,
    get_concept_by_key,
    get_concept_mastery,
    get_concept_mastery_batch,
    get_event_by_id,
    get_event_by_idempotency_key,
    get_learning_events,
    get_project,
    insert_learning_event,
    list_all_concepts,
    list_preference_events,
    run_in_transaction,
    search_concepts,
    upsert_concept,
    upsert_concept_mastery,
    upsert_term_impression,
)

router = APIRouter(prefix="/api/projects", tags=["personalization"])

CURRENT_SCHEMA_VERSION = 1
PRIOR_KNOWN = 1.0
PRIOR_UNKNOWN = 1.0

# ---- Evidence deltas (mirrors TypeScript AUTO_EVIDENCE_DELTAS) ----
AUTO_EVIDENCE_DELTAS = {
    "asked_definition": (0, 3),
    "asked_clarification": (0, 2),
    "used_correctly": (1, 0),
    "opened_explanation": (0, 1),
    "completed_exercise": (3, 0),
    "saved_learning_anchor": (2, 0),
    "manual_override_known": (0, 0),
    "manual_override_unknown": (0, 0),
    "manual_override_cleared": (0, 0),
    "event_voided": (0, 0),
}


def _require_project(project_id: int) -> None:
    if get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")


def _scope_for_concept(project_id: int, concept_id: str) -> tuple[str, str]:
    concept = get_concept(concept_id)
    if concept is None:
        raise HTTPException(status_code=404, detail="Concept not found")
    return concept_scope(concept, project_id)


# ---- Helpers ----

def _make_concept_key(namespace: str, name: str, project_id: Optional[int] = None) -> str:
    if namespace == "project" and project_id:
        return f"project:{project_id}:symbol:{name}"
    return f"global:{namespace}:{name}"


def _concept_response(c: Concept) -> dict:
    return {
        "id": c.id,
        "conceptKey": c.concept_key,
        "canonicalName": c.canonical_name,
        "displayName": c.display_name,
        "domain": c.domain,
        "conceptType": c.concept_type,
        "aliases": json.loads(c.aliases_json) if c.aliases_json else [],
        "difficulty": c.difficulty,
        "createdAt": c.created_at,
    }


def _mastery_response(m: ConceptMastery) -> dict:
    return {
        "id": m.id,
        "conceptId": m.concept_id,
        "scope": {"type": m.scope_type, "id": m.scope_id},
        "knownEvidence": m.known_evidence,
        "unknownEvidence": m.unknown_evidence,
        "mastery": m.mastery,
        "uncertainty": m.uncertainty,
        "manualStatus": m.manual_status,
        "sequence": m.sequence,
        "lastSeenAt": m.last_seen_at,
        "updatedAt": m.updated_at,
    }


def _event_response(e: LearningEventRecord) -> dict:
    return {
        "eventId": e.id,
        "idempotencyKey": e.idempotency_key,
        "schemaVersion": e.schema_version,
        "conceptId": e.concept_id,
        "scope": {"type": e.scope_type, "id": e.scope_id},
        "eventType": e.event_type,
        "direction": e.direction,
        "strength": e.strength,
        "source": e.source,
        "targetEventId": e.target_event_id,
        "evidenceText": e.evidence_text,
        "sessionId": e.session_id,
        "qaRecordId": e.qa_record_id,
        "isVoided": e.is_voided,
        "createdAt": e.created_at,
    }


STYLE_SURVEY_COOLDOWN_SECONDS = 24 * 60 * 60


def _survey_is_due(last_survey_at: Optional[str], now: Optional[datetime] = None) -> bool:
    if not last_survey_at:
        return True
    try:
        last = datetime.fromisoformat(last_survey_at.replace("Z", "+00:00"))
    except ValueError:
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return (current - last).total_seconds() >= STYLE_SURVEY_COOLDOWN_SECONDS


def _preferences_response(preferences) -> dict:
    return {
        "scope": {
            "type": preferences.scope_type,
            "id": preferences.scope_id,
        },
        "answerDepth": preferences.answer_depth,
        "codeRatio": preferences.code_ratio,
        "explanationOrder": preferences.explanation_order,
        "prerequisiteDetail": preferences.prerequisite_detail,
        "terminologyDensity": preferences.terminology_density,
        "feedbackCount": preferences.feedback_count,
        "surveyEnabled": preferences.survey_enabled,
        "lastSurveyAt": preferences.last_survey_at,
        "surveyDue": bool(
            preferences.survey_enabled
            and preferences.feedback_count >= 5
            and _survey_is_due(preferences.last_survey_at)
        ),
        "updatedAt": preferences.updated_at,
    }


def _calculate_mastery(known: float, unknown: float) -> tuple[float, float]:
    total = known + unknown
    if total <= 0:
        return (0.5, 0.7071)
    return (known / total, 1.0 / math.sqrt(total))


def _replay_events(events: list[LearningEventRecord]) -> tuple[float, float, Optional[str]]:
    """Replay events to compute (known, unknown, manualStatus)."""
    known = PRIOR_KNOWN
    unknown = PRIOR_UNKNOWN
    manual_status = None

    # Collect voided target IDs
    voided_ids = set()
    for e in events:
        if e.event_type == "event_voided" and e.target_event_id:
            voided_ids.add(e.target_event_id)

    active = sorted(
        [e for e in events if not e.is_voided and e.id not in voided_ids],
        key=lambda x: (x.created_at, x.id),
    )
    for e in active:
        if e.event_type == "manual_override_known":
            manual_status = "known"
        elif e.event_type == "manual_override_unknown":
            manual_status = "unknown"
        elif e.event_type == "manual_override_cleared":
            manual_status = None
        elif manual_status is None:
            # Automatic event — only applies when no manual override
            dk, du = AUTO_EVIDENCE_DELTAS.get(e.event_type, (0, 0))
            if e.source != "explicit_user":
                dk = min(dk, 1)
                du = min(du, 1)
            known += dk * e.strength
            unknown += du * e.strength

    known = max(PRIOR_KNOWN, known)
    unknown = max(PRIOR_UNKNOWN, unknown)
    return (known, unknown, manual_status)


# ---- Concepts ----

@router.get("/{project_id}/personalization/concepts")
def list_concepts(
    project_id: int,
    query: str = Query(default="", max_length=200),
) -> list[dict]:
    _require_project(project_id)
    results = search_concepts(query.strip()) if query.strip() else list_all_concepts()
    return [_concept_response(c) for c in results]


@router.post("/{project_id}/personalization/concepts")
def create_concept(project_id: int, body: dict) -> dict:
    """Create or get-or-create a concept by conceptKey."""
    _require_project(project_id)
    concept_key = str(body.get("conceptKey", "")).strip()
    canonical_name = str(body.get("canonicalName", "")).strip()
    display_name = str(body.get("displayName", "")).strip()
    domain = str(body.get("domain", "general")).strip()
    concept_type = str(body.get("conceptType", "theory")).strip()
    aliases = body.get("aliases", [])
    difficulty = float(body.get("difficulty", 0.5))

    if not concept_key:
        raise HTTPException(status_code=400, detail="conceptKey is required")
    if not canonical_name:
        raise HTTPException(status_code=400, detail="canonicalName is required")

    # Get-or-create
    existing = get_concept_by_key(concept_key)
    if existing:
        return _concept_response(existing)

    c = upsert_concept(
        concept_id=str(uuid4()),
        concept_key=concept_key,
        canonical_name=canonical_name,
        display_name=display_name or canonical_name,
        domain=domain,
        concept_type=concept_type,
        aliases_json=json.dumps(aliases if isinstance(aliases, list) else []),
        difficulty=difficulty,
    )
    return _concept_response(c)


# ---- Mastery batch ----

@router.get("/{project_id}/personalization/mastery")
def get_mastery_batch(
    project_id: int,
    concept_ids: str = Query(default="", description="Comma-separated concept IDs"),
) -> dict[str, dict]:
    _require_project(project_id)
    ids = [cid.strip() for cid in concept_ids.split(",") if cid.strip()]
    if not ids:
        return {}
    results = {}
    for concept_id in ids:
        scope_type, scope_id = _scope_for_concept(project_id, concept_id)
        mastery = get_concept_mastery(concept_id, scope_type, scope_id)
        if mastery:
            results[concept_id] = _mastery_response(mastery)
    return results


# ---- Atomic explicit feedback (event + projection in one transaction) ----

def _atomic_feedback(
    project_id: int,
    concept_id: str,
    event_type: str,
    direction: str,
    idempotency_key: str,
    evidence_text: Optional[str] = None,
) -> dict:
    """Core: insert event + recompute projection in one transaction."""
    _require_project(project_id)
    concept = get_concept(concept_id)
    if concept is None:
        raise HTTPException(status_code=404, detail="Concept not found")
    scope_type, scope_id = concept_scope(concept, project_id)

    def do_tx(conn):
        now = datetime.now(timezone.utc).isoformat()
        event_id = str(uuid4())

        # Idempotency check
        existing_evt = get_event_by_idempotency_key(idempotency_key, conn=conn)
        if existing_evt is not None:
            # Return current mastery for idempotent calls
            m = get_concept_mastery(concept_id, scope_type, scope_id, conn=conn)
            return {
                "event": _event_response(existing_evt),
                "mastery": _mastery_response(m) if m else None,
                "idempotent": True,
            }

        # Insert event
        event = insert_learning_event(
            event_id=event_id,
            idempotency_key=idempotency_key,
            schema_version=CURRENT_SCHEMA_VERSION,
            concept_id=concept_id,
            scope_type=scope_type,
            scope_id=scope_id,
            event_type=event_type,
            direction=direction,
            strength=1.0,
            source="explicit_user",
            evidence_text=evidence_text,
            conn=conn,
        )

        # Recompute projection from all events
        all_events = get_learning_events(concept_id, scope_type, scope_id, conn=conn)
        known, unknown, manual_status = _replay_events(all_events)
        mst, unc = _calculate_mastery(known, unknown)

        existing_m = get_concept_mastery(concept_id, scope_type, scope_id, conn=conn)
        mastery_id = existing_m.id if existing_m else str(uuid4())
        seq = (existing_m.sequence + 1) if existing_m else 1

        mastery = upsert_concept_mastery(
            mastery_id=mastery_id,
            concept_id=concept_id,
            scope_type=scope_type,
            scope_id=scope_id,
            known_evidence=known,
            unknown_evidence=unknown,
            mastery=mst,
            uncertainty=unc,
            manual_status=manual_status,
            sequence=seq,
            conn=conn,
        )
        return {"event": _event_response(event), "mastery": _mastery_response(mastery), "idempotent": False}

    result = run_in_transaction(do_tx)
    return result


@router.post("/{project_id}/personalization/mark-known")
def mark_concept_known(project_id: int, body: dict) -> dict:
    """
    Atomic: mark concept as known.
    Appends manual_override_known event + updates mastery projection.
    Evidence counts are NOT modified.
    """
    concept_id = str(body.get("conceptId", ""))
    idempotency_key = str(body.get("idempotencyKey", ""))
    evidence_text = body.get("evidenceText")
    if not concept_id or not idempotency_key:
        raise HTTPException(status_code=400, detail="conceptId and idempotencyKey are required")
    return _atomic_feedback(
        project_id, concept_id,
        event_type="manual_override_known",
        direction="known",
        idempotency_key=idempotency_key,
        evidence_text=evidence_text,
    )


@router.post("/{project_id}/personalization/mark-unknown")
def mark_concept_unknown(project_id: int, body: dict) -> dict:
    """
    Atomic: mark concept as unknown.
    Appends manual_override_unknown event + updates mastery projection.
    Evidence counts are NOT modified.
    """
    concept_id = str(body.get("conceptId", ""))
    idempotency_key = str(body.get("idempotencyKey", ""))
    evidence_text = body.get("evidenceText")
    if not concept_id or not idempotency_key:
        raise HTTPException(status_code=400, detail="conceptId and idempotencyKey are required")
    return _atomic_feedback(
        project_id, concept_id,
        event_type="manual_override_unknown",
        direction="unknown",
        idempotency_key=idempotency_key,
        evidence_text=evidence_text,
    )


@router.post("/{project_id}/personalization/clear-override")
def clear_concept_override(project_id: int, body: dict) -> dict:
    """
    Atomic: clear manual override.
    Appends manual_override_cleared event + recomputes projection from automatic events.
    """
    concept_id = str(body.get("conceptId", ""))
    idempotency_key = str(body.get("idempotencyKey", ""))
    if not concept_id or not idempotency_key:
        raise HTTPException(status_code=400, detail="conceptId and idempotencyKey are required")
    return _atomic_feedback(
        project_id, concept_id,
        event_type="manual_override_cleared",
        direction="neutral",
        idempotency_key=idempotency_key,
    )


# ---- Events ----

@router.get("/{project_id}/personalization/events/{concept_id}")
def get_events(project_id: int, concept_id: str) -> list[dict]:
    _require_project(project_id)
    scope_type, scope_id = _scope_for_concept(project_id, concept_id)
    events = get_learning_events(concept_id, scope_type, scope_id)
    return [_event_response(e) for e in events]


@router.post("/{project_id}/personalization/events/{event_id}/void")
def void_event(project_id: int, event_id: str, body: dict = {}) -> dict:
    """
    Append an event_voided compensation event.
    Does NOT UPDATE the original event (preserves immutability).
    """
    _require_project(project_id)

    original = get_event_by_id(event_id)
    if original is None:
        raise HTTPException(status_code=404, detail="Event not found")

    concept_id = str(body.get("conceptId", original.concept_id))
    scope_type, scope_id = _scope_for_concept(project_id, concept_id)
    if original.scope_type != scope_type or original.scope_id != scope_id:
        raise HTTPException(status_code=404, detail="Event not found in this profile")
    idempotency_key = str(body.get("idempotencyKey", f"void:{event_id}:{datetime.now(timezone.utc).isoformat()}"))
    reason = body.get("reason", "User requested undo")

    def do_tx(conn):
        compensation = insert_learning_event(
            event_id=str(uuid4()),
            idempotency_key=idempotency_key,
            schema_version=CURRENT_SCHEMA_VERSION,
            concept_id=concept_id,
            scope_type=scope_type,
            scope_id=scope_id,
            event_type="event_voided",
            direction="neutral",
            strength=1.0,
            source="explicit_user",
            target_event_id=event_id,
            evidence_text=reason,
        )
        # Recompute projection
        all_events = get_learning_events(concept_id, scope_type, scope_id)
        known, unknown, manual_status = _replay_events(all_events)
        mst, unc = _calculate_mastery(known, unknown)
        existing_m = get_concept_mastery(concept_id, scope_type, scope_id)
        if existing_m:
            upsert_concept_mastery(
                mastery_id=existing_m.id,
                concept_id=concept_id,
                scope_type=scope_type,
                scope_id=scope_id,
                known_evidence=known,
                unknown_evidence=unknown,
                mastery=mst,
                uncertainty=unc,
                manual_status=manual_status,
                sequence=existing_m.sequence + 1,
            )
        return _event_response(compensation)

    return run_in_transaction(do_tx)


# ---- Profile Management (privacy reset) ----

@router.delete("/{project_id}/personalization/profile")
def reset_profile(
    project_id: int,
    scope: str = Query(default="project", pattern="^(project|global)$"),
) -> dict:
    _require_project(project_id)
    scope_type = "global" if scope == "global" else "project"
    scope_id = GLOBAL_SCOPE_ID if scope_type == "global" else str(project_id)

    def do_tx(conn):
        deleted_mastery = delete_concept_mastery_by_scope(scope_type, scope_id)
        deleted_events = delete_events_by_scope(scope_type, scope_id)
        deleted_preferences, deleted_preference_events = delete_preferences_by_scope(
            scope_type,
            scope_id,
        )
        return {
            "status": "ok",
            "scope": scope,
            "deletedMasteryCount": deleted_mastery,
            "deletedEventCount": deleted_events,
            "deletedPreferencesCount": deleted_preferences,
            "deletedPreferenceEventsCount": deleted_preference_events,
        }

    return run_in_transaction(do_tx)


# ---- Cross-platform personalization contract ----

@router.post("/{project_id}/personalization/resolve")
def resolve_candidates(
    project_id: int,
    body: PersonalizationResolveRequest,
) -> dict:
    _require_project(project_id)
    resolved = []
    for candidate in body.terms:
        try:
            concept = resolve_concept(
                project_id,
                candidate.text,
                candidate.source,
                candidate.confidence,
            )
        except ValueError:
            continue
        scope_type, scope_id = concept_scope(concept, project_id)
        mastery = get_concept_mastery(concept.id, scope_type, scope_id)
        resolved.append(
            {
                "text": candidate.text,
                "source": candidate.source,
                "confidence": candidate.confidence,
                "contextRelevance": candidate.context_relevance,
                "concept": _concept_response(concept),
                "mastery": _mastery_response(mastery) if mastery else None,
            }
        )
    return {"terms": resolved}


@router.get("/{project_id}/personalization/preferences")
def get_preferences(project_id: int) -> dict:
    _require_project(project_id)
    return _preferences_response(effective_preferences(project_id))


@router.put("/{project_id}/personalization/preferences")
def put_preferences(project_id: int, body: LearnerPreferencesUpdate) -> dict:
    _require_project(project_id)
    values = body.model_dump(exclude_none=True, exclude={"scope"})
    return _preferences_response(
        update_preferences(project_id, values, scope=body.scope)
    )


@router.post("/{project_id}/personalization/answer-feedback")
def answer_feedback(project_id: int, body: AnswerFeedbackRequest) -> dict:
    _require_project(project_id)
    preferences = apply_preference_feedback(
        project_id,
        dimension=body.dimension,
        choice=body.choice,
        source=body.source,
        idempotency_key=body.idempotency_key,
        qa_record_id=body.qa_record_id,
        scope=body.scope,
    )
    return _preferences_response(preferences)


@router.post("/{project_id}/personalization/term-impressions/batch")
def record_term_impressions(
    project_id: int,
    body: TermImpressionsBatchRequest,
) -> dict:
    _require_project(project_id)
    saved = 0
    for impression in body.impressions:
        upsert_term_impression(
            project_id,
            impression.source_type,
            impression.source_path,
            impression.term_text,
            impression.content_hash,
            concept_id=impression.concept_id,
            displayed=impression.displayed,
            opened=impression.opened,
            feedback=impression.feedback,
            display_style=impression.display_style,
        )
        saved += 1
    return {"status": "ok", "saved": saved}


@router.get("/{project_id}/personalization/profile")
def get_profile(project_id: int) -> dict:
    _require_project(project_id)
    entries = []
    for concept in list_all_concepts():
        scope_type, scope_id = concept_scope(concept, project_id)
        mastery = get_concept_mastery(concept.id, scope_type, scope_id)
        if mastery is None:
            continue
        judgement = mastery.manual_status
        if judgement == "unknown":
            judgement = "unfamiliar"
        if not judgement:
            judgement = (
                "known"
                if mastery.mastery >= 0.75
                else "unfamiliar"
                if mastery.mastery <= 0.35
                else "uncertain"
            )
        entries.append(
            {
                "concept": _concept_response(concept),
                "mastery": _mastery_response(mastery),
                "judgement": judgement,
            }
        )
    entries.sort(
        key=lambda item: (
            {"unfamiliar": 0, "uncertain": 1, "known": 2}.get(
                item["judgement"],
                1,
            ),
            item["concept"]["displayName"].casefold(),
        )
    )
    global_events = list_preference_events("global", GLOBAL_SCOPE_ID, 50)
    project_events = list_preference_events("project", str(project_id), 50)
    return {
        "preferences": _preferences_response(effective_preferences(project_id)),
        "concepts": entries,
        "preferenceEvidence": [
            {
                "id": event.id,
                "dimension": event.dimension,
                "delta": event.delta,
                "source": event.source,
                "evidenceText": event.evidence_text,
                "qaRecordId": event.qa_record_id,
                "createdAt": event.created_at,
            }
            for event in sorted(
                [*global_events, *project_events],
                key=lambda event: event.created_at,
                reverse=True,
            )[:50]
        ],
    }


# ---------- Phase 1: Observer Settings & Shadow Debug APIs ----------

OBSERVER_SETTINGS_PREFIX = "personalization.observer"


def _get_observer_setting(key: str, default: str = "") -> str:
    from app.services.storage import get_setting
    val = get_setting(f"{OBSERVER_SETTINGS_PREFIX}.{key}")
    return val if val else default


def _set_observer_setting(key: str, value: str) -> None:
    from app.services.storage import set_setting
    set_setting(f"{OBSERVER_SETTINGS_PREFIX}.{key}", value)


@router.get("/observer-settings")
def get_observer_settings() -> dict:
    return {
        "enabled": _get_observer_setting("enabled", "false"),
        "mode": _get_observer_setting("mode", "shadow"),
        "provider": _get_observer_setting("provider", "inherit"),
        "base_url": _get_observer_setting("base_url", "inherit"),
        "model": _get_observer_setting("model", "inherit"),
        "sample_rate": _get_observer_setting("sample_rate", "0.35"),
        "timeout_seconds": _get_observer_setting("timeout_seconds", "20"),
        "max_history_records": _get_observer_setting("max_history_records", "4"),
        "store_raw_output": _get_observer_setting("store_raw_output", "false"),
    }


@router.put("/observer-settings")
def put_observer_settings(body: dict) -> dict:
    allowed = {
        "enabled", "mode", "provider", "base_url", "model",
        "sample_rate", "timeout_seconds", "max_history_records",
        "store_raw_output",
    }
    for key, value in body.items():
        if key in allowed and isinstance(value, str):
            _set_observer_setting(key, value)
    return get_observer_settings()


@router.get("/observer-runs")
def list_observer_runs_endpoint(
    project_id: int,
    status: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
) -> list[dict]:
    from app.services.storage import list_observer_runs
    runs = list_observer_runs(project_id, status=status, limit=limit)
    return [
        {
            "id": r.id,
            "projectId": r.project_id,
            "qaRecordId": r.qa_record_id,
            "parentQaRecordId": r.parent_qa_record_id,
            "mode": r.mode,
            "provider": r.provider,
            "model": r.model,
            "promptVersion": r.prompt_version,
            "status": r.status,
            "latencyMs": r.latency_ms,
            "errorMessage": r.error_message,
            "createdAt": r.created_at,
        }
        for r in runs
    ]


@router.get("/observer-runs/{run_id}")
def get_observer_run_endpoint(run_id: str) -> dict:
    from app.services.storage import get_observer_run_by_id
    run = get_observer_run_by_id(run_id)
    if run is None:
        raise HTTPException(404, "Observer run not found")
    return {
        "id": run.id,
        "projectId": run.project_id,
        "qaRecordId": run.qa_record_id,
        "parentQaRecordId": run.parent_qa_record_id,
        "mode": run.mode,
        "provider": run.provider,
        "model": run.model,
        "promptVersion": run.prompt_version,
        "status": run.status,
        "latencyMs": run.latency_ms,
        "errorMessage": run.error_message,
        "rawOutputJson": run.raw_output_json if json.loads(_get_observer_setting("store_raw_output", "false") or "false") else None,
        "createdAt": run.created_at,
    }


# ---------- Phase 1: Shadow Debug APIs ----------

@router.get("/shadow/observations")
def list_shadow_observations(
    project_id: int,
    session_id: Optional[int] = Query(None),
    qa_record_id: Optional[int] = Query(None),
    observation_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
) -> list[dict]:
    from app.services.storage import list_interaction_observations
    obs = list_interaction_observations(
        project_id=project_id,
        session_id=session_id,
        qa_record_id=qa_record_id,
        observation_type=observation_type,
        status=status,
        limit=limit,
    )
    return [
        {
            "id": o.id,
            "runId": o.run_id,
            "qaRecordId": o.qa_record_id,
            "observationType": o.observation_type,
            "subjectKey": o.subject_key,
            "scopeType": o.scope_type,
            "scopeId": o.scope_id,
            "confidence": o.confidence,
            "payload": json.loads(o.payload_json) if o.payload_json else None,
            "evidenceText": o.evidence_text,
            "status": o.status,
            "createdAt": o.created_at,
        }
        for o in obs
    ]


@router.get("/shadow/hypotheses")
def list_shadow_hypotheses(
    project_id: int,
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
) -> list[dict]:
    from app.services.storage import list_learner_hypotheses
    hyps = list_learner_hypotheses(
        scope_type="project",
        scope_id=str(project_id),
        category=category,
        status=status,
        limit=limit,
    )
    return [
        {
            "id": h.id,
            "hypothesisKey": h.hypothesis_key,
            "category": h.category,
            "statement": h.statement,
            "scopeType": h.scope_type,
            "scopeId": h.scope_id,
            "confidence": h.confidence,
            "supportCount": h.support_count,
            "contraryCount": h.contrary_count,
            "status": h.status,
            "createdAt": h.created_at,
            "updatedAt": h.updated_at,
        }
        for h in hyps
    ]


@router.get("/shadow/misconceptions")
def list_shadow_misconceptions(
    project_id: int,
    concept_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
) -> list[dict]:
    from app.services.storage import list_misconception_hypotheses
    miscons = list_misconception_hypotheses(
        scope_type="project",
        scope_id=str(project_id),
        concept_id=concept_id,
        status=status,
        limit=limit,
    )
    return [
        {
            "id": m.id,
            "conceptId": m.concept_id,
            "conceptText": m.concept_text,
            "statement": m.statement,
            "scopeType": m.scope_type,
            "scopeId": m.scope_id,
            "confidence": m.confidence,
            "supportCount": m.support_count,
            "contraryCount": m.contrary_count,
            "status": m.status,
            "resolvedAt": m.resolved_at,
            "createdAt": m.created_at,
        }
        for m in miscons
    ]


@router.get("/shadow/capabilities")
def list_shadow_capabilities(
    project_id: int,
) -> list[dict]:
    from app.services.storage import list_concept_capabilities
    caps = list_concept_capabilities(
        scope_type="project",
        scope_id=str(project_id),
    )
    return [
        {
            "conceptId": c.concept_id,
            "scopeType": c.scope_type,
            "scopeId": c.scope_id,
            "familiarity": c.familiarity,
            "conceptualUnderstanding": c.conceptual_understanding,
            "codeReading": c.code_reading,
            "implementation": c.implementation,
            "debugging": c.debugging,
            "transfer": c.transfer,
            "confidence": c.confidence,
            "evidenceCount": c.evidence_count,
            "lastObservedAt": c.last_observed_at,
            "updatedAt": c.updated_at,
        }
        for c in caps
    ]


@router.get("/shadow/runs")
def list_shadow_runs(
    project_id: int,
    status: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
) -> list[dict]:
    from app.services.storage import list_observer_runs
    runs = list_observer_runs(project_id, status=status, limit=limit)
    return [
        {
            "id": r.id,
            "projectId": r.project_id,
            "qaRecordId": r.qa_record_id,
            "mode": r.mode,
            "provider": r.provider,
            "model": r.model,
            "promptVersion": r.prompt_version,
            "status": r.status,
            "latencyMs": r.latency_ms,
            "errorMessage": r.error_message,
            "createdAt": r.created_at,
        }
        for r in runs
    ]


# ---------- Phase 2: Shadow Snapshots & Teacher Plan APIs ----------

def _api_db_connect():
    from app.services.storage import _connect
    return _connect()


@router.get("/shadow/snapshots")
def list_shadow_snapshots_endpoint(
    project_id: int,
    limit: int = Query(50, le=200),
) -> list[dict]:
    with _api_db_connect() as conn:
        rows = conn.execute(
            """SELECT id, project_id, session_id, target_qa_record_id,
               as_of_qa_record_id, builder_version, snapshot_hash,
               source_observation_ids_json, created_at
               FROM shadow_learner_snapshots
               WHERE project_id = ?
               ORDER BY created_at DESC LIMIT ?""",
            (project_id, limit),
        ).fetchall()
    return [
        {
            "id": r[0],
            "projectId": r[1],
            "sessionId": r[2],
            "targetQaRecordId": r[3],
            "asOfQaRecordId": r[4],
            "builderVersion": r[5],
            "snapshotHash": r[6],
            "sourceObservationIds": json.loads(r[7]) if r[7] else [],
            "createdAt": r[8],
        }
        for r in rows
    ]


@router.get("/shadow/snapshots/{snapshot_id}")
def get_shadow_snapshot_endpoint(
    project_id: int,
    snapshot_id: str,
) -> dict:
    with _api_db_connect() as conn:
        row = conn.execute(
            "SELECT * FROM shadow_learner_snapshots WHERE id = ? AND project_id = ?",
            (snapshot_id, project_id),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Snapshot not found")
    return {
        "id": row[0],
        "projectId": row[1],
        "targetQaRecordId": row[3],
        "asOfQaRecordId": row[4],
        "builderVersion": row[5],
        "snapshotHash": row[7],
        "payload": json.loads(row[8]) if row[8] else None,
        "sourceObservationIds": json.loads(row[9]) if row[9] else [],
        "createdAt": row[10],
    }


@router.get("/shadow/teacher-plans")
def list_teacher_plans_endpoint(
    project_id: int,
    qa_record_id: Optional[int] = Query(None),
    limit: int = Query(50, le=200),
) -> list[dict]:
    with _api_db_connect() as conn:
        if qa_record_id is not None:
            rows = conn.execute(
                """SELECT id, run_id, project_id, session_id, qa_record_id,
                   snapshot_id, planner_version, plan_confidence, created_at
                   FROM teacher_plans
                   WHERE project_id = ? AND qa_record_id = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (project_id, qa_record_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT id, run_id, project_id, session_id, qa_record_id,
                   snapshot_id, planner_version, plan_confidence, created_at
                   FROM teacher_plans
                   WHERE project_id = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (project_id, limit),
            ).fetchall()
    return [
        {"id": r[0], "runId": r[1], "projectId": r[2], "sessionId": r[3],
         "qaRecordId": r[4], "snapshotId": r[5], "plannerVersion": r[6],
         "planConfidence": r[7], "createdAt": r[8]}
        for r in rows
    ]


@router.get("/shadow/teacher-plans/{plan_id}")
def get_teacher_plan_endpoint(
    project_id: int,
    plan_id: str,
) -> dict:
    with _api_db_connect() as conn:
        row = conn.execute(
            "SELECT * FROM teacher_plans WHERE id = ? AND project_id = ?",
            (plan_id, project_id),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Teacher plan not found")
    return {
        "id": row[0], "runId": row[1], "projectId": row[2], "sessionId": row[3],
        "qaRecordId": row[4], "snapshotId": row[5], "plannerVersion": row[6],
        "payload": json.loads(row[7]) if row[7] else None,
        "planConfidence": row[8], "createdAt": row[9],
    }


@router.get("/shadow/teacher-plan-runs")
def list_teacher_plan_runs_endpoint(
    project_id: int,
    status: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
) -> list[dict]:
    with _api_db_connect() as conn:
        if status is not None:
            rows = conn.execute(
                """SELECT id, project_id, session_id, qa_record_id,
                   status, provider, model, planner_version, error_message, created_at
                   FROM teacher_plan_runs
                   WHERE project_id = ? AND status = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (project_id, status, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT id, project_id, session_id, qa_record_id,
                   status, provider, model, planner_version, error_message, created_at
                   FROM teacher_plan_runs
                   WHERE project_id = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (project_id, limit),
            ).fetchall()
    return [
        {"id": r[0], "projectId": r[1], "sessionId": r[2], "qaRecordId": r[3],
         "status": r[4], "provider": r[5], "model": r[6],
         "plannerVersion": r[7], "errorMessage": r[8], "createdAt": r[9]}
        for r in rows
    ]
