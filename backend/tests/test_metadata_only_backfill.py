"""Metadata-only repair must spend at most once on each accepted source span."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import time
import unittest
from unittest.mock import patch

from app.services import storage, teaching_backfill as backfill, teaching_index as index
from app.services.personalization.teaching.generation_context import build_generation_context
from app.services.personalization.teaching.manifest import canonical_comment, merge_manifests, parse_manifest
from app.services.personalization.teaching.publication import publish_course_document
from test_lesson_prompt_autonomy import lesson_plan, response
from test_qa_records import _setup_temp_db


SETTINGS = {'base_url': 'fixture', 'api_key': 'fixture', 'model': 'fixture'}


def metadata_for(messages):
    request = json.loads(next(m['content'] for m in messages if m['role'] == 'user'))
    slots, body = request['slots'], request['document']
    return json.dumps({'repair_version': 1,
        'concepts': [{'ref': slot['slot'], 'domain': 'programming', 'scope': 'global', 'parent_ref': None}
                     for slot in slots if slot['needs_definition']],
        'coverage': [{'slot': slot['slot'], 'kind': 'explained', 'core': True,
                      'quote': body.split('\n\n')[-1]} for slot in slots],
        'terms': [{'concept_ref': slots[0]['slot'], 'text': slots[0]['name'], 'quote': body.split('\n\n')[-1]}]})


class MetadataOnlyBackfillTests(unittest.TestCase):
    def setUp(self):
        self.temp, self.workspace, self.generated = _setup_temp_db()
        self.project = storage.create_learning_plan_project('Repair', self.workspace / 'repo').id
        self.plan = lesson_plan(3)
        context = build_generation_context(self.project)
        root = self.generated / str(self.project)
        self.bodies = [f"## {s['title']}\n\n{s['items'][0]['name']} 的真实讲解和具体因果机制。" for s in self.plan['sections']]
        fragments = []
        for number, (section, body) in enumerate(zip(self.plan['sections'], self.bodies), 1):
            raw = response(body, section['items'][0]) if number == 2 else body
            p = root / '.lesson-results' / 'task-99' / f'section-{number}.json'
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps({'response': raw}), encoding='utf-8')
            if number == 2:
                fragments.append((section['section_id'], parse_manifest(raw).manifest))
        p = root / '.lesson-plans' / 'task-99.json'
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({'plan': self.plan, 'context': {name: getattr(context, name) for name in (
            'topology_json', 'state_json', 'requirements_json', 'learning_preferences_json')}}), encoding='utf-8')
        body = '# 课件\n\n' + '\n\n'.join(self.bodies)
        manifest = merge_manifests(fragments, body)
        manifest['metadata_gaps'] = [{'section_id': 'section_1', 'reason': 'no metadata'},
                                     {'section_id': 'section_3', 'reason': 'bad identity'}]
        self.content = body + '\n\n' + canonical_comment(manifest)
        self.path = 'lessons/repaired.md'
        publish_course_document(self.project, self.path, self.content, generation_id='task:99')
        self.target = root / self.path
        self.settings = patch('app.services.generation_service._llm_settings_or_error', return_value=SETTINGS)
        self.settings.start()
        self.addCleanup(self.settings.stop)

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def model(_base, _key, _model, messages, **kwargs):
        assert kwargs['response_format'] == {'type': 'json_object'}
        assert kwargs['max_attempts'] == 1
        assert kwargs['max_tokens'] == 16384
        assert kwargs['reasoning_effort'] == 'disabled'
        assert '先直接流式输出完整 Markdown 正文' not in messages[0]['content']
        return metadata_for(messages)

    def test_only_gaps_are_requested_then_preview_apply_and_repeat_are_local(self):
        before_tree = build_generation_context(self.project).snapshot
        with patch('app.services.llm_client.call_openai_compatible_chat', side_effect=self.model) as model:
            preview = backfill.prepare(self.project, 'course', self.path)
            self.assertEqual(model.call_count, 2)
            for call in model.call_args_list:
                body = json.loads(call.args[3][1]['content'])['document']
                self.assertNotIn(self.bodies[1], body)
                self.assertIn(body, self.content)
                self.assertNotIn('lr_', call.args[3][1]['content'])
            self.assertEqual(backfill.prepare(self.project, 'course', self.path)['id'], preview['id'])
            self.assertEqual(model.call_count, 2)
        self.assertEqual(self.target.read_text(encoding='utf-8'), self.content)
        self.assertEqual(build_generation_context(self.project).snapshot, before_tree)
        self.assertEqual(len(preview['coverage']), 3)
        backfill.apply(self.project, preview['id'])
        state = index.document_state(self.project, 'course', self.path)
        self.assertEqual(state['indexStatus'], 'complete')
        self.assertEqual(len(state['passages']), 3)
        self.assertFalse(state['documentConfirmed'])
        self.assertEqual(self.target.read_text(encoding='utf-8'), self.content)
        with patch('app.services.generation_service._llm_settings_or_error', side_effect=AssertionError('must stay local')):
            backfill.prepare(self.project, 'course', self.path)

    def test_invalid_second_part_never_resends_first_or_automatically_retries_bad_output(self):
        attempts = []
        def model(*args, **kwargs):
            attempts.append(json.loads(args[3][1]['content'])['document'])
            return '{broken' if len(attempts) == 2 else self.model(*args, **kwargs)
        with patch('app.services.llm_client.call_openai_compatible_chat', side_effect=model) as calls:
            with self.assertRaisesRegex(ValueError, '第 2 段'):
                backfill.prepare(self.project, 'course', self.path)
            with self.assertRaisesRegex(ValueError, '未再次调用模型'):
                backfill.prepare(self.project, 'course', self.path)
            self.assertEqual(calls.call_count, 2)
            preview = backfill.prepare(self.project, 'course', self.path, retry_invalid=True)
            self.assertEqual(calls.call_count, 3)
        self.assertEqual(attempts, [self.bodies[0], self.bodies[2], self.bodies[2]])
        self.assertEqual(len(preview['coverage']), 3)

    def test_interrupted_request_requires_explicit_retry_and_preserves_the_accepted_part(self):
        attempts = []
        def model(*args, **kwargs):
            attempts.append(args)
            if len(attempts) == 2:
                raise RuntimeError('network interrupted')
            return self.model(*args, **kwargs)
        with patch('app.services.llm_client.call_openai_compatible_chat', side_effect=model) as calls:
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                backfill.prepare(self.project, 'course', self.path)
            with self.assertRaisesRegex(ValueError, '上次请求未完成'):
                backfill.prepare(self.project, 'course', self.path)
            self.assertEqual(calls.call_count, 2)
            backfill.prepare(self.project, 'course', self.path, retry_invalid=True)
            self.assertEqual(calls.call_count, 3)

    def test_source_change_stops_before_paying_for_the_next_part(self):
        def model(*args, **kwargs):
            self.target.write_text(self.content + '\n用户新编辑', encoding='utf-8')
            return self.model(*args, **kwargs)
        with patch('app.services.llm_client.call_openai_compatible_chat', side_effect=model) as calls:
            with self.assertRaisesRegex(ValueError, '来源已更新'):
                backfill.prepare(self.project, 'course', self.path)
        self.assertEqual(calls.call_count, 1)

    def test_every_request_budget_is_checked_before_the_first_request(self):
        with patch('app.services.llm_client.check_request_budget', side_effect=[{}, ValueError('预算超限')]), \
             patch('app.services.llm_client.call_openai_compatible_chat', side_effect=AssertionError('no API')) as calls:
            with self.assertRaisesRegex(ValueError, '预算超限'):
                backfill.prepare(self.project, 'course', self.path)
            calls.assert_not_called()

    def test_cached_segments_can_finish_without_a_provider_key_or_budget_reservation(self):
        with patch('app.services.llm_client.call_openai_compatible_chat', side_effect=self.model):
            backfill.prepare(self.project, 'course', self.path)
        with storage._connect() as conn, conn:
            conn.execute('DELETE FROM teaching_backfills WHERE project_id=?', (self.project,))
        with patch('app.services.generation_service._llm_settings_or_error', side_effect=RuntimeError('disabled')), \
             patch.object(storage, 'get_llm_settings', return_value={**SETTINGS, 'api_key': '', 'enabled': 'false'}), \
             patch('app.services.llm_client.call_openai_compatible_chat', side_effect=AssertionError('no API')) as calls, \
             patch('app.services.llm_client.check_request_budget', side_effect=AssertionError('no request budget needed')):
            preview = backfill.prepare(self.project, 'course', self.path)
            self.assertEqual(len(preview['coverage']), 3)
            calls.assert_not_called()

    def test_concurrent_clicks_share_one_preview_and_one_request_per_gap(self):
        def model(*args, **kwargs):
            time.sleep(.03)
            return self.model(*args, **kwargs)
        with patch('app.services.llm_client.call_openai_compatible_chat', side_effect=model) as calls:
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: backfill.prepare(self.project, 'course', self.path), range(2)))
            self.assertEqual(calls.call_count, 2)
            self.assertEqual(results[0]['id'], results[1]['id'])

    def test_missing_or_unlocatable_coverage_never_clears_a_gap(self):
        for broken_quote in (False, True):
            with self.subTest(quote=broken_quote):
                def model(*args, **kwargs):
                    value = json.loads(self.model(*args, **kwargs))
                    if broken_quote:
                        value['coverage'][0]['quote'] = '原文中根本没有的句子'
                    else:
                        value['coverage'] = []
                    return json.dumps(value)
                with patch('app.services.llm_client.call_openai_compatible_chat', side_effect=model):
                    with self.assertRaises(ValueError):
                        backfill.prepare(self.project, 'course', self.path, retry_invalid=True)
                self.assertEqual(index.document_state(self.project, 'course', self.path)['indexStatus'], 'pending')

    def test_bad_original_anchor_stops_before_a_model_call(self):
        self.target.write_text(self.content.replace('知识项 1 的真实讲解', '用户修改过的讲解'), encoding='utf-8')
        with patch('app.services.llm_client.call_openai_compatible_chat', side_effect=AssertionError('no API')) as calls:
            with self.assertRaisesRegex(ValueError, '无法在当前文档唯一定位'):
                backfill.prepare(self.project, 'course', self.path)
            calls.assert_not_called()

    def test_empty_optional_editor_has_no_invented_coverage_and_missing_content_still_fails_audit(self):
        from app.services.generation_service import _defer_lesson_metadata
        from app.services.personalization.teaching.lesson_responsibility import audit_synthesis_manifest, freeze_responsibility_map
        parsed = _defer_lesson_metadata('', 'synthesis', ValueError('no manifest'))
        self.assertEqual(parsed.manifest['coverage'], [])
        self.assertFalse(parsed.manifest.get('metadata_gaps'))
        frozen = freeze_responsibility_map(self.plan, build_generation_context(self.project).tree_snapshot)
        with self.assertRaisesRegex(ValueError, '仍有冻结职责'):
            audit_synthesis_manifest(frozen, parsed.manifest, self.plan['sections'][0]['items'])

    def test_known_slot_identity_and_dimension_are_owned_by_server(self):
        from app.services import knowledge_tree_service as tree
        from app.services.personalization.teaching.lesson_responsibility import freeze_responsibility_map
        from app.services.teaching_metadata_repair import _decode
        identity = tree.apply_manifest(self.project, {'schema_version': 2, 'concepts': [
            {'ref': 'known', 'name': '标准身份', 'domain': 'cpp', 'scope': 'global', 'parent_ref': None}], 'coverage': [], 'terms': []},
            source_type='course', source_path='other.md', artifact_kind='lesson', content_hash='other')['ref_to_id']['known']
        context = build_generation_context(self.project)
        plan = lesson_plan(1)
        plan['sections'][0]['items'][0]['existing_id'] = identity
        frozen = freeze_responsibility_map(plan, context.tree_snapshot)
        unit = {'section': plan['sections'][0], 'frozen': frozen.plan_json, 'body': '标准身份实际解释了内存与生命周期。'}
        raw = {'repair_version': 1, 'concepts': [{'ref': 'r1', 'existing_id': 'wrong-id', 'name': 'wrong-name',
            'domain': 'wrong-domain', 'scope': 'project'}], 'coverage': [{'slot': 'r1', 'kind': 'explained', 'core': True,
            'dimension': 'transfer', 'responsibility_id': 'wrong', 'aspect': 'wrong', 'quote': unit['body']}], 'terms': []}
        result = _decode(json.dumps(raw), unit, context)
        known = next(c for c in result['concepts'] if c['ref'] == 'r1')
        self.assertEqual((known['existing_id'], known['name'], known['domain'], known['scope']),
                         (identity, '标准身份', 'cpp', 'global'))
        self.assertEqual(result['coverage'][0]['dimension'], 'conceptual')
        self.assertEqual(result['coverage'][0]['aspect'], plan['sections'][0]['items'][0]['aspect'])

    def test_historical_chunks_do_not_overlap_and_accept_pretty_json_without_regenerating_prose(self):
        path = 'legacy-long.md'
        target = self.generated / str(self.project) / path
        body = '\n\n'.join(f'第 {i} 段解释对象生命周期与作用域的关系。' + '这是已有的详细教学内容。' * 800 for i in range(3))
        target.write_text(body, encoding='utf-8', newline='\n')
        chunks = []
        def model(_base, _key, _model, messages, **_kwargs):
            chunk = json.loads(messages[1]['content'])['document']
            chunks.append(chunk)
            quote = chunk[:chunk.index('。') + 1]
            item = lesson_plan(1)['sections'][0]['items'][0]
            item['name'] = f'作用域示例 {len(chunks)}'
            return json.dumps(parse_manifest(response(quote, item)).manifest, ensure_ascii=False, indent=2)
        with patch('app.services.llm_client.call_openai_compatible_chat', side_effect=model):
            preview = backfill.prepare(self.project, 'course', path)
        self.assertGreater(len(chunks), 1)
        self.assertEqual(''.join(chunks), body)
        self.assertTrue(all(len(chunk) <= 18000 for chunk in chunks))
        self.assertEqual(len(preview['coverage']), len(chunks))
        self.assertEqual(target.read_text(encoding='utf-8'), body)


if __name__ == '__main__':
    unittest.main()
