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


def _resolve_concept_id(concept_text: str, concept_key: Optional[str], conn: sqlite3.Connection, project_id: int) -> Optional[str]:
    from app.services.personalization.concept_identity import canonical_concept_name
    clean = canonical_concept_name(concept_text)
    if not clean:
        return None
    if concept_key and concept_key.startswith("project:") and not concept_key.startswith(f"project:{project_id}:"):
        return None
    if clean != concept_text:
        concept_key = None
    concept_text = clean
    concept_id = None
    if concept_key:
        row = conn.execute(
            "SELECT id FROM concepts WHERE concept_key = ? AND (canonical_name = ? OR display_name = ?)",
            (concept_key, concept_text, concept_text),
        ).fetchone()
        if row:
            concept_id = row[0]
    if concept_id is None:
        row = conn.execute(
            "SELECT id FROM concepts WHERE (canonical_name = ? OR display_name = ?) AND (concept_key NOT LIKE 'project:%' OR concept_key LIKE ?)",
            (concept_text, concept_text, f"project:{project_id}:%"),
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
    return None


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
    return None


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
    return None


def apply_shadow_updates(
    project_id: int,
    session_id: Optional[int],
    observation: InteractionObservation,
    conn: sqlite3.Connection,
) -> None:
    """Retired: observed prose cannot write abilities, styles or hypotheses."""
    return None
