import dataclasses
import json
import unittest
from unittest.mock import patch

from test_personalization_profile import _setup_temp_workspace


class ProfileSemanticsTests(unittest.TestCase):
    def setUp(self):
        self.workspace = _setup_temp_workspace()
        from fastapi.testclient import TestClient
        from app.main import app
        self.client = TestClient(app)
        self.project = self.client.post('/api/projects/learning-plan', json={'name': 'Containers'}).json()['id']
        self.other = self.client.post('/api/projects/learning-plan', json={'name': 'Other'}).json()['id']

    def tearDown(self):
        self.workspace.cleanup()

    def qa(self, question, project=None, selected='', answer='上下文中的助手解释'):
        from app.services import storage
        return storage.create_qa_record(project_id=project or self.project, source_type='course',
            source_path='outline.md', selected_text=selected, question=question,
            answer_md=answer, provider='test', model='test')

    def observation(self, quote):
        from test_observer import SchemaValidationTests
        value = SchemaValidationTests()._valid_json_obj()
        value.update(previous_teaching_outcome=None, behavior_evidence=[], possible_misconceptions=[],
            knowledge_evidence=[], concept_relations=[{
                'source_concept_text': 'std::vector<int>', 'target_concept_text': 'STL 容器',
                'relation_type': 'is_a', 'domain': 'C++ 标准库', 'confidence': .9,
                'rationale': '当前讨论容器的选择，不把接触下位概念当作掌握上位概念。',
            }], domain_assessments=[{
                'domain_key': 'C++ 标准库', 'state': 'insufficient', 'confidence': .8,
                'summary': '正在比较容器的使用方式，尚缺少选型和独立实现的证据。',
                'concept_keys': ['std::vector'], 'evidence_quotes': [quote],
            }])
        return value

    def execute(self, record, value):
        from app.services.personalization.interaction_observer import _execute_observer_run
        with patch('app.services.personalization.interaction_observer._get_observer_settings',
                   return_value={'api_key': 'fake', 'base_url': 'http://test', 'model': 'test'}), \
             patch('app.services.personalization.interaction_observer._call_observer_model',
                   return_value=json.dumps(value, ensure_ascii=False)) as model:
            _execute_observer_run(self.project, record.id)
            return model

    def test_retired_observer_never_calls_a_model_or_writes_a_profile(self):
        from app.services import storage
        self.qa('EARLIER_IN_THIS_PROJECT')
        record = self.qa('vector 和 stack 的用途有什么不同？')
        model = self.execute(record, self.observation(record.question))
        model.assert_not_called()
        with storage._connect() as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM observer_runs').fetchone()[0], 0)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM concept_relations').fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM learner_inferences").fetchone()[0], 0)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM learning_evidence_v2').fetchone()[0], 0)

    def test_observer_payload_cannot_create_evidence_or_inferences(self):
        from app.services import storage
        record = self.qa('请继续解释', selected='vector 提供连续内存', answer='vector 提供连续内存')
        value = self.observation('vector 提供连续内存')
        value['knowledge_evidence'] = [{
            'concept_text': 'std::vector', 'dimension': 'conceptual_understanding',
            'direction': 'positive', 'strength': .8, 'confidence': .9,
            'evidence_quote': 'vector 提供连续内存', 'explanation': '不应接受助手或选中文字作为用户证据',
        }]
        self.execute(record, value)
        with storage._connect() as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM learning_evidence_v2').fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM learner_inferences").fetchone()[0], 0)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM interaction_observations').fetchone()[0], 0)

    def test_only_explicit_user_actions_create_evidence(self):
        from app.services import storage
        from app.services.personalization.knowledge_state_service import append_evidence
        concept = storage.upsert_concept(
            concept_id='vector-concept', concept_key='global:general:std::vector',
            canonical_name='std::vector', display_name='std::vector',
            domain='general', concept_type='theory', aliases_json='[]', difficulty=.5,
        )
        record = self.qa('我还不能判断 vector 扩容后迭代器是否有效')
        value = self.observation(record.question)
        value['knowledge_evidence'] = [{
            'concept_text': 'std::vector<int>', 'dimension': 'conceptual_understanding',
            'direction': 'negative', 'strength': .6, 'confidence': .9,
            'evidence_quote': record.question, 'explanation': '迭代器失效的条件仍需澄清',
        }]
        self.execute(record, value)
        with storage._connect() as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM learning_evidence_v2').fetchone()[0], 0)
        appended = append_evidence({
            'id': 'needs-help', 'conceptId': concept.id, 'scopeType': 'global', 'scopeId': 'local-user',
            'dimension': 'familiarity', 'direction': 'negative', 'strength': .6, 'reliability': .72,
            'source': 'summary', 'action': 'self_needs_help',
            'result': {'aspect': '扩容后迭代器失效', 'dimension': 'conceptual'},
            'eventTime': '2026-10-21T00:00:00+00:00',
        })
        self.assertTrue(appended)
        with storage._connect() as conn:
            evidence = conn.execute("SELECT * FROM learning_evidence_v2 WHERE id='needs-help'").fetchone()
            self.assertEqual(evidence['source'], 'summary')
            self.assertIn('扩容后迭代器失效', evidence['result_json'])

    def test_legacy_repair_is_idempotent_preserves_manual_and_retires_observer_jobs(self):
        from app.services import storage
        from app.services.personalization.knowledge_state_service import append_evidence
        from app.services.personalization.profile_repair import REPAIR_KEY, repair_legacy_profile
        concept = storage.upsert_concept(concept_id='old-vector', concept_key='global:general:std::vector<int>',
            canonical_name='std::vector<int>', display_name='std::vector<int>',
            domain='general', concept_type='theory', aliases_json='[]', difficulty=.5)
        for source, action in [('question', 'asked_definition'), ('manual', 'manual_known')]:
            append_evidence({'id': source, 'conceptId': concept.id, 'scopeType': 'global', 'scopeId': 'local-user',
                'dimension': 'familiarity', 'direction': 'negative' if source == 'question' else 'positive',
                'strength': .7, 'source': source, 'action': action})
        record = self.qa('旧问题')
        with storage._connect() as conn:
            conn.execute(
                """INSERT INTO observer_jobs(id,project_id,qa_record_id,reason,payload_json,status,
                   attempt_count,available_at,created_at,updated_at)
                   VALUES('legacy-job',?,?,'followup','{}','pending',0,?,?,?)""",
                (self.project, record.id, '2026-10-01', '2026-10-01', '2026-10-01'),
            )
            conn.execute('DELETE FROM app_settings WHERE key=?', (REPAIR_KEY,))
            repair_legacy_profile(conn)
            question = conn.execute("SELECT * FROM learning_evidence_v2 WHERE id='question'").fetchone()
            self.assertEqual((question['direction'], question['strength']), ('neutral', 0))
            self.assertEqual(json.loads(question['context_json'])['profileRepair']['direction'], 'negative')
            self.assertNotEqual(question['concept_id'], concept.id)
            manual = conn.execute("SELECT * FROM learning_evidence_v2 WHERE id='manual'").fetchone()
            self.assertEqual((manual['direction'], manual['concept_id']), ('positive', concept.id))
            # Legacy queues stay retired across restarts and repeated repairs.
            self.assertNotIn(conn.execute("SELECT status FROM observer_jobs WHERE id='legacy-job'").fetchone()[0],
                             ('pending', 'queued', 'running', 'retry'))
            repair_legacy_profile(conn)
            self.assertNotIn(conn.execute("SELECT status FROM observer_jobs WHERE id='legacy-job'").fetchone()[0],
                             ('pending', 'queued', 'running', 'retry'))

    def test_row_models_are_dataclasses_and_foreign_keys_rejected(self):
        from app.services import storage
        from app.services.personalization.learner_inference_service import _concept_row
        for name in ['ObservationRun', 'InteractionObservationRow', 'ConceptCapabilityRow',
                     'LearnerHypothesisRow', 'MisconceptionHypothesisRow']:
            self.assertTrue(dataclasses.is_dataclass(getattr(storage, name)), name)
        from app.services.personalization_service import resolve_concept
        private = resolve_concept(self.other, 'privateStack', 'symbol')
        with storage._connect() as conn:
            self.assertIsNone(_concept_row(conn, f'project:{self.other}:symbol:stack', 'stack', self.project))
            self.assertIsNone(_concept_row(conn, 'global:missing:key', 'global:missing:key', self.project))
            self.assertIsNone(_concept_row(conn, private.id, private.id, self.project))

    def test_lexical_identity_and_question_is_not_knowledge(self):
        from app.services.personalization.concept_identity import canonical_concept_name, mentions_concept
        for raw, expected in [('std::vector<std::unique_ptr<T>>', 'std::vector'),
                ('std::map<int, std::string>::iterator', 'std::map::iterator'), ('stack', 'stack'),
                ('最小生成树', '最小生成树'), ('std::vector<int>::iterator it', ''),
                ('下一步学习建议', ''), ('它要求新根必须是一个挂载点（mount point）', ''), ('std::vector<int', '')]:
            self.assertEqual(canonical_concept_name(raw), expected, raw)
        self.assertFalse(mentions_concept('kChildStackSize character', 'stack'))
        self.assertFalse(mentions_concept('character', 'char'))
        self.assertTrue(mentions_concept('这个vector的用法', 'vector'))
        from app.services.personalization.knowledge_state_resolver import resolve_knowledge_state
        stamp = '2026-09-05T00:00:00+00:00'
        base = resolve_knowledge_state('v', 'global', 'local-user', [], stamp)
        evidence = {'id': 'q', 'dimension': 'familiarity', 'source': 'question', 'action': 'asked_definition',
            'direction': 'neutral', 'strength': 0, 'reliability': .8, 'eventTime': stamp}
        observed = resolve_knowledge_state('v', 'global', 'local-user', [evidence], stamp)
        self.assertEqual(observed['dimensions'], base['dimensions'])

    def test_planner_timeout_is_one_request_without_hidden_retry(self):
        import httpx
        from app.services.personalization.teaching.teacher_planner import _call_planner_model_result
        with patch('app.services.llm_client._SYNC_CLIENT.post', side_effect=httpx.ReadTimeout('timeout')) as request, \
             patch('app.services.llm_client._retry_backoff') as backoff:
            with self.assertRaises(RuntimeError):
                _call_planner_model_result([], {'base_url': 'http://test', 'api_key': 'fake', 'model': 'test', 'timeout': 8})
            self.assertEqual(request.call_count, 1)
            self.assertEqual(request.call_args.kwargs['json']['max_tokens'], 4096)
            backoff.assert_not_called()

    def test_disabled_observer_does_not_replay_and_trial_context_is_not_lost(self):
        from app.services.personalization.interaction_observer import recover_pending_observer_jobs, _build_observer_messages
        with patch('app.services.personalization.interaction_observer._is_observer_enabled', return_value=False), \
             patch('app.services.personalization.interaction_observer._get_executor') as executor:
            self.assertEqual(recover_pending_observer_jobs(), 0)
            executor.assert_not_called()
        messages = _build_observer_messages('问题', '', None, None, None, None, '[]', '', '', '{}',
            previous_trial_json_for_msg='{"teaching_goal":"previous-real-goal"}')
        self.assertIn('previous-real-goal', messages[1]['content'])

    def test_failed_planner_trial_records_truthful_fallback(self):
        from app.services import storage
        record = self.qa('解释所有权')
        trial_id = storage.persist_applied_teaching_trial(project_id=self.project, session_id=None,
            qa_record_id=record.id, planner_run_id=None, teaching_plan_id=None,
            effective_context_json='{}', mode='fallback', fallback_reason='timeout', snapshot_id='snapshot')
        with storage._connect() as conn:
            trial = conn.execute('SELECT * FROM teaching_trials WHERE id=?', (trial_id,)).fetchone()
            self.assertEqual((trial['mode'], trial['fallback_reason'], trial['snapshot_id']), ('fallback', 'timeout', 'snapshot'))
