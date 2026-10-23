"""Versioned, model-free migration for the authoritative concept forest."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

FLOW_VERSION = "teaching-facts-v1"


def concept_scope(row):
    key = row["concept_key"] or ""
    match = re.match(r"^project:(\d+):", key)
    if match:
        return "project", match[1]
    if key.startswith("project:") or row["concept_type"] == "project_symbol":
        return "project", "unresolved"
    return "global", "local-user"


def initialize(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS knowledge_tree_versions (
        id INTEGER PRIMARY KEY CHECK(id=1), topology_version INTEGER NOT NULL DEFAULT 0,
        state_version INTEGER NOT NULL DEFAULT 0)""")
    conn.execute("INSERT OR IGNORE INTO knowledge_tree_versions(id) VALUES(1)")
    conn.execute("""CREATE TABLE IF NOT EXISTS concept_tree_nodes (
        concept_id TEXT PRIMARY KEY REFERENCES concepts(id),
        parent_id TEXT REFERENCES concepts(id), scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL, domain TEXT NOT NULL, normalized_name TEXT NOT NULL,
        identity_status TEXT NOT NULL DEFAULT 'resolved',
        placement_status TEXT NOT NULL DEFAULT 'pending',
        topology_source_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, CHECK(parent_id IS NULL OR parent_id<>concept_id),
        CHECK(scope_type IN ('global','project')))""")
    if "placement_status" not in {r[1] for r in conn.execute("PRAGMA table_info(concept_tree_nodes)")}:
        conn.execute("ALTER TABLE concept_tree_nodes ADD COLUMN placement_status TEXT NOT NULL DEFAULT 'pending'")
    conn.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_tree_identity
        ON concept_tree_nodes(scope_type,scope_id,domain,normalized_name)
        WHERE identity_status='resolved'""")
    conn.execute("""CREATE TABLE IF NOT EXISTS concept_alias_bindings (
        scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, domain TEXT NOT NULL,
        alias TEXT NOT NULL, concept_id TEXT NOT NULL REFERENCES concepts(id),
        PRIMARY KEY(scope_type,scope_id,domain,alias))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS project_knowledge_roots (
        project_id INTEGER NOT NULL REFERENCES projects(id),
        root_concept_id TEXT NOT NULL REFERENCES concepts(id), source_json TEXT NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY(project_id,root_concept_id))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS project_root_status (
        project_id INTEGER PRIMARY KEY REFERENCES projects(id), status TEXT NOT NULL,
        error TEXT, updated_at TEXT NOT NULL)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS knowledge_tree_issues (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS user_teaching_requirements (
        id TEXT PRIMARY KEY, project_id INTEGER REFERENCES projects(id),
        scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, text TEXT NOT NULL,
        source TEXT NOT NULL, action_id TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS knowledge_migrations (
        version TEXT PRIMARY KEY, completed_at TEXT NOT NULL)""")
    from app.services.knowledge_maintenance_schema import initialize as initialize_maintenance
    initialize_maintenance(conn)
    stamp = datetime.now(timezone.utc).isoformat()
    changed = sync_concepts(conn, stamp)
    if not conn.execute("SELECT 1 FROM knowledge_migrations WHERE version=?", (FLOW_VERSION,)).fetchone():
        changed = _migrate_parent_edges(conn, stamp) or changed
        conn.execute("INSERT INTO knowledge_migrations VALUES(?,?)", (FLOW_VERSION, stamp))
    conn.execute("""INSERT OR IGNORE INTO project_root_status(project_id,status,updated_at)
        SELECT id,'pending',? FROM projects WHERE project_type='learning_plan'""", (stamp,))
    # Imported settings and old queues must never reactivate retired inference.
    for key, value in (("personalization.teacher_planner.enabled", "true"),
                       ("personalization.observer.enabled", "true"),
                       ("personalization.flow_version", FLOW_VERSION)):
        conn.execute("""INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at""",
                     (key, value, stamp))
    conn.execute("""UPDATE observer_jobs SET status='cancelled',last_error='Retired by teaching-facts-v1'
        WHERE status IN ('queued','pending','running','retry')""")
    if changed:
        conn.execute("UPDATE knowledge_tree_versions SET topology_version=topology_version+1 WHERE id=1")


def sync_concepts(conn, stamp=None):
    """Adopt legacy identities without guessing taxonomy or leaking private symbols."""
    stamp = stamp or datetime.now(timezone.utc).isoformat()
    changed = bool(conn.execute("""UPDATE concept_tree_nodes SET identity_status='archived',
        parent_id=NULL,placement_status='archived',updated_at=?
        WHERE concept_id IN (SELECT id FROM concepts WHERE concept_type='archived')
          AND identity_status<>'archived'""", (stamp,)).rowcount)
    for row in conn.execute("""SELECT c.* FROM concepts c LEFT JOIN concept_tree_nodes t
        ON t.concept_id=c.id WHERE t.concept_id IS NULL ORDER BY c.created_at,c.id""").fetchall():
        scope, scope_id = concept_scope(row)
        domain = (row["domain"] or "general").strip().casefold()
        name = row["canonical_name"].strip().casefold()
        duplicate = conn.execute("""SELECT concept_id FROM concept_tree_nodes
            WHERE scope_type=? AND scope_id=? AND domain=? AND normalized_name=? AND identity_status<>'archived'""",
                                 (scope, scope_id, domain, name)).fetchone()
        status = "archived" if row["concept_type"] == "archived" else "ambiguous" if duplicate else "resolved"
        if status == "archived":
            duplicate = None
        if duplicate:
            conn.execute("""UPDATE concept_tree_nodes SET identity_status='ambiguous'
                WHERE scope_type=? AND scope_id=? AND domain=? AND normalized_name=? AND identity_status<>'archived'""",
                         (scope, scope_id, domain, name))
            conn.execute("""INSERT OR IGNORE INTO knowledge_tree_issues(id,kind,payload_json,created_at)
                VALUES(?,?,?,?)""", ("identity:" + row["id"], "ambiguous_identity",
                    json.dumps({"concept_ids": [duplicate["concept_id"], row["id"]]}, ensure_ascii=False), stamp))
        conn.execute("""INSERT INTO concept_tree_nodes(concept_id,parent_id,scope_type,scope_id,
            domain,normalized_name,identity_status,placement_status,topology_source_json,created_at,updated_at)
            VALUES(?,NULL,?,?,?,?,?,?,'{"source":"legacy_identity"}',?,?)""",
                     (row["id"], scope, scope_id, domain, name, status,
                      "archived" if status == "archived" else "pending", stamp, stamp))
        changed = True
    return changed


def _migrate_parent_edges(conn, stamp):
    nodes = {row["concept_id"]: dict(row) for row in conn.execute("SELECT * FROM concept_tree_nodes")}
    candidates = {}
    for row in conn.execute("SELECT * FROM concept_relations WHERE relation_type='is_a' AND status='active'"):
        # Legacy is_a points from the specific child to its more general parent.
        candidates.setdefault(row["source_concept_id"], set()).add(row["target_concept_id"])
    invalid = {}
    for child, parents in candidates.items():
        parent = next(iter(parents)) if len(parents) == 1 else None
        c, p = nodes.get(child), nodes.get(parent)
        if len(parents) != 1:
            invalid[child] = "multiple_parents"
        elif not c or not p:
            invalid[child] = "missing_identity"
        elif c["identity_status"] != "resolved" or p["identity_status"] != "resolved":
            invalid[child] = "ambiguous_identity"
        elif c["scope_type"] == "global" and p["scope_type"] != "global":
            invalid[child] = "private_parent"
        elif p["scope_type"] == "project" and (c["scope_type"], c["scope_id"]) != (p["scope_type"], p["scope_id"]):
            invalid[child] = "cross_project"
    parents = {child: next(iter(values)) for child, values in candidates.items() if child not in invalid}
    for child in parents:
        path, current = [], child
        while current in parents:
            if current in path:
                for member in path[path.index(current):]:
                    invalid[member] = "cycle"
                break
            path.append(current)
            current = parents[current]
    changed = False
    for child, values in candidates.items():
        if child in invalid:
            conn.execute("""INSERT OR IGNORE INTO knowledge_tree_issues(id,kind,payload_json,created_at)
                VALUES(?,?,?,?)""", ("legacy-parent:" + child, invalid[child],
                    json.dumps({"child_id": child, "parent_ids": sorted(values)}, ensure_ascii=False), stamp))
        else:
            # Only legacy/pending identities may be adopted by the old is_a
            # migration. An explicit root or a restored placement is
            # authoritative even though its parent_id is NULL.
            node = nodes.get(child) or {}
            if str(node.get("placement_status") or "pending") not in ("pending", "legacy"):
                continue
            source = json.dumps({"source": "legacy_is_a", "direction": "child_to_parent"})
            cursor = conn.execute("""UPDATE concept_tree_nodes SET parent_id=?,placement_status='placed',topology_source_json=?,updated_at=?
                WHERE concept_id=? AND parent_id IS NULL AND placement_status IN ('pending','legacy')""",
                                  (parents[child], source, stamp, child))
            changed = bool(cursor.rowcount) or changed
    return changed
