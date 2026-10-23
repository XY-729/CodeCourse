"""User-directed forest corrections and source ownership, all transactional."""
import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4

from app.services.storage import run_in_transaction
from app.services.knowledge_tree_service import _project, _sync, _versions, _visible, _validate_parent_graph, TreeVersionConflict

TABLES = ("concepts", "concept_tree_nodes", "concept_alias_bindings", "concept_redirects",
    "project_concept_links", "project_knowledge_roots", "learning_range_aliases",
    "teaching_documents", "teaching_passages", "teaching_terms", "teaching_manifest_overrides", "teaching_concept_overrides",
    "understanding_feedback", "teaching_feedback_actions", "learning_evidence_v2",
    "document_terms", "concept_explanations", "concept_mastery", "learning_events", "concept_relations")


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def now():
    return datetime.now(timezone.utc).isoformat()


def snapshot(conn):
    result = {}
    for table in TABLES:
        columns = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
        primary = [row["name"] for row in sorted(columns, key=lambda r: r["pk"]) if row["pk"]]
        if primary:
            result[table] = {encode({k: row[k] for k in primary}): dict(row) for row in conn.execute(f'SELECT * FROM "{table}"')}
    return result


def guard(rows, concepts, documents):
    selected = {}
    sources = {(r['project_id'], r['source_type'], r['source_path']) for r in rows.get('teaching_documents', {}).values() if r['id'] in documents}
    for table, records in rows.items():
        selected[table] = {pk: {k: v for k, v in row.items() if k not in {'updated_at', 'topology_source_json'}} for pk, row in records.items() if any(
            (key in {"concept_id", "source_id", "target_id", "parent_id", "root_concept_id", "source_concept_id", "target_concept_id"} and value in concepts)
            or (key == "id" and table == "concepts" and value in concepts)
            or (key == "document_id" and value in documents)
            or (key == "id" and table == "teaching_documents" and value in documents)
            for key, value in row.items()) or (row.get('project_id'), row.get('source_type'), row.get('source_path')) in sources}
    return hashlib.sha256(encode(selected).encode()).hexdigest()


def record_change(conn, project, kind, before, concepts=()):
    after = snapshot(conn)
    old, new, affected, documents = [], [], set(concepts), set()
    for table in TABLES:
        left, right = before.get(table, {}), after.get(table, {})
        for pk in sorted(left.keys() | right.keys()):
            if left.get(pk) == right.get(pk): continue
            old.append({"table": table, "pk": json.loads(pk), "row": left.get(pk)})
            new.append({"table": table, "pk": json.loads(pk), "row": right.get(pk)})
            for row in (left.get(pk) or {}, right.get(pk) or {}):
                for field in ("concept_id", "source_id", "target_id", "root_concept_id"):
                    if row.get(field): affected.add(row[field])
                if table == "concepts" and row: affected.add(row["id"])
                if row.get("document_id"): documents.add(row["document_id"])
                if table == "teaching_documents" and row: documents.add(row["id"])
    identity = str(uuid4())
    scope = {"concepts": sorted(affected), "documents": sorted(documents)}
    scope["guard"] = guard(after, affected, documents)
    conn.execute("INSERT INTO knowledge_changes VALUES(?,?,?,?,?,?,0,?)",
        (identity, project, kind, encode(scope), encode(old), encode(new), now()))
    conn.execute("UPDATE knowledge_tree_versions SET topology_version=topology_version+1,state_version=state_version+1 WHERE id=1")
    return {"changeId": identity, **_versions(conn)}


def rebuild(conn, ids):
    from app.services.personalization.knowledge_state_service import rebuild_state
    for identity in ids:
        node = conn.execute("SELECT * FROM concept_tree_nodes WHERE concept_id=? AND identity_status<>'archived'", (identity,)).fetchone()
        conn.execute("DELETE FROM knowledge_states_v2 WHERE concept_id=?", (identity,))
        if node: rebuild_state(identity, node["scope_type"], node["scope_id"], conn=conn)


def undo_change(project, identity):
    def work(conn):
        _project(conn, project)
        row = conn.execute("SELECT * FROM knowledge_changes WHERE id=? AND project_id=?", (identity, project)).fetchone()
        if row is None: raise ValueError("修改记录不存在")
        if row["undone"]: return {"changeId": identity, "undone": True, **_versions(conn)}
        scope = json.loads(row["affected_json"])
        if guard(snapshot(conn), set(scope["concepts"]), set(scope["documents"])) != scope["guard"]:
            raise TreeVersionConflict("相关知识或来源已发生后续变化，不能覆盖新记录；请刷新后手动调整")
        before = json.loads(row["before_json"])
        conn.execute('PRAGMA defer_foreign_keys=ON')
        for change in reversed(before):
            if change['row'] is not None: continue
            where = " AND ".join(f'"{key}"=?' for key in change["pk"])
            conn.execute(f'DELETE FROM "{change["table"]}" WHERE {where}', list(change["pk"].values()))
        for change in before:
            value = change["row"]
            if value is not None:
                columns = list(value)
                primary = ','.join(change['pk'])
                updates = ','.join(f'{column}=excluded.{column}' for column in columns)
                conn.execute(f'INSERT INTO "{change["table"]}" ({",".join(columns)}) VALUES({",".join("?" for _ in columns)}) ON CONFLICT({primary}) DO UPDATE SET {updates}', list(value.values()))
        conn.execute("UPDATE knowledge_changes SET undone=1 WHERE id=?", (identity,))
        conn.execute("UPDATE teaching_backfills SET status='undone' WHERE change_id=?", (identity,))
        rebuild(conn, scope["concepts"])
        conn.execute("UPDATE knowledge_tree_versions SET topology_version=topology_version+1,state_version=state_version+1 WHERE id=1")
        return {"changeId": identity, "undone": True, **_versions(conn)}
    return run_in_transaction(work)


def list_changes(project):
    def read(conn):
        _project(conn, project)
        return [dict(row) for row in conn.execute("SELECT id,kind,undone,created_at FROM knowledge_changes WHERE project_id=? ORDER BY rowid DESC LIMIT 30", (project,))]
    return run_in_transaction(read)


def details(project, identity):
    from app.services.learning_ranges import catalog
    def read(conn):
        node = accessible(conn, project, identity)
        return {"concept": node, "ranges": catalog(conn, identity),
            "passages": [dict(r) for r in conn.execute("""SELECT p.*,d.source_type,d.source_path,d.project_id
                FROM teaching_passages p JOIN teaching_documents d ON d.id=p.document_id
                WHERE p.concept_id=? AND p.active=1 ORDER BY d.project_id,d.source_path,p.start_line""", (identity,))]}
    return run_in_transaction(read)


def accessible(conn, project, identity):
    _project(conn, project)
    row = conn.execute("SELECT * FROM concept_tree_nodes WHERE concept_id=? AND identity_status<>'archived'", (identity,)).fetchone()
    if row is None or not _visible(row, project): raise ValueError("无法修改不可访问的知识点")
    return dict(row)


def correct(project, identity, payload):
    def work(conn):
        _sync(conn)
        node = accessible(conn, project, identity)
        if payload.get("topology_version") != _versions(conn)["topology_version"]:
            raise TreeVersionConflict("知识树已变化，请刷新后重试")
        before = snapshot(conn)
        action = payload.get("action")
        if action == "move":
            from app.services.knowledge_tree_service import reparent_concept_in_tx
            reparent_concept_in_tx(conn, project, identity, payload.get("parent_id"), "用户调整分类")
        elif action == "rename":
            rename(conn, node, payload.get("name"))
        elif action == "merge":
            merge(conn, project, node, payload.get("target_id"))
        elif action == "split":
            split(conn, project, node, payload)
        elif action == "range_alias":
            merge_range(conn, node, payload)
        else: raise ValueError("未知的知识树修改类型")
        rebuild(conn, {identity, payload.get("target_id")} - {None})
        return record_change(conn, project, action, before, [identity])
    return run_in_transaction(work)


def rename(conn, node, name):
    name = str(name or "").strip()
    if not name or len(name) > 200: raise ValueError("概念名应为 1–200 个字符")
    old = conn.execute("SELECT * FROM concepts WHERE id=?", (node["concept_id"],)).fetchone()
    aliases = sorted(set(json.loads(old["aliases_json"]) + [old["display_name"]]) - {name})
    conn.execute("UPDATE concepts SET canonical_name=?,display_name=?,aliases_json=? WHERE id=?", (name, name, encode(aliases), old["id"]))
    conn.execute("UPDATE concept_tree_nodes SET normalized_name=?,updated_at=? WHERE concept_id=?", (name.casefold(), now(), old["id"]))
    for alias in aliases + [name]:
        row = conn.execute("SELECT concept_id FROM concept_alias_bindings WHERE scope_type=? AND scope_id=? AND domain=? AND alias=?", (node["scope_type"], node["scope_id"], node["domain"], alias.casefold())).fetchone()
        if row and row[0] != old["id"]: raise ValueError("名称或别名属于其他概念，请选择合并或使用更明确的名称")
        conn.execute("INSERT OR IGNORE INTO concept_alias_bindings VALUES(?,?,?,?,?)", (node["scope_type"], node["scope_id"], node["domain"], alias.casefold(), old["id"]))


def merge(conn, project, node, target):
    target_node = accessible(conn, project, target)
    source = node["concept_id"]
    if source == target: raise ValueError("请选择另一个概念")
    if any(node[k] != target_node[k] for k in ("scope_type", "scope_id", "domain")):
        raise ValueError("只能合并同一领域与作用域的概念")
    if target_node['parent_id'] not in {None, source} and conn.execute('SELECT 1 FROM project_knowledge_roots WHERE root_concept_id=?', (source,)).fetchone():
        raise ValueError('计划根只能合并到根节点或其直接子节点')
    if target_node["parent_id"] == source:
        conn.execute("UPDATE concept_tree_nodes SET parent_id=?,placement_status=? WHERE concept_id=?", (node["parent_id"], "placed" if node["parent_id"] else "root", target))
    conn.execute("UPDATE concept_tree_nodes SET parent_id=? WHERE parent_id=?", (target, source))
    for passage in conn.execute("SELECT * FROM teaching_passages WHERE concept_id=?", (source,)).fetchall():
        duplicate = conn.execute("SELECT id FROM teaching_passages WHERE document_id=? AND concept_id=? AND aspect=? AND dimension=? AND quote=?", (passage["document_id"], target, passage["aspect"], passage["dimension"], passage["quote"])).fetchone()
        if duplicate:
            conn.execute("UPDATE OR IGNORE understanding_feedback SET passage_id=? WHERE passage_id=?", (duplicate[0], passage["id"]))
            conn.execute("UPDATE teaching_passages SET active=0 WHERE id=?", (passage["id"],))
        else: conn.execute("UPDATE teaching_passages SET concept_id=? WHERE id=?", (target, passage["id"]))
    for table in ("teaching_terms", "understanding_feedback", "learning_evidence_v2", "document_terms", "concept_explanations", "concept_mastery", "learning_events", "project_concept_links", "learning_range_aliases"):
        conn.execute(f"UPDATE OR IGNORE {table} SET concept_id=? WHERE concept_id=?", (target, source))
    conn.execute("UPDATE OR IGNORE project_knowledge_roots SET root_concept_id=? WHERE root_concept_id=?", (target, source))
    conn.execute("DELETE FROM project_knowledge_roots WHERE root_concept_id=?", (source,))
    conn.execute("UPDATE concept_alias_bindings SET concept_id=? WHERE concept_id=?", (target, source))
    for column in ('source_concept_id', 'target_concept_id'):
        conn.execute(f'UPDATE OR IGNORE teaching_concept_overrides SET {column}=? WHERE {column}=?', (target, source))
        conn.execute(f'UPDATE OR IGNORE concept_relations SET {column}=? WHERE {column}=?', (target, source))
    conn.execute('DELETE FROM concept_relations WHERE source_concept_id=target_concept_id')
    old, new = [conn.execute("SELECT * FROM concepts WHERE id=?", (i,)).fetchone() for i in (source, target)]
    aliases = sorted(set(json.loads(old["aliases_json"]) + json.loads(new["aliases_json"]) + [old["display_name"]]))
    conn.execute("UPDATE concepts SET aliases_json=? WHERE id=?", (encode(aliases), target))
    conn.execute("UPDATE concepts SET concept_type='archived' WHERE id=?", (source,))
    conn.execute("UPDATE concept_tree_nodes SET identity_status='archived',parent_id=NULL,placement_status='pending' WHERE concept_id=?", (source,))
    conn.execute("INSERT INTO concept_redirects VALUES(?,?)", (source, target))
    conn.execute("UPDATE concept_redirects SET target_id=? WHERE target_id=? AND source_id<>?", (target, source, source))
    _validate_parent_graph({r["concept_id"]: dict(r) for r in conn.execute("SELECT * FROM concept_tree_nodes")})


def split(conn, project, node, payload):
    name = str(payload.get("name") or "").strip()
    passages = list(dict.fromkeys(payload.get("passage_ids") or []))
    if not name or len(name) > 200 or not passages: raise ValueError("拆分需要 1–200 字的新概念名，并选择原文范围；不会复制所有熟悉度")
    duplicate = conn.execute("SELECT 1 FROM concept_tree_nodes WHERE normalized_name=? AND domain=? AND scope_type=? AND scope_id=? AND identity_status<>'archived'", (name.casefold(), node['domain'], node['scope_type'], node['scope_id'])).fetchone()
    if duplicate: raise ValueError('名称已有其他概念，请明确区分')
    selected = []
    for identity in passages:
        row = conn.execute("SELECT p.*,d.project_id,d.source_type,d.source_path FROM teaching_passages p JOIN teaching_documents d ON d.id=p.document_id WHERE p.id=? AND p.concept_id=? AND p.active=1", (identity, node["concept_id"])).fetchone()
        if row is None: raise ValueError("所选讲解范围已变化")
        selected.append(dict(row))
    fresh = str(uuid4())
    prefix = f'project:{project}:' if node["scope_type"] == "project" else 'global:'
    conn.execute("INSERT INTO concepts(id,concept_key,canonical_name,display_name,domain,concept_type,aliases_json,difficulty,created_at) VALUES(?,?,?,?,?,'theory','[]',0.5,?)", (fresh, prefix + node["domain"] + ':' + fresh, name, name, node["domain"], now()))
    conn.execute("INSERT INTO concept_tree_nodes(concept_id,parent_id,scope_type,scope_id,domain,normalized_name,identity_status,placement_status,topology_source_json,created_at,updated_at) VALUES(?,?,?,?,?,?, 'resolved',?,?,?,?)", (fresh, node["parent_id"], node["scope_type"], node["scope_id"], node["domain"], name.casefold(), "placed" if node["parent_id"] else "root", encode({"project_id": project, "source": "manual_split"}), now(), now()))
    for item in selected:
        from app.services.learning_ranges import resolve
        resolve(conn, fresh, item['dimension'], item['aspect'])
        terms = conn.execute('SELECT * FROM teaching_terms WHERE document_id=? AND concept_id=? AND start_offset>=? AND end_offset<=?',
            (item['document_id'], node['concept_id'], item['start_offset'] or 0, item['end_offset'] or 0)).fetchall()
        for quote in {item['quote']} | {t['quote'] for t in terms}:
            conn.execute('INSERT OR REPLACE INTO teaching_concept_overrides VALUES(?,?,?,?,?,?,?)',
                (item['project_id'], item['source_type'], item['source_path'], item['content_hash'], quote, node['concept_id'], fresh))
        conn.execute("UPDATE teaching_passages SET concept_id=? WHERE id=?", (fresh, item["id"]))
        conn.execute("UPDATE understanding_feedback SET concept_id=? WHERE passage_id=?", (fresh, item["id"]))
        conn.execute("UPDATE learning_evidence_v2 SET concept_id=? WHERE id IN (SELECT evidence_id FROM understanding_feedback WHERE passage_id=?)", (fresh, item["id"]))
        conn.execute("UPDATE teaching_terms SET concept_id=? WHERE document_id=? AND concept_id=? AND quote=?", (fresh, item["document_id"], node["concept_id"], item["quote"]))
        for term in terms: conn.execute('UPDATE teaching_terms SET concept_id=? WHERE id=?', (fresh, term['id']))
        conn.execute("INSERT OR IGNORE INTO project_concept_links VALUES(?,?,?,?)", (item["project_id"], fresh, item["source_type"], item["source_path"]))
    rebuild(conn, [fresh])


def merge_range(conn, node, payload):
    from app.services.learning_ranges import resolve, key
    dimension, canonical = payload.get("dimension"), str(payload.get("canonical") or "").strip()
    aliases = payload.get("aliases") or []
    if dimension not in {"conceptual", "code_reading", "implementation", "debugging", "transfer"} or not canonical or not aliases:
        raise ValueError("请选择维度、规范范围和同义范围")
    identity = node["concept_id"]
    canonical, rid = resolve(conn, identity, dimension, canonical)
    for alias in aliases:
        if not str(alias).strip(): continue
        old = conn.execute("SELECT aspect_id FROM learning_range_aliases WHERE concept_id=? AND dimension=? AND alias=?", (identity, dimension, key(alias))).fetchone()
        if old: conn.execute("UPDATE learning_range_aliases SET canonical=?,aspect_id=? WHERE concept_id=? AND dimension=? AND aspect_id=?", (canonical, rid, identity, dimension, old[0]))
        conn.execute("INSERT OR REPLACE INTO learning_range_aliases VALUES(?,?,?,?,?)", (identity, dimension, key(alias), canonical, rid))


def resolve_redirects(conn, manifest):
    from app.services.personalization.teaching.prompt_forest import expand_prompt_references
    redirects = dict(conn.execute("SELECT source_id,target_id FROM concept_redirects"))
    def walk(item):
        if isinstance(item, list): return [walk(v) for v in item]
        if isinstance(item, dict): return {k: redirects.get(v, v) if k in {"existing_id", "from_parent_id"} and isinstance(v, str) else walk(v) for k, v in item.items()}
        return item
    return walk(manifest)


def _project_ids(value):
    result = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key.replace('_', '').lower() in {'projectid', 'projectids'}:
                for item in child if isinstance(child, list) else [child]:
                    if str(item).isdigit(): result.add(int(item))
            result.update(_project_ids(child))
    elif isinstance(value, list):
        for child in value: result.update(_project_ids(child))
    return result


def refresh_ownership(conn):
    from app.services.knowledge_maintenance_schema import initialize
    initialize(conn)
    projects = {r[0] for r in conn.execute("SELECT id FROM projects")}
    for row in conn.execute("SELECT * FROM concept_tree_nodes"):
        ids = _project_ids(json.loads(row["topology_source_json"] or '{}'))
        if row["scope_type"] == 'project' and row["scope_id"].isdigit(): ids.add(int(row["scope_id"]))
        for project in ids & projects:
            conn.execute("INSERT OR IGNORE INTO project_concept_links VALUES(?,?,'provenance','')", (project, row["concept_id"]))


def delete_project_knowledge(conn, project):
    """Remove exclusive concepts and this project's facts, retaining shared ancestors."""
    refresh_ownership(conn)
    parents = {r['concept_id']: r['parent_id'] for r in conn.execute('SELECT * FROM concept_tree_nodes')}
    candidates = {r[0] for r in conn.execute('SELECT concept_id FROM project_concept_links WHERE project_id=?', (project,))}
    def ancestors(ids):
        result = set(ids)
        for identity in list(ids):
            visited = set()
            while parents.get(identity) and identity not in visited:
                visited.add(identity); identity = parents[identity]; result.add(identity)
        return result
    candidates = ancestors(candidates)
    protected = ancestors({r[0] for r in conn.execute('SELECT concept_id FROM project_concept_links WHERE project_id<>?', (project,))})
    # Unowned independent records outside the deleted project's branch also
    # keep their parents. No surviving child is left pointing at a deleted node.
    protected |= ancestors(set(parents) - candidates)
    for row in conn.execute('SELECT * FROM concept_redirects'):
        if row['target_id'] in protected: protected.add(row['source_id'])
    private = {r[0] for r in conn.execute("SELECT concept_id FROM concept_tree_nodes WHERE scope_type='project' AND scope_id=?", (str(project),))}
    doomed = (candidates - protected) | private
    qa_ids = {r[0] for r in conn.execute('SELECT id FROM qa_records WHERE project_id=?', (project,))}
    evidence = [dict(r) for r in conn.execute('SELECT * FROM learning_evidence_v2')]
    removed = {r['id'] for r in evidence if r['concept_id'] in doomed or r['qa_record_id'] in qa_ids
        or (r['scope_type'] == 'project' and r['scope_id'] == str(project))
        or project in _project_ids(json.loads(r['object_json'] or '{}'))
        or project in _project_ids(json.loads(r['context_json'] or '{}'))}
    changed = True
    while changed:
        linked = {r['id'] for r in evidence if r['target_evidence_id'] in removed}
        changed = bool(linked - removed); removed |= linked
    affected = {r['concept_id'] for r in evidence if r['id'] in removed}
    from app.services.teaching_index import remove_documents
    remove_documents(conn, project)
    # remove_documents emits void events; include those whose targets disappear.
    for row in conn.execute('SELECT id,target_evidence_id FROM learning_evidence_v2'):
        if row['target_evidence_id'] in removed: removed.add(row['id'])
    for identity in removed: conn.execute('DELETE FROM learning_evidence_v2 WHERE id=?', (identity,))
    for table in ('project_concept_links', 'knowledge_changes', 'teaching_backfills', 'teaching_manifest_overrides', 'teaching_concept_overrides'):
        conn.execute(f'DELETE FROM {table} WHERE project_id=?', (project,))
    for identity in doomed:
        # Enumerate database-owned identifiers, never interpolate user text.
        for table in [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]:
            if not table.replace('_', '').isalnum() or table == 'concepts': continue
            columns = {r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')}
            names = columns & {'concept_id', 'source_concept_id', 'target_concept_id', 'root_concept_id'}
            if table == 'concept_redirects': names |= {'source_id', 'target_id'}
            for field in names: conn.execute(f'DELETE FROM "{table}" WHERE "{field}"=?', (identity,))
        conn.execute("DELETE FROM learner_inferences WHERE subject_type='concept' AND subject_key=?", (identity,))
        conn.execute('DELETE FROM concepts WHERE id=?', (identity,))
    # A journal from another project must not resurrect removed identities.
    if doomed:
        for row in conn.execute('SELECT id,affected_json FROM knowledge_changes').fetchall():
            if doomed & set(json.loads(row['affected_json']).get('concepts', [])):
                conn.execute('DELETE FROM knowledge_changes WHERE id=?', (row['id'],))
    rebuild(conn, affected - doomed)
    conn.execute('UPDATE knowledge_tree_versions SET topology_version=topology_version+1,state_version=state_version+1 WHERE id=1')
    return len(doomed)
