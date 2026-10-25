"""Paid bodies survive metadata failure; pending is never complete evidence."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from app.services import generation_service as generation
from app.services.personalization.teaching.generation_context import GenerationContext
from app.services.personalization.teaching.lesson_responsibility import freeze_responsibility_map
from app.services.personalization.teaching.manifest import canonical_comment, merge_manifests, parse_manifest
from test_lesson_prompt_autonomy import lesson_plan, response, WRITERS


class MetadataRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.context = GenerationContext(
            topology_json='{"topology_version":3,"topology_status":"ready","nodes":[]}',
            state_json='{"state_version":4,"nodes":[]}', requirements_json='[]')

    def test_all_cached_chapters_recover_without_any_provider_call_in_both_pipelines(self):
        for writer in WRITERS:
            with self.subTest(writer=writer), tempfile.TemporaryDirectory() as temporary:
                plan = lesson_plan(6)
                frozen = freeze_responsibility_map(plan, self.context.tree_snapshot)
                settings = {"base_url": "fixture", "model": "fixture", "api_key": "fixture"}
                bodies = [f"## 章节 {i}\n\n这是已经付费生成的第 {i} 章。" for i in range(1, 7)]
                raw = [response(body, section['items'][0]) for body, section in zip(bodies, plan['sections'])]
                raw[2], raw[5] = bodies[2], bodies[5]  # omitted manifests
                bad = parse_manifest(raw[0])
                bad.manifest['coverage'][0]['dimension'] = 'transfer'  # wrong frozen dimension
                raw[0] = bad.body + '\n' + canonical_comment(bad.manifest)
                records = {}

                def cache(project, task, key, settings, messages, version, validate_cached=None):
                    index = int(key.split('-')[1]) - 1
                    # Exercise the actual cache reader with unaudited records.
                    p = generation._lesson_response_path(project, task, key)
                    if not p.exists():
                        generation._atomic_write(p, json.dumps({
                            'response': raw[index], 'validated': False, 'version': version,
                            'request_hash': generation._lesson_request_hash(settings, messages)}))
                    result = original_cache(project, task, key, settings, messages, version, validate_cached)
                    records[key] = json.loads(p.read_text(encoding='utf-8'))
                    return result

                original_cache = generation._cached_lesson_response
                with patch.object(generation, 'GENERATED_ROOT', Path(temporary)), \
                     patch.object(generation, 'build_generation_context', return_value=self.context), \
                     patch.object(generation, '_prepare_lesson_plan', return_value=(plan, frozen, self.context)), \
                     patch.object(generation, 'update_generation_task'), \
                     patch.object(generation, 'load_prompt', return_value=''), \
                     patch.object(generation, '_debug_dump'), \
                     patch.object(generation, '_cached_lesson_response', side_effect=cache), \
                     patch.object(generation, 'call_openai_compatible_chat', side_effect=AssertionError('Paid API forbidden')) as model:
                    _, content = getattr(generation, writer)(1, 98, 1, '课件', '材料', '', settings, preview=Mock())
                    # Retrying the very same task must also be entirely local.
                    _, again = getattr(generation, writer)(1, 98, 1, '课件', '材料', '', settings, preview=Mock())
                model.assert_not_called()
                self.assertEqual(content, again)
                parsed = parse_manifest(content)
                self.assertEqual(parsed.status, 'valid', parsed.errors)
                self.assertEqual(len(parsed.manifest['metadata_gaps']), 3)
                self.assertEqual(len(parsed.manifest['coverage']), 3)
                for body in bodies:
                    self.assertIn(body, parsed.body)

    def test_empty_or_non_markdown_response_still_cannot_replace_a_lesson(self):
        for raw in ('', '模型没有完成正文'):
            with self.subTest(raw=raw), self.assertRaises(RuntimeError):
                generation._defer_lesson_metadata(raw, 's', ValueError('metadata omitted'))

    def test_malformed_manifest_is_removed_from_visible_body_without_fake_coverage(self):
        parsed = generation._defer_lesson_metadata(
            '## 实际正文\n\n保留讲解。\nTEACHING: {broken}', 's', ValueError('broken JSON'))
        self.assertEqual(parsed.body, '## 实际正文\n\n保留讲解。')
        self.assertEqual(parsed.manifest['coverage'], [])
        merged = merge_manifests([('s', parsed.manifest)], parsed.body)
        self.assertEqual(merged['metadata_gaps'][0]['section_id'], 's')

    def test_pending_marker_survives_index_merge_and_invalid_marker_cannot_crash_indexing(self):
        from app.services import teaching_index
        valid = {'schema_version': 2, 'concepts': [], 'coverage': [], 'terms': [],
                 'metadata_gaps': [{'section_id': 's', 'reason': 'missing metadata'}]}
        merged = teaching_index.merge_manifests([valid, valid])
        self.assertEqual(len(merged['metadata_gaps']), 2)
        for gaps in ('broken', [{}], [None]):
            raw = '<!-- codecourse-teaching: ' + json.dumps({**valid, 'metadata_gaps': gaps}) + ' -->'
            _, _, errors = teaching_index._parse_manifest(raw)
            self.assertTrue(errors)


class PendingPublicationTests(unittest.TestCase):
    def test_publish_pending_index_preserves_valid_chapters_but_cannot_confirm_learning(self):
        from test_personalization_profile import _setup_temp_workspace
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services import storage, teaching_index
        from app.services.personalization.teaching.publication import publish_course_document
        workspace = _setup_temp_workspace()
        try:
            client = TestClient(app)
            project = client.post('/api/projects/learning-plan', json={'name': 'Recovery'}).json()['id']
            item = lesson_plan(1)['sections'][0]['items'][0]
            parsed = parse_manifest(response('## 已完成章节\n\n这是有效讲解。', item))
            parsed.manifest['metadata_gaps'] = [{'section_id': 's2', 'reason': '模型未返回清单'}]
            content = parsed.body + '\n\n' + canonical_comment(parsed.manifest)
            with patch.object(generation, 'call_openai_compatible_chat', side_effect=AssertionError('Paid API forbidden')):
                publish_course_document(project, 'lessons/recovered.md', content)
                for _ in range(2):
                    state = teaching_index.document_state(project, 'course', 'lessons/recovered.md')
                    self.assertEqual(state['contentStatus'], 'published')
                    self.assertEqual(state['indexStatus'], 'pending')
                    self.assertEqual(state['metadataStatus'], 'pending')
                    self.assertEqual(len(state['passages']), 1)
                with self.assertRaises(ValueError):
                    teaching_index.save_feedback(project, 'course', state['sourcePath'], 'understood',
                        [p['id'] for p in state['passages']], state['contentHash'], 'cannot-confirm-pending')
            saved = storage.GENERATED_ROOT / str(project) / 'lessons/recovered.md'
            self.assertEqual(saved.read_text(encoding='utf-8'), content)
        finally:
            workspace.cleanup()


if __name__ == '__main__':
    unittest.main()
