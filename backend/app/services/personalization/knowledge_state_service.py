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
        event_id = str(payload.get("id") or uuid4())
        idempotency_key = str(payload.get("idempotencyKey") or event_id)
        event_time = str(payload.get("eventTime") or _now())
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
        return {"evidence": evidence, "state": state}
    finally:
        if owns_connection:
            database.close()


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
        state = resolve_knowledge_state(
            concept_id,
            scope_type,
            scope_id,
            evidence,
            current_time,
        )
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
) -> list[dict[str, Any]]:
    scope_list = list(scopes)
    with _connect() as conn:
        pairs = conn.execute(
            """SELECT DISTINCT concept_id, scope_type, scope_id
               FROM learning_evidence_v2"""
        ).fetchall()
        for pair in pairs:
            scope = (pair["scope_type"], pair["scope_id"])
            if scope not in scope_list:
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
        conn.commit()
        query = "SELECT * FROM knowledge_states_v2 WHERE " + " OR ".join(
            "(scope_type = ? AND scope_id = ?)" for _ in scope_list
        )
        params: list[Any] = [value for pair in scope_list for value in pair]
        if concept_ids:
            query = f"SELECT * FROM ({query}) WHERE concept_id IN ({','.join('?' for _ in concept_ids)})"
            params.extend(concept_ids)
        rows = conn.execute(query, params).fetchall()
        return [json.loads(row["state_json"]) for row in rows]


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
) -> dict[str, Any]:
    def transaction(conn):
        target = conn.execute(
            "SELECT * FROM learning_evidence_v2 WHERE id = ?",
            (evidence_id,),
        ).fetchone()
        if target is None:
            raise ValueError("Evidence not found")
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

    return run_in_transaction(transaction)


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
    conn=None,
) -> dict[str, Any] | None:
    concept_ids = [str(value) for value in candidate.get("concept_ids", []) if value][:4]
    source_refs = candidate.get("source_refs") or []
    answer_key = candidate.get("answer_key")
    if not concept_ids or not _is_objective_diagnostic_candidate(candidate):
        return None
    if candidate.get("dimension") not in DIMENSIONS:
        return None
    if conn is None:
        return run_in_transaction(
            lambda database: create_diagnostic_item(
                project_id,
                candidate,
                source_qa_record_id,
                session_id,
                strategy_version,
                conn=database,
            )
        )
    owns_connection = False
    database = conn
    try:
        pending = database.execute(
            "SELECT id FROM diagnostic_items WHERE project_id = ? AND status = 'pending' LIMIT 1",
            (project_id,),
        ).fetchone()
        if pending:
            return None
        last = database.execute(
            """SELECT COALESCE(MAX(source_qa_record_id), 0) AS last_qa
               FROM diagnostic_items WHERE project_id = ?""",
            (project_id,),
        ).fetchone()
        successful_since = database.execute(
            """SELECT COUNT(*) FROM qa_records
               WHERE project_id = ? AND id > ? AND answer_md <> ''""",
            (project_id, int(last["last_qa"] or 0)),
        ).fetchone()[0]
        if int(successful_since) < 5:
            return None
        item_id = f"diagnostic:{uuid4()}"
        created = _now()
        database.execute(
            """INSERT INTO diagnostic_items
               (id, project_id, session_id, source_qa_record_id,
                concept_ids_json, dimension, item_type, prompt, options_json,
                answer_key_json, source_refs_json, rationale, difficulty,
                strategy_version, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
            (
                item_id,
                project_id,
                session_id,
                source_qa_record_id,
                _json(concept_ids),
                candidate["dimension"],
                candidate["item_type"],
                candidate["prompt"],
                _json(candidate.get("options") or []),
                _json(answer_key),
                _json(source_refs),
                str(candidate.get("rationale") or ""),
                max(0.0, min(1.0, float(candidate.get("difficulty", 0.5)))),
                strategy_version,
                created,
            ),
        )
        if owns_connection:
            database.commit()
        return get_pending_diagnostic(project_id, conn=database)
    finally:
        if owns_connection:
            database.close()


def _diagnostic_response(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "projectId": row["project_id"],
        "sessionId": row["session_id"],
        "sourceQaRecordId": row["source_qa_record_id"],
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
    if conn is None:
        with _connect() as database:
            return get_pending_diagnostic(project_id, conn=database)
    owns_connection = False
    database = conn
    try:
        row = database.execute(
            """SELECT * FROM diagnostic_items
               WHERE project_id = ? AND status = 'pending'
               ORDER BY created_at DESC LIMIT 1""",
            (project_id,),
        ).fetchone()
        return _diagnostic_response(row) if row else None
    finally:
        if owns_connection:
            database.close()


def submit_diagnostic_answer(
    project_id: int,
    item_id: str,
    answer: Any,
) -> dict[str, Any]:
    def transaction(conn):
        item = conn.execute(
            "SELECT * FROM diagnostic_items WHERE id = ? AND project_id = ?",
            (item_id, project_id),
        ).fetchone()
        if item is None or item["status"] != "pending":
            raise ValueError("Diagnostic item is not available")
        expected = json.loads(item["answer_key_json"])
        correct = _canonical_answer(answer) == _canonical_answer(expected)
        attempt_id = f"diagnostic-attempt:{uuid4()}"
        evidence_ids: list[str] = []
        for concept_id in json.loads(item["concept_ids_json"]):
            concept_row = conn.execute(
                "SELECT concept_key FROM concepts WHERE id = ?",
                (concept_id,),
            ).fetchone()
            scope_type = (
                "project"
                if concept_row and str(concept_row["concept_key"]).startswith("project:")
                else "global"
            )
            scope_id = str(project_id) if scope_type == "project" else "local-user"
            evidence_id = f"{attempt_id}:{concept_id}"
            append_evidence(
                {
                    "id": evidence_id,
                    "idempotencyKey": evidence_id,
                    "conceptId": concept_id,
                    "scopeType": scope_type,
                    "scopeId": scope_id,
                    "dimension": item["dimension"],
                    "direction": "positive" if correct else "negative",
                    "strength": 1,
                    "reliability": 0.9,
                    "source": "diagnostic",
                    "action": "answered",
                    "object": {"diagnosticItemId": item_id},
                    "result": {"answer": answer},
                    "context": {},
                    "sessionId": item["session_id"],
                    "qaRecordId": item["source_qa_record_id"],
                    "diagnosticAttemptId": attempt_id,
                    "objectiveCorrect": correct,
                },
                conn=conn,
            )
            evidence_ids.append(evidence_id)
        conn.execute(
            """INSERT INTO diagnostic_attempts
               (id, item_id, project_id, session_id, answer_json, is_correct,
                evidence_ids_json, answered_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                attempt_id,
                item_id,
                project_id,
                item["session_id"],
                _json(answer),
                int(correct),
                _json(evidence_ids),
                _now(),
            ),
        )
        conn.execute(
            "UPDATE diagnostic_items SET status = 'answered', shown_at = COALESCE(shown_at, ?) WHERE id = ?",
            (_now(), item_id),
        )
        return {"status": "answered", "correct": correct, "attemptId": attempt_id}

    return run_in_transaction(transaction)


def dismiss_diagnostic(project_id: int, item_id: str) -> dict[str, Any]:
    with _connect() as conn:
        cursor = conn.execute(
            """UPDATE diagnostic_items SET status = 'dismissed', dismissed_at = ?
               WHERE id = ? AND project_id = ? AND status = 'pending'""",
            (_now(), item_id, project_id),
        )
        conn.commit()
    return {"status": "dismissed", "changed": cursor.rowcount}


def flag_diagnostic(project_id: int, item_id: str) -> dict[str, Any]:
    # void_evidence owns its transaction, so avoid nesting on the same handle.
    with _connect() as conn:
        attempt = conn.execute(
            """SELECT * FROM diagnostic_attempts
               WHERE item_id = ? AND project_id = ?
               ORDER BY answered_at DESC LIMIT 1""",
            (item_id, project_id),
        ).fetchone()
    if attempt:
        for evidence_id in json.loads(attempt["evidence_ids_json"]):
            void_evidence(
                evidence_id,
                f"diagnostic-flag:{item_id}:{evidence_id}",
                "user_flagged_item",
            )
    with _connect() as conn:
        if attempt:
            conn.execute(
                "UPDATE diagnostic_attempts SET user_flagged = 1 WHERE id = ?",
                (attempt["id"],),
            )
        conn.execute(
            "UPDATE diagnostic_items SET status = 'flagged' WHERE id = ? AND project_id = ?",
            (item_id, project_id),
        )
        conn.commit()
    return {"status": "flagged"}


def _canonical_answer(value: Any) -> str:
    if isinstance(value, dict) and set(value) == {"value"}:
        value = value["value"]
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
