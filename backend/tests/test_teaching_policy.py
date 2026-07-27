import json
import sqlite3
import unittest

from app.services.personalization.teaching.effective_context import (
    EffectiveTeachingContext,
)
from app.services.personalization.teaching.strategy_policy import (
    apply_teaching_history_policy,
    has_changed_primary_strategy,
)
from app.services.personalization.teaching.teaching_history import (
    get_latest_evaluable_teaching_trial,
    get_recent_assessed_teaching_history,
)


def _context(strategies: list[str]) -> EffectiveTeachingContext:
    return EffectiveTeachingContext(
        schema_version=1,
        mode="planned",
        user_goal="understand_mechanism",
        teaching_goal="理解运行机制",
        strategies=strategies,
    )


class TeachingHistoryPolicyTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.execute(
            """CREATE TABLE teaching_trials (
                id TEXT PRIMARY KEY,
                project_id INTEGER NOT NULL,
                session_id INTEGER,
                qa_record_id INTEGER NOT NULL,
                planner_run_id TEXT,
                teaching_plan_id TEXT,
                snapshot_id TEXT,
                effective_context_json TEXT NOT NULL,
                mode TEXT NOT NULL,
                was_applied INTEGER NOT NULL,
                fallback_reason TEXT,
                answer_model TEXT,
                created_at TEXT NOT NULL
            )"""
        )
        self.conn.execute(
            """CREATE TABLE teaching_outcomes (
                id TEXT PRIMARY KEY,
                teaching_trial_id TEXT NOT NULL UNIQUE,
                result TEXT NOT NULL,
                confidence REAL NOT NULL,
                reason TEXT NOT NULL,
                evidence_quote TEXT NOT NULL,
                evaluation_qa_record_id INTEGER NOT NULL
            )"""
        )

    def tearDown(self):
        self.conn.close()

    def _insert_trial(self, trial_id: str, qa_id: int, strategies: list[str]):
        self.conn.execute(
            """INSERT INTO teaching_trials (
                id, project_id, session_id, qa_record_id,
                effective_context_json, mode, was_applied, created_at
            ) VALUES (?, 1, 7, ?, ?, 'assist', 1, '2026-01-01')""",
            (trial_id, qa_id, _context(strategies).model_dump_json()),
        )

    def test_observer_and_planner_queries_have_opposite_semantics(self):
        self._insert_trial("unassessed", 10, ["brief_definition"])
        self._insert_trial("assessed", 20, ["brief_definition"])
        self.conn.execute(
            """INSERT INTO teaching_outcomes (
                id, teaching_trial_id, result, confidence, reason,
                evidence_quote, evaluation_qa_record_id
            ) VALUES ('o1', 'assessed', 'unsuccessful', 0.9,
                      'still confused', '还是没懂', 21)"""
        )
        self.conn.commit()

        observer_trial = get_latest_evaluable_teaching_trial(
            project_id=1,
            session_id=7,
            before_qa_record_id=30,
            conn=self.conn,
        )
        self.assertEqual(observer_trial["id"], "unassessed")

        history = get_recent_assessed_teaching_history(
            project_id=1,
            session_id=7,
            through_qa_record_id=30,
            conn=self.conn,
        )
        self.assertEqual([item["teaching_trial_id"] for item in history], ["assessed"])
        self.assertEqual(history[-1]["outcome"], "unsuccessful")

    def test_unsuccessful_forces_different_primary_strategy(self):
        current = _context(["brief_definition", "worked_example"])
        updated = apply_teaching_history_policy(
            context=current,
            blocker_type="mechanism",
            recent_history=[
                {
                    "strategies": ["brief_definition", "worked_example"],
                    "outcome": "unsuccessful",
                    "outcome_confidence": 0.9,
                }
            ],
        )
        self.assertTrue(
            has_changed_primary_strategy(
                ["brief_definition", "worked_example"],
                updated.strategies,
            )
        )

    def test_low_confidence_failure_does_not_force_change(self):
        current = _context(["brief_definition", "worked_example"])
        updated = apply_teaching_history_policy(
            context=current,
            blocker_type="mechanism",
            recent_history=[
                {
                    "strategies": ["brief_definition", "worked_example"],
                    "outcome": "unsuccessful",
                    "outcome_confidence": 0.3,
                }
            ],
        )
        self.assertEqual(updated.strategies, current.strategies)


if __name__ == "__main__":
    unittest.main()
