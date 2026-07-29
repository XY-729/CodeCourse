from __future__ import annotations

import json
import logging
import sqlite3
from typing import Any, Optional

from app.services.personalization.teaching.effective_context import (
    EffectiveTeachingContext,
)

logger = logging.getLogger(__name__)


def _session_clause(session_id: int | None) -> tuple[str, tuple[object, ...]]:
    """Return SQL + parameters that preserve NULL session isolation."""
    if session_id is None:
        return "t.session_id IS NULL", ()
    return "t.session_id = ?", (session_id,)


def _parse_effective_context(payload: str | None) -> EffectiveTeachingContext | None:
    if not payload:
        return None
    try:
        return EffectiveTeachingContext.model_validate_json(payload)
    except Exception:
        logger.warning("Ignoring invalid teaching trial context", exc_info=True)
        return None


def get_latest_evaluable_teaching_trial(
    project_id: int,
    session_id: int | None,
    before_qa_record_id: int,
    conn: sqlite3.Connection,
) -> Optional[dict[str, Any]]:
    """Return the latest applied trial that has not yet been evaluated.

    This query is for the Observer only.  Planner history has the opposite
    requirement and must use get_recent_assessed_teaching_history().
    """
    if before_qa_record_id <= 0:
        return None

    session_sql, session_params = _session_clause(session_id)
    row = conn.execute(
        f"""SELECT
                t.id,
                t.project_id,
                t.session_id,
                t.qa_record_id,
                t.planner_run_id,
                t.teaching_plan_id,
                t.snapshot_id,
                t.effective_context_json,
                t.mode,
                t.was_applied,
                t.fallback_reason,
                t.answer_model,
                t.created_at
            FROM teaching_trials AS t
            WHERE t.project_id = ?
              AND {session_sql}
              AND t.qa_record_id < ?
              AND t.was_applied = 1
              AND t.mode = 'assist'
              AND t.fallback_reason IS NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM teaching_outcomes AS o
                  WHERE o.teaching_trial_id = t.id
              )
            ORDER BY t.qa_record_id DESC
            LIMIT 1""",
        (project_id, *session_params, before_qa_record_id),
    ).fetchone()

    if row is None:
        return None

    context = _parse_effective_context(row[7])
    return {
        "id": row[0],
        "project_id": row[1],
        "session_id": row[2],
        "qa_record_id": row[3],
        "planner_run_id": row[4],
        "teaching_plan_id": row[5],
        "snapshot_id": row[6],
        "effective_context_json": row[7],
        "strategies": list(context.strategies) if context else [],
        "teaching_goal": context.teaching_goal if context else "",
        "mode": row[8],
        "was_applied": bool(row[9]),
        "fallback_reason": row[10],
        "answer_model": row[11],
        "created_at": row[12],
    }


def get_recent_assessed_teaching_history(
    project_id: int,
    session_id: int | None,
    through_qa_record_id: int,
    limit: int = 3,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Return recently evaluated, actually-applied teaching trials.

    The result is chronological (oldest -> newest) so the last item is the
    latest policy signal.  Only outcomes with a real later evaluation QA are
    accepted.
    """
    if conn is None or through_qa_record_id <= 0 or limit <= 0:
        return []

    safe_limit = max(1, min(int(limit), 20))
    session_sql, session_params = _session_clause(session_id)
    rows = conn.execute(
        f"""SELECT
                t.id,
                t.qa_record_id,
                t.effective_context_json,
                o.result,
                o.confidence,
                o.reason,
                o.evidence_quote,
                o.evaluation_qa_record_id,
                o.evidence_type,
                o.authority
            FROM teaching_trials AS t
            INNER JOIN teaching_outcomes AS o
                ON o.teaching_trial_id = t.id
            WHERE t.project_id = ?
              AND {session_sql}
              AND t.qa_record_id <= ?
              AND t.was_applied = 1
              AND t.mode = 'assist'
              AND t.fallback_reason IS NULL
              AND o.policy_eligible = 1
              AND o.id = (
                  SELECT strongest.id
                  FROM teaching_outcomes AS strongest
                  WHERE strongest.teaching_trial_id = t.id
                    AND strongest.policy_eligible = 1
                  ORDER BY strongest.authority DESC, strongest.created_at DESC
                  LIMIT 1
              )
              AND o.evaluation_qa_record_id <= ?
            ORDER BY t.qa_record_id DESC, o.authority DESC, o.created_at DESC
            LIMIT ?""",
        (
            project_id,
            *session_params,
            through_qa_record_id,
            through_qa_record_id,
            safe_limit,
        ),
    ).fetchall()

    history: list[dict[str, Any]] = []
    for row in reversed(rows):
        context = _parse_effective_context(row[2])
        if context is None:
            continue
        history.append(
            {
                "teaching_trial_id": row[0],
                "qa_record_id": int(row[1]),
                "teaching_goal": context.teaching_goal,
                "strategies": list(context.strategies),
                "user_goal": context.user_goal,
                "outcome": row[3],
                "outcome_confidence": float(row[4]),
                "outcome_reason": row[5],
                "evidence_quote": row[6],
                "evaluation_qa_record_id": int(row[7]),
                "outcome_evidence_type": row[8],
                "outcome_authority": int(row[9]),
                "policy_eligible": True,
            }
        )
    return history


def get_recent_teaching_history(
    project_id: int,
    session_id: int | None,
    before_qa_record_id: int,
    limit: int = 3,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Compatibility wrapper for older debug callers.

    New Planner code should use get_recent_assessed_teaching_history().
    """
    return get_recent_assessed_teaching_history(
        project_id=project_id,
        session_id=session_id,
        through_qa_record_id=max(0, before_qa_record_id - 1),
        limit=limit,
        conn=conn,
    )
