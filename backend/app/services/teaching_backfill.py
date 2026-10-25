"""Preview/apply historical v2 sidecars without changing source or user feedback."""
import json
from uuid import uuid4

from app.services import teaching_index as index
from app.services.knowledge_maintenance import encode, now, snapshot, record_change, _project
from app.services.storage import run_in_transaction


def view(row):
    manifest = json.loads(row['manifest_json'])
    return {"id": row['id'], "sourceType": row['source_type'], "sourcePath": row['source_path'],
        "contentHash": row['content_hash'], "status": row['status'], "changeId": row['change_id'],
        "createdAt": row['created_at'], "concepts": manifest['concepts'], "coverage": manifest['coverage'],
        "termCount": len(manifest['terms'])}


def list_previews(project):
    def read(conn):
        _project(conn, project)
        return [view(row) for row in conn.execute('SELECT * FROM teaching_backfills WHERE project_id=? ORDER BY rowid DESC LIMIT 100', (project,))]
    return run_in_transaction(read)


def prepare(project, source_type, source_path, *, retry_invalid=False):
    from app.services.teaching_metadata_repair import repair_lock
    with repair_lock(project, source_type, source_path):
        return _prepare(project, source_type, source_path, retry_invalid=retry_invalid)


def _prepare(project, source_type, source_path, *, retry_invalid=False):
    from app.services.personalization.teaching.generation_context import build_generation_context
    from app.services.personalization.teaching.manifest import parse_manifest, validate_manifest
    from app.services.knowledge_tree_service import apply_manifest
    from app.services.generation_service import _llm_settings_or_error
    from app.services.teaching_metadata_repair import extract
    if source_type not in {'course', 'qa'}: raise ValueError('无效来源类型')
    content = index._read_source(project, source_type, source_path)
    body = index.visible_body(content)
    if not body.strip(): raise ValueError('来源没有可补录的正文')
    digest = index.fingerprint(content)
    from app.services.storage import _connect
    with _connect() as conn:
        preview = conn.execute("SELECT * FROM teaching_backfills WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=? AND status='preview' ORDER BY rowid DESC LIMIT 1",
            (project, source_type, source_path, digest)).fetchone()
        if preview and not json.loads(preview['manifest_json']).get('metadata_gaps'):
            return view(preview)
        document = conn.execute('SELECT generation_id FROM teaching_documents WHERE project_id=? AND source_type=? AND source_path=?',
            (project, source_type, source_path)).fetchone()
        override = conn.execute('SELECT manifest_json FROM teaching_manifest_overrides WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=?',
            (project, source_type, source_path, digest)).fetchone()
    context = build_generation_context(project, related_text=content, source_type=source_type, source_path=source_path)
    parsed = parse_manifest(content)
    existing = validate_manifest(json.loads(override[0]), body) if override else parsed.manifest
    if existing is not None and not existing.get('metadata_gaps'):
        manifest = existing
    else:
        # The retained baseline must be locally applicable before any extraction
        # can spend tokens on its missing chapters.
        if existing:
            def preflight(conn):
                conn.execute('SAVEPOINT retained_backfill')
                try:
                    apply_manifest(project, existing, source_type=source_type, source_path=source_path,
                        artifact_kind=index._artifact_kind(source_type, source_path, content), content_hash=digest, conn=conn)
                finally:
                    conn.execute('ROLLBACK TO retained_backfill'); conn.execute('RELEASE retained_backfill')
            run_in_transaction(preflight)
        from app.services.storage import get_llm_settings
        settings, allow_requests = get_llm_settings(), True
        try:
            settings = _llm_settings_or_error()
        except RuntimeError:
            # Removing a key or disabling the provider must not prevent an
            # entirely local resume from already accepted response files.
            allow_requests = False
        manifest, context = extract(project, source_type, source_path, content, existing,
            document[0] if document else None, context, settings,
            retry_invalid=retry_invalid, allow_requests=allow_requests)
    # A backfill adds coverage; structural corrections belong to the explicit
    # correction UI. It may create missing ancestors for newly discovered nodes.
    manifest['placement_changes'] = []
    identity = str(uuid4())
    def store(conn):
        _project(conn, project)
        if index.fingerprint(index._read_source(project, source_type, source_path)) != index.fingerprint(content):
            raise ValueError('补录期间来源已更新，请重新预览')
        conn.execute('SAVEPOINT backfill_validate')
        try:
            apply_manifest(project, manifest, source_type=source_type, source_path=source_path,
                artifact_kind=index._artifact_kind(source_type, source_path, content), content_hash=index.fingerprint(content), conn=conn)
        finally:
            conn.execute('ROLLBACK TO backfill_validate'); conn.execute('RELEASE backfill_validate')
        conn.execute("DELETE FROM teaching_backfills WHERE project_id=? AND source_type=? AND source_path=? AND status='preview'", (project, source_type, source_path))
        conn.execute('INSERT INTO teaching_backfills VALUES(?,?,?,?,?,?,?,\'preview\',NULL,?)',
            (identity, project, source_type, source_path, index.fingerprint(content), encode(manifest), encode(context.tree_snapshot), now()))
        return view(conn.execute('SELECT * FROM teaching_backfills WHERE id=?', (identity,)).fetchone())
    return run_in_transaction(store)


def apply(project, identity):
    from app.services.personalization.knowledge_state_service import append_evidence
    from app.services.knowledge_maintenance import rebuild
    def work(conn):
        _project(conn, project)
        row = conn.execute('SELECT * FROM teaching_backfills WHERE id=? AND project_id=?', (identity, project)).fetchone()
        if row is None: raise ValueError('补录预览不存在')
        if row['status'] == 'applied': return view(row)
        if row['status'] != 'preview': raise ValueError('请重新生成补录预览')
        content = index._read_source(project, row['source_type'], row['source_path'])
        if index.fingerprint(content) != row['content_hash']: raise ValueError('来源已更新，请重新预览')
        # Other lessons may have been backfilled since this preview. Apply the
        # proposal through the current identity/scope/parent validators instead
        # of overwriting a frozen tree or learner state.
        before = snapshot(conn)
        conn.execute('INSERT OR REPLACE INTO teaching_manifest_overrides VALUES(?,?,?,?,?)',
            (project, row['source_type'], row['source_path'], row['content_hash'], row['manifest_json']))
        previous = conn.execute('SELECT generation_id FROM teaching_documents WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=?',
            (project, row['source_type'], row['source_path'], row['content_hash'])).fetchone()
        generation_id = previous[0] if previous else None
        document_id = index.index_document(project, row['source_type'], row['source_path'], content,
            conn=conn, force=True, generation_id=generation_id)
        document = conn.execute('SELECT * FROM teaching_documents WHERE id=?', (document_id,)).fetchone()
        if document['index_status'] != 'complete': raise ValueError('清单未通过校验，未应用补录：' + document['metadata_errors_json'])
        passages = [dict(p) for p in conn.execute("SELECT * FROM teaching_passages WHERE document_id=? AND active=1 AND kind IN ('brief','explained')", (document_id,))]
        # Only replay an existing explicit course completion, at its original
        # time. No new understanding declaration is manufactured by a scan.
        completion = conn.execute("SELECT completed_at FROM learning_states WHERE project_id=? AND source_type=? AND source_path=? AND status='completed'", (project, row['source_type'], row['source_path'])).fetchone()
        if completion:
            grouped = {}
            for passage in passages: grouped.setdefault(passage['concept_id'], []).append(passage)
            for concept, values in grouped.items():
                node = conn.execute('SELECT * FROM concept_tree_nodes WHERE concept_id=?', (concept,)).fetchone()
                append_evidence({'idempotencyKey': f'backfill:{identity}:{concept}', 'conceptId': concept,
                    'scopeType': node['scope_type'], 'scopeId': node['scope_id'], 'dimension': 'familiarity',
                    'source': 'course_completion', 'action': 'course_studied', 'direction': 'neutral', 'strength': 0, 'reliability': 1,
                    'eventTime': completion[0] or now(),
                    'object': {'projectId': project, 'sourcePath': row['source_path'], 'sourceType': row['source_type'],
                               'contentHash': row['content_hash'], 'backfillId': identity},
                    'result': {'ranges': [{'aspect': p['aspect'], 'dimension': p['dimension'], 'kind': p['kind']} for p in values]}}, conn=conn)
        affected = {p['concept_id'] for p in passages}
        rebuild(conn, affected)
        change = record_change(conn, project, 'backfill', before, affected)
        conn.execute("UPDATE teaching_backfills SET status='applied',change_id=? WHERE id=?", (change['changeId'], identity))
        if generation_id and generation_id.startswith('task:') and generation_id[5:].isdigit():
            conn.execute("UPDATE generation_tasks SET stage_label='正文与知识关联已就绪' WHERE id=? AND project_id=? AND status='completed'",
                (int(generation_id[5:]), project))
        return view(conn.execute('SELECT * FROM teaching_backfills WHERE id=?', (identity,)).fetchone())
    return run_in_transaction(work)
