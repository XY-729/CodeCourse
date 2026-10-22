"""Pure V2 knowledge-state resolver.

This mirrors frontend/src/personalization/knowledgeState.ts. Keep the module
free of database and model dependencies so desktop and Android can share
golden vectors.
"""
from __future__ import annotations

from datetime import datetime
from math import isfinite
from typing import Any

POLICY_VERSION = "knowledge-facts-v1"
LEGACY_POLICY_VERSION = "knowledge-v2.2"
DIMENSIONS = (
    "familiarity",
    "conceptual",
    "code_reading",
    "implementation",
    "debugging",
    "transfer",
)
DEFAULT_BKT = {"prior": 0.35, "guess": 0.2, "slip": 0.1, "learn": 0.12}
HIGH_RELIABILITY = 0.72
SOFT_CONFIRMATION_CEILING = 0.74


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    numeric = float(value)
    if not isfinite(numeric):
        numeric = minimum
    return max(minimum, min(maximum, numeric))


def _round6(value: float) -> float:
    return round(value + 0.0, 6)


def update_bkt(
    prior: float,
    correct: bool,
    parameters: dict[str, float] | None = None,
) -> float:
    params = {**DEFAULT_BKT, **(parameters or {})}
    probability = _clamp(prior)
    if correct:
        numerator = probability * (1 - params["slip"])
        denominator = numerator + (1 - probability) * params["guess"]
    else:
        numerator = probability * params["slip"]
        denominator = numerator + (1 - probability) * (1 - params["guess"])
    posterior = numerator / denominator if denominator > 0 else probability
    return _round6(posterior + (1 - posterior) * params["learn"])


def resolve_knowledge_state(
    concept_id: str,
    scope_type: str,
    scope_id: str,
    evidence: list[dict[str, Any]],
    now: str,
) -> dict[str, Any]:
    # A caller may pass a shared ledger. Scope and concept are part of identity,
    # including for void markers, and must be checked before replay.
    evidence = [item for item in evidence if (
        str(item.get("conceptId", concept_id)) == concept_id
        and item.get("scopeType", scope_type) == scope_type
        and str(item.get("scopeId", scope_id)) == scope_id
    )]
    voided_targets = {
        str(item["targetEvidenceId"])
        for item in evidence
        if item.get("action") == "void_evidence"
        and item.get("targetEvidenceId") and not item.get("voided", False)
    }
    active = sorted(
        [
            item for item in evidence
            if (
                not item.get("voided", False)
                and item.get("action") != "void_evidence"
                and item.get("id") not in voided_targets
            )
        ],
        key=lambda item: (item.get("eventTime", ""), item["id"]),
    )
    dimensions = {
        dimension: _resolve_dimension(
            [item for item in active if item["dimension"] == dimension and not (
                dimension in {"implementation", "debugging", "transfer"}
                and item.get("source") in {"summary", "course_completion", "question"}
            )],
            now,
        )
        for dimension in DIMENSIONS
    }
    facts = resolve_familiarity(active)
    return {
        "conceptId": concept_id,
        "scopeType": scope_type,
        "scopeId": scope_id,
        "dimensions": dimensions,
        **facts,
        "policyVersion": POLICY_VERSION,
        "evidenceVersion": len(active),
        "updatedAt": now,
    }


def evidence_familiarity(event: dict[str, Any]) -> str | None:
    """Map observable actions, never a model score or an inferred direction."""
    source, action = event.get("source"), event.get("action")
    if source == "manual":
        return {"manual_known": "declared_known", "manual_unknown": "needs_help"}.get(action)
    if source == "question" and action in {
        "asked_definition", "asked_clarification", "asked_question", "observed",
        "selected_range", "located_range", "encountered",
    }:
        return "encountered"
    if source == "course_completion" and action in {"course_studied", "studied"}:
        return "studied"
    if source == "summary":
        result = event.get("result") or {}
        if not (str(result.get("aspect") or "").strip() or result.get("ranges") or result.get("range")):
            return None
        return {
            "self_understood": "self_reported_understood",
            "saved_understanding": "self_reported_understood",
            "self_partial": "partially_understood",
            "self_needs_help": "needs_help",
        }.get(action)
    if source == "contact" and action in {"selected_range", "located_range", "encountered"}:
        return "encountered"
    return None


def _event_ranges(event: dict[str, Any]) -> list[tuple[str, str]]:
    result = event.get("result") or {}
    raw = result.get("ranges")
    if raw is None:
        raw = [result.get("range") or {
            "aspect": result.get("aspect", ""), "dimension": event.get("dimension", "familiarity"),
        }]
    if not isinstance(raw, list):
        return []
    return sorted({
        (str(item.get("aspect") or "").strip(), str(item.get("dimension") or event.get("dimension", "familiarity")))
        for item in raw if isinstance(item, dict)
        and item.get("dimension", event.get("dimension", "familiarity")) in DIMENSIONS
        and item.get("kind") not in {"planned", "mentioned"}
    })


def _source_ref(event: dict[str, Any]) -> dict[str, Any]:
    obj, context = event.get("object") or {}, event.get("context") or {}
    return {
        "source_type": obj.get("sourceType") or obj.get("type") or context.get("sourceType") or event.get("source"),
        "source_path": obj.get("sourcePath") or context.get("sourcePath"),
        "project_id": obj.get("projectId") or context.get("projectId"),
        "content_hash": obj.get("contentHash") or (event.get("result") or {}).get("contentHash"),
    }


def resolve_familiarity(active: list[dict[str, Any]]) -> dict[str, Any]:
    """Deterministically reduce factual events by aspect and dimension.

    Exposure/completion cannot erase an explicit understanding declaration.
    A later explicit declaration can change the current range while all active
    historical evidence remains inspectable. Manual clear removes its override.
    """
    grouped: dict[tuple[str, str], list[tuple[dict[str, Any], str | None]]] = {}
    for event in active:
        state = evidence_familiarity(event)
        is_clear = event.get("source") == "manual" and event.get("action") == "manual_clear"
        if state is None and not is_clear:
            continue
        for key in _event_ranges(event):
            grouped.setdefault(key, []).append((event, state))
    ranges = []
    for (aspect, dimension), events in sorted(grouped.items()):
        manual = None
        explicit = None
        exposure = "unrecorded"
        for event, state in events:
            if event.get("source") == "manual":
                manual = state
            elif state in {"self_reported_understood", "partially_understood", "needs_help"}:
                explicit = state
            elif state == "studied" or exposure == "unrecorded":
                exposure = state or exposure
        state = manual or explicit or exposure
        # Cleared declarations remain in the audit ledger, not in the active
        # knowledge references of the projected range.
        effective = [event for event, value in events if value and (
            event.get("source") != "manual" or manual is not None
        )]
        if not effective:
            continue
        sources = []
        for event in effective:
            source = _source_ref(event)
            if source not in sources:
                sources.append(source)
        sources.sort(key=lambda item: tuple(str(item[field] or "") for field in ("source_type", "source_path", "project_id", "content_hash")))
        ranges.append({
            "aspect": aspect, "dimension": dimension, "familiarity": state,
            "evidence_ids": sorted({str(event["id"]) for event in effective}),
            "source_count": len(sources), "sources": sources,
            "last_evidence_at": max((event.get("eventTime", "") for event in effective), default=None),
        })
    states = {item["familiarity"] for item in ranges}
    return {
        "familiarity": next(iter(states)) if len(states) == 1 else "mixed" if states else "unrecorded",
        "ranges": ranges,
        "evidence_ids": sorted({value for item in ranges for value in item["evidence_ids"]}),
        "source_count": len({tuple(str(source[field] or "") for field in ("source_type", "source_path", "project_id", "content_hash")) for item in ranges for source in item["sources"]}),
    }


def _resolve_dimension(events: list[dict[str, Any]], now: str) -> dict[str, Any]:
    # Contact with a topic is not evidence of knowledge, including recency.
    events = [event for event in events if event["source"] == "manual" or (
        event["direction"] != "neutral" and float(event["strength"]) > 0
    )]
    probability = DEFAULT_BKT["prior"]
    manual_status: str | None = None
    manual_evidence_at: str | None = None
    objective_attempt_count = 0
    direct_evidence_count = 0
    soft_only = True
    reliable_sessions: set[str] = set()

    for event in events:
        if event["source"] == "manual":
            if event["action"] == "manual_known":
                manual_status = "known"
                manual_evidence_at = event["eventTime"]
            elif event["action"] == "manual_unknown":
                manual_status = "unknown"
                manual_evidence_at = event["eventTime"]
            elif event["action"] == "manual_clear":
                manual_status = None
                manual_evidence_at = None
            continue

        strength = _clamp(event["strength"])
        reliability = _clamp(event["reliability"])
        if event["source"] not in ("observer", "migration"):
            direct_evidence_count += 1

        objective_correct = event.get("objectiveCorrect")
        if event["source"] == "diagnostic" and objective_correct is not None:
            objective_attempt_count += 1
            soft_only = False
            context = event.get("context") or {}
            probability = update_bkt(
                probability,
                bool(objective_correct),
                context.get("bkt"),
            )
            if objective_correct and reliability >= HIGH_RELIABILITY:
                reliable_sessions.add(
                    str(event.get("sessionId") or f"attempt:{event['id']}")
                )
            continue

        magnitude = strength * reliability
        if event["direction"] == "positive":
            probability += (1 - probability) * 0.16 * magnitude
        elif event["direction"] == "negative":
            probability -= probability * 0.22 * magnitude
        probability = _clamp(probability)

    if soft_only:
        probability = min(probability, SOFT_CONFIRMATION_CEILING)
    if manual_status == "known":
        probability = 0.99
    if manual_status == "unknown":
        probability = 0.01

    knowledge_events = [event for event in events if event["source"] != "manual"]
    last_evidence_at = (
        manual_evidence_at
        if manual_status
        else knowledge_events[-1]["eventTime"] if knowledge_events else None
    )
    age_uncertainty = 0.2
    if last_evidence_at:
        age = _days_between(last_evidence_at, now)
        age_uncertainty = min(0.22, max(0.0, age - 30) / 365)
    information = sum(
        _clamp(event["reliability"]) * _clamp(event["strength"])
        for event in knowledge_events
    )
    uncertainty = _clamp(
        0.72 - min(0.55, information * 0.1) + age_uncertainty,
        0.05,
        0.95,
    )
    if manual_status:
        uncertainty = 0.02

    confirmed = (
        manual_status == "known"
        or (len(reliable_sessions) >= 2 and probability >= 0.72)
    )
    learning = (
        manual_status == "unknown"
        or any(event["direction"] == "negative" for event in events)
        or (objective_attempt_count > 0 and probability < 0.58)
    )
    return {
        "probability": _round6(probability),
        "uncertainty": _round6(uncertainty),
        "status": "confirmed" if confirmed else "learning" if learning else "uncertain",
        "evidenceCount": len(knowledge_events) + (1 if manual_status else 0),
        "directEvidenceCount": direct_evidence_count,
        "objectiveAttemptCount": objective_attempt_count,
        "reliableCorrectSessions": len(reliable_sessions),
        "manualStatus": manual_status,
        "lastEvidenceAt": last_evidence_at,
    }


def _days_between(start: str, end: str) -> float:
    try:
        first = datetime.fromisoformat(start.replace("Z", "+00:00"))
        second = datetime.fromisoformat(end.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return 0
    return max(0.0, (second - first).total_seconds() / 86400)
