"""Pure V2 knowledge-state resolver.

This mirrors frontend/src/personalization/knowledgeState.ts. Keep the module
free of database and model dependencies so desktop and Android can share
golden vectors.
"""
from __future__ import annotations

from datetime import datetime
from math import isfinite
from typing import Any

POLICY_VERSION = "knowledge-v2.1"
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
    voided_targets = {
        str(item["targetEvidenceId"])
        for item in evidence
        if item.get("targetEvidenceId") and not item.get("voided", False)
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
        key=lambda item: (item["eventTime"], item["id"]),
    )
    dimensions = {
        dimension: _resolve_dimension(
            [item for item in active if item["dimension"] == dimension],
            now,
        )
        for dimension in DIMENSIONS
    }
    return {
        "conceptId": concept_id,
        "scopeType": scope_type,
        "scopeId": scope_id,
        "dimensions": dimensions,
        "policyVersion": POLICY_VERSION,
        "evidenceVersion": len(active),
        "updatedAt": now,
    }


def _resolve_dimension(events: list[dict[str, Any]], now: str) -> dict[str, Any]:
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
