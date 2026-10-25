import json
import unittest
from unittest.mock import patch

import test_outline_forest_context as fixtures
from test_knowledge_tree_forest import concept, coverage, manifest


class QAForestContextTests(unittest.TestCase):
    setUp = fixtures.OutlineForestContextTests.setUp
    tearDown = fixtures.OutlineForestContextTests.tearDown
    write = fixtures.OutlineForestContextTests.write
    outline = fixtures.OutlineForestContextTests.outline

    def prepare(self, **kwargs):
        from app.models.schemas import QAAskRequest
        from app.services import qa_service as qa
        self.storage.set_setting('llm.enabled', 'true')
        self.storage.set_setting('llm.api_key', 'fixture')
        values = {'source_type': 'file', 'source_path': 'main.cpp', 'question': '解释这个机制', 'selected_text': '示例'}
        values.update(kwargs)
        return qa.prepare_question(self.project, QAAskRequest(**values))

    def test_question_uploads_the_same_forest_and_prior_coverage_as_lesson(self):
        from app.services.personalization.teaching.generation_context import build_generation_context
        expected = build_generation_context(self.project, '解释这个机制', outline_path='outline.md')
        prepared = self.prepare()
        text = '\n'.join(row['content'] for row in prepared.messages)
        self.assertIn(expected.render(), text)
        self.assertIn('对象生命周期', text)  # Not mentioned by the current question.
        self.assertIn('<previously_explained>', text)
        self.assertIn('并发', text)  # Prior cross-branch explanation selected by the outline.
        self.assertNotIn('数学', text)
        self.assertEqual(prepared.scope_constraint, json.loads(expected.generation_scope_json))

    def test_no_outline_continues_qa_without_uploading_any_tree(self):
        from app.services import qa_service as qa
        (self.storage.GENERATED_ROOT / str(self.project) / 'outline.md').unlink()
        with patch('app.services.personalization.teaching.generation_context.get_full_tree_snapshot',
                   side_effect=AssertionError('must not retrieve the full tree')):
            prepared = self.prepare()
        text = '\n'.join(row['content'] for row in prepared.messages)
        for marker in ('<knowledge_topology>', '<knowledge_state>', '<previously_explained>', '对象生命周期', '数学'):
            self.assertNotIn(marker, text)
        self.assertIsNone(prepared.scope_constraint)
        with patch.object(qa, 'call_openai_compatible_chat', return_value='正常回答。') as model, \
                patch('app.services.qa_background.dispatch_answer'):
            record = qa.ask_question(self.project, prepared.payload)
        self.assertEqual(model.call_count, 1)
        self.assertIn('正常回答', record.answer_md)

    def test_unusable_outline_also_continues_without_tree(self):
        (self.storage.GENERATED_ROOT / str(self.project) / 'outline.md').write_text('# 旧总纲', encoding='utf-8')
        prepared = self.prepare()
        self.assertIsNone(prepared.scope_constraint)
        self.assertNotIn('<knowledge_topology>', str(prepared.messages))

    def sub_lesson(self):
        self.outline(path='sub-outline-12345678.md', major='并发', repeat=False)
        self.write('lesson.md', '本课讲解并发。', manifest([
            concept('root', '计算机基础', existing_id=self.ids['计算机基础']),
            concept('major', '并发', 'root', existing_id=self.ids['并发'])],
            [coverage('major', '本课讲解并发。')]))
        from app.services.generation_service import _link_lesson_to_outline
        node = self.storage.create_knowledge_node(self.project, 'course', '并发课件', ref_type='course', ref_path='lesson.md')
        _link_lesson_to_outline(self.project, node.id, 'sub-outline-12345678.md')

    def test_course_question_uses_its_sub_outline_instead_of_project_outline(self):
        self.sub_lesson()
        prepared = self.prepare(source_type='course', source_path='lesson.md')
        self.assertEqual(prepared.scope_constraint['outline_path'], 'sub-outline-12345678.md')
        text = '\n'.join(row['content'] for row in prepared.messages)
        self.assertIn('并发', text)
        self.assertNotIn('对象生命周期', text)
        self.assertNotIn('内存管理', text)

    def test_follow_up_and_qa_source_inherit_originating_sub_outline(self):
        from app.services import qa_service as qa
        self.sub_lesson()
        prepared = self.prepare(source_type='course', source_path='lesson.md')
        first = qa.finalize_question(prepared, '第一轮回答。')
        for args in ({'parent_qa_id': first.id}, {'source_type': 'qa', 'source_path': str(first.output_path)}):
            with self.subTest(args=args):
                followup = self.prepare(**args)
                self.assertEqual(followup.scope_constraint['outline_path'], 'sub-outline-12345678.md')
                self.assertNotIn('对象生命周期', str(followup.messages))

    def test_renamed_outline_is_found_through_origin_graph(self):
        self.sub_lesson()
        root = self.storage.GENERATED_ROOT / str(self.project)
        old, new = 'sub-outline-12345678.md', 'renamed-plan.md'
        (root / old).rename(root / new)
        self.storage.rename_course_references(self.project, old, new, '改名总纲')
        prepared = self.prepare(source_type='course', source_path='lesson.md')
        self.assertEqual(prepared.scope_constraint['outline_path'], new)

    def test_legacy_qa_chain_recovers_the_original_course_forest(self):
        from app.services import qa_service as qa
        self.sub_lesson()
        first = qa.finalize_question(self.prepare(source_type='course', source_path='lesson.md'), '第一轮。')
        second = qa.finalize_question(self.prepare(parent_qa_id=first.id), '第二轮。')
        with self.storage._connect() as conn, conn:
            conn.execute("UPDATE teaching_documents SET lesson_scope_json=NULL WHERE project_id=? AND source_type='qa'", (self.project,))
        prepared = self.prepare(parent_qa_id=second.id)
        self.assertEqual(prepared.scope_constraint['outline_path'], 'sub-outline-12345678.md')
        self.assertNotIn('对象生命周期', str(prepared.messages))

    def test_bound_missing_sub_outline_does_not_fall_back_to_main_tree(self):
        from app.services import qa_service as qa
        self.sub_lesson()
        first = qa.finalize_question(self.prepare(source_type='course', source_path='lesson.md'), '原回答。')
        (self.storage.GENERATED_ROOT / str(self.project) / 'sub-outline-12345678.md').unlink()
        prepared = self.prepare(parent_qa_id=first.id)
        self.assertIsNone(prepared.scope_constraint)
        self.assertNotIn('<knowledge_topology>', str(prepared.messages))

    def answer_manifest(self, *, orphan=False):
        from app.services.personalization.teaching.manifest import canonical_comment
        value = manifest([concept('root', '计算机基础', existing_id=self.ids['计算机基础']),
            concept('major', '内存管理', 'root', existing_id=self.ids['内存管理']),
            concept('minor', 'QA内存池', None if orphan else 'major')],
            [coverage('minor', '内存池维护空闲对象集合。')])
        return '# 回答\n\n内存池维护空闲对象集合。\n\n' + canonical_comment(value)

    def test_answer_persists_same_scope_and_appends_only_under_major(self):
        from app.services import qa_service as qa
        from app.services.knowledge_tree_service import get_tree_snapshot
        record = qa.finalize_question(self.prepare(), self.answer_manifest())
        nodes = {row['name']: row for row in get_tree_snapshot(self.project)['nodes']}
        self.assertEqual(nodes['QA内存池']['parent_id'], self.ids['内存管理'])
        with self.storage._connect() as conn:
            row = conn.execute("SELECT * FROM teaching_documents WHERE project_id=? AND source_type='qa' AND source_path=?",
                               (self.project, str(record.output_path))).fetchone()
        self.assertEqual(row['index_status'], 'complete')
        self.assertEqual(json.loads(row['lesson_scope_json'])['outline_path'], 'outline.md')

    def test_out_of_forest_answer_keeps_readable_text_without_new_root(self):
        from app.services import qa_service as qa
        from app.services.knowledge_tree_service import get_tree_snapshot
        record = qa.finalize_question(self.prepare(), self.answer_manifest(orphan=True))
        self.assertIn('维护空闲对象', record.answer_md)
        self.assertNotIn('QA内存池', {row['name'] for row in get_tree_snapshot(self.project)['nodes']})
        with self.storage._connect() as conn:
            row = conn.execute("SELECT index_status FROM teaching_documents WHERE project_id=? AND source_type='qa' AND source_path=?",
                               (self.project, str(record.output_path))).fetchone()
        self.assertEqual(row['index_status'], 'invalid')


if __name__ == '__main__':
    unittest.main()
