import json
import unittest
from unittest.mock import patch

from test_personalization_profile import _setup_temp_workspace


class CourseCompletionTests(unittest.TestCase):
    def setUp(self):
        self.workspace = _setup_temp_workspace()
        from fastapi.testclient import TestClient
        from app.main import app
        self.client = TestClient(app)
        self.project = self.client.post('/api/projects/learning-plan', json={'name': 'Completion'}).json()['id']
        self.other = self.client.post('/api/projects/learning-plan', json={'name': 'Other'}).json()['id']
        dispatch = patch('app.services.course_completion.dispatch_completion')
        self.dispatch = dispatch.start()
        self.addCleanup(dispatch.stop)
        self.path = 'lessons/lesson_1.md'
        self.document()

    def tearDown(self):
        self.workspace.cleanup()

    def document(self, project=None, private=False):
        from app.services import storage, teaching_index as index
        project = project or self.project
        items = [dict(concept='借用', aspect='共享与可变借用', kind='explained', core=True,
                      dimension='conceptual', scope='project' if private else 'global', quote='共享借用允许同时读取，而可变借用要求独占访问。'),
                 dict(concept='借用', aspect='借用检查', kind='brief', core=False,
                      dimension='code_reading', quote='借用检查器会检查访问是否满足这些约束条件。'),
                 dict(concept='生命周期', aspect='后续计划', kind='planned', core=True,
                      quote='生命周期将在后续课程结合具体案例继续讲解。')]
        raw = 'TEACHING: ' + json.dumps(items, ensure_ascii=False) + '\n# 借用\n\n' + '\n\n'.join(i['quote'] for i in items)
        content = index.prepare_metadata(raw)  # Keep fixtures independent from reuse policy.
        path = storage.GENERATED_ROOT / str(project) / self.path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')
        return index.document_state(project, 'course', self.path)

    def complete(self, status='completed', project=None):
        response = self.client.put(f'/api/projects/{project or self.project}/learning-state', json={
            'source_type': 'course', 'source_path': self.path, 'status': status,
            'position_kind': 'scroll_ratio', 'position_value': .5})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def run_job(self, identity):
        from app.services import storage, course_completion as completion
        with storage._connect() as conn:
            request = conn.execute('SELECT profile_request FROM learning_states WHERE id=?', (identity,)).fetchone()[0]
        completion._run(identity, request)

    def evidence(self):
        from app.services import storage
        with storage._connect() as conn:
            return [dict(r) for r in conn.execute("SELECT * FROM learning_evidence_v2 WHERE source='course_completion' AND voided=0 AND NOT EXISTS (SELECT 1 FROM learning_evidence_v2 v WHERE v.target_evidence_id=learning_evidence_v2.id AND v.voided=0)")]

    def test_completion_records_ranges_once_without_confirming_mastery(self):
        from app.services import course_completion as completion
        from app.services.personalization.knowledge_state_service import get_states
        saved = self.complete()
        self.assertEqual(saved['profile_status'], 'pending')
        with patch('app.services.teaching_index.reindex_document') as scan:
            self.run_job(saved['id'])
            self.run_job(saved['id'])
            scan.assert_not_called()
        self.assertEqual(len(self.evidence()), 1)
        event = self.evidence()[0]
        self.assertEqual(len(json.loads(event['result_json'])['ranges']), 2)
        state = get_states([('global', 'local-user')], [event['concept_id']])[0]
        self.assertGreater(state['dimensions']['familiarity']['probability'], .35)
        self.assertEqual(state['dimensions']['conceptual']['evidenceCount'], 0)
        self.assertNotEqual(state['dimensions']['familiarity']['status'], 'confirmed')
        self.assertIn('共享与可变借用', completion.learned_course_context(self.project))
        self.assertNotIn('生命周期', completion.learned_course_context(self.project))
        self.complete()  # Scroll/status saves cannot queue a second completion.
        self.assertEqual(len(self.evidence()), 1)

    def test_unmark_reset_and_recomplete_do_not_accumulate_evidence(self):
        from app.services.course_completion import learned_course_context
        saved = self.complete()
        self.run_job(saved['id'])
        first = self.evidence()[0]['id']
        self.complete('in_progress')
        self.assertEqual(self.evidence(), [])
        self.assertNotIn('借用', learned_course_context(self.project))
        saved = self.complete()
        self.run_job(saved['id'])
        self.assertEqual(len(self.evidence()), 1)
        self.assertNotEqual(first, self.evidence()[0]['id'])
        self.client.delete(f'/api/projects/{self.project}/learning-state')
        self.assertEqual(self.evidence(), [])

    def test_cancel_during_model_scan_does_not_apply_late_result(self):
        from app.services import storage, teaching_index as index
        path = storage.GENERATED_ROOT / str(self.project) / self.path
        original = path.read_text(encoding='utf-8')
        path.write_text('# 旧课件\n\n共享借用允许同时读取，而可变借用要求独占访问。', encoding='utf-8')
        saved = self.complete()
        def scan(*args):
            self.complete('in_progress')
            path.write_text(original, encoding='utf-8')
            return index.document_state(self.project, 'course', self.path)
        with patch.object(index, 'reindex_document', side_effect=scan):
            self.run_job(saved['id'])
        self.assertEqual(self.evidence(), [])

    def test_missing_index_keeps_progress_without_any_model_call(self):
        from app.services import storage, teaching_index as index
        path = storage.GENERATED_ROOT / str(self.project) / self.path
        path.write_text('# 没有知识索引的旧课件', encoding='utf-8')
        saved = self.complete()
        with patch.object(index, 'reindex_document') as scan:
            self.run_job(saved['id'])
            scan.assert_not_called()
        state = self.client.get(f'/api/projects/{self.project}/learning-state').json()[0]
        self.assertEqual(state['status'], 'completed')
        self.assertEqual(state['profile_status'], 'failed')
        self.assertIn('知识清单未就绪', state['profile_error'])
        self.assertEqual(self.evidence(), [])
        # The explicit backfill is a separate visible task; after it the retry
        # applies local evidence without any model call in completion itself.
        self.document()
        retry = self.client.post(f'/api/projects/{self.project}/learning-state/{saved["id"]}/profile-retry')
        self.assertEqual(retry.json()['profile_status'], 'pending')
        self.run_job(saved['id'])
        self.assertEqual(len(self.evidence()), 1)

    def test_private_scope_delete_and_rename(self):
        from app.services import storage
        from app.services.course_completion import learned_course_context
        self.document(private=True)
        saved = self.complete()
        self.run_job(saved['id'])
        self.assertNotIn('共享与可变借用', learned_course_context(self.other))
        old = storage.GENERATED_ROOT / str(self.project) / self.path
        old.rename(old.with_name('renamed.md'))
        storage.rename_course_references(self.project, self.path, 'lessons/renamed.md', 'Renamed')
        self.assertIn('lessons/renamed.md', learned_course_context(self.project))
        storage.cleanup_course_artifacts(self.project, 'lessons/renamed.md')
        self.assertEqual(self.evidence(), [])

    def test_generation_and_qa_contexts_receive_learned_ranges(self):
        from app.services.personalization.teaching.generation_context import build_generation_context
        from app.services.qa_background import saved_learner_summary
        saved = self.complete()
        self.run_job(saved['id'])
        context = build_generation_context(self.project).render()
        self.assertEqual(context, saved_learner_summary(self.project))
        self.assertIn('<knowledge_state>', context)
        self.assertIn('<explicit_user_requirements>', context)
        # Completed ranges reach every entry point through the factual tree, not
        # through a separate truncated summary block.
        self.assertIn('共享与可变借用', context)
        self.assertIn('借用检查', context)
        self.assertNotIn('生命周期将在后续课程', context)

    def test_manual_judgement_survives_course_completion(self):
        from app.services.personalization.knowledge_state_service import get_states
        document = self.document()
        concept = document['passages'][0]['concept_id']
        marked = self.client.post(f'/api/projects/{self.project}/personalization/mark-unknown', json={
            'conceptId': concept, 'idempotencyKey': 'manual-unknown'})
        self.assertEqual(marked.status_code, 200)
        saved = self.complete(); self.run_job(saved['id'])
        state = get_states([('global', 'local-user')], [concept])[0]
        self.assertEqual(state['dimensions']['familiarity']['manualStatus'], 'unknown')
        self.assertEqual(state['dimensions']['familiarity']['probability'], .01)

    def test_reset_profile_invalidates_pending_worker(self):
        from app.services import storage, course_completion as completion
        saved = self.complete()
        with storage._connect() as conn:
            request = conn.execute('SELECT profile_request FROM learning_states WHERE id=?', (saved['id'],)).fetchone()[0]
        reset = self.client.delete(f'/api/projects/{self.project}/personalization/profile?scope=all')
        self.assertEqual(reset.status_code, 200)
        completion._run(saved['id'], request)
        self.assertEqual(self.evidence(), [])

    def test_restart_recovers_only_unfinished_completion_jobs(self):
        from app.services.course_completion import recover_completions
        saved = self.complete()
        self.dispatch.reset_mock()
        recover_completions()
        self.dispatch.assert_called_once_with(saved['id'])
        self.run_job(saved['id'])
        self.dispatch.reset_mock()
        recover_completions()
        self.dispatch.assert_not_called()

    def test_long_legacy_lesson_indexes_all_chunks_without_changing_prose(self):
        from app.services import storage, teaching_index as index
        quote = '课程末尾讲解：共享借用允许多个读取者，但不能同时存在写入者。'
        body = '# 长课件\n\n' + ''.join(f'第{i}段背景材料。' for i in range(12000)) + '\n\n' + quote
        target = storage.GENERATED_ROOT / str(self.project) / self.path
        target.write_text(body, encoding='utf-8')
        def model(_base, _key, _model, messages, **kwargs):
            chunk = messages[1]['content']
            return 'TEACHING: ' + json.dumps([{'concept': '借用', 'aspect': '共享借用限制', 'kind': 'explained', 'core': True, 'quote': quote}] if quote in chunk else [])
        settings = {'base_url': 'http://test', 'api_key': 'fake', 'model': 'test'}
        with patch('app.services.generation_service._llm_settings_or_error', return_value=settings), patch('app.services.llm_client.call_openai_compatible_chat', side_effect=model) as calls:
            state = index.reindex_document(self.project, 'course', self.path)
        self.assertGreater(calls.call_count, 4)
        self.assertEqual(state['indexStatus'], 'complete')
        self.assertEqual(state['passages'][0]['aspect'], '共享借用限制')
        self.assertEqual(index.COMMENT.sub('', target.read_text(encoding='utf-8')).strip(), body)


if __name__ == '__main__':
    unittest.main()
