"""Authoritative local concept identity, topology and complete teaching snapshots.

This module never calls a model. Generation supplies proposals; only this service
allocates identities and publishes validated structural changes.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4

from app.services.storage import run_in_transaction
from app.services.knowledge_tree_schema import sync_concepts
from app.services.personalization.teaching.prompt_forest import expand_prompt_references

KINDS = {"planned", "mentioned", "brief", "explained"}
DIMENSIONS = {"conceptual", "code_reading", "implementation", "debugging", "transfer"}


class TreeVersionConflict(ValueError):
    pass


def _now():
    return datetime.now(timezone.utc).isoformat()


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _project(conn, project_id):
    row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if row is None:
        raise ValueError("Project not found")
    return row


def _versions(conn):
    row = conn.execute("SELECT topology_version,state_version FROM knowledge_tree_versions WHERE id=1").fetchone()
    return dict(row)


def _visible(node, project_id):
    return ((node["scope_type"], node["scope_id"]) == ("global", "local-user")
            or (node["scope_type"], node["scope_id"]) == ("project", str(project_id)))


def _sync(conn):
    if sync_concepts(conn):
        conn.execute("UPDATE knowledge_tree_versions SET topology_version=topology_version+1 WHERE id=1")


def _scope(item, project_id):
    scope = item.get("scope")
    if scope not in {"global", "project"}:
        raise ValueError("Concept scope must be global or project")
    return scope, "local-user" if scope == "global" else str(project_id)


def _text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a nonempty string")
    return value.strip()


def _validate_parent_graph(nodes):
    for identity, node in nodes.items():
        parent_id = node["parent_id"]
        if parent_id is None:
            continue
        if parent_id == identity or parent_id not in nodes:
            raise ValueError("Self or missing parent")
        parent = nodes[parent_id]
        if node["scope_type"] == "global" and parent["scope_type"] != "global":
            raise ValueError("Global concepts cannot have private ancestors")
        if parent["scope_type"] == "project" and (node["scope_type"], node["scope_id"]) != (parent["scope_type"], parent["scope_id"]):
            raise ValueError("Cross-project parent is forbidden")
    done = set()
    for identity in nodes:
        path, current = set(), identity
        while current is not None and current not in done:
            if current in path:
                raise ValueError("Concept parent cycle")
            path.add(current)
            current = nodes[current]["parent_id"]
        done.update(path)


def apply_manifest(project_id, manifest, *, source_type, source_path, artifact_kind,
                   content_hash, tree_snapshot=None, generation_id=None, conn=None):
    """Apply one already quote-validated v2 manifest in a single transaction.

    Source fields are program-owned. The caller validates visible quote/spans
    before calling and persists coverage and publication in this same transaction.
    An exception rolls back all identities and edges, including sibling proposals.
    """
    if conn is None:
        return run_in_transaction(lambda db: apply_manifest(project_id, manifest,
            source_type=source_type, source_path=source_path, artifact_kind=artifact_kind,
            content_hash=content_hash, tree_snapshot=tree_snapshot, generation_id=generation_id, conn=db))
    _project(conn, project_id)
    if source_type not in {"course", "qa"} or artifact_kind not in {"outline", "lesson", "answer", "root"}:
        raise ValueError("Unsupported teaching source")
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 2:
        raise ValueError("TeachingManifest schema_version must be 2")
    if any(not isinstance(manifest.get(key), list) for key in ("concepts", "coverage", "terms")):
        raise ValueError("TeachingManifest concepts, coverage and terms must be arrays")
    _sync(conn)
    nodes = {row["concept_id"]: dict(row) for row in conn.execute("SELECT * FROM concept_tree_nodes")}
    manifest = expand_prompt_references(manifest, nodes)
    from app.services.knowledge_maintenance import resolve_redirects
    manifest = resolve_redirects(conn, manifest)
    versions_before = _versions(conn)
    stale_snapshot = False
    if tree_snapshot is not None:
        if not isinstance(tree_snapshot, dict):
            raise ValueError("tree_snapshot must be an object")
        topology = tree_snapshot.get("topology_version", tree_snapshot.get("topologyVersion"))
        state = tree_snapshot.get("state_version", tree_snapshot.get("stateVersion"))
        if not isinstance(topology, int) or isinstance(topology, bool) or topology < 0 \
                or not isinstance(state, int) or isinstance(state, bool) or state < 0:
            raise ValueError("tree_snapshot versions must be non-negative integers")
        stale_snapshot = topology != versions_before["topology_version"]
    proposed, refs, new_ids = {}, {}, set()
    aliases_changed = False
    stamp = _now()
    binding = {"source_type": source_type, "source_path": source_path, "artifact_kind": artifact_kind,
               "project_id": project_id, "content_hash": content_hash, "generation_id": generation_id,
               "tree_snapshot": tree_snapshot}
    for item in manifest["concepts"]:
        if not isinstance(item, dict):
            raise ValueError("Manifest concept must be an object")
        ref = _text(item.get("ref"), "ref")
        if ref in refs:
            raise ValueError("Duplicate manifest ref")
        name = _text(item.get("name"), "name")
        domain = _text(item.get("domain"), "domain").casefold()
        scope_type, scope_id = _scope(item, project_id)
        aliases = item.get("aliases", [])
        if not isinstance(aliases, list) or any(not isinstance(a, str) or not a.strip() for a in aliases):
            raise ValueError("aliases must contain nonempty strings")
        identity = item.get("existing_id")
        if identity is not None:
            if not isinstance(identity, str) or identity not in nodes or nodes[identity]["identity_status"] == "archived" or not _visible(nodes[identity], project_id):
                raise ValueError("Inaccessible existing_id")
            node = nodes[identity]
            if (scope_type, scope_id, domain) != (node["scope_type"], node["scope_id"], node["domain"]):
                raise ValueError("Existing concept scope/domain cannot be changed by a manifest")
        else:
            matching = [n for n in nodes.values() if n["identity_status"] != "archived" and
                (n["scope_type"], n["scope_id"], n["domain"], n["normalized_name"]) ==
                (scope_type, scope_id, domain, name.casefold())]
            if len(matching) > 1 or any(n["identity_status"] != "resolved" for n in matching):
                raise ValueError("Ambiguous canonical identity requires explicit existing_id")
            alias = conn.execute("""SELECT a.concept_id FROM concept_alias_bindings a
                JOIN concept_tree_nodes t ON t.concept_id=a.concept_id
                WHERE a.scope_type=? AND a.scope_id=? AND a.domain=? AND a.alias=? AND t.identity_status<>'archived'""",
                                 (scope_type, scope_id, domain, name.casefold())).fetchone()
            identity = matching[0]["concept_id"] if matching else alias["concept_id"] if alias else None
            if identity is None:
                identity = str(uuid4())
                key = f"{scope_type}:{scope_id}:{domain}:{name.casefold()}"
                if conn.execute("SELECT 1 FROM concepts WHERE concept_key=? AND concept_type='archived'", (key,)).fetchone():
                    key += ":replacement:" + identity
                conn.execute("""INSERT INTO concepts(id,concept_key,canonical_name,display_name,domain,
                    concept_type,aliases_json,difficulty,created_at) VALUES(?,?,?,?,?,?,?,0.5,?)""",
                    (identity, key, name, name, domain, "project_symbol" if scope_type == "project" else "theory", _json(aliases), stamp))
                nodes[identity] = {"concept_id": identity, "parent_id": None, "scope_type": scope_type,
                    "scope_id": scope_id, "domain": domain, "normalized_name": name.casefold(), "identity_status": "resolved", "placement_status": "pending"}
                conn.execute("""INSERT INTO concept_tree_nodes(concept_id,parent_id,scope_type,scope_id,
                    domain,normalized_name,topology_source_json,created_at,updated_at) VALUES(?,NULL,?,?,?,?,?,?,?)""",
                    (identity, scope_type, scope_id, domain, name.casefold(), _json(binding), stamp, stamp))
                new_ids.add(identity)
        refs[ref] = identity
        proposed[ref] = item
        # Alias identity is domain- and owner-bound. Collisions fail the whole proposal.
        for alias in [name, *aliases]:
            normalized = alias.strip().casefold()
            canonical = [n for n in nodes.values() if n["identity_status"] != "archived" and
                (n["scope_type"], n["scope_id"], n["domain"], n["normalized_name"]) ==
                (scope_type, scope_id, domain, normalized) and n["concept_id"] != identity]
            found = conn.execute("""SELECT concept_id FROM concept_alias_bindings
                WHERE scope_type=? AND scope_id=? AND domain=? AND alias=?""",
                                 (scope_type, scope_id, domain, normalized)).fetchone()
            if canonical or (found and found["concept_id"] != identity):
                raise ValueError("Alias is already bound to another concept")
            inserted = conn.execute("INSERT OR IGNORE INTO concept_alias_bindings VALUES(?,?,?,?,?)",
                                    (scope_type, scope_id, domain, normalized, identity))
            aliases_changed = bool(inserted.rowcount) or aliases_changed
        current = conn.execute("SELECT canonical_name,aliases_json FROM concepts WHERE id=?", (identity,)).fetchone()
        merged = sorted(set(json.loads(current["aliases_json"] or "[]")) | {
            a.strip() for a in [name, *aliases] if a.strip().casefold() != current["canonical_name"].casefold()})
        conn.execute("UPDATE concepts SET aliases_json=? WHERE id=?", (_json(merged), identity))
    requested_parents = {}
    explicit_changes = {}
    for change in manifest.get("placement_changes", []):
        if not isinstance(change, dict):
            raise ValueError("placement_changes items must be objects")
        concept_ref = _text(change.get("concept_ref"), "placement concept_ref")
        to_parent_ref = _text(change.get("to_parent_ref"), "placement to_parent_ref")
        if concept_ref not in refs or to_parent_ref not in refs:
            raise ValueError("Structural change must reference manifest concepts")
        if refs[concept_ref] == refs[to_parent_ref]:
            raise ValueError("A concept cannot become its own parent")
        if concept_ref in explicit_changes:
            raise ValueError("Duplicate placement_changes concept")
        explicit_changes[concept_ref] = {
            "from_parent_id": change.get("from_parent_id"),
            "to_parent_id": refs[to_parent_ref],
            "reason": _text(change.get("reason"), "placement reason"),
        }
    issues = []
    before = {}
    for ref, item in proposed.items():
        if "parent_ref" not in item:
            raise ValueError("Each v2 concept must explicitly include parent_ref")
        parent_ref = item["parent_ref"]
        if parent_ref is not None and (not isinstance(parent_ref, str) or parent_ref not in refs):
            raise ValueError("Unresolved parent_ref")
        identity, parent = refs[ref], refs.get(parent_ref)
        if identity not in before:
            before[identity] = (nodes[identity]["parent_id"], nodes[identity]["placement_status"])
        change = explicit_changes.get(ref)
        if change is not None:
            # An explicit proposal is the only way to move an already placed
            # node; a stale `from_parent_id` keeps the authoritative edge and is
            # recorded for later reconciliation instead of silently winning.
            current = nodes[identity]["parent_id"]
            target = change["to_parent_id"]
            if parent is not None and parent not in (current, target):
                raise ValueError("placement_changes contradicts parent_ref")
            if change["from_parent_id"] != current:
                issues.append({"kind": "placement_conflict", "concept_id": identity,
                               "from_parent_id": change["from_parent_id"], "current_parent_id": current,
                               "to_parent_id": target, "reason": change["reason"]})
                parent = current
            else:
                parent = target
        elif identity not in new_ids and nodes[identity]["placement_status"] != "pending" and nodes[identity]["parent_id"] != parent:
            raise ValueError("Existing parent requires explicit topology change")
        if stale_snapshot and identity not in new_ids and (change is not None or nodes[identity]["parent_id"] != parent):
            # New siblings may still be added, but a snapshot from another
            # topology must not reorder existing edges.
            raise ValueError("Stale tree_snapshot cannot change existing placements")
        if identity in requested_parents and requested_parents[identity] != parent:
            raise ValueError("Same concept has multiple proposed parents")
        requested_parents[identity] = parent
        nodes[identity]["parent_id"] = parent
    _validate_parent_graph(nodes)
    placement_changed = False
    for identity, parent in requested_parents.items():
        status = "placed" if parent is not None else "root"
        if before[identity] != (parent, status):
            placement_changed = True
        conn.execute("UPDATE concept_tree_nodes SET parent_id=?,placement_status=?,topology_source_json=?,updated_at=? WHERE concept_id=?",
                     (parent, status, _json(binding), stamp, identity))
    for issue in issues:
        conn.execute("""INSERT OR IGNORE INTO knowledge_tree_issues(id,kind,payload_json,status,created_at)
            VALUES(?,?,?,'pending',?)""",
                     (f"placement:{issue['concept_id']}:{issue['to_parent_id']}", issue["kind"],
                      _json(issue), stamp))
    coverage, terms = [], []
    for item in manifest["coverage"]:
        if not isinstance(item, dict) or item.get("concept_ref") not in refs:
            raise ValueError("Unresolved coverage concept_ref")
        if item.get("kind") not in KINDS or item.get("dimension") not in DIMENSIONS:
            raise ValueError("Invalid coverage kind or dimension")
        _text(item.get("aspect"), "aspect")
        _text(item.get("quote"), "quote")
        from app.services.learning_ranges import resolve
        aspect, range_id = resolve(conn, refs[item["concept_ref"]], item["dimension"], item["aspect"], item.get("aspect_id"))
        coverage.append({**item, "aspect": aspect, "aspect_id": range_id, "concept_id": refs[item["concept_ref"]]})
    for item in manifest["terms"]:
        if not isinstance(item, dict) or item.get("concept_ref") not in refs:
            raise ValueError("Unresolved term concept_ref")
        _text(item.get("text"), "term text")
        _text(item.get("quote"), "term quote")
        terms.append({**item, "concept_id": refs[item["concept_ref"]]})
    if new_ids or aliases_changed or placement_changed:
        conn.execute("UPDATE knowledge_tree_versions SET topology_version=topology_version+1 WHERE id=1")
    for identity in set(refs.values()):
        conn.execute("INSERT OR IGNORE INTO project_concept_links VALUES(?,?,?,?)", (project_id, identity, source_type, source_path))
    return {"ref_to_id": refs, "coverage": coverage, "terms": terms,
            "tree_snapshot": _versions(conn), "issues": issues}


def get_tree_snapshot(project_id, conn=None):
    if conn is None:
        return run_in_transaction(lambda db: get_tree_snapshot(project_id, conn=db))
    _project(conn, project_id)
    _sync(conn)
    from app.services.personalization.knowledge_state_service import get_states
    states = {(s["conceptId"], s["scopeType"], str(s["scopeId"])): s for s in get_states([("global", "local-user"), ("project", str(project_id))], conn=conn)}
    from app.services.learning_ranges import resolve, catalog
    grouped = {}
    for row in conn.execute("""SELECT p.concept_id,p.aspect,p.dimension,p.kind,p.document_id
        FROM teaching_passages p JOIN teaching_documents d ON d.id=p.document_id
        WHERE p.active=1 AND d.index_status='complete'
        ORDER BY p.concept_id,p.aspect,p.dimension,p.kind"""):
        aspect, range_id = resolve(conn, row['concept_id'], row['dimension'], row['aspect'])
        group = grouped.setdefault((row['concept_id'], range_id, row['dimension'], row['kind']),
            {'aspect': aspect, 'aspect_id': range_id, 'dimension': row['dimension'], 'kind': row['kind'], 'documents': set()})
        group['documents'].add(row['document_id'])
    coverage = {}
    for (identity, *_), item in grouped.items():
        documents = item.pop('documents')
        coverage.setdefault(identity, []).append({**item, 'source_count': len(documents)})
    nodes = []
    for row in conn.execute("""SELECT t.*,c.canonical_name,c.display_name,c.aliases_json FROM concept_tree_nodes t
        JOIN concepts c ON c.id=t.concept_id
        WHERE c.concept_type<>'archived' AND t.identity_status<>'archived'
        ORDER BY t.concept_id"""):
        if not _visible(row, project_id):
            continue
        state = states.get((row["concept_id"], row["scope_type"], row["scope_id"]), {})
        nodes.append({"id": row["concept_id"], "name": row["display_name"], "canonical_name": row["canonical_name"],
            "parent_id": row["parent_id"], "scope": row["scope_type"], "scope_id": row["scope_id"], "domain": row["domain"],
            "project_id": int(row["scope_id"]) if row["scope_type"] == "project" else None,
            "identity_status": row["identity_status"], "aliases": sorted(json.loads(row["aliases_json"] or "[]")),
            "placement_status": row["placement_status"],
            "familiarity": state.get("familiarity", "unrecorded"), "ranges": state.get("ranges", []),
            "coverage": coverage.get(row["concept_id"], []), "range_catalog": catalog(conn, row["concept_id"])})
    root_status = get_root_status(project_id, conn)
    return {"schema_version": 2, "tree_snapshot": _versions(conn), **_versions(conn), "nodes": nodes,
            "concepts": nodes, "topology_status": "ready",
            "plan_roots": [{"project_id": project_id, **root_status}],
            "project_roots": root_status["root_concept_ids"]}


def serialize_tree_snapshot(project_id, conn=None):
    return _json(get_tree_snapshot(project_id, conn=conn))


def get_root_status(project_id, conn=None):
    if conn is None:
        return run_in_transaction(lambda db: get_root_status(project_id, conn=db))
    project = _project(conn, project_id)
    row = conn.execute("SELECT * FROM project_root_status WHERE project_id=?", (project_id,)).fetchone()
    roots = [r[0] for r in conn.execute("SELECT root_concept_id FROM project_knowledge_roots WHERE project_id=? ORDER BY root_concept_id", (project_id,))]
    return {"status": row["status"] if row else "pending" if project["project_type"] == "learning_plan" else "unassigned",
            "error": row["error"] if row else None, "root_concept_ids": roots}


def get_root_recognition_context(project_id):
    def operation(conn):
        project = _project(conn, project_id)
        return {"project_id": project_id, "name": project["name"], "root_status": get_root_status(project_id, conn),
                "tree": get_tree_snapshot(project_id, conn), "requirements": list_requirements(project_id, conn)}
    return run_in_transaction(operation)


def apply_root_proposal(project_id, proposal, tree_snapshot, *, source="root_recognition", conn=None):
    if conn is None:
        return run_in_transaction(lambda db: apply_root_proposal(project_id, proposal, tree_snapshot, source=source, conn=db))
    _project(conn, project_id)
    _sync(conn)
    if not isinstance(tree_snapshot, dict) or tree_snapshot.get("topology_version") != _versions(conn)["topology_version"]:
        raise TreeVersionConflict("Topology changed; refresh the root proposal")
    if not isinstance(proposal, dict) or not isinstance(proposal.get("root_refs"), list) or not proposal["root_refs"]:
        raise ValueError("Root proposal requires nonempty root_refs")
    applied = apply_manifest(project_id, {"schema_version": 2, "concepts": proposal.get("concepts"), "coverage": [], "terms": []},
        source_type="course", source_path="", artifact_kind="root", content_hash="", tree_snapshot=tree_snapshot, conn=conn)
    for ref in proposal["root_refs"]:
        identity = applied["ref_to_id"].get(ref)
        node = conn.execute("SELECT * FROM concept_tree_nodes WHERE concept_id=?", (identity,)).fetchone()
        if node is None or node["parent_id"] is not None or not _visible(node, project_id):
            raise ValueError("Project root must reference an accessible forest root")
        cursor = conn.execute("INSERT OR IGNORE INTO project_knowledge_roots VALUES(?,?,?,?)",
                              (project_id, identity, _json({"source": source, "tree_snapshot": tree_snapshot}), _now()))
        if cursor.rowcount:
            conn.execute("UPDATE knowledge_tree_versions SET topology_version=topology_version+1 WHERE id=1")
    conn.execute("""INSERT INTO project_root_status(project_id,status,error,updated_at) VALUES(?,'ready',NULL,?)
        ON CONFLICT(project_id) DO UPDATE SET status='ready',error=NULL,updated_at=excluded.updated_at""", (project_id, _now()))
    return get_root_status(project_id, conn)


def link_project_roots(project_id, root_ids, topology_version):
    def operation(conn):
        _project(conn, project_id)
        _sync(conn)
        if topology_version != _versions(conn)["topology_version"]:
            raise TreeVersionConflict("Topology changed; refresh before selecting roots")
        concepts, refs = [], []
        for identity in dict.fromkeys(root_ids):
            row = conn.execute("""SELECT t.*,c.display_name FROM concept_tree_nodes t JOIN concepts c ON c.id=t.concept_id
                WHERE t.concept_id=?""", (identity,)).fetchone()
            if row is None or not _visible(row, project_id):
                raise ValueError("Inaccessible root")
            concepts.append({"ref": identity, "existing_id": identity, "name": row["display_name"], "domain": row["domain"],
                             "scope": row["scope_type"], "parent_ref": None, "aliases": []})
            refs.append(identity)
        return apply_root_proposal(project_id, {"concepts": concepts, "root_refs": refs}, _versions(conn), source="user_selected", conn=conn)
    return run_in_transaction(operation)


def reparent_concept(project_id, concept_id, parent_id, topology_version, reason):
    def operation(conn):
        _project(conn, project_id)
        _sync(conn)
        if topology_version != _versions(conn)["topology_version"]:
            raise TreeVersionConflict("Topology changed; refresh before moving a concept")
        nodes = {r["concept_id"]: dict(r) for r in conn.execute("SELECT * FROM concept_tree_nodes")}
        if concept_id not in nodes or not _visible(nodes[concept_id], project_id):
            raise ValueError("Inaccessible concept")
        if parent_id is not None and (parent_id not in nodes or not _visible(nodes[parent_id], project_id)):
            raise ValueError("Inaccessible parent")
        _text(reason, "structural change reason")
        if nodes[concept_id]["parent_id"] == parent_id:
            return _versions(conn)
        if parent_id is not None and conn.execute("SELECT 1 FROM project_knowledge_roots WHERE root_concept_id=?", (concept_id,)).fetchone():
            raise ValueError("A linked plan root cannot be reparented")
        nodes[concept_id]["parent_id"] = parent_id
        _validate_parent_graph(nodes)
        conn.execute("UPDATE concept_tree_nodes SET parent_id=?,placement_status=?,topology_source_json=?,updated_at=? WHERE concept_id=?",
            (parent_id, "root" if parent_id is None else "placed", _json({"source": "explicit_reparent", "project_id": project_id, "reason": reason}), _now(), concept_id))
        conn.execute("UPDATE knowledge_tree_versions SET topology_version=topology_version+1 WHERE id=1")
        return _versions(conn)
    return run_in_transaction(operation)


def reparent_concept_in_tx(conn, project_id, concept_id, parent_id, reason):
    nodes = {r['concept_id']: dict(r) for r in conn.execute('SELECT * FROM concept_tree_nodes')}
    if concept_id not in nodes or not _visible(nodes[concept_id], project_id): raise ValueError('无法访问概念')
    if parent_id is not None and (parent_id not in nodes or not _visible(nodes[parent_id], project_id) or nodes[parent_id]['identity_status'] == 'archived'):
        raise ValueError('无法访问父概念')
    if parent_id is not None and conn.execute('SELECT 1 FROM project_knowledge_roots WHERE root_concept_id=?', (concept_id,)).fetchone():
        raise ValueError('计划根不能移入子分类')
    nodes[concept_id]['parent_id'] = parent_id
    _validate_parent_graph(nodes)
    conn.execute('UPDATE concept_tree_nodes SET parent_id=?,placement_status=?,topology_source_json=?,updated_at=? WHERE concept_id=?',
        (parent_id, 'placed' if parent_id else 'root', _json({'project_id': project_id, 'source': 'manual_move', 'reason': reason}), _now(), concept_id))


def list_requirements(project_id, conn=None):
    if conn is None:
        return run_in_transaction(lambda db: list_requirements(project_id, conn=db))
    _project(conn, project_id)
    return [dict(r) for r in conn.execute("""SELECT id,scope_type,scope_id,text,source FROM user_teaching_requirements
        WHERE active=1 AND ((scope_type='global' AND scope_id='local-user') OR (scope_type='project' AND scope_id=?))
        ORDER BY created_at,id""", (str(project_id),))]


def save_requirement(project_id, text, scope, source, action_id):
    text, source, action_id = _text(text, "requirement text"), _text(source, "source"), _text(action_id, "action_id")
    scope_type, scope_id = _scope({"scope": scope}, project_id)
    def operation(conn):
        _project(conn, project_id)
        previous = conn.execute("SELECT * FROM user_teaching_requirements WHERE action_id=?", (action_id,)).fetchone()
        if previous:
            if (previous["text"], previous["scope_type"], previous["scope_id"], previous["source"]) != (text, scope_type, scope_id, source):
                raise ValueError("action_id already used for a different requirement")
            return dict(previous)
        identity, stamp = str(uuid4()), _now()
        conn.execute("""INSERT INTO user_teaching_requirements(id,project_id,scope_type,scope_id,text,source,action_id,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?)""", (identity, project_id if scope == "project" else None, scope_type, scope_id, text, source, action_id, stamp, stamp))
        return dict(conn.execute("SELECT * FROM user_teaching_requirements WHERE id=?", (identity,)).fetchone())
    return run_in_transaction(operation)


def edit_requirement(project_id, requirement_id, text=None, *, delete=False):
    def operation(conn):
        _project(conn, project_id)
        row = conn.execute("SELECT * FROM user_teaching_requirements WHERE id=?", (requirement_id,)).fetchone()
        if row is None or not ((row["scope_type"], row["scope_id"]) == ("global", "local-user") or
                               (row["scope_type"], row["scope_id"]) == ("project", str(project_id))):
            raise ValueError("Requirement not found")
        value = row["text"] if delete else _text(text, "requirement text")
        conn.execute("UPDATE user_teaching_requirements SET text=?,active=?,updated_at=? WHERE id=?", (value, int(not delete), _now(), requirement_id))
        return {"id": requirement_id, "active": not delete, "text": value}
    return run_in_transaction(operation)
