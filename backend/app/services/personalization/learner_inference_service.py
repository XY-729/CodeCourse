from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4
from app.services.personalization.concept_identity import canonical_concept_name

from app.services.personalization.observation_schema import InteractionObservation


GLOBAL_SCOPE_ID = "local-user"
DIRECT_CONFIDENCE = 0.68
RELATION_CONFIDENCE = 0.58
SURVEY_CONFIDENCE = 0.65


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _loads(value: Optional[str], fallback):
    try:
        parsed = json.loads(value or "")
        return parsed
    except (TypeError, json.JSONDecodeError):
        return fallback


def _concept_row(conn, concept_key: Optional[str], concept_text: str, project_id: int | None = None):
    if concept_key and concept_key.startswith("project:") and not concept_key.startswith(f"project:{project_id}:"):
        return None
    if concept_key and concept_text == concept_key:
        return conn.execute(
            "SELECT * FROM concepts WHERE (concept_key=? OR id=?) AND (concept_key NOT LIKE 'project:%' OR concept_key LIKE ?) LIMIT 1",
            (concept_key, concept_key, f"project:{project_id}:%"),
        ).fetchone()
    clean = canonical_concept_name(concept_text)
    if not clean:
        return None
    if clean != concept_text:
        concept_key = None
    concept_text = clean
    if concept_key:
        row = conn.execute(
            "SELECT * FROM concepts WHERE (concept_key = ? OR id = ?) AND (concept_key NOT LIKE 'project:%' OR concept_key LIKE ?) LIMIT 1",
            (concept_key, concept_key, f"project:{project_id}:%"),
        ).fetchone()
        if row is not None and clean.casefold() in {str(row["canonical_name"]).casefold(), str(row["display_name"]).casefold()}:
            return row
        if row is not None:
            concept_key = None
    row = conn.execute(
        """SELECT * FROM concepts
           WHERE (lower(canonical_name) = lower(?) OR lower(display_name) = lower(?))
             AND (concept_key NOT LIKE 'project:%' OR concept_key LIKE ?)
           ORDER BY CASE WHEN concept_key LIKE 'global:%' THEN 0 ELSE 1 END
           LIMIT 1""",
        (concept_text, concept_text, f"project:{project_id}:%"),
    ).fetchone()
    if row is not None:
        return row
    display_name = str(concept_text or concept_key or "").strip().strip("`")
    if not display_name:
        return None
    normalized = display_name.casefold()
    stable_key = str(concept_key or "").strip()
    if not (stable_key.startswith("global:") or stable_key.startswith("project:")):
        stable_key = f"global:general:{normalized or uuid4().hex[:12]}"
    stamp = _now()
    concept_id = str(uuid4())
    conn.execute(
        """INSERT OR IGNORE INTO concepts
           (id, concept_key, canonical_name, display_name, domain, concept_type,
            aliases_json, difficulty, created_at)
           VALUES (?, ?, ?, ?, 'general', 'theory', '[]', 0.5, ?)""",
        (concept_id, stable_key, display_name, display_name, stamp),
    )
    return conn.execute(
        "SELECT * FROM concepts WHERE concept_key = ?",
        (stable_key,),
    ).fetchone()


def _scope_for_concept(row, project_id: int) -> tuple[str, str]:
    key = str(row["concept_key"] or "")
    kind = str(row["concept_type"] or "")
    if key.startswith("project:") or kind == "project_symbol":
        return "project", str(project_id)
    return "global", GLOBAL_SCOPE_ID


def _merge_evidence(existing_json: str, evidence: dict[str, Any], limit: int = 20) -> str:
    existing = _loads(existing_json, [])
    if not isinstance(existing, list):
        existing = []
    evidence_id = evidence.get("id")
    if evidence_id and any(item.get("id") == evidence_id for item in existing if isinstance(item, dict)):
        return json.dumps(existing, ensure_ascii=False)
    return json.dumps([evidence, *existing][:limit], ensure_ascii=False)


def _relation_confidence(evidence: list[dict[str, Any]]) -> tuple[float, str]:
    active = [
        item for item in evidence
        if isinstance(item, dict) and not bool(item.get("voided"))
    ]
    if not active:
        return 0.0, "voided"
    values = [
        max(0.0, min(1.0, float(item.get("confidence", 0))))
        for item in active
    ]
    return sum(values) / len(values), "active"


def _upsert_inference(
    conn,
    *,
    subject_type: str,
    subject_key: str,
    scope_type: str,
    scope_id: str,
    state: str,
    summary: str,
    confidence: float,
    direct: bool,
    evidence: dict[str, Any],
) -> None:
    return None


def _upsert_relation(conn, relation, observer_run_id: str, project_id: int) -> None:
    return None


def _survey_due(conn) -> bool:
    return False


def _store_survey(conn, survey, observer_run_id: str) -> None:
    return None


def _rebuild_domain_profiles(conn) -> None:
    """Historical model summaries are retained, never rebuilt for new teaching."""
    return None


def apply_inference_updates(
    *,
    project_id: int,
    qa_record_id: int,
    observer_run_id: str,
    observation: InteractionObservation,
    conn,
) -> None:
    """Retired observer writer. Validated manifests and user actions own state."""
    return None


def record_model_call(
    *,
    project_id: Optional[int],
    purpose: str,
    provider: Optional[str],
    model: Optional[str],
    status: str,
    latency_ms: Optional[int] = None,
    input_tokens: Optional[int] = None,
    output_tokens: Optional[int] = None,
    estimated_cost: Optional[float] = None,
    error_message: Optional[str] = None,
    conn=None,
) -> None:
    if conn is None:
        from app.services.storage import _connect
        with _connect() as database:
            record_model_call(
                project_id=project_id,
                purpose=purpose,
                provider=provider,
                model=model,
                status=status,
                latency_ms=latency_ms,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                estimated_cost=estimated_cost,
                error_message=error_message,
                conn=database,
            )
            database.commit()
        return
    conn.execute(
        """INSERT INTO model_call_audit
           (id, project_id, purpose, provider, model, status, input_tokens,
           output_tokens, estimated_cost, latency_ms, error_message, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            str(uuid4()), project_id, purpose, provider, model, status,
            input_tokens, output_tokens, estimated_cost, latency_ms,
            (error_message or "")[:500] or None, _now(),
        )
    )


def profile_payload(project_id: int) -> dict[str, Any]:
    """Expose model usage audit, never old inferred abilities as current facts."""
    from app.services.storage import _connect
    with _connect() as conn:
        audits = [dict(row) for row in conn.execute(
            "SELECT * FROM model_call_audit WHERE project_id=? ORDER BY created_at DESC LIMIT 50",
            (project_id,),
        ).fetchall()]
    return {"domainProfiles": [], "inferences": [], "relations": [],
            "surveyCandidate": None, "modelCalls": [
                {"id": row["id"], "projectId": row["project_id"], "purpose": row["purpose"],
                 "provider": row["provider"], "model": row["model"], "status": row["status"],
                 "inputTokens": row["input_tokens"], "outputTokens": row["output_tokens"],
                 "estimatedCost": row["estimated_cost"], "latencyMs": row["latency_ms"],
                 "errorMessage": row["error_message"], "createdAt": row["created_at"]}
                for row in audits]}


def answer_survey(project_id: int, survey_id: str, choice: str) -> dict[str, Any]:
    return {"status": "disabled", "reason": "preference_surveys_retired", "applied": False}


def dismiss_survey(survey_id: str) -> dict[str, Any]:
    return {"status": "disabled", "reason": "preference_surveys_retired", "applied": False}


def void_inference(inference_id: str) -> dict[str, Any]:
    from app.services.storage import _connect
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, evidence_json FROM learner_inferences WHERE id = ?",
            (inference_id,),
        ).fetchone()
        if row is None:
            raise ValueError("inference not found")
        conn.execute(
            "UPDATE learner_inferences SET status = 'voided', updated_at = ? WHERE id = ?",
            (_now(), inference_id),
        )
        observer_runs = {
            str(item.get("id", "")).split(":knowledge:", 1)[0]
            for item in _loads(row["evidence_json"], [])
            if isinstance(item, dict) and ":knowledge:" in str(item.get("id", ""))
        }
        if observer_runs:
            for relation in conn.execute(
                "SELECT id, evidence_json FROM concept_relations"
            ).fetchall():
                evidence = _loads(relation["evidence_json"], [])
                changed = False
                for item in evidence:
                    if not isinstance(item, dict):
                        continue
                    if str(item.get("id", "")) in observer_runs and not item.get("voided"):
                        item["voided"] = True
                        changed = True
                if not changed:
                    continue
                confidence, status = _relation_confidence(evidence)
                conn.execute(
                    """UPDATE concept_relations
                       SET confidence = ?, evidence_json = ?, status = ?, updated_at = ?
                       WHERE id = ?""",
                    (
                        confidence,
                        json.dumps(evidence, ensure_ascii=False),
                        status,
                        _now(),
                        relation["id"],
                    ),
                )
        _rebuild_domain_profiles(conn)
        conn.commit()
    return {"status": "voided", "id": inference_id}


def register_concept_explanation(
    concept_id: str,
    project_id: int,
    qa_record_id: int,
    title: str,
) -> None:
    from app.services.storage import _connect
    stamp = _now()
    with _connect() as conn:
        conn.execute(
            """INSERT INTO concept_explanations
               (id, concept_id, project_id, qa_record_id, title, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
               ON CONFLICT(concept_id, qa_record_id) DO UPDATE SET
                 title = excluded.title, status = 'active', updated_at = excluded.updated_at""",
            (
                str(uuid4()), concept_id, project_id, qa_record_id, title[:200],
                stamp, stamp,
            ),
        )
        conn.commit()


def find_concept_explanation(concept_id: str) -> Optional[dict[str, Any]]:
    from app.services.storage import _connect
    with _connect() as conn:
        row = conn.execute(
            """SELECT e.*, q.session_id, q.parent_qa_id, q.relation_type,
                      q.source_type, q.source_path, q.display_title, q.selected_text,
                      q.question, q.answer_md, q.provider, q.model, q.output_path,
                      q.retrieval_trace, q.retrieval_sources_json, q.favorite,
                      q.created_at AS qa_created_at, q.updated_at AS qa_updated_at
               FROM concept_explanations e
               JOIN qa_records q ON q.id = e.qa_record_id AND q.project_id = e.project_id
               JOIN projects p ON p.id = e.project_id
               WHERE e.concept_id = ? AND e.status = 'active'
               ORDER BY e.updated_at DESC LIMIT 1""",
            (concept_id,),
        ).fetchone()
        if row is None:
            return None
        return {
            "projectId": int(row["project_id"]),
            "qa": {
                "id": int(row["qa_record_id"]),
                "project_id": int(row["project_id"]),
                "session_id": row["session_id"],
                "parent_qa_id": row["parent_qa_id"],
                "relation_type": row["relation_type"],
                "source_type": row["source_type"],
                "source_path": row["source_path"],
                "display_title": row["display_title"],
                "selected_text": row["selected_text"],
                "question": row["question"],
                "answer_md": row["answer_md"],
                "provider": row["provider"],
                "model": row["model"],
                "output_path": row["output_path"],
                "retrieval_trace": row["retrieval_trace"],
                "retrieval_sources_json": row["retrieval_sources_json"],
                "favorite": bool(row["favorite"]),
                "created_at": row["qa_created_at"],
                "updated_at": row["qa_updated_at"],
            },
        }


def relevant_teaching_context(
    project_id: int,
    concept_ids: list[str],
) -> dict[str, Any]:
    """Reuse saved explanations, without applying inferred knowledge or styles."""
    from app.services.storage import get_concept
    accessible = []
    for concept_id in concept_ids:
        concept = get_concept(concept_id)
        if concept is None:
            continue
        try:
            from app.services.personalization_service import concept_scope
            concept_scope(concept, project_id)
        except ValueError:
            continue
        accessible.append(concept_id)
    explanations = []
    for concept_id in sorted(set(accessible)):
        explanation = find_concept_explanation(concept_id)
        if explanation:
            qa = explanation["qa"]
            explanations.append({"conceptId": concept_id, "projectId": qa["project_id"],
                "qaRecordId": qa["id"], "title": qa["display_title"] or qa["question"],
                "url": f"https://codecourse.local/qa/{qa['project_id']}/{qa['id']}"})
    return {"domains": [], "inferences": [], "prerequisites": [], "explanations": explanations}
