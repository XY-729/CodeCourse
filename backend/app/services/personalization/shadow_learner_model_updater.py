from __future__ import annotations

import hashlib
import re
from typing import Any, Optional
from uuid import uuid4

import sqlite3

from app.services.personalization.observation_schema import InteractionObservation


CAPABILITY_MAX_DELTA = 0.04
CONFIDENCE_THRESHOLD_KNOWLEDGE = 0.65
CONFIDENCE_THRESHOLD_BEHAVIOR = 0.65
CONFIDENCE_THRESHOLD_MISCONCEPTION = 0.70
CONFIDENCE_THRESHOLD_EXPLICIT_FACT = 0.90
MAX_CONFIDENCE_GAIN = 0.03
MAX_HYPOTHESIS_DELTA = 0.03
MIN_SUPPORT_FOR_SUPPORTED = 2
DEFAULT_CAPABILITY = 0.5


def capability_delta(
    direction: str,
    strength: float,
    confidence: float,
) -> float:
    sign = 1.0 if direction == "positive" else -1.0
    magnitude = min(
        CAPABILITY_MAX_DELTA,
        CAPABILITY_MAX_DELTA
        * max(0.0, min(1.0, strength))
        * max(0.0, min(1.0, confidence)),
    )
    return sign * magnitude


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _hypothesis_key(category: str, statement: str) -> str:
    normalized = re.sub(r"\s+", " ", statement.strip().casefold())
    digest = hashlib.sha256(
        f"{category}:{normalized}".encode("utf-8")
    ).hexdigest()[:16]
    return f"{category}:{digest}"


def _dimension_column(dimension: str) -> str:
    mapping = {
        "familiarity": "familiarity",
        "conceptual_understanding": "conceptual_understanding",
        "code_reading": "code_reading",
        "implementation": "implementation",
        "debugging": "debugging",
        "transfer": "transfer",
    }
    return mapping.get(dimension, "familiarity")


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _resolve_concept_id(concept_text: str, concept_key: Optional[str], conn: sqlite3.Connection) -> Optional[str]:
    concept_id = None
    if concept_key:
        row = conn.execute(
            "SELECT id FROM concepts WHERE concept_key = ?", (concept_key,)
        ).fetchone()
        if row:
            concept_id = row[0]
    if concept_id is None:
        row = conn.execute(
            "SELECT id FROM concepts WHERE canonical_name = ? OR display_name = ?",
            (concept_text, concept_text),
        ).fetchone()
        if row:
            concept_id = row[0]
    return concept_id


def _upsert_concept_capability(
    concept_id: str,
    scope_type: str,
    scope_id: str,
    dimension: str,
    delta: float,
    observation_confidence: float,
    conn: sqlite3.Connection,
) -> None:
    row = conn.execute(
        """SELECT familiarity, conceptual_understanding, code_reading,
           implementation, debugging, transfer, confidence, evidence_count
           FROM concept_capabilities
           WHERE concept_id = ? AND scope_type = ? AND scope_id = ?""",
        (concept_id, scope_type, scope_id),
    ).fetchone()

    now = _now_iso()
    if row is None:
        values = {
            "familiarity": DEFAULT_CAPABILITY,
            "conceptual_understanding": DEFAULT_CAPABILITY,
            "code_reading": DEFAULT_CAPABILITY,
            "implementation": DEFAULT_CAPABILITY,
            "debugging": DEFAULT_CAPABILITY,
            "transfer": DEFAULT_CAPABILITY,
        }
        values[dimension] = clamp01(DEFAULT_CAPABILITY + delta)
        conn.execute(
            """INSERT INTO concept_capabilities
               (concept_id, scope_type, scope_id, familiarity,
                conceptual_understanding, code_reading, implementation,
                debugging, transfer, confidence, evidence_count,
                last_observed_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                concept_id, scope_type, scope_id,
                values["familiarity"], values["conceptual_understanding"],
                values["code_reading"], values["implementation"],
                values["debugging"], values["transfer"],
                clamp01(observation_confidence * 0.5),
                1, now, now,
            ),
        )
    else:
        col = _dimension_column(dimension)
        cols = ["familiarity", "conceptual_understanding", "code_reading",
                 "implementation", "debugging", "transfer"]
        old_idx = cols.index(col)
        old_value = float(row[old_idx])
        old_confidence = float(row[5 + len(cols)])
        old_count = int(row[5 + len(cols) + 1])

        new_value = clamp01(old_value + delta)
        confidence_gain = min(MAX_CONFIDENCE_GAIN, MAX_CONFIDENCE_GAIN * observation_confidence)
        new_confidence = clamp01(old_confidence + confidence_gain)

        conn.execute(
            f"""UPDATE concept_capabilities
                SET {col} = ?, confidence = ?, evidence_count = ?,
                    last_observed_at = ?, updated_at = ?
                WHERE concept_id = ? AND scope_type = ? AND scope_id = ?""",
            (
                new_value, new_confidence, old_count + 1,
                now, now,
                concept_id, scope_type, scope_id,
            ),
        )


def _upsert_hypothesis(
    hypothesis_key: str,
    category: str,
    statement: str,
    scope_type: str,
    scope_id: str,
    direction: str,
    confidence: float,
    observation_id: str,
    recommended_scope: str,
    conn: sqlite3.Connection,
) -> None:
    now = _now_iso()
    row = conn.execute(
        """SELECT id, confidence, support_count, contrary_count, status,
           evidence_observation_ids_json, scope_type, scope_id
           FROM learner_hypotheses
           WHERE hypothesis_key = ? AND scope_type = ? AND scope_id = ?""",
        (hypothesis_key, scope_type, scope_id),
    ).fetchone()

    if row is None:
        actual_scope_type = "session" if recommended_scope == "global" else recommended_scope
        conn.execute(
            """INSERT INTO learner_hypotheses
               (id, hypothesis_key, category, statement,
                scope_type, scope_id, confidence, support_count,
                contrary_count, status, evidence_observation_ids_json,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(uuid4()), hypothesis_key, category, statement,
                actual_scope_type, scope_id, clamp01(confidence * 0.5),
                1 if direction == "support" else 0,
                1 if direction == "contradict" else 0,
                "candidate",
                f'["{observation_id}"]',
                now, now,
            ),
        )
    else:
        hyp_id = row[0]
        old_confidence = float(row[1])
        old_support = int(row[2])
        old_contrary = int(row[3])
        old_status = row[4]
        old_ids_json = row[5]

        new_support = old_support + (1 if direction == "support" else 0)
        new_contrary = old_contrary + (1 if direction == "contradict" else 0)

        if direction == "support":
            delta = min(MAX_HYPOTHESIS_DELTA, MAX_HYPOTHESIS_DELTA * confidence)
            new_confidence = clamp01(old_confidence + delta)
        elif direction == "contradict":
            delta = min(MAX_HYPOTHESIS_DELTA, MAX_HYPOTHESIS_DELTA * confidence)
            new_confidence = clamp01(old_confidence - delta)
        else:
            new_confidence = old_confidence

        new_status = old_status
        if old_status == "candidate" and direction == "support" and new_support >= MIN_SUPPORT_FOR_SUPPORTED:
            new_status = "supported"

        try:
            import json
            old_ids = json.loads(old_ids_json)
        except (json.JSONDecodeError, TypeError):
            old_ids = []
        if observation_id not in old_ids:
            old_ids.append(observation_id)

        conn.execute(
            """UPDATE learner_hypotheses
               SET confidence = ?, support_count = ?, contrary_count = ?,
                   status = ?, evidence_observation_ids_json = ?,
                   last_validated_at = ?, updated_at = ?
               WHERE id = ?""",
            (
                new_confidence, new_support, new_contrary,
                new_status, json.dumps(old_ids),
                now, now, hyp_id,
            ),
        )


def _upsert_misconception(
    concept_text: str,
    concept_id: Optional[str],
    statement: str,
    scope_type: str,
    scope_id: str,
    confidence: float,
    observation_id: str,
    conn: sqlite3.Connection,
) -> None:
    now = _now_iso()
    concat = f"{concept_text}|||{statement}"
    digest = hashlib.sha256(concat.encode("utf-8")).hexdigest()[:16]

    row = conn.execute(
        """SELECT id, confidence, support_count, contrary_count, status,
           evidence_observation_ids_json
           FROM misconception_hypotheses
           WHERE id = ?""",
        (f"miscon:{digest}",),
    ).fetchone()

    if row is None:
        conn.execute(
            """INSERT INTO misconception_hypotheses
               (id, concept_id, concept_text, statement,
                scope_type, scope_id, confidence, support_count,
                contrary_count, status, evidence_observation_ids_json,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                f"miscon:{digest}", concept_id, concept_text, statement,
                scope_type, scope_id, clamp01(confidence * 0.5),
                1, 0, "candidate",
                f'["{observation_id}"]',
                now, now,
            ),
        )


def apply_shadow_updates(
    project_id: int,
    session_id: Optional[int],
    observation: InteractionObservation,
    conn: sqlite3.Connection,
) -> None:
    scope_type = "project"
    scope_id = str(project_id)

    for i, ev in enumerate(observation.knowledge_evidence):
        if ev.confidence < CONFIDENCE_THRESHOLD_KNOWLEDGE:
            continue
        if ev.direction == "uncertain":
            continue
        concept_id = _resolve_concept_id(ev.concept_text, ev.concept_key, conn)
        if concept_id is None:
            continue
        delta = capability_delta(
            direction=ev.direction,
            strength=ev.strength,
            confidence=ev.confidence,
        )
        _upsert_concept_capability(
            concept_id=concept_id,
            scope_type=scope_type,
            scope_id=scope_id,
            dimension=ev.dimension,
            delta=delta,
            observation_confidence=ev.confidence,
            conn=conn,
        )

    for i, ev in enumerate(observation.behavior_evidence):
        if ev.confidence < CONFIDENCE_THRESHOLD_BEHAVIOR:
            continue
        hkey = ev.hypothesis_key or _hypothesis_key(ev.category, ev.statement)
        obs_id = f"observer:v1:qa:{project_id}:behavior:{i}"
        _upsert_hypothesis(
            hypothesis_key=hkey,
            category=ev.category,
            statement=ev.statement,
            scope_type=ev.recommended_scope,
            scope_id=scope_id if ev.recommended_scope == "project" else (
                str(session_id) if session_id and ev.recommended_scope == "session" else scope_id
            ),
            direction=ev.direction,
            confidence=ev.confidence,
            observation_id=obs_id,
            recommended_scope=ev.recommended_scope,
            conn=conn,
        )

    for i, ev in enumerate(observation.possible_misconceptions):
        if ev.confidence < CONFIDENCE_THRESHOLD_MISCONCEPTION:
            continue
        concept_id = _resolve_concept_id(ev.concept_text, ev.concept_key, conn)
        obs_id = f"observer:v1:qa:{project_id}:miscon:{i}"
        _upsert_misconception(
            concept_text=ev.concept_text,
            concept_id=concept_id,
            statement=ev.statement,
            scope_type=scope_type,
            scope_id=scope_id,
            confidence=ev.confidence,
            observation_id=obs_id,
            conn=conn,
        )

    for i, ev in enumerate(observation.explicit_user_facts):
        if ev.confidence < CONFIDENCE_THRESHOLD_EXPLICIT_FACT:
            continue
        hkey = f"explicit_fact:{ev.fact_type}:{_hypothesis_key(ev.fact_type, ev.statement)}"
        obs_id = f"observer:v1:qa:{project_id}:fact:{i}"
        _upsert_hypothesis(
            hypothesis_key=hkey,
            category=f"explicit_user_{ev.fact_type}",
            statement=ev.statement,
            scope_type=ev.recommended_scope,
            scope_id=scope_id if ev.recommended_scope in ("project", "session") else scope_id,
            direction="support",
            confidence=ev.confidence,
            observation_id=obs_id,
            recommended_scope=ev.recommended_scope,
            conn=conn,
        )
