"""Apply an explicitly prepared history classification without discarding facts.

Semantic classification is supplied by the history-curation job. This service
only validates and applies that plan, preserving IDs, source text and evidence.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4

from app.services.storage import run_in_transaction
from app.services.knowledge_tree_service import _validate_parent_graph, _sync


def _label(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 120:
        raise ValueError("History classification requires a readable name")
    if any(ord(c) < 32 or c == "\ufffd" or "\ue000" <= c <= "\uf8ff" for c in value):
        raise ValueError("Unreadable history name must be isolated")
    return value.strip()


def apply_history_classification(plan, *, conn=None):
    if conn is None:
        return run_in_transaction(lambda db: apply_history_classification(plan, conn=db))
    items = plan.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("History plan requires items")
    job = str(plan.get("job_id") or uuid4())
    if conn.execute("SELECT 1 FROM knowledge_tree_issues WHERE id=?", ("history-job:" + job,)).fetchone():
        return {"status": "already_applied", "job_id": job}
    _sync(conn)
    rows = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM concepts")}
    nodes = {r["concept_id"]: dict(r) for r in conn.execute("SELECT * FROM concept_tree_nodes")}
    by_id = {}
    for item in items:
        identity = item.get("id")
        if identity in by_id or identity not in rows:
            raise ValueError("Duplicate or unknown history identity")
        if rows[identity]["canonical_name"] != item.get("original_name"):
            raise ValueError("History changed since classification; refresh before applying")
        if item.get("status") not in {"keep", "archive"}:
            raise ValueError("Unknown history action")
        if item["status"] == "keep":
            path = item.get("path")
            if not isinstance(path, list) or not 1 <= len(path) <= 3:
                raise ValueError("History category path is invalid")
            for label in path:
                _label(label)
            _label(item.get("name") or rows[identity]["display_name"])
        by_id[identity] = item
    stamp = datetime.now(timezone.utc).isoformat()
    # Audit every original row before touching names or placements. No learning
    # evidence, answer, document or course completion is removed by this job.
    for identity, item in by_id.items():
        conn.execute("""INSERT INTO knowledge_tree_issues(id,kind,payload_json,status,created_at)
            VALUES(?, 'history_curation', ?, 'resolved', ?)""",
            ("history:" + job + ":" + identity, json.dumps({
                "original_concept": rows[identity], "original_placement": nodes[identity],
                "original_alias_bindings": [dict(row) for row in conn.execute(
                    "SELECT * FROM concept_alias_bindings WHERE concept_id=?", (identity,))],
                "decision": item}, ensure_ascii=False), stamp))
    kept = {identity for identity, item in by_id.items() if item["status"] == "keep"}
    categories, used_categories = {}, set()
    created = []

    def category(scope_type, scope_id, path):
        key = (scope_type, scope_id, tuple(path))
        if key in categories:
            return categories[key]
        parent = category(scope_type, scope_id, path[:-1]) if len(path) > 1 else None
        label = _label(path[-1])
        matches = [identity for identity in kept if identity not in used_categories
            and nodes[identity]["scope_type"] == scope_type and nodes[identity]["scope_id"] == scope_id
            and (rows[identity]["canonical_name"].casefold() == label.casefold()
                 or rows[identity]["display_name"].casefold() == label.casefold())]
        identity = matches[0] if len(matches) == 1 else None
        if identity is None:
            digest = hashlib.sha256(json.dumps(key, ensure_ascii=False).encode()).hexdigest()[:24]
            concept_key = ("global:" if scope_type == "global" else "project:" + scope_id + ":") + "history-category:" + digest
            existing = conn.execute("SELECT id FROM concepts WHERE concept_key=?", (concept_key,)).fetchone()
            identity = existing["id"] if existing else str(uuid4())
            if not existing:
                domain = "history:" + path[0].casefold()
                conn.execute("""INSERT INTO concepts(id,concept_key,canonical_name,display_name,domain,
                    concept_type,aliases_json,difficulty,created_at) VALUES(?,?,?,?,?,'category','[]',0.5,?)""",
                    (identity, concept_key, label, label, domain, stamp))
                conn.execute("""INSERT INTO concept_tree_nodes(concept_id,parent_id,scope_type,scope_id,domain,
                    normalized_name,identity_status,placement_status,topology_source_json,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,'resolved',?,'{}',?,?)""",
                    (identity, parent, scope_type, scope_id, domain, label.casefold(),
                     "placed" if parent else "root", stamp, stamp))
                created.append(identity)
        used_categories.add(identity)
        categories[key] = identity
        conn.execute("""UPDATE concept_tree_nodes SET parent_id=?,placement_status=?,
            topology_source_json=?,updated_at=? WHERE concept_id=?""",
            (parent, "placed" if parent else "root",
             json.dumps({"source": "history_curation", "job_id": job, "path": path}, ensure_ascii=False), stamp, identity))
        return identity

    # Build categories before assigning leaves so reused category concepts keep
    # their structural placement rather than being attached below themselves.
    for identity, item in by_id.items():
        if item["status"] == "keep":
            node = nodes[identity]
            category(node["scope_type"], node["scope_id"], item["path"])
    renamed, archived = 0, 0
    for identity, item in by_id.items():
        if item["status"] == "archive":
            conn.execute("UPDATE concepts SET concept_type='archived' WHERE id=?", (identity,))
            conn.execute("DELETE FROM concept_alias_bindings WHERE concept_id=?", (identity,))
            conn.execute("""UPDATE concept_tree_nodes SET identity_status='archived',parent_id=NULL,
                placement_status='archived',updated_at=? WHERE concept_id=?""", (stamp, identity))
            archived += 1
            continue
        name = _label(item.get("name") or rows[identity]["display_name"])
        if name != rows[identity]["display_name"]:
            # Display repair never merges identities or transfers user evidence.
            # Canonical repair is allowed only when it does not collide.
            node = nodes[identity]
            collision = conn.execute("""SELECT 1 FROM concept_tree_nodes
                WHERE scope_type=? AND scope_id=? AND domain=? AND normalized_name=?
                  AND concept_id<>? AND identity_status='resolved'""",
                (node["scope_type"], node["scope_id"], node["domain"], name.casefold(), identity)).fetchone()
            conn.execute("UPDATE concepts SET display_name=? WHERE id=?", (name, identity))
            if not collision:
                conn.execute("UPDATE concepts SET canonical_name=? WHERE id=?", (name, identity))
                conn.execute("UPDATE concept_tree_nodes SET normalized_name=? WHERE concept_id=?", (name.casefold(), identity))
            renamed += 1
        if identity not in used_categories:
            node = nodes[identity]
            parent = categories[(node["scope_type"], node["scope_id"], tuple(item["path"]))]
            conn.execute("""UPDATE concept_tree_nodes SET parent_id=?,placement_status='placed',
                topology_source_json=?,updated_at=? WHERE concept_id=?""",
                (parent, json.dumps({"source": "history_curation", "job_id": job}, ensure_ascii=False), stamp, identity))
    for root in plan.get("project_roots", []):
        project = conn.execute("SELECT id FROM projects WHERE id=?", (root["project_id"],)).fetchone()
        if project is None:
            raise ValueError("Unknown project root")
        identity = categories.get(("global", "local-user", tuple(root["path"])))
        if identity is None:
            raise ValueError("Project root must reference a classified root")
        if conn.execute("SELECT parent_id FROM concept_tree_nodes WHERE concept_id=?", (identity,)).fetchone()[0] is not None:
            raise ValueError("Project root cannot reference a subcategory")
        conn.execute("""INSERT OR IGNORE INTO project_knowledge_roots(project_id,root_concept_id,source_json,created_at)
            VALUES(?,?,?,?)""", (root["project_id"], identity, json.dumps({"source": "history_curation", "job_id": job}), stamp))
        conn.execute("""INSERT INTO project_root_status(project_id,status,error,updated_at) VALUES(?,'ready',NULL,?)
            ON CONFLICT(project_id) DO UPDATE SET status='ready',error=NULL,updated_at=excluded.updated_at""",
            (root["project_id"], stamp))
    # A partial plan must not leave active descendants below a hidden parent.
    _validate_parent_graph({r["concept_id"]: dict(r) for r in conn.execute(
        "SELECT * FROM concept_tree_nodes WHERE identity_status<>'archived'")})
    conn.execute("UPDATE knowledge_tree_versions SET topology_version=topology_version+1 WHERE id=1")
    summary = {"status": "applied", "job_id": job, "kept": len(kept), "archived": archived,
               "renamed": renamed, "created_categories": len(created)}
    conn.execute("""INSERT INTO knowledge_tree_issues(id,kind,payload_json,status,created_at)
        VALUES(?,'history_curation_complete',?,'resolved',?)""",
        ("history-job:" + job, json.dumps(summary, ensure_ascii=False), stamp))
    return summary
