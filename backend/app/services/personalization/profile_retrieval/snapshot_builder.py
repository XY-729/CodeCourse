from __future__ import annotations

import hashlib
import json
from typing import Optional

import sqlite3

from app.services.personalization.profile_retrieval.snapshot_schema import (
    ShadowLearnerSnapshot,
    RelevantCapability,
    RelevantFact,
    RelevantHypothesis,
    RelevantMisconception,
    SnapshotSource,
)

SNAPSHOT_BUILDER_VERSION = "snapshot-builder-v1"

CONFIDENCE_THRESHOLD_EXPLICIT_FACT = 0.90
CONFIDENCE_THRESHOLD_CAPABILITY = 0.08
EVIDENCE_COUNT_MIN_CAPABILITY = 2
CONFIDENCE_THRESHOLD_HYPOTHESIS = 0.62
SUPPORT_COUNT_MIN_HYPOTHESIS = 2
CONFIDENCE_THRESHOLD_MISCONCEPTION = 0.72
MAX_SNAPSHOT_CHARS = 6000


def capability_interpretation(value: float, confidence: float) -> str:
    if confidence < 0.12:
        return "uncertain"
    if value >= 0.68:
        return "likely_known"
    if value <= 0.32:
        return "likely_unknown"
    return "uncertain"


def _snapshot_hash(snapshot: ShadowLearnerSnapshot) -> str:
    content = json.dumps(snapshot.model_dump(exclude={"snapshot_hash"}), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def build_shadow_snapshot(
    project_id: int,
    session_id: int | None,
    target_qa_record_id: int,
    as_of_qa_record_id: int | None,
    relevant_concept_keys: list[str],
    question: str,
    conn: sqlite3.Connection,
) -> ShadowLearnerSnapshot:
    facts: list[RelevantFact] = []
    caps: list[RelevantCapability] = []
    hyps: list[RelevantHypothesis] = []
    miscons: list[RelevantMisconception] = []
    all_obs_ids: list[str] = []
    excluded = 0
    now_qa_id = as_of_qa_record_id or target_qa_record_id

    _collect_explicit_facts(project_id, now_qa_id, conn, facts, all_obs_ids)
    _collect_capabilities(project_id, relevant_concept_keys, conn, caps, all_obs_ids)
    _collect_hypotheses(project_id, session_id, conn, hyps, all_obs_ids)
    _collect_misconceptions(project_id, conn, miscons, all_obs_ids)

    manual_prefs = _get_manual_preferences(project_id, conn)
    manual_mastery = _get_manual_mastery(project_id, relevant_concept_keys, conn)

    snapshot = ShadowLearnerSnapshot(
        schema_version=1,
        builder_version=SNAPSHOT_BUILDER_VERSION,
        project_id=project_id,
        session_id=session_id,
        target_qa_record_id=target_qa_record_id,
        as_of_qa_record_id=as_of_qa_record_id,
        explicit_facts=facts,
        capabilities=caps,
        behavior_hypotheses=hyps,
        misconceptions=miscons,
        current_manual_preferences=manual_prefs,
        current_manual_mastery=manual_mastery,
        excluded_item_count=excluded,
        source_observation_ids=all_obs_ids,
        snapshot_hash="",
    )
    snapshot.snapshot_hash = _snapshot_hash(snapshot)
    return snapshot


def _collect_explicit_facts(
    project_id: int,
    as_of_qa_id: int,
    conn: sqlite3.Connection,
    facts: list[RelevantFact],
    obs_ids: list[str],
) -> None:
    rows = conn.execute(
        """SELECT id, observation_type, subject_key, payload_json, evidence_text,
           scope_type, scope_id, confidence
           FROM interaction_observations
           WHERE project_id = ? AND qa_record_id <= ?
           AND observation_type = 'explicit_user_fact'
           AND status = 'accepted_shadow'
           AND confidence >= ?
           ORDER BY created_at DESC
           LIMIT 8""",
        (project_id, as_of_qa_id, CONFIDENCE_THRESHOLD_EXPLICIT_FACT),
    ).fetchall()

    for row in rows:
        obs_ids.append(row[0])
        payload = json.loads(row[3])
        facts.append(RelevantFact(
            fact_type=payload.get("fact_type", "other"),
            statement=payload.get("statement", ""),
            value=payload.get("value", ""),
            scope_type=row[5],
            scope_id=row[6],
            confidence=float(row[7]),
            evidence_quote=row[4],
            sources=[SnapshotSource(
                source_type="manual_fact",
                source_id=row[0],
                evidence_qa_record_ids=[],
                confidence=float(row[7]),
            )],
        ))
        if len(facts) >= 6:
            break


def _collect_capabilities(
    project_id: int,
    relevant_keys: list[str],
    conn: sqlite3.Connection,
    caps: list[RelevantCapability],
    obs_ids: list[str],
) -> None:
    if not relevant_keys:
        return

    placeholders = ",".join("?" * len(relevant_keys))
    rows = conn.execute(
        f"""SELECT concept_id, scope_type, scope_id, familiarity,
           conceptual_understanding, code_reading, implementation,
           debugging, transfer, confidence, evidence_count
           FROM concept_capabilities
           WHERE scope_type = 'project' AND scope_id = ?
           AND concept_id IN ({placeholders})
           AND evidence_count >= ?
           AND confidence >= ?""",
        (str(project_id), *relevant_keys, EVIDENCE_COUNT_MIN_CAPABILITY, CONFIDENCE_THRESHOLD_CAPABILITY),
    ).fetchall()

    dims = ["familiarity", "conceptual_understanding", "code_reading",
            "implementation", "debugging", "transfer"]

    for row in rows:
        concept_id = row[0]
        confidence = float(row[9])
        for i, dim in enumerate(dims):
            value = float(row[3 + i])
            caps.append(RelevantCapability(
                concept_key=concept_id,
                concept_name=concept_id,
                dimension=dim,
                value=value,
                confidence=confidence,
                interpretation=capability_interpretation(value, confidence),
                sources=[SnapshotSource(
                    source_type="capability",
                    source_id=f"{concept_id}:{dim}",
                    evidence_qa_record_ids=[],
                    confidence=confidence,
                )],
            ))
            if len(caps) >= 10:
                break
        if len(caps) >= 10:
            break


def _collect_hypotheses(
    project_id: int,
    session_id: int | None,
    conn: sqlite3.Connection,
    hyps: list[RelevantHypothesis],
    obs_ids: list[str],
) -> None:
    rows = conn.execute(
        """SELECT id, hypothesis_key, statement, category,
           scope_type, scope_id, confidence, support_count,
           evidence_observation_ids_json
           FROM learner_hypotheses
           WHERE status = 'supported'
           AND support_count >= ?
           AND confidence >= ?
           AND contrary_count < support_count
           AND (scope_type = 'project' AND scope_id = ?
            OR scope_type = 'session' AND scope_id = ?)
           ORDER BY confidence DESC
           LIMIT 10""",
        (
            SUPPORT_COUNT_MIN_HYPOTHESIS, CONFIDENCE_THRESHOLD_HYPOTHESIS,
            str(project_id),
            str(session_id) if session_id else "",
        ),
    ).fetchall()

    for row in rows:
        try:
            ev_ids = json.loads(row[8])
            obs_ids.extend(ev_ids)
        except (json.JSONDecodeError, TypeError):
            ev_ids = []
        hyps.append(RelevantHypothesis(
            hypothesis_key=row[1],
            statement=row[2],
            category=row[3],
            scope_type=row[4],
            scope_id=row[5],
            confidence=float(row[6]),
            evidence_count=int(row[7]),
            sources=[SnapshotSource(
                source_type="behavior_hypothesis",
                source_id=row[0],
                evidence_qa_record_ids=[],
                confidence=float(row[6]),
            )],
        ))
        if len(hyps) >= 5:
            break


def _collect_misconceptions(
    project_id: int,
    conn: sqlite3.Connection,
    miscons: list[RelevantMisconception],
    obs_ids: list[str],
) -> None:
    rows = conn.execute(
        """SELECT id, concept_id, concept_text, statement,
           confidence, evidence_observation_ids_json
           FROM misconception_hypotheses
           WHERE scope_type = 'project' AND scope_id = ?
           AND status = 'supported'
           AND confidence >= ?
           AND resolved_at IS NULL
           ORDER BY confidence DESC
           LIMIT 4""",
        (str(project_id), CONFIDENCE_THRESHOLD_MISCONCEPTION),
    ).fetchall()

    for row in rows:
        try:
            ev_ids = json.loads(row[5])
            obs_ids.extend(ev_ids)
        except (json.JSONDecodeError, TypeError):
            ev_ids = []
        miscons.append(RelevantMisconception(
            id=row[0],
            concept_key=row[1],
            concept_text=row[2],
            statement=row[3],
            confidence=float(row[4]),
            sources=[SnapshotSource(
                source_type="misconception",
                source_id=row[0],
                evidence_qa_record_ids=[],
                confidence=float(row[4]),
            )],
        ))


def _get_manual_preferences(project_id: int, conn: sqlite3.Connection) -> dict[str, object]:
    """Return only user-facing preferences that remain part of the product.

    Legacy answer_depth/code_ratio/explanation_order values are retained in the
    database for migration compatibility, but must not influence Planner input.
    """
    row = conn.execute(
        """SELECT terminology_density
           FROM learner_preferences
           WHERE scope_type = 'project' AND scope_id = ?""",
        (str(project_id),),
    ).fetchone()
    if row:
        return {"terminology_density": float(row[0])}

    row = conn.execute(
        """SELECT terminology_density
           FROM learner_preferences
           WHERE scope_type = 'global' AND scope_id = 'local-user'"""
    ).fetchone()
    if row:
        return {"terminology_density": float(row[0])}
    return {}


def _get_manual_mastery(
    project_id: int,
    relevant_keys: list[str],
    conn: sqlite3.Connection,
) -> list[dict[str, object]]:
    if not relevant_keys:
        return []
    placeholders = ",".join("?" * len(relevant_keys))
    rows = conn.execute(
        f"""SELECT concept_id, mastery, manual_status
           FROM concept_mastery
           WHERE scope_type = 'global' AND scope_id = 'local-user'
           AND concept_id IN ({placeholders})
           AND manual_status IS NOT NULL""",
        relevant_keys,
    ).fetchall()
    return [
        {"concept_id": r[0], "mastery": float(r[1]), "manual_status": r[2]}
        for r in rows[:10]
    ]
