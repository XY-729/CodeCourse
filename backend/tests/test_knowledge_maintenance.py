import json
import unittest
from unittest.mock import patch

from test_qa_records import _setup_temp_db
from test_knowledge_tree_forest import concept, manifest, coverage
from app.services import storage, knowledge_tree_service as tree, knowledge_maintenance as maintenance, teaching_index as index


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp, self.workspace, self.generated = _setup_temp_db()
        self.project = storage.create_learning_plan_project('One', self.workspace/'one').id
        self.other = storage.create_learning_plan_project('Two', self.workspace/'two').id

    def tearDown(self): self.temp.cleanup()

    def apply(self, concepts, project=None):
        return tree.apply_manifest(project or self.project, manifest(concepts), source_type='course', source_path='lesson.md',
            artifact_kind='lesson', content_hash='hash')['ref_to_id']

    def correct(self, identity, action, **fields):
        version = tree.get_tree_snapshot(self.project)['topology_version']
        return maintenance.correct(self.project, identity, {'action': action, 'topology_version': version, **fields})

    def document(self, identity, name='vector', aspect='扩容原理', path='lesson.md'):
        body = f'{name} 在扩容时会分配新的连续内存空间。'
        node = next(n for n in tree.get_tree_snapshot(self.project)['nodes'] if n['id']==identity)
        payload = manifest([concept('v', name, existing_id=identity, domain=node['domain'])], [coverage('v', body, aspect=aspect)],
            [{'concept_ref':'v','text':name,'quote':body}])
        text = body+'\n\n<!-- codecourse-teaching: '+json.dumps(payload,ensure_ascii=False)+' -->'
        target = self.generated/str(self.project)/path
        target.parent.mkdir(parents=True, exist_ok=True); target.write_text(text, encoding='utf-8')
        return index.document_state(self.project,'course',path), target

    def test_move_rename_undo_and_cycle_rollback(self):
        ids=self.apply([concept('r','C++'),concept('v','vector','r'),concept('s','STL','r')])
        change=self.correct(ids['v'],'move',parent_id=ids['s'])
        self.assertEqual(next(n for n in tree.get_tree_snapshot(self.project)['nodes'] if n['id']==ids['v'])['parent_id'],ids['s'])
        maintenance.undo_change(self.project,change['changeId'])
        rename=self.correct(ids['v'],'rename',name='std::vector')
        self.assertEqual(storage.get_concept(ids['v']).display_name,'std::vector')
        maintenance.undo_change(self.project,rename['changeId'])
        self.assertEqual(storage.get_concept(ids['v']).display_name,'vector')
        with self.assertRaises(ValueError): self.correct(ids['r'],'move',parent_id=ids['v'])

    def test_merge_feedback_redirect_and_undo(self):
        ids=self.apply([concept('v','vector'),concept('same','std::vector')])
        state,_=self.document(ids['v'])
        index.save_feedback(self.project,'course','lesson.md','understood',[],state['contentHash'],'understood')
        change=self.correct(ids['v'],'merge',target_id=ids['same'])
        self.assertEqual(index.document_state(self.project,'course','lesson.md')['passages'][0]['concept_id'],ids['same'])
        result=self.apply([concept('v','vector',existing_id=ids['v'])])
        self.assertEqual(result['v'],ids['same'])
        # An idempotent source reuse does not change the undo guard.
        maintenance.undo_change(self.project,change['changeId'])
        self.assertEqual(index.document_state(self.project,'course','lesson.md')['passages'][0]['concept_id'],ids['v'])

    def test_range_alias_reduces_facts_and_undo(self):
        identity=self.apply([concept('v','vector')])['v']
        first,_=self.document(identity)
        index.save_feedback(self.project,'course','lesson.md','understood',[],first['contentHash'],'a')
        second,_=self.document(identity,aspect='扩容机制',path='other.md')
        index.save_feedback(self.project,'course','other.md','needs_help',[],second['contentHash'],'b')
        change=self.correct(identity,'range_alias',dimension='conceptual',canonical='扩容原理',aliases=['扩容机制'])
        state=next(n for n in tree.get_tree_snapshot(self.project)['nodes'] if n['id']==identity)
        self.assertEqual(len(state['ranges']),1)
        self.assertEqual(state['ranges'][0]['familiarity'],'needs_help')
        self.assertEqual(len(state['coverage']),1)
        self.assertEqual(state['coverage'][0]['source_count'],2)
        self.assertEqual(index.document_state(self.project,'course','lesson.md')['passages'][0]['understanding'],'needs_help')
        maintenance.undo_change(self.project,change['changeId'])
        state=next(n for n in tree.get_tree_snapshot(self.project)['nodes'] if n['id']==identity)
        self.assertEqual(len(state['ranges']),2)

    def test_split_moves_selected_quote_feedback_and_survives_reindex(self):
        identity=self.apply([concept('v','vector')])['v']
        original,_=self.document(identity)
        index.save_feedback(self.project,'course','lesson.md','understood',[],original['contentHash'],'u')
        change=self.correct(identity,'split',name='vector 扩容',passage_ids=[original['passages'][0]['id']])
        state=index.document_state(self.project,'course','lesson.md')
        fresh=state['passages'][0]['concept_id']
        self.assertNotEqual(fresh,identity)
        content=index._read_source(self.project,'course','lesson.md')
        index.index_document(self.project,'course','lesson.md',content,force=True)
        self.assertEqual(index.document_state(self.project,'course','lesson.md')['passages'][0]['concept_id'],fresh)
        # Re-indexing changed the correction's affected records, so undo cannot
        # overwrite that later transaction even though the source is unchanged.
        with self.assertRaises(tree.TreeVersionConflict): maintenance.undo_change(self.project,change['changeId'])

    def test_project_delete_removes_exclusive_and_keeps_shared_source(self):
        from app.services.personalization.knowledge_state_service import append_evidence
        ids=self.apply([concept('r','C++'),concept('v','vector','r'),concept('x','Unique','r'),concept('p','Private',scope='project')])
        self.apply([concept('r','C++'),concept('v','vector','r')],self.other)
        state,_=self.document(ids['v'])
        index.save_feedback(self.project,'course','lesson.md','understood',[],state['contentHash'],'u')
        append_evidence({'idempotencyKey':'other-project','conceptId':ids['v'],'scopeType':'global','scopeId':'local-user',
            'dimension':'conceptual','source':'summary','action':'self_understood','direction':'positive','strength':0.65,'reliability':0.72,
            'object':{'projectId':self.other},'result':{'aspect':'扩容原理'}})
        self.assertTrue(storage.delete_project(self.project))
        remaining={n['id'] for n in tree.get_tree_snapshot(self.other)['nodes']}
        self.assertIn(ids['r'],remaining); self.assertIn(ids['v'],remaining)
        self.assertNotIn(ids['x'],remaining); self.assertNotIn(ids['p'],remaining)
        with storage._connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM learning_evidence_v2').fetchone()[0],1)
            self.assertEqual(conn.execute('SELECT idempotency_key FROM learning_evidence_v2').fetchone()[0],'other-project')
            self.assertEqual(conn.execute('SELECT count(*) FROM project_concept_links WHERE project_id=?',(self.project,)).fetchone()[0],0)

    def test_backfill_preview_apply_undo_preserves_original_and_rejects_stale(self):
        from app.services import teaching_backfill as backfill
        body='vector 在扩容时会分配新的连续内存空间。'
        target=self.generated/str(self.project)/'legacy.md'; target.parent.mkdir(parents=True,exist_ok=True); target.write_text(body,encoding='utf-8')
        proposal=manifest([concept('v','vector')],[coverage('v',body,aspect='扩容机制')],[{'concept_ref':'v','text':'vector','quote':body}])
        with patch('app.services.generation_service._llm_settings_or_error',return_value={'base_url':'mock','api_key':'mock','model':'mock'}), \
                patch('app.services.llm_client.call_openai_compatible_chat',return_value='TEACHING: '+json.dumps(proposal)):
            preview=backfill.prepare(self.project,'course','legacy.md')
        self.assertEqual(len(tree.get_tree_snapshot(self.project)['nodes']),0)
        applied=backfill.apply(self.project,preview['id'])
        self.assertEqual(target.read_text(encoding='utf-8'),body)
        self.assertEqual(index.document_state(self.project,'course','legacy.md')['schemaVersion'],2)
        maintenance.undo_change(self.project,applied['changeId'])
        self.assertEqual(target.read_text(encoding='utf-8'),body)
        self.assertEqual(len(tree.get_tree_snapshot(self.project)['nodes']),0)

    def test_backfill_refuses_changed_source_and_stale_undo(self):
        from app.services import teaching_backfill as backfill
        identity=self.apply([concept('v','vector')])['v']
        state,target=self.document(identity)
        preview=backfill.prepare(self.project,'course','lesson.md')
        original=target.read_bytes()
        target.write_bytes(original+b'\nNew source')
        with self.assertRaisesRegex(ValueError,'来源已更新'): backfill.apply(self.project,preview['id'])
        target.write_bytes(original)
        applied=backfill.apply(self.project,preview['id'])
        index.save_feedback(self.project,'course','lesson.md','needs_help',[],state['contentHash'],'new-learning')
        with self.assertRaises(tree.TreeVersionConflict): maintenance.undo_change(self.project,applied['changeId'])
        self.assertEqual(target.read_bytes(),original)
        self.assertEqual(index.document_state(self.project,'course','lesson.md')['status'],'partial')

    def test_backfill_replays_explicit_completion_without_inventing_understanding(self):
        from app.services import teaching_backfill as backfill
        identity=self.apply([concept('v','vector')])['v']
        state,_=self.document(identity)
        with storage._connect() as conn, conn:
            conn.execute("INSERT INTO learning_states(project_id,source_type,source_path,status,completed_at,updated_at,last_opened_at) VALUES(?,'course','lesson.md','completed','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')",(self.project,))
        applied=backfill.apply(self.project,backfill.prepare(self.project,'course','lesson.md')['id'])
        node=next(n for n in tree.get_tree_snapshot(self.project)['nodes'] if n['id']==identity)
        self.assertEqual(node['familiarity'],'studied')
        self.assertFalse(index.document_state(self.project,'course','lesson.md')['documentConfirmed'])
        with storage._connect() as conn:
            self.assertEqual(conn.execute('SELECT event_time FROM learning_evidence_v2').fetchone()[0],'2026-10-01T00:00:00Z')
        maintenance.undo_change(self.project,applied['changeId'])
        self.assertEqual(next(n for n in tree.get_tree_snapshot(self.project)['nodes'] if n['id']==identity)['familiarity'],'unrecorded')

    def test_private_scope_and_range_identity_are_not_crossed(self):
        from app.services.learning_ranges import resolve, normalize_proposal
        from app.services.personalization.teaching.generation_context import build_generation_context
        ids=self.apply([concept('v','vector'),concept('p','private',scope='project')])
        self.assertNotIn(ids['p'],{n['id'] for n in tree.get_tree_snapshot(self.other)['nodes']})
        with self.assertRaises(ValueError): maintenance.correct(self.other,ids['p'],{'action':'rename','name':'other','topology_version':tree.get_tree_snapshot(self.other)['topology_version']})
        with storage._connect() as conn, conn:
            _,range_id=resolve(conn,ids['v'],'conceptual','扩容原理')
            with self.assertRaises(ValueError): resolve(conn,ids['p'],'conceptual','扩容原理',range_id)
        proposed=manifest([concept('v','vector',existing_id=ids['v'])],[{**coverage('v','vector 连续分配内存。',aspect='扩容机制'),'aspect_id':range_id}])
        self.assertEqual(normalize_proposal(proposed,build_generation_context(self.project).snapshot)['coverage'][0]['aspect'],'扩容原理')

    def test_split_can_be_undone_after_reading_tree_without_copying_unrelated_facts(self):
        identity=self.apply([concept('v','vector')])['v']
        state,_=self.document(identity)
        self.document(identity,aspect='迭代器',path='iterator.md')
        index.save_feedback(self.project,'course','lesson.md','understood',[],state['contentHash'],'original-feedback')
        change=self.correct(identity,'split',name='vector 扩容',passage_ids=[state['passages'][0]['id']])
        nodes=tree.get_tree_snapshot(self.project)['nodes']
        fresh=next(n for n in nodes if n['id']!=identity)
        self.assertEqual([r['aspect'] for r in fresh['ranges']],['扩容原理'])
        maintenance.undo_change(self.project,change['changeId'])
        self.assertEqual(index.document_state(self.project,'course','lesson.md')['passages'][0]['concept_id'],identity)
