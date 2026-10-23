"""Persistence and replay services for verifiable learner knowledge state."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Iterable
from uuid import uuid4

from app.services.personalization.knowledge_state_resolver import (
    DIMENSIONS,
    POLICY_VERSION,
    resolve_knowledge_state,
)
from app.services.storage import _connect, run_in_transaction

VALID_SOURCES = {
    "manual",
    "diagnostic",
    "question",
    "summary",
    "observer",
    "course_completion",
    "migration",
    "contact",
}
VALID_DIRECTIONS = {"positive", "negative", "neutral"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False, separators=(",", ":"))


def _row_to_evidence(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "idempotencyKey": row["idempotency_key"],
        "schemaVersion": 2,
        "conceptId": row["concept_id"],
        "scopeType": row["scope_type"],
        "scopeId": row["scope_id"],
        "dimension": row["dimension"],
        "direction": row["direction"],
        "strength": float(row["strength"]),
        "reliability": float(row["reliability"]),
        "source": row["source"],
        "action": row["action"],
        "object": json.loads(row["object_json"] or "{}"),
        "result": json.loads(row["result_json"] or "{}"),
        "context": json.loads(row["context_json"] or "{}"),
        "eventTime": row["event_time"],
        "sessionId": row["session_id"],
        "qaRecordId": row["qa_record_id"],
        "diagnosticAttemptId": row["diagnostic_attempt_id"],
        "objectiveCorrect": (
            None if row["objective_correct"] is None else bool(row["objective_correct"])
        ),
        "targetEvidenceId": row["target_evidence_id"],
        "voided": bool(row["voided"]),
        "modelVersion": row["model_version"],
        "policyVersion": row["policy_version"],
    }


def append_evidence(payload: dict[str, Any], conn=None) -> dict[str, Any]:
    if conn is None:
        return run_in_transaction(lambda database: append_evidence(payload, conn=database))
    owns_connection = False
    database = conn
    try:
        dimension = str(payload.get("dimension", ""))
        direction = str(payload.get("direction", ""))
        source = str(payload.get("source", ""))
        if dimension not in DIMENSIONS:
            raise ValueError(f"Unsupported knowledge dimension: {dimension}")
        if direction not in VALID_DIRECTIONS:
            raise ValueError(f"Unsupported evidence direction: {direction}")
        if source not in VALID_SOURCES:
            raise ValueError(f"Unsupported evidence source: {source}")
        if source in {"observer", "diagnostic"}:
            raise ValueError("Inferred/diagnostic profiling is retired")
        event_id = str(payload.get("id") or uuid4())
        idempotency_key = str(payload.get("idempotencyKey") or event_id)
        event_time = str(payload.get("eventTime") or _now())
        _validate_scope(database, str(payload["conceptId"]), str(payload["scopeType"]), str(payload["scopeId"]))
        existing = database.execute(
            "SELECT * FROM learning_evidence_v2 WHERE idempotency_key=? OR id=?",
            (idempotency_key, event_id),
        ).fetchone()
        if existing is not None:
            if (existing["concept_id"], existing["scope_type"], existing["scope_id"], existing["action"], existing["target_evidence_id"]) != (
                str(payload["conceptId"]), str(payload["scopeType"]), str(payload["scopeId"]),
                str(payload.get("action") or "observed"), payload.get("targetEvidenceId"),
            ):
                raise ValueError("Evidence action ID is already bound to another action or scope")
            if any(existing[field] != value for field, value in (
                ("dimension", dimension), ("direction", direction), ("source", source),
            )) or json.loads(existing["object_json"] or "{}") != (payload.get("object") or {}) or json.loads(existing["result_json"] or "{}") != (payload.get("result") or {}):
                raise ValueError("Evidence action ID is already bound to another payload")
            evidence = _row_to_evidence(existing)
            return {"evidence": evidence, "state": rebuild_state(evidence["conceptId"], evidence["scopeType"], evidence["scopeId"], conn=database), "idempotent": True}
        database.execute(
            """INSERT OR IGNORE INTO learning_evidence_v2
               (id, idempotency_key, schema_version, concept_id, scope_type,
                scope_id, dimension, direction, strength, reliability, source,
                action, object_json, result_json, context_json, event_time,
                session_id, qa_record_id, diagnostic_attempt_id,
                objective_correct, target_evidence_id, voided, model_version,
                policy_version)
               VALUES (?, ?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                       ?, ?, ?, ?, ?, ?)""",
            (
                event_id,
                idempotency_key,
                str(payload["conceptId"]),
                str(payload["scopeType"]),
                str(payload["scopeId"]),
                dimension,
                direction,
                max(0.0, min(1.0, float(payload.get("strength", 1)))),
                max(0.0, min(1.0, float(payload.get("reliability", 0.5)))),
                source,
                str(payload.get("action") or "observed"),
                _json(payload.get("object")),
                _json(payload.get("result")),
                _json(payload.get("context")),
                event_time,
                payload.get("sessionId"),
                payload.get("qaRecordId"),
                payload.get("diagnosticAttemptId"),
                (
                    None
                    if payload.get("objectiveCorrect") is None
                    else int(bool(payload.get("objectiveCorrect")))
                ),
                payload.get("targetEvidenceId"),
                int(bool(payload.get("voided", False))),
                payload.get("modelVersion"),
                str(payload.get("policyVersion") or POLICY_VERSION),
            ),
        )
        row = database.execute(
            "SELECT * FROM learning_evidence_v2 WHERE idempotency_key = ?",
            (idempotency_key,),
        ).fetchone()
        if row is None:
            raise RuntimeError("Evidence was not persisted")
        evidence = _row_to_evidence(row)
        state = rebuild_state(
            evidence["conceptId"],
            evidence["scopeType"],
            evidence["scopeId"],
            conn=database,
        )
        if owns_connection:
            database.commit()
        return {"evidence": evidence, "state": state, "idempotent": False}
    finally:
        if owns_connection:
            database.close()


def _validate_scope(conn, concept_id: str, scope_type: str, scope_id: str) -> None:
    row = conn.execute("SELECT * FROM concepts WHERE id=?", (concept_id,)).fetchone()
    if row is None:
        raise ValueError("Evidence concept does not exist")
    from app.services.knowledge_tree_schema import concept_scope
    if (scope_type, scope_id) != concept_scope(row):
        raise ValueError("Evidence scope does not match concept ownership")


def _fact_signature(state: dict[str, Any] | None) -> str:
    state = state or {}
    return _json({key: state.get(key, default) for key, default in (
        ("familiarity", "unrecorded"), ("ranges", []), ("evidence_ids", []), ("source_count", 0),
    )})


def list_evidence(
    concept_id: str,
    scope_type: str,
    scope_id: str,
    conn=None,
) -> list[dict[str, Any]]:
    if conn is None:
        with _connect() as database:
            return list_evidence(concept_id, scope_type, scope_id, conn=database)
    owns_connection = False
    database = conn
    try:
        rows = database.execute(
            """SELECT * FROM learning_evidence_v2
               WHERE concept_id = ? AND scope_type = ? AND scope_id = ?
               ORDER BY event_time, id""",
            (concept_id, scope_type, scope_id),
        ).fetchall()
        return [_row_to_evidence(row) for row in rows]
    finally:
        if owns_connection:
            database.close()


def rebuild_state(
    concept_id: str,
    scope_type: str,
    scope_id: str,
    conn=None,
) -> dict[str, Any]:
    if conn is None:
        return run_in_transaction(
            lambda database: rebuild_state(
                concept_id,
                scope_type,
                scope_id,
                conn=database,
            )
        )
    owns_connection = False
    database = conn
    try:
        current_time = _now()
        evidence = list_evidence(concept_id, scope_type, scope_id, conn=database)
        from app.services.learning_ranges import normalize_evidence, resolve
        evidence = normalize_evidence(database, evidence)
        state = resolve_knowledge_state(
            concept_id,
            scope_type,
            scope_id,
            evidence,
            current_time,
        )
        for item in state.get('ranges', []):
            item['aspect'], item['aspect_id'] = resolve(database, concept_id, item['dimension'], item['aspect'])
        old = database.execute(
            "SELECT state_json FROM knowledge_states_v2 WHERE concept_id=? AND scope_type=? AND scope_id=?",
            (concept_id, scope_type, scope_id),
        ).fetchone()
        previous = json.loads(old["state_json"]) if old else None
        if _fact_signature(previous) != _fact_signature(state):
            database.execute("UPDATE knowledge_tree_versions SET state_version=state_version+1 WHERE id=1")
        database.execute(
            """INSERT INTO knowledge_states_v2
               (concept_id, scope_type, scope_id, state_json, policy_version,
                evidence_version, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(concept_id, scope_type, scope_id) DO UPDATE SET
                 state_json=excluded.state_json,
                 policy_version=excluded.policy_version,
                 evidence_version=excluded.evidence_version,
                 updated_at=excluded.updated_at""",
            (
                concept_id,
                scope_type,
                scope_id,
                _json(state),
                POLICY_VERSION,
                state["evidenceVersion"],
                current_time,
            ),
        )
        if owns_connection:
            database.commit()
        return state
    finally:
        if owns_connection:
            database.close()


def get_states(
    scopes: Iterable[tuple[str, str]],
    concept_ids: list[str] | None = None,
    conn=None,
) -> list[dict[str, Any]]:
    scope_list = list(scopes)
    if not scope_list:
        return []
    if conn is None:
        return run_in_transaction(lambda database: get_states(scope_list, concept_ids, conn=database))
    if conn is not None:
        pairs = conn.execute(
            """SELECT DISTINCT concept_id, scope_type, scope_id
               FROM learning_evidence_v2"""
        ).fetchall()
        for pair in pairs:
            scope = (pair["scope_type"], pair["scope_id"])
            if scope not in scope_list:
                continue
            try:
                _validate_scope(conn, pair["concept_id"], *scope)
            except ValueError:
                continue
            if concept_ids and pair["concept_id"] not in concept_ids:
                continue
            cached = conn.execute(
                """SELECT policy_version, evidence_version
                   FROM knowledge_states_v2
                   WHERE concept_id = ? AND scope_type = ? AND scope_id = ?""",
                (pair["concept_id"], *scope),
            ).fetchone()
            if (
                cached is None
                or cached["policy_version"] != POLICY_VERSION
            ):
                rebuild_state(pair["concept_id"], *scope, conn=conn)
        query = "SELECT * FROM knowledge_states_v2 WHERE " + " OR ".join(
            "(scope_type = ? AND scope_id = ?)" for _ in scope_list
        )
        params: list[Any] = [value for pair in scope_list for value in pair]
        if concept_ids:
            query = f"SELECT * FROM ({query}) WHERE concept_id IN ({','.join('?' for _ in concept_ids)})"
            params.extend(concept_ids)
        rows = conn.execute(query, params).fetchall()
        result = []
        for row in sorted(rows, key=lambda row: (row["concept_id"], row["scope_type"], row["scope_id"])):
            try:
                _validate_scope(conn, row["concept_id"], row["scope_type"], row["scope_id"])
            except ValueError:
                continue
            result.append(json.loads(row["state_json"]))
        return result


def rebuild_profile(project_id: int | None = None) -> dict[str, Any]:
    scopes = [("global", "local-user")]
    if project_id is not None:
        scopes.append(("project", str(project_id)))
    rebuilt = 0
    with _connect() as conn:
        pairs = conn.execute(
            """SELECT DISTINCT concept_id, scope_type, scope_id
               FROM learning_evidence_v2"""
        ).fetchall()
        for row in pairs:
            if (row["scope_type"], row["scope_id"]) not in scopes:
                continue
            rebuild_state(row["concept_id"], row["scope_type"], row["scope_id"], conn=conn)
            rebuilt += 1
        conn.commit()
    return {"status": "ok", "rebuilt": rebuilt, "policyVersion": POLICY_VERSION}


def void_evidence(
    evidence_id: str,
    idempotency_key: str,
    reason: str = "",
    conn=None,
) -> dict[str, Any]:
    def transaction(conn):
        target = conn.execute(
            "SELECT * FROM learning_evidence_v2 WHERE id = ?",
            (evidence_id,),
        ).fetchone()
        if target is None:
            raise ValueError("Evidence not found")
        prior = conn.execute(
            "SELECT * FROM learning_evidence_v2 WHERE target_evidence_id=? AND action='void_evidence' AND voided=0 ORDER BY event_time,id LIMIT 1",
            (evidence_id,),
        ).fetchone()
        if prior is not None:
            evidence = _row_to_evidence(prior)
            return {"evidence": evidence, "state": rebuild_state(target["concept_id"], target["scope_type"], target["scope_id"], conn=conn), "idempotent": True}
        return append_evidence(
            {
                "idempotencyKey": idempotency_key,
                "conceptId": target["concept_id"],
                "scopeType": target["scope_type"],
                "scopeId": target["scope_id"],
                "dimension": target["dimension"],
                "direction": "neutral",
                "strength": 0,
                "reliability": 1,
                "source": "manual",
                "action": "void_evidence",
                "targetEvidenceId": evidence_id,
                "result": {"reason": reason},
            },
            conn=conn,
        )

    return transaction(conn) if conn is not None else run_in_transaction(transaction)


def invalidate_source_evidence(conn, project_id: int, source_type: str,
                               source_path: str, content_hash: str | None = None,
                               reason: str = "source_invalidated") -> int:
    """Void one source/version without disturbing another source's statements."""
    affected = 0
    for row in conn.execute("SELECT * FROM learning_evidence_v2 WHERE action<>'void_evidence' AND voided=0 ORDER BY event_time,id").fetchall():
        event = _row_to_evidence(row)
        obj, context = event["object"], event["context"]
        bound_project = obj.get("projectId", context.get("projectId"))
        bound_path = obj.get("sourcePath", context.get("sourcePath"))
        bound_type = obj.get("sourceType") or obj.get("type") or context.get("sourceType")
        bound_hash = obj.get("contentHash") or event["result"].get("contentHash")
        if str(bound_project) != str(project_id) or str(bound_path or "").replace("\\", "/") != source_path.replace("\\", "/") or bound_type != source_type:
            continue
        if content_hash is not None and bound_hash != content_hash:
            continue
        if conn.execute("SELECT 1 FROM learning_evidence_v2 WHERE target_evidence_id=? AND action='void_evidence' AND voided=0", (event["id"],)).fetchone():
            continue
        void_evidence(event["id"], f"source-invalidated:{event['id']}", reason, conn=conn)
        affected += 1
    return affected


def invalidate_qa_evidence(conn, project_id: int, qa_record_id: int,
                           reason: str = "answer_deleted") -> int:
    """Void every fact that was created by one answer, never other sources.

    Matches both the stored qa_record_id column (old rows) and the object/context
    binding (new rows); the project binding keeps same-id answers of another
    project untouched.
    """
    affected = 0
    for row in conn.execute(
        "SELECT * FROM learning_evidence_v2 WHERE action<>'void_evidence' AND voided=0 ORDER BY event_time,id"
    ).fetchall():
        event = _row_to_evidence(row)
        obj, context = event["object"], event["context"]
        bound_question = obj.get("qaRecordId", context.get("qaRecordId"))
        if bound_question is None:
            bound_question = event.get("qaRecordId")
        if str(bound_question) != str(qa_record_id):
            continue
        bound_project = obj.get("projectId", context.get("projectId"))
        if bound_project is not None and str(bound_project) != str(project_id):
            continue
        if conn.execute("SELECT 1 FROM learning_evidence_v2 WHERE target_evidence_id=? AND action='void_evidence' AND voided=0", (event["id"],)).fetchone():
            continue
        void_evidence(event["id"], f"qa-deleted:{event['id']}", reason, conn=conn)
        affected += 1
    return affected


def record_manual_feedback_v2(
    concept_id: str,
    scope_type: str,
    scope_id: str,
    status: str | None,
    idempotency_key: str,
    evidence_text: str = "",
) -> dict[str, Any]:
    action = "manual_clear" if status is None else f"manual_{status}"
    direction = "neutral" if status is None else "positive" if status == "known" else "negative"
    return append_evidence(
        {
            "idempotencyKey": f"v2:{idempotency_key}",
            "conceptId": concept_id,
            "scopeType": scope_type,
            "scopeId": scope_id,
            "dimension": "familiarity",
            "direction": direction,
            "strength": 1,
            "reliability": 1,
            "source": "manual",
            "action": action,
            "object": {"type": "concept", "id": concept_id},
            "result": {"status": status, "evidenceText": evidence_text},
        }
    )


def _is_objective_diagnostic_candidate(candidate: dict[str, Any]) -> bool:
    source_refs = candidate.get("source_refs") or []
    if not source_refs or not all(
        ref.get("source_type") in {"course", "file", "qa"}
        and str(ref.get("source_path") or "").strip()
        and str(ref.get("excerpt") or "").strip()
        for ref in source_refs
        if isinstance(ref, dict)
    ):
        return False
    if len(source_refs) != sum(isinstance(ref, dict) for ref in source_refs):
        return False
    answer = candidate.get("answer_key")
    if answer in (None, "", [], {}):
        return False
    item_type = candidate.get("item_type")
    options = candidate.get("options") or []
    values = [_canonical_answer(option.get("value")) for option in options if isinstance(option, dict)]
    if len(values) != len(options) or len(set(values)) != len(values):
        return False
    canonical_answer = _canonical_answer(answer)
    if item_type == "step_order":
        if not isinstance(answer, list) or len(options) < 2:
            return False
        ordered = [_canonical_answer(value) for value in answer]
        return (
            len(ordered) == len(values)
            and len(set(ordered)) == len(ordered)
            and set(ordered) == set(values)
        )
    if item_type == "code_output" and not options:
        return not isinstance(answer, (list, dict))
    return len(options) >= 2 and values.count(canonical_answer) == 1


def create_diagnostic_item(
    project_id: int,
    candidate: dict[str, Any],
    source_qa_record_id: int,
    session_id: str | None,
    strategy_version: str,
    teaching_trial_id: str | None = None,
    conn=None,
) -> dict[str, Any] | None:
    """Retired: diagnostic scores do not enter the factual teaching flow."""
    return None


def _diagnostic_response(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "projectId": row["project_id"],
        "sessionId": row["session_id"],
        "sourceQaRecordId": row["source_qa_record_id"],
        "teachingTrialId": row["teaching_trial_id"],
        "conceptIds": json.loads(row["concept_ids_json"]),
        "dimension": row["dimension"],
        "itemType": row["item_type"],
        "prompt": row["prompt"],
        "options": json.loads(row["options_json"]),
        "sourceRefs": json.loads(row["source_refs_json"]),
        "rationale": row["rationale"],
        "difficulty": row["difficulty"],
        "createdAt": row["created_at"],
    }


def get_pending_diagnostic(project_id: int, conn=None) -> dict[str, Any] | None:
    """Retired: diagnostic scores do not enter the factual teaching flow."""
    return None


def submit_diagnostic_answer(
    project_id: int,
    item_id: str,
    answer: Any,
) -> dict[str, Any]:
    """Retired: diagnostic scores do not enter the factual teaching flow."""
    raise ValueError("Diagnostic profiling is retired; historical records are read-only")


def dismiss_diagnostic(project_id: int, item_id: str) -> dict[str, Any]:
    """Retired: diagnostic scores do not enter the factual teaching flow."""
    raise ValueError("Diagnostic profiling is retired; historical records are read-only")


def flag_diagnostic(project_id: int, item_id: str) -> dict[str, Any]:
    # void_evidence owns its transaction, so avoid nesting on the same handle.
    """Retired: diagnostic scores do not enter the factual teaching flow."""
    raise ValueError("Diagnostic profiling is retired; historical records are read-only")


def _canonical_answer(value: Any) -> str:
    if isinstance(value, dict) and set(value) == {"value"}:
        value = value["value"]
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
