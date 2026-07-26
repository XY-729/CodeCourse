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

from app.services.storage import (
    Concept,
    ConceptMastery,
    LearningEventRecord,
    delete_concept_mastery_by_scope,
    delete_events_by_scope,
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
    run_in_transaction,
    search_concepts,
    upsert_concept,
    upsert_concept_mastery,
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


def _project_scope(project_id: int) -> tuple[str, str]:
    return ("project", str(project_id))


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
        [e for e in events if not e.is_voided and e.event_id not in voided_ids],
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
    scope_type, scope_id = _project_scope(project_id)
    ids = [cid.strip() for cid in concept_ids.split(",") if cid.strip()]
    if not ids:
        return {}
    results = get_concept_mastery_batch(ids, scope_type, scope_id)
    return {m.concept_id: _mastery_response(m) for m in results}


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
    scope_type, scope_id = _project_scope(project_id)

    concept = get_concept(concept_id)
    if concept is None:
        raise HTTPException(status_code=404, detail="Concept not found")

    def do_tx(conn):
        now = datetime.now(timezone.utc).isoformat()
        event_id = str(uuid4())

        # Idempotency check
        existing_evt = get_event_by_idempotency_key(idempotency_key)
        if existing_evt is not None:
            # Return current mastery for idempotent calls
            m = get_concept_mastery(concept_id, scope_type, scope_id)
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
        )

        # Recompute projection from all events
        all_events = get_learning_events(concept_id, scope_type, scope_id)
        known, unknown, manual_status = _replay_events(all_events)
        mst, unc = _calculate_mastery(known, unknown)

        existing_m = get_concept_mastery(concept_id, scope_type, scope_id)
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
    scope_type, scope_id = _project_scope(project_id)
    events = get_learning_events(concept_id, scope_type, scope_id)
    return [_event_response(e) for e in events]


@router.post("/{project_id}/personalization/events/{event_id}/void")
def void_event(project_id: int, event_id: str, body: dict = {}) -> dict:
    """
    Append an event_voided compensation event.
    Does NOT UPDATE the original event (preserves immutability).
    """
    _require_project(project_id)
    scope_type, scope_id = _project_scope(project_id)

    original = get_event_by_id(event_id)
    if original is None:
        raise HTTPException(status_code=404, detail="Event not found")

    concept_id = str(body.get("conceptId", original.concept_id))
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
def reset_profile(project_id: int) -> dict:
    _require_project(project_id)
    scope_type, scope_id = _project_scope(project_id)

    def do_tx(conn):
        deleted_mastery = delete_concept_mastery_by_scope(scope_type, scope_id)
        deleted_events = delete_events_by_scope(scope_type, scope_id)
        return {"status": "ok", "deletedMasteryCount": deleted_mastery, "deletedEventCount": deleted_events}

    return run_in_transaction(do_tx)
