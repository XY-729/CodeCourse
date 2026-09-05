"""One-time, transactional correction of automatic legacy profile signals.

Original concepts, manual judgements and answers remain untouched. Corrections
retain their original values alongside the evidence/term for inspection.
"""
import json
from datetime import datetime, timezone

from app.services.personalization.concept_identity import canonical_concept_name

REPAIR_KEY = "migration.personalization.semantic-profile-v1"


def _object(value):
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {"originalValue": parsed}
    except (ValueError, TypeError):
        return {"originalValue": value}


def repair_legacy_profile(conn) -> None:
    if conn.execute("SELECT 1 FROM app_settings WHERE key=?", (REPAIR_KEY,)).fetchone():
        return
    stamp = datetime.now(timezone.utc).isoformat()
    for row in conn.execute(
        """SELECT * FROM learning_evidence_v2 WHERE source='question'
           AND action IN ('asked_definition','asked_clarification')
           AND (direction<>'neutral' OR strength<>0)"""
    ).fetchall():
        context = _object(row["context_json"])
        context["profileRepair"] = {"version": 1, "direction": row["direction"], "strength": row["strength"]}
        result = _object(row["result_json"])
        result["explanation"] = "曾主动询问这个概念；提问本身不能证明已掌握或不熟悉。"
        conn.execute(
            "UPDATE learning_evidence_v2 SET direction='neutral',strength=0,context_json=?,result_json=? WHERE id=?",
            (json.dumps(context, ensure_ascii=False), json.dumps(result, ensure_ascii=False), row["id"]),
        )
    # Retire only unconfirmed automatic candidates, not user-linked terms.
    for row in conn.execute("SELECT * FROM document_terms WHERE status='candidate'").fetchall():
        if canonical_concept_name(row["canonical_name"] or row["term_text"]):
            continue
        if row["link_origin"] == "user" or row["qa_record_id"] is not None:
            continue
        span = _object(row["source_span_json"])
        span["profileRepair"] = {"version": 1, "status": row["status"]}
        conn.execute(
            "UPDATE document_terms SET status='dismissed',source_span_json=?,updated_at=? WHERE id=?",
            (json.dumps(span, ensure_ascii=False), stamp, row["id"]),
        )
    from app.services.personalization.learner_inference_service import _concept_row
    for old in conn.execute("SELECT * FROM concepts WHERE concept_key LIKE 'global:%'").fetchall():
        clean = canonical_concept_name(old["canonical_name"])
        if not clean or clean == old["canonical_name"]:
            continue
        canonical = _concept_row(conn, None, clean)
        for row in conn.execute("SELECT * FROM learning_evidence_v2 WHERE concept_id=? AND source='question'", (old["id"],)).fetchall():
            context = _object(row["context_json"])
            context["originalConceptId"] = old["id"]
            conn.execute("UPDATE learning_evidence_v2 SET concept_id=?,context_json=? WHERE id=?",
                         (canonical["id"], json.dumps(context, ensure_ascii=False), row["id"]))
        for term in conn.execute("SELECT * FROM document_terms WHERE concept_id=? AND status='candidate' AND qa_record_id IS NULL", (old["id"],)).fetchall():
            if term["link_origin"] == "user":
                continue
            span = _object(term["source_span_json"])
            span["originalConceptId"] = old["id"]
            conn.execute("UPDATE document_terms SET concept_id=?,source_span_json=? WHERE id=?",
                         (canonical["id"], json.dumps(span, ensure_ascii=False), term["id"]))
    # This exact old signature failed before any model request/observation.
    # Do not requeue network failures or completed runs, nor retry on every boot.
    conn.execute(
        """UPDATE observer_jobs SET status='pending',locked_at=NULL,available_at=?,
           reason='profile_repair',updated_at=?
           WHERE status='failed' AND last_error='observer_failed'
             AND NOT EXISTS (SELECT 1 FROM observer_runs r WHERE r.project_id=observer_jobs.project_id
                             AND r.qa_record_id=observer_jobs.qa_record_id)
             AND EXISTS (SELECT 1 FROM qa_records q WHERE q.project_id=observer_jobs.project_id
                         AND q.id=observer_jobs.qa_record_id AND q.answer_md<>'')""",
        (stamp, stamp),
    )
    from app.services.personalization.knowledge_state_service import rebuild_state
    for row in conn.execute("SELECT DISTINCT concept_id,scope_type,scope_id FROM learning_evidence_v2").fetchall():
        rebuild_state(row["concept_id"], row["scope_type"], row["scope_id"], conn=conn)
    conn.execute("INSERT INTO app_settings(key,value,updated_at) VALUES (?,'done',?)", (REPAIR_KEY, stamp))
