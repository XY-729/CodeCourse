from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

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


def _concept_row(conn, concept_key: Optional[str], concept_text: str):
    if concept_key:
        row = conn.execute(
            "SELECT * FROM concepts WHERE concept_key = ? OR id = ? LIMIT 1",
            (concept_key, concept_key),
        ).fetchone()
        if row is not None:
            return row
    row = conn.execute(
        """SELECT * FROM concepts
           WHERE lower(canonical_name) = lower(?) OR lower(display_name) = lower(?)
           ORDER BY CASE WHEN concept_key LIKE 'global:%' THEN 0 ELSE 1 END
           LIMIT 1""",
        (concept_text, concept_text),
    ).fetchone()
    if row is not None:
        return row
    display_name = str(concept_text or concept_key or "").strip().strip("`")
    if not display_name:
        return None
    normalized = re.sub(r"[^a-z0-9_\-:.]+", "-", display_name.casefold()).strip("-")
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
    row = conn.execute(
        """SELECT * FROM learner_inferences
           WHERE subject_type = ? AND subject_key = ? AND scope_type = ? AND scope_id = ?""",
        (subject_type, subject_key, scope_type, scope_id),
    ).fetchone()
    stamp = _now()
    if row is None:
        conn.execute(
            """INSERT INTO learner_inferences
               (id, subject_type, subject_key, scope_type, scope_id, state, summary,
                confidence, direct_evidence_count, inferred_evidence_count,
                evidence_json, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)""",
            (
                str(uuid4()), subject_type, subject_key, scope_type, scope_id,
                state, summary[:500], confidence, 1 if direct else 0,
                0 if direct else 1, json.dumps([evidence], ensure_ascii=False),
                stamp, stamp,
            ),
        )
        return

    direct_count = int(row["direct_evidence_count"]) + (1 if direct else 0)
    inferred_count = int(row["inferred_evidence_count"]) + (0 if direct else 1)
    old_confidence = float(row["confidence"])
    weight = min(0.35, 1.0 / max(2, direct_count + inferred_count))
    merged_confidence = max(0.0, min(1.0, old_confidence * (1 - weight) + confidence * weight))

    # Direct evidence always outranks inferred evidence. A negative direct signal
    # can move a concept back to learning; inferred relations can never confirm it.
    old_state = str(row["state"])
    next_state = state
    if not direct and old_state in {"confirmed", "learning"}:
        next_state = old_state
    elif state == "confirmed" and not direct:
        next_state = "likely_prerequisite"

    conn.execute(
        """UPDATE learner_inferences
           SET state = ?, summary = ?, confidence = ?,
               direct_evidence_count = ?, inferred_evidence_count = ?,
               evidence_json = ?, status = 'active', updated_at = ?
           WHERE id = ?""",
        (
            next_state, summary[:500], merged_confidence, direct_count,
            inferred_count, _merge_evidence(row["evidence_json"], evidence),
            stamp, row["id"],
        ),
    )


def _upsert_relation(conn, relation, observer_run_id: str) -> None:
    source = _concept_row(conn, relation.source_concept_key, relation.source_concept_text)
    target = _concept_row(conn, relation.target_concept_key, relation.target_concept_text)
    if source is None or target is None or source["id"] == target["id"]:
        return
    if relation.domain and relation.domain != "general":
        conn.execute(
            """UPDATE concepts SET domain = ?
               WHERE id IN (?, ?) AND (domain IS NULL OR domain = '' OR domain = 'general')""",
            (relation.domain, source["id"], target["id"]),
        )
    confidence = float(relation.confidence)
    if confidence < RELATION_CONFIDENCE:
        return
    stamp = _now()
    evidence = {
        "id": observer_run_id,
        "rationale": relation.rationale,
        "confidence": confidence,
    }
    row = conn.execute(
        """SELECT * FROM concept_relations
           WHERE source_concept_id = ? AND target_concept_id = ? AND relation_type = ?""",
        (source["id"], target["id"], relation.relation_type),
    ).fetchone()
    if row is None:
        conn.execute(
            """INSERT INTO concept_relations
               (id, source_concept_id, target_concept_id, relation_type, domain,
                confidence, evidence_json, origin, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'observer', 'active', ?, ?)""",
            (
                str(uuid4()), source["id"], target["id"], relation.relation_type,
                relation.domain, confidence, json.dumps([evidence], ensure_ascii=False),
                stamp, stamp,
            ),
        )
        return
    merged_evidence = _loads(_merge_evidence(row["evidence_json"], evidence, limit=200), [])
    merged_confidence, merged_status = _relation_confidence(merged_evidence)
    conn.execute(
        """UPDATE concept_relations
           SET confidence = ?, domain = ?, evidence_json = ?, status = ?, updated_at = ?
           WHERE id = ?""",
        (
            merged_confidence,
            relation.domain,
            json.dumps(merged_evidence, ensure_ascii=False),
            merged_status,
            stamp,
            row["id"],
        ),
    )


def _survey_due(conn) -> bool:
    prefs = conn.execute(
        "SELECT * FROM learner_preferences WHERE scope_type = 'global' AND scope_id = ?",
        (GLOBAL_SCOPE_ID,),
    ).fetchone()
    completed_answers = int(
        conn.execute("SELECT COUNT(*) FROM qa_records WHERE answer_md <> ''").fetchone()[0]
    )
    if prefs is None or not bool(prefs["survey_enabled"]) or completed_answers < 5:
        return False
    pending = conn.execute(
        "SELECT 1 FROM survey_candidates WHERE scope_id = ? AND status = 'pending' LIMIT 1",
        (GLOBAL_SCOPE_ID,),
    ).fetchone()
    if pending is not None:
        return False
    latest = conn.execute(
        """SELECT created_at FROM survey_candidates
           WHERE scope_id = ? ORDER BY created_at DESC LIMIT 1""",
        (GLOBAL_SCOPE_ID,),
    ).fetchone()
    if latest is None:
        return True
    try:
        created = datetime.fromisoformat(str(latest["created_at"]).replace("Z", "+00:00"))
        return datetime.now(timezone.utc) - created >= timedelta(days=1)
    except ValueError:
        return True


def _store_survey(conn, survey, observer_run_id: str) -> None:
    if survey is None or survey.confidence < SURVEY_CONFIDENCE or not _survey_due(conn):
        return
    conn.execute(
        """INSERT INTO survey_candidates
           (id, scope_id, question, dimension, options_json, rationale,
            confidence, status, observer_run_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
        (
            str(uuid4()), GLOBAL_SCOPE_ID, survey.question, survey.dimension,
            json.dumps([item.model_dump() for item in survey.options], ensure_ascii=False),
            survey.rationale, survey.confidence, observer_run_id, _now(),
        ),
    )


def _rebuild_domain_profiles(conn) -> None:
    domains = {
        str(row[0])
        for row in conn.execute(
            """SELECT DISTINCT c.domain
               FROM concepts c
               JOIN learner_inferences i ON i.subject_type = 'concept' AND i.subject_key = c.id
               WHERE i.status = 'active' AND i.scope_id IN (?, 'local-user')""",
            (GLOBAL_SCOPE_ID,),
        ).fetchall()
        if row[0]
    }
    domains.update(
        str(row[0])
        for row in conn.execute(
            """SELECT DISTINCT subject_key FROM learner_inferences
               WHERE subject_type = 'domain' AND scope_id = ? AND status = 'active'""",
            (GLOBAL_SCOPE_ID,),
        ).fetchall()
        if row[0]
    )

    for domain in domains:
        rows = conn.execute(
            """SELECT c.id, c.display_name, i.state, i.confidence, i.evidence_json
               FROM concepts c
               JOIN learner_inferences i ON i.subject_type = 'concept' AND i.subject_key = c.id
               WHERE c.domain = ? AND i.status = 'active'
                 AND (i.scope_type = 'global' AND i.scope_id = ?)""",
            (domain, GLOBAL_SCOPE_ID),
        ).fetchall()
        confirmed = [str(row["display_name"]) for row in rows if row["state"] == "confirmed"]
        learning = [str(row["display_name"]) for row in rows if row["state"] == "learning"]
        likely = [str(row["display_name"]) for row in rows if row["state"] == "likely_prerequisite"]

        confirmed_ids = {str(row["id"]) for row in rows if row["state"] == "confirmed"}
        if confirmed_ids:
            placeholders = ",".join("?" * len(confirmed_ids))
            rel_rows = conn.execute(
                f"""SELECT c.display_name
                    FROM concept_relations r
                    JOIN concepts c ON c.id = r.target_concept_id
                    WHERE r.source_concept_id IN ({placeholders})
                      AND r.relation_type = 'prerequisite'
                      AND r.status = 'active' AND r.confidence >= ?""",
                (*confirmed_ids, RELATION_CONFIDENCE),
            ).fetchall()
            for rel_row in rel_rows:
                name = str(rel_row["display_name"])
                if name not in confirmed and name not in learning and name not in likely:
                    likely.append(name)

        domain_row = conn.execute(
            """SELECT * FROM learner_inferences
               WHERE subject_type = 'domain' AND subject_key = ?
                 AND scope_type = 'global' AND scope_id = ? AND status = 'active'""",
            (domain, GLOBAL_SCOPE_ID),
        ).fetchone()
        if domain_row is not None:
            summary = str(domain_row["summary"])
            confidence = float(domain_row["confidence"])
            evidence = _loads(domain_row["evidence_json"], [])
        else:
            parts = []
            if confirmed:
                parts.append(f"已有直接证据：{', '.join(confirmed[:4])}")
            if learning:
                parts.append(f"正在学习：{', '.join(learning[:4])}")
            if not parts:
                parts.append("目前证据不足")
            summary = "；".join(parts)
            confidence = max([float(row["confidence"]) for row in rows] or [0.0])
            evidence = []

        stamp = _now()
        conn.execute(
            """INSERT INTO domain_profiles
               (domain_key, scope_id, summary, confidence, confirmed_json,
                learning_json, likely_prerequisites_json, evidence_json,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(domain_key, scope_id) DO UPDATE SET
                 summary = excluded.summary,
                 confidence = excluded.confidence,
                 confirmed_json = excluded.confirmed_json,
                 learning_json = excluded.learning_json,
                 likely_prerequisites_json = excluded.likely_prerequisites_json,
                 evidence_json = excluded.evidence_json,
                 updated_at = excluded.updated_at""",
            (
                domain, GLOBAL_SCOPE_ID, summary, confidence,
                json.dumps(confirmed[:20], ensure_ascii=False),
                json.dumps(learning[:20], ensure_ascii=False),
                json.dumps(likely[:20], ensure_ascii=False),
                json.dumps(evidence[:20], ensure_ascii=False),
                stamp, stamp,
            ),
        )


def apply_inference_updates(
    *,
    project_id: int,
    qa_record_id: int,
    observer_run_id: str,
    observation: InteractionObservation,
    conn,
) -> None:
    for relation in observation.concept_relations:
        _upsert_relation(conn, relation, observer_run_id)

    for index, evidence in enumerate(observation.knowledge_evidence):
        if evidence.confidence < DIRECT_CONFIDENCE or evidence.direction == "uncertain":
            continue
        concept = _concept_row(conn, evidence.concept_key, evidence.concept_text)
        if concept is None:
            continue
        scope_type, scope_id = _scope_for_concept(concept, project_id)
        # Legacy projection stays readable, but Observer no longer decides
        # mastery. Positive observations remain insufficient until verified.
        state = "insufficient" if evidence.direction == "positive" else "learning"
        _upsert_inference(
            conn,
            subject_type="concept",
            subject_key=str(concept["id"]),
            scope_type=scope_type,
            scope_id=scope_id,
            state=state,
            summary=evidence.explanation,
            confidence=evidence.confidence,
            direct=evidence.direction == "negative",
            evidence={
                "id": f"{observer_run_id}:knowledge:{index}",
                "qaRecordId": qa_record_id,
                "quote": evidence.evidence_quote,
                "dimension": evidence.dimension,
                "direction": evidence.direction,
            },
        )
        from app.services.personalization.knowledge_state_service import append_evidence
        append_evidence(
            {
                "id": f"{observer_run_id}:knowledge-v2:{index}",
                "idempotencyKey": f"{observer_run_id}:knowledge-v2:{index}",
                "conceptId": str(concept["id"]),
                "scopeType": scope_type,
                "scopeId": scope_id,
                "dimension": (
                    "conceptual"
                    if evidence.dimension == "conceptual_understanding"
                    else evidence.dimension
                ),
                "direction": (
                    "positive"
                    if evidence.direction == "positive"
                    else "negative"
                    if evidence.direction == "negative"
                    else "neutral"
                ),
                "strength": evidence.strength,
                "reliability": min(0.65, evidence.confidence),
                "source": "observer",
                "action": "candidate_accepted",
                "object": {
                    "type": "concept",
                    "conceptText": evidence.concept_text,
                },
                "result": {
                    "evidenceQuote": evidence.evidence_quote,
                    "explanation": evidence.explanation,
                },
                "qaRecordId": qa_record_id,
                "modelVersion": observer_run_id.split(":")[0],
            },
            conn=conn,
        )

    for index, assessment in enumerate(observation.domain_assessments):
        for concept_key in assessment.concept_keys:
            concept = _concept_row(conn, concept_key, concept_key)
            if concept is not None and assessment.domain_key != "general":
                conn.execute(
                    """UPDATE concepts SET domain = ?
                       WHERE id = ? AND (domain IS NULL OR domain = '' OR domain = 'general')""",
                    (assessment.domain_key, concept["id"]),
                )
        assessment_keys = {
            str(value).strip().casefold()
            for value in assessment.concept_keys
            if str(value).strip()
        }

        def belongs_to_assessment(item) -> bool:
            candidates = {
                str(item.concept_text or "").strip().casefold(),
                str(item.concept_key or "").strip().casefold(),
            }
            if assessment_keys and any(value in assessment_keys for value in candidates if value):
                return True
            concept_row = _concept_row(conn, item.concept_key, item.concept_text)
            return bool(
                concept_row is not None
                and str(concept_row["domain"] or "").strip().casefold()
                == assessment.domain_key.strip().casefold()
            )

        direct_positive = any(
            item.direction == "positive"
            and item.confidence >= DIRECT_CONFIDENCE
            and belongs_to_assessment(item)
            for item in observation.knowledge_evidence
        )
        direct_negative = any(
            item.direction == "negative"
            and item.confidence >= DIRECT_CONFIDENCE
            and belongs_to_assessment(item)
            for item in observation.knowledge_evidence
        )
        state = assessment.state
        direct = False
        if state == "confirmed":
            # A domain-level model assessment is a teaching hint, never proof.
            state = "likely_prerequisite"
        elif state == "learning":
            direct = direct_negative
        _upsert_inference(
            conn,
            subject_type="domain",
            subject_key=assessment.domain_key,
            scope_type="global",
            scope_id=GLOBAL_SCOPE_ID,
            state=state,
            summary=assessment.summary,
            confidence=assessment.confidence,
            direct=direct,
            evidence={
                "id": f"{observer_run_id}:domain:{index}",
                "qaRecordId": qa_record_id,
                "quotes": assessment.evidence_quotes,
                "conceptKeys": assessment.concept_keys,
            },
        )

    _store_survey(conn, observation.survey_candidate, observer_run_id)
    _rebuild_domain_profiles(conn)


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
    from app.services.storage import _connect
    with _connect() as conn:
        domains = [
            {
                "domainKey": row["domain_key"],
                "summary": row["summary"],
                "confidence": float(row["confidence"]),
                "confirmed": _loads(row["confirmed_json"], []),
                "learning": _loads(row["learning_json"], []),
                "likelyPrerequisites": _loads(row["likely_prerequisites_json"], []),
                "evidence": _loads(row["evidence_json"], []),
                "updatedAt": row["updated_at"],
            }
            for row in conn.execute(
                "SELECT * FROM domain_profiles WHERE scope_id = ? ORDER BY updated_at DESC",
                (GLOBAL_SCOPE_ID,),
            ).fetchall()
        ]
        inferences = [
            {
                "id": row["id"],
                "subjectType": row["subject_type"],
                "subjectKey": row["subject_key"],
                "displayName": row["display_name"],
                "scopeType": row["scope_type"],
                "scopeId": row["scope_id"],
                "state": row["state"],
                "summary": row["summary"],
                "confidence": float(row["confidence"]),
                "directEvidenceCount": int(row["direct_evidence_count"]),
                "inferredEvidenceCount": int(row["inferred_evidence_count"]),
                "evidence": _loads(row["evidence_json"], []),
                "updatedAt": row["updated_at"],
            }
            for row in conn.execute(
                """SELECT i.*, c.display_name
                   FROM learner_inferences i
                   LEFT JOIN concepts c
                     ON i.subject_type = 'concept' AND c.id = i.subject_key
                   WHERE i.status = 'active'
                     AND ((scope_type = 'global' AND scope_id = ?)
                       OR (scope_type = 'project' AND scope_id = ?))
                   ORDER BY i.updated_at DESC LIMIT 200""",
                (GLOBAL_SCOPE_ID, str(project_id)),
            ).fetchall()
        ]
        relations = [
            {
                "id": row["id"],
                "sourceConceptId": row["source_concept_id"],
                "targetConceptId": row["target_concept_id"],
                "relationType": row["relation_type"],
                "domain": row["domain"],
                "confidence": float(row["confidence"]),
                "evidence": _loads(row["evidence_json"], []),
            }
            for row in conn.execute(
                "SELECT * FROM concept_relations WHERE status = 'active' ORDER BY updated_at DESC LIMIT 200"
            ).fetchall()
        ]
        survey = conn.execute(
            """SELECT * FROM survey_candidates
               WHERE scope_id = ? AND status = 'pending'
               ORDER BY created_at DESC LIMIT 1""",
            (GLOBAL_SCOPE_ID,),
        ).fetchone()
        audits = [
            {
                "id": row["id"],
                "projectId": row["project_id"],
                "purpose": row["purpose"],
                "provider": row["provider"],
                "model": row["model"],
                "status": row["status"],
                "inputTokens": row["input_tokens"],
                "outputTokens": row["output_tokens"],
                "estimatedCost": row["estimated_cost"],
                "latencyMs": row["latency_ms"],
                "errorMessage": row["error_message"],
                "createdAt": row["created_at"],
            }
            for row in conn.execute(
                "SELECT * FROM model_call_audit ORDER BY created_at DESC LIMIT 50"
            ).fetchall()
        ]
    return {
        "domainProfiles": domains,
        "inferences": inferences,
        "relations": relations,
        "surveyCandidate": None if survey is None else {
            "id": survey["id"],
            "question": survey["question"],
            "dimension": survey["dimension"],
            "options": _loads(survey["options_json"], []),
            "rationale": survey["rationale"],
            "confidence": float(survey["confidence"]),
            "createdAt": survey["created_at"],
        },
        "modelCalls": audits,
    }


def answer_survey(project_id: int, survey_id: str, choice: str) -> dict[str, Any]:
    from app.services.personalization_service import apply_preference_feedback
    from app.services.storage import _connect
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM survey_candidates WHERE id = ? AND scope_id = ?",
            (survey_id, GLOBAL_SCOPE_ID),
        ).fetchone()
        if row is None:
            raise ValueError("survey not found")
        if row["status"] != "pending":
            return {"status": row["status"]}
        options = _loads(row["options_json"], [])
        if choice not in {str(option.get("value")) for option in options if isinstance(option, dict)}:
            raise ValueError("invalid survey choice")
        conn.execute(
            """UPDATE survey_candidates
               SET status = 'answered', answer = ?, answered_at = ? WHERE id = ?""",
            (choice, _now(), survey_id),
        )
        conn.commit()
        dimension = str(row["dimension"])
    apply_preference_feedback(
        project_id,
        dimension=dimension,
        choice=choice,
        source="survey",
        idempotency_key=f"dynamic-survey:{survey_id}",
        scope="global",
    )
    return {"status": "answered"}


def dismiss_survey(survey_id: str) -> dict[str, Any]:
    from app.services.storage import _connect
    with _connect() as conn:
        conn.execute(
            """UPDATE survey_candidates SET status = 'dismissed', dismissed_at = ?
               WHERE id = ? AND scope_id = ? AND status = 'pending'""",
            (_now(), survey_id, GLOBAL_SCOPE_ID),
        )
        conn.commit()
    return {"status": "dismissed"}


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
    if not concept_ids:
        return {"domains": [], "inferences": [], "explanations": []}
    from app.services.storage import _connect
    placeholders = ",".join("?" * len(concept_ids))
    with _connect() as conn:
        concept_rows = conn.execute(
            f"SELECT id, domain FROM concepts WHERE id IN ({placeholders})",
            concept_ids,
        ).fetchall()
        domains = sorted({str(row["domain"]) for row in concept_rows if row["domain"]})
        domain_rows = []
        if domains:
            domain_placeholders = ",".join("?" * len(domains))
            domain_rows = conn.execute(
                f"""SELECT * FROM domain_profiles
                    WHERE scope_id = ? AND domain_key IN ({domain_placeholders})""",
                (GLOBAL_SCOPE_ID, *domains),
            ).fetchall()
        inference_rows = conn.execute(
            f"""SELECT * FROM learner_inferences
                WHERE subject_type = 'concept' AND subject_key IN ({placeholders})
                  AND status = 'active'
                  AND ((scope_type = 'global' AND scope_id = ?)
                    OR (scope_type = 'project' AND scope_id = ?))""",
            (*concept_ids, GLOBAL_SCOPE_ID, str(project_id)),
        ).fetchall()
        prerequisite_rows = conn.execute(
            f"""SELECT DISTINCT c.id, c.display_name
                FROM concept_relations r
                JOIN concepts c ON c.id = r.target_concept_id
                WHERE r.source_concept_id IN ({placeholders})
                  AND r.relation_type = 'prerequisite'
                  AND r.status = 'active'
                ORDER BY r.confidence DESC LIMIT 8""",
            concept_ids,
        ).fetchall()
        explanation_rows = conn.execute(
            f"""SELECT e.concept_id, e.project_id, e.qa_record_id, e.title
                FROM concept_explanations e
                JOIN qa_records q ON q.id = e.qa_record_id AND q.project_id = e.project_id
                JOIN projects p ON p.id = e.project_id
                WHERE e.concept_id IN ({placeholders}) AND e.status = 'active'
                GROUP BY e.concept_id
                ORDER BY e.updated_at DESC""",
            concept_ids,
        ).fetchall()
    return {
        "domains": [
            {
                "domainKey": row["domain_key"],
                "summary": row["summary"],
                "confirmed": _loads(row["confirmed_json"], []),
                "learning": _loads(row["learning_json"], []),
                "likelyPrerequisites": _loads(row["likely_prerequisites_json"], []),
                "confidence": float(row["confidence"]),
            }
            for row in domain_rows
        ],
        "inferences": [
            {
                "conceptId": row["subject_key"],
                "state": row["state"],
                "summary": row["summary"],
                "confidence": float(row["confidence"]),
                "directEvidenceCount": int(row["direct_evidence_count"]),
            }
            for row in inference_rows
        ],
        "prerequisites": [
            {"conceptId": row["id"], "displayName": row["display_name"]}
            for row in prerequisite_rows
        ],
        "explanations": [
            {
                "conceptId": row["concept_id"],
                "projectId": int(row["project_id"]),
                "qaRecordId": int(row["qa_record_id"]),
                "title": row["title"],
                "url": f"https://codecourse.local/qa/{int(row['project_id'])}/{int(row['qa_record_id'])}",
            }
            for row in explanation_rows
        ],
    }
