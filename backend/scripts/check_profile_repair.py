"""Dry-run repair against an ephemeral SQLite backup; never modify the source.

Run from backend: .venv/Scripts/python.exe scripts/check_profile_repair.py PATH
Only aggregate counts are printed. No settings, questions or keys are logged.
"""
import json
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.personalization.profile_repair import repair_legacy_profile


def counts(conn):
    return {name: conn.execute(sql).fetchone()[0] for name, sql in {
        "answers": "SELECT COUNT(*) FROM qa_records",
        "manual_facts": "SELECT COUNT(*) FROM learning_evidence_v2 WHERE source='manual'",
        "negative_question_signals": "SELECT COUNT(*) FROM learning_evidence_v2 WHERE source='question' AND direction='negative'",
        "pending_observer_jobs": "SELECT COUNT(*) FROM observer_jobs WHERE status='pending'",
        "dismissed_candidates": "SELECT COUNT(*) FROM document_terms WHERE status='dismissed'",
    }.items()}


if __name__ == '__main__':
    source = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory(prefix='codecourse-profile-check-') as temp:
        original = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
        copy = sqlite3.connect(str(Path(temp) / 'profile.db'))
        try:
            original.backup(copy)
            copy.row_factory = sqlite3.Row
            before = counts(copy)
            with copy:
                repair_legacy_profile(copy)
            after = counts(copy)
            print(json.dumps({'before': before, 'after': after}, ensure_ascii=False))
        finally:
            copy.close()
            original.close()
