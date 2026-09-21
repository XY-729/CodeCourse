import json
import unittest
from unittest.mock import patch

from test_personalization_profile import _setup_temp_workspace


class TeachingIndexTests(unittest.TestCase):
    def setUp(self):
        self.workspace = _setup_temp_workspace()
        from fastapi.testclient import TestClient
        from app.main import app
        self.client = TestClient(app)
        self.project = self.client.post('/api/projects/learning-plan', json={'name': 'Teaching'}).json()['id']
        self.other = self.client.post('/api/projects/learning-plan', json={'name': 'Other'}).json()['id']

    def tearDown(self):
        self.workspace.cleanup()

    def document(self, path='lessons/lesson_1.md', project=None, scope='global', count=1):
        from app.services import storage, teaching_index as index
        project = project or self.project
        items = [{'concept': f'知识点{i}', 'aspect': '基本原理', 'kind': 'explained',
                  'core': True, 'quote': f'知识点{i}表示一种独立的抽象机制。', 'scope': scope} for i in range(count)]
        content = '# 本课\n\n' + '\n\n'.join(item['quote'] for item in items)
        content = index.prepare_metadata('TEACHING: ' + json.dumps(items) + '\n' + content, project)
        target = storage.GENERATED_ROOT / str(project) / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')
        return index.document_state(project, 'course', path)

    def feedback(self, state, result, key):
        from app.services.teaching_index import save_feedback
        return save_feedback(self.project, 'course', state['sourcePath'], result,
                             [p['id'] for p in state['passages']], state['contentHash'], key)

    def test_all_coverage_not_limited_to_twelve_terms(self):
        state = self.document(count=20)
        self.assertEqual(state['coreCount'], 20)
        self.assertEqual(state['status'], 'pending')
        self.assertEqual(state['indexStatus'], 'complete')

    def test_understanding_reversible_idempotent_and_not_mastery(self):
        state = self.document()
        understood = self.feedback(state, 'understood', 'once')
        self.assertEqual(understood['status'], 'understood')
        self.assertEqual(len(self.feedback(state, 'understood', 'once')['feedback']), 1)
        from app.services.personalization.knowledge_state_service import get_states
        knowledge = get_states([('global', 'local-user')], [state['passages'][0]['concept_id']])
        self.assertNotEqual(knowledge[0]['dimensions']['conceptual']['status'], 'confirmed')
        self.assertEqual(self.feedback(state, 'clear', 'undo')['status'], 'pending')

    def test_same_aspect_updates_other_course_but_not_other_aspects(self):
        state = self.document()
        second = self.document('lessons/lesson_2.md')
        self.feedback(state, 'understood', 'once')
        from app.services.teaching_index import document_state
        self.assertEqual(document_state(self.project, 'course', second['sourcePath'])['status'], 'understood')

    def test_feedback_dimension_and_void_are_respected(self):
        from app.services import storage, teaching_index as index
        from app.services.personalization.knowledge_state_service import void_evidence
        state = self.document()
        understood = self.feedback(state, 'understood', 'dimension')
        source = storage.GENERATED_ROOT / str(self.project) / state['sourcePath']
        content = source.read_text(encoding='utf-8').replace('"core":true', '"dimension":"implementation","core":true')
        target = source.parent / 'implementation.md'
        target.write_text(content, encoding='utf-8')
        self.assertEqual(index.document_state(self.project, 'course', 'lessons/implementation.md')['status'], 'pending')
        void_evidence(understood['feedback'][0]['evidence_id'], 'external-void')
        self.assertEqual(index.document_state(self.project, 'course', state['sourcePath'])['status'], 'pending')
        self.assertIn('"self_report": "unknown"', index.teaching_context(self.project))

    def test_legacy_document_confirmation_in_course_summary(self):
        from app.services import storage, teaching_index as index
        root = storage.GENERATED_ROOT / str(self.project)
        root.mkdir(parents=True, exist_ok=True)
        (root / 'legacy.md').write_text('# 旧课件\n没有讲解元数据', encoding='utf-8')
        state = index.document_state(self.project, 'course', 'legacy.md')
        saved = self.feedback(state, 'understood', 'legacy-confirm')
        self.assertTrue(saved['documentConfirmed'])
        self.assertEqual(saved['status'], 'pending')
        summaries = self.client.get(f'/api/projects/{self.project}/teaching/courses').json()
        self.assertTrue(next(d for d in summaries if d['sourcePath'] == 'legacy.md')['documentConfirmed'])
        self.assertFalse(self.feedback(state, 'clear', 'legacy-undo')['documentConfirmed'])

    def test_outline_is_only_planned(self):
        state = self.document('outline.md')
        self.assertEqual(state['passages'][0]['kind'], 'planned')
        with self.assertRaises(ValueError):
            self.feedback(state, 'understood', 'bad')

    def test_rename_keeps_reference_and_edit_refuses_wrong_anchor(self):
        state = self.document()
        from app.services import storage, teaching_index as index
        passage = state['passages'][0]['id']
        root = storage.GENERATED_ROOT / str(self.project)
        old, new = state['sourcePath'], 'renamed.md'
        (root / old).rename(root / new)
        storage.rename_course_references(self.project, old, new, '新标题')
        self.assertEqual(index.resolve_reference(self.project, passage)['sourcePath'], new)
        (root / new).write_text('内容已修改', encoding='utf-8')
        with self.assertRaises(ValueError):
            index.resolve_reference(self.project, passage)

    def test_cross_project_private_symbols_are_isolated(self):
        from app.services.teaching_index import resolve_reference, teaching_context
        state = self.document(scope='project')
        with self.assertRaises(ValueError):
            resolve_reference(self.other, state['passages'][0]['id'])
        self.assertNotIn(state['passages'][0]['id'], teaching_context(self.other))

    def test_stale_feedback_and_unknown_passage_rejected(self):
        from app.services.teaching_index import save_feedback
        state = self.document()
        with self.assertRaises(ValueError):
            save_feedback(self.project, 'course', state['sourcePath'], 'understood', [], 'stale', 'bad')
        with self.assertRaises(ValueError):
            save_feedback(self.project, 'course', state['sourcePath'], 'understood', ['unknown'], state['contentHash'], 'bad')

    def test_legacy_content_not_silently_classified_as_understood(self):
        from app.services import storage, teaching_index as index
        path = storage.GENERATED_ROOT / str(self.project) / 'legacy.md'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('# 曾经学过的课程\n一些旧内容', encoding='utf-8')
        state = index.document_state(self.project, 'course', 'legacy.md')
        self.assertEqual(state['indexStatus'], 'pending')
        self.assertEqual(state['status'], 'pending')

    def test_reuse_links_are_validated_and_assembled(self):
        from app.services.teaching_index import prepare_metadata
        state = self.document()
        identity = state['passages'][0]['id']
        result = prepare_metadata('REUSE: ' + json.dumps([identity, 'missing']) + '\n新内容', self.project)
        self.assertIn('https://codecourse.local/teaching/' + identity, result)
        self.assertNotIn('missing', result)

    def test_stream_does_not_leak_coverage_metadata(self):
        from app.services.metadata_stream import StreamingMetadataFilter
        stream = StreamingMetadataFilter()
        text = 'TEACHING: [{"concept":"知识"}]\nREUSE: []\n# 内容\n'
        output = ''.join(part for char in text for part in stream.push(char)) + ''.join(stream.finish())
        self.assertEqual(output, '# 内容\n')

    def test_duplicate_paragraph_is_reused_but_explicit_reteaching_is_allowed(self):
        from app.services.teaching_index import prepare_metadata
        state = self.document()
        entry = {'concept': '知识点0', 'aspect': '基本原理', 'kind': 'explained', 'core': True,
                 'quote': '这是同一知识点的另一段基础解释。'}
        raw = 'TEACHING: ' + json.dumps([entry]) + '\n# 新课\n\n' + entry['quote'] + '\n\n新的应用场景。'
        reused = prepare_metadata(raw, self.project)
        self.assertIn(state['passages'][0]['id'], reused)
        self.assertNotIn(entry['quote'], reused)
        self.assertIn(entry['quote'], prepare_metadata(raw, self.project, '从头重新讲解'))
        self.feedback(state, 'needs_help', 'confused')
        self.assertIn(entry['quote'], prepare_metadata(raw, self.project))

    def test_partial_feedback_preserves_unselected_understanding(self):
        from app.services.teaching_index import save_feedback
        state = self.document(count=2)
        self.feedback(state, 'understood', 'all')
        next_state = save_feedback(self.project, 'course', state['sourcePath'], 'needs_help',
                                  [state['passages'][0]['id']], state['contentHash'], 'one')
        self.assertEqual(next_state['understoodCount'], 1)
        self.assertEqual(next_state['status'], 'partial')

    def test_deletion_removes_coverage_and_its_feedback_evidence(self):
        from app.services import storage, teaching_index as index
        state = self.document()
        self.feedback(state, 'understood', 'understood')
        storage.cleanup_course_artifacts(self.project, state['sourcePath'])
        with storage._connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM understanding_feedback').fetchone()[0], 0)
        with self.assertRaises(ValueError):
            index.resolve_reference(self.project, state['passages'][0]['id'])

    def test_reset_profile_clears_understanding_without_deleting_coverage(self):
        from app.services.teaching_index import document_state
        state = self.document()
        self.feedback(state, 'understood', 'once')
        response = self.client.delete(f'/api/projects/{self.project}/personalization/profile?scope=all')
        self.assertEqual(response.status_code, 200)
        refreshed = document_state(self.project, 'course', state['sourcePath'])
        self.assertEqual(refreshed['status'], 'pending')
        self.assertEqual(refreshed['coreCount'], 1)

    def test_explicit_reindex_preserves_prose_and_rejects_stale_scan(self):
        from app.services import storage, teaching_index as index
        self.document()
        path = storage.GENERATED_ROOT / str(self.project) / 'legacy.md'
        original = '# 原课件\n\n知识点0表示一种独立的抽象机制。'
        path.write_text(original, encoding='utf-8')
        metadata = 'TEACHING: ' + json.dumps([{'concept': '知识点0', 'aspect': '基本原理', 'kind': 'explained', 'core': True, 'quote': original.split('\n\n')[1]}])
        with patch('app.services.generation_service._llm_settings_or_error', return_value={'api_key': 'fake', 'base_url': 'http://test', 'model': 'test'}), patch('app.services.llm_client.call_openai_compatible_chat', return_value=metadata):
            state = index.reindex_document(self.project, 'course', 'legacy.md')
        self.assertEqual(state['indexStatus'], 'complete')
        self.assertEqual(index.COMMENT.sub('', path.read_text(encoding='utf-8')).strip(), original)
        def concurrent_edit(*args, **kwargs):
            path.write_text('用户正在编辑的新内容', encoding='utf-8')
            return metadata
        with patch('app.services.generation_service._llm_settings_or_error', return_value={'api_key': 'fake', 'base_url': 'http://test', 'model': 'test'}), patch('app.services.llm_client.call_openai_compatible_chat', side_effect=concurrent_edit):
            with self.assertRaises(ValueError):
                index.reindex_document(self.project, 'course', 'legacy.md')
        self.assertEqual(path.read_text(encoding='utf-8'), '用户正在编辑的新内容')

    def test_desktop_android_schema_contract(self):
        import ast
        from pathlib import Path
        from app.services import teaching_index
        module = ast.parse(Path(teaching_index.__file__).read_text(encoding='utf-8'))
        initialize = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == 'initialize')
        sql = ';\n'.join(node.value.args[0].value.strip() for node in initialize.body if isinstance(node, ast.Expr)) + ';'
        mobile = Path(__file__).parents[2] / 'frontend/src/platform/android/teachingSchema.ts'
        serialized = mobile.read_text(encoding='utf-8').split('export const TEACHING_SCHEMA = ', 1)[1].strip().removesuffix(';')
        self.assertEqual(json.loads(serialized), sql)
