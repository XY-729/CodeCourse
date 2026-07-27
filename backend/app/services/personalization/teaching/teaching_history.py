from __future__ import annotations

import sqlite3
from typing import Optional


def get_latest_evaluable_teaching_trial(
    project_id: int,
    session_id: int | None,
    before_qa_record_id: int,
    conn: sqlite3.Connection,
) -> Optional[dict]:
    if session_id is None:
        return None

    row = conn.execute(
        """SELECT t.id, t.qa_record_id, t.effective_context_json,
           t.previous_outcome, t.was_applied
           FROM teaching_trials t
           WHERE t.project_id = ?
             AND t.session_id = ?
             AND t.qa_record_id < ?
             AND t.was_applied = 1
             AND t.mode = 'assist'
             AND NOT EXISTS (
               SELECT 1 FROM teaching_outcomes o
               WHERE o.teaching_trial_id = t.id
             )
           ORDER BY t.qa_record_id DESC
           LIMIT 1""",
        (project_id, session_id, before_qa_record_id),
    ).fetchone()

    if row is None:
        return None

    import json
    ctx = json.loads(row[2]) if row[2] else {}
    strategies = ctx.get("strategies", []) if isinstance(ctx, dict) else []
    teaching_goal = ctx.get("teaching_goal", "") if isinstance(ctx, dict) else ""
    return {
        "id": row[0],
        "qa_record_id": row[1],
        "effective_context_json": row[2],
        "strategies": strategies,
        "teaching_goal": teaching_goal,
        "was_applied": bool(row[4]),
        "previous_outcome": row[3],
    }


def get_recent_teaching_history(
    project_id: int,
    session_id: int | None,
    before_qa_record_id: int,
    limit: int = 3,
    conn: sqlite3.Connection | None = None,
) -> list[dict]:
    if session_id is None or conn is None:
        return []

    rows = conn.execute(
        """SELECT t.id, t.qa_record_id, t.effective_context_json,
           o.result, o.confidence, o.reason
           FROM teaching_trials t
           LEFT JOIN teaching_outcomes o ON o.teaching_trial_id = t.id
           WHERE t.project_id = ?
             AND t.session_id = ?
             AND t.qa_record_id < ?
             AND t.was_applied = 1
             AND t.mode = 'assist'
           ORDER BY t.qa_record_id DESC
           LIMIT ?""",
        (project_id, session_id, before_qa_record_id, limit),
    ).fetchall()

    import json
    history: list[dict] = []
    for row in reversed(rows):
        ctx = json.loads(row[2]) if row[2] else {}
        strategies = ctx.get("strategies", []) if isinstance(ctx, dict) else []
        history.append({
            "teaching_trial_id": row[0],
            "qa_record_id": row[1],
            "teaching_goal": ctx.get("teaching_goal", "") if isinstance(ctx, dict) else "",
            "strategies": strategies,
            "outcome": row[3],
            "outcome_confidence": row[4],
            "outcome_reason": row[5],
        })
    return history
