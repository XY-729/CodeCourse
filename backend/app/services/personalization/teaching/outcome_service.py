from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


OUTCOME_POLICY_VERSION = "teaching-outcome-v2.1"

EVIDENCE_AUTHORITY = {
    "objective_diagnostic": 100,
    "manual_feedback": 90,
    "user_artifact": 75,
    "followup_behavior": 45,
    "observer_inference": 20,
}

POLICY_ELIGIBLE_EVIDENCE = {
    "objective_diagnostic",
    "manual_feedback",
    "user_artifact",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_context(payload: str | None) -> dict[str, Any]:
    if not payload:
        return {}
    try:
        parsed = json.loads(payload)
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def get_teaching_trial_for_qa(
    project_id: int,
    qa_record_id: int,
    conn: sqlite3.Connection,
) -> sqlite3.Row | None:
    return conn.execute(
        """SELECT * FROM teaching_trials
           WHERE project_id = ? AND qa_record_id = ?
           ORDER BY created_at DESC LIMIT 1""",
        (project_id, qa_record_id),
    ).fetchone()


def _refresh_trial_outcome(trial_id: str, conn: sqlite3.Connection) -> None:
    strongest = conn.execute(
        """SELECT result FROM teaching_outcomes
           WHERE teaching_trial_id = ?
           ORDER BY authority DESC, created_at DESC LIMIT 1""",
        (trial_id,),
    ).fetchone()
    conn.execute(
        "UPDATE teaching_trials SET previous_outcome = ? WHERE id = ?",
        (strongest["result"] if strongest else None, trial_id),
    )


def record_teaching_outcome(
    *,
    conn: sqlite3.Connection,
    idempotency_key: str,
    project_id: int,
    teaching_trial_id: str,
    result: str,
    confidence: float,
    reason: str,
    evidence_quote: str,
    evidence_type: str,
    evidence_ref_id: str | None = None,
    evaluation_qa_record_id: int | None = None,
    diagnostic_attempt_id: str | None = None,
    source_observation_id: str | None = None,
    observer_run_id: str | None = None,
) -> dict[str, Any]:
    if evidence_type not in EVIDENCE_AUTHORITY:
        raise ValueError(f"Unsupported teaching outcome evidence: {evidence_type}")
    if result not in {
        "successful",
        "partially_successful",
        "unsuccessful",
        "advanced_followup",
        "topic_changed",
        "unknown",
    }:
        raise ValueError(f"Unsupported teaching outcome result: {result}")

    trial = conn.execute(
        "SELECT * FROM teaching_trials WHERE id = ? AND project_id = ?",
        (teaching_trial_id, project_id),
    ).fetchone()
    if trial is None:
        raise ValueError("Teaching trial not found")

    authority = EVIDENCE_AUTHORITY[evidence_type]
    policy_eligible = int(evidence_type in POLICY_ELIGIBLE_EVIDENCE)
    outcome_id = f"teaching-outcome:{uuid4()}"
    evaluation_id = evaluation_qa_record_id or int(trial["qa_record_id"])
    conn.execute(
        """INSERT OR IGNORE INTO teaching_outcomes
           (id, idempotency_key, project_id, session_id,
            teaching_trial_id, taught_qa_record_id, evaluation_qa_record_id,
            result, confidence, reason, evidence_quote,
            source_observation_id, observer_run_id, evidence_type,
            evidence_ref_id, authority, policy_eligible,
            diagnostic_attempt_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            outcome_id,
            idempotency_key,
            project_id,
            trial["session_id"],
            teaching_trial_id,
            trial["qa_record_id"],
            evaluation_id,
            result,
            max(0.0, min(1.0, float(confidence))),
            reason[:1000],
            evidence_quote[:1000],
            source_observation_id,
            observer_run_id,
            evidence_type,
            evidence_ref_id,
            authority,
            policy_eligible,
            diagnostic_attempt_id,
            _now(),
        ),
    )
    row = conn.execute(
        "SELECT * FROM teaching_outcomes WHERE idempotency_key = ?",
        (idempotency_key,),
    ).fetchone()
    _refresh_trial_outcome(teaching_trial_id, conn)
    return {
        "id": row["id"],
        "teachingTrialId": row["teaching_trial_id"],
        "result": row["result"],
        "confidence": float(row["confidence"]),
        "evidenceType": row["evidence_type"],
        "evidenceRefId": row["evidence_ref_id"],
        "authority": int(row["authority"]),
        "policyEligible": bool(row["policy_eligible"]),
        "createdAt": row["created_at"],
    }


def record_manual_teaching_feedback(
    project_id: int,
    qa_record_id: int,
    *,
    result: str,
    idempotency_key: str,
    reason: str = "",
) -> dict[str, Any]:
    from app.services.storage import run_in_transaction

    def transaction(conn: sqlite3.Connection) -> dict[str, Any]:
        trial = get_teaching_trial_for_qa(project_id, qa_record_id, conn)
        if trial is None:
            raise ValueError("Teaching trial not found for this answer")
        return record_teaching_outcome(
            conn=conn,
            idempotency_key=idempotency_key,
            project_id=project_id,
            teaching_trial_id=str(trial["id"]),
            result=result,
            confidence=1.0,
            reason=reason or "User directly evaluated this explanation",
            evidence_quote=reason or result,
            evidence_type="manual_feedback",
            evidence_ref_id=f"qa:{qa_record_id}",
            evaluation_qa_record_id=qa_record_id,
        )

    return run_in_transaction(transaction)


def teaching_trial_payload(
    project_id: int,
    qa_record_id: int,
    conn: sqlite3.Connection,
) -> dict[str, Any] | None:
    trial = get_teaching_trial_for_qa(project_id, qa_record_id, conn)
    if trial is None:
        return None
    context = _parse_context(trial["effective_context_json"])
    outcomes = conn.execute(
        """SELECT * FROM teaching_outcomes
           WHERE teaching_trial_id = ?
           ORDER BY authority DESC, created_at DESC""",
        (trial["id"],),
    ).fetchall()
    return {
        "id": trial["id"],
        "qaRecordId": int(trial["qa_record_id"]),
        "mode": trial["mode"],
        "teachingGoal": context.get("teaching_goal", ""),
        "strategies": context.get("strategies", []),
        "assumedKnown": context.get("assumed_known", []),
        "explainBriefly": context.get("explain_briefly", []),
        "explainInDetail": context.get("explain_in_detail", []),
        "targetConceptIds": json.loads(trial["target_concepts_json"] or "[]"),
        "targetDimensions": json.loads(trial["target_dimensions_json"] or "[]"),
        "strategyRationale": trial["strategy_rationale"],
        "policyVersion": trial["policy_version"],
        "preState": json.loads(trial["pre_state_json"] or "{}"),
        "outcomes": [
            {
                "id": row["id"],
                "result": row["result"],
                "confidence": float(row["confidence"]),
                "reason": row["reason"],
                "evidenceQuote": row["evidence_quote"],
                "evidenceType": row["evidence_type"],
                "authority": int(row["authority"]),
                "policyEligible": bool(row["policy_eligible"]),
                "createdAt": row["created_at"],
            }
            for row in outcomes
        ],
        "createdAt": trial["created_at"],
    }


def teaching_evidence_summary(
    project_id: int,
    conn: sqlite3.Connection,
    *,
    limit: int = 40,
) -> dict[str, Any]:
    rows = conn.execute(
        """SELECT t.*, o.result, o.confidence, o.reason, o.evidence_type,
                  o.authority, o.policy_eligible, o.created_at AS outcome_created_at
           FROM teaching_trials AS t
           LEFT JOIN teaching_outcomes AS o
             ON o.id = (
               SELECT candidate.id FROM teaching_outcomes AS candidate
               WHERE candidate.teaching_trial_id = t.id
               ORDER BY candidate.authority DESC, candidate.created_at DESC
               LIMIT 1
             )
           WHERE t.project_id = ?
           ORDER BY t.created_at DESC LIMIT ?""",
        (project_id, max(1, min(limit, 100))),
    ).fetchall()

    strategy_stats: dict[str, dict[str, Any]] = {}
    recent_trials: list[dict[str, Any]] = []
    verified_count = 0
    awaiting_count = 0
    for row in rows:
        context = _parse_context(row["effective_context_json"])
        strategies = [
            str(item) for item in context.get("strategies", []) if str(item)
        ]
        if row["result"] is None:
            awaiting_count += 1
        if bool(row["policy_eligible"]):
            verified_count += 1
            for strategy in strategies[:2]:
                stats = strategy_stats.setdefault(
                    strategy,
                    {
                        "strategy": strategy,
                        "successful": 0,
                        "partiallySuccessful": 0,
                        "unsuccessful": 0,
                        "evidenceCount": 0,
                    },
                )
                stats["evidenceCount"] += 1
                if row["result"] == "successful":
                    stats["successful"] += 1
                elif row["result"] == "partially_successful":
                    stats["partiallySuccessful"] += 1
                elif row["result"] == "unsuccessful":
                    stats["unsuccessful"] += 1

        recent_trials.append(
            {
                "id": row["id"],
                "qaRecordId": int(row["qa_record_id"]),
                "teachingGoal": context.get("teaching_goal", ""),
                "strategies": strategies,
                "result": row["result"],
                "evidenceType": row["evidence_type"],
                "policyEligible": bool(row["policy_eligible"]),
                "createdAt": row["created_at"],
            }
        )

    effective = sorted(
        strategy_stats.values(),
        key=lambda item: (
            item["successful"] + 0.5 * item["partiallySuccessful"]
            - item["unsuccessful"],
            item["evidenceCount"],
        ),
        reverse=True,
    )
    return {
        "verifiedTrialCount": verified_count,
        "awaitingEvidenceCount": awaiting_count,
        "effectiveStrategies": effective[:6],
        "recentTrials": recent_trials[:20],
        "policyVersion": OUTCOME_POLICY_VERSION,
    }
