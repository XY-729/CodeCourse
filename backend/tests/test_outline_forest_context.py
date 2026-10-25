import json
import unittest
from unittest.mock import patch

from test_personalization_profile import _setup_temp_workspace
from test_knowledge_tree_forest import concept, coverage, manifest


class OutlineForestContextTests(unittest.TestCase):
    def setUp(self):
        self.workspace = _setup_temp_workspace()
        from app.services import storage
        self.storage = storage
        self.project = storage.create_learning_plan_project('Forest', storage.REPOS_ROOT / 'forest').id
        self.other = storage.create_learning_plan_project('Other', storage.REPOS_ROOT / 'other').id
        self.write('history.md', '内存模型说明。\n旧的同步说明。\n另一个领域。', manifest([
            concept('root', '计算机基础'), concept('memory', '内存管理', 'root'),
            concept('child', '对象生命周期', 'memory'), concept('thread', '并发', 'root'),
            concept('math', '数学')], [coverage('child', '内存模型说明。'),
                coverage('thread', '旧的同步说明。'), coverage('math', '另一个领域。')]), project=self.other)
        from app.services.knowledge_tree_service import get_tree_snapshot
        self.ids = {n['name']: n['id'] for n in get_tree_snapshot(self.project)['nodes']}
        self.outline()

    def tearDown(self):
        self.workspace.cleanup()

    def write(self, path, body, value, *, project=None):
        from app.services.teaching_index import index_document
        from app.services.personalization.teaching.manifest import canonical_comment
        project = project or self.project
        text = '# 文档\n\n' + body + '\n\n' + canonical_comment(value)
        target = self.storage.GENERATED_ROOT / str(project) / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf-8', newline='\n')
        identity = index_document(project, 'course', path, text)
        with self.storage._connect() as conn:
            row = conn.execute('SELECT * FROM teaching_documents WHERE id=?', (identity,)).fetchone()
            self.assertEqual(row['index_status'], 'complete', row['metadata_errors_json'])
        return identity

    def outline(self, *, path='outline.md', major='内存管理', repeat=True):
        value = manifest([concept('root', '计算机基础', existing_id=self.ids['计算机基础']),
            concept('major', major, 'root', existing_id=self.ids[major])],
            [coverage('major', '本课将学习基础。', kind='planned')])
        from app.services.personalization.teaching.prompt_forest import prompt_id
        value['outline_knowledge'] = {'major_refs': ['major'],
            'repeated_ids': [prompt_id(self.ids['并发'])] if repeat else []}
        return self.write(path, '本课将学习基础。', value)

    def context(self, path='outline.md'):
        from app.services.personalization.teaching.generation_context import build_generation_context
        return build_generation_context(self.project, outline_path=path)

    def test_forest_keeps_descendants_and_connectors_but_excludes_siblings(self):
        context = self.context()
        names = {n['name'] for n in context.snapshot['nodes']}
        self.assertEqual(names, {'计算机基础', '内存管理', '对象生命周期'})
        self.assertIn('previously_explained', context.render())
        history = json.loads(context.generation_scope_json)['prior_coverage']
        self.assertEqual({row['name'] for row in history}, {'对象生命周期', '并发'})
        self.assertNotIn('数学', context.render())
        with self.storage._connect() as conn:
            saved = json.loads(conn.execute("SELECT outline_scope_json FROM teaching_documents WHERE project_id=? AND source_path='outline.md'", (self.project,)).fetchone()[0])
        self.assertEqual(saved['major_ids'], [self.ids['内存管理']])
        self.assertEqual({row['name'] for row in saved['prior_coverage']}, {'对象生命周期', '并发'})

    def test_new_explanations_appear_and_deleted_history_disappears(self):
        self.outline(repeat=False)
        self.assertNotIn('并发', self.context().render())
        value = manifest([concept('root', '计算机基础', existing_id=self.ids['计算机基础']),
            concept('major', '内存管理', 'root', existing_id=self.ids['内存管理']),
            concept('new', '分配器', 'major')], [coverage('new', '分配器的新讲解。')])
        self.write('new.md', '分配器的新讲解。', value, project=self.other)
        context = self.context()
        self.assertIn('分配器', context.render())
        from app.services.teaching_index import remove_documents
        self.storage.run_in_transaction(lambda conn: remove_documents(conn, self.other, 'history.md'))
        self.assertNotIn('旧的同步说明', self.context().render())
        self.assertNotIn('对象生命周期', {r['name'] for r in json.loads(self.context().generation_scope_json)['prior_coverage']})

    def lesson(self, *, orphan=False, hidden=False):
        concepts = [concept('root', '计算机基础', existing_id=self.ids['计算机基础']),
            concept('major', '内存管理', 'root', existing_id=self.ids['内存管理']),
            concept('new', '数学' if hidden else '内存池', None if orphan else 'major')]
        return manifest(concepts, [coverage('new', '新的具体机制。')])

    def publish(self, value, context=None, path='lessons/lesson_1.md'):
        from app.services.personalization.teaching.publication import publish_course_document
        from app.services.personalization.teaching.manifest import canonical_comment
        context = context or self.context()
        return publish_course_document(self.project, path, '# 第1课\n\n新的具体机制。\n\n' + canonical_comment(value),
            tree_snapshot=context.tree_snapshot, scope_constraint=json.loads(context.generation_scope_json))

    def test_append_child_is_visible_to_next_lesson_and_preserves_parent(self):
        self.publish(self.lesson())
        nodes = {n['name']: n for n in self.context().snapshot['nodes']}
        self.assertEqual(nodes['内存池']['parent_id'], self.ids['内存管理'])

    def test_orphan_and_hidden_canonical_collision_roll_back_without_new_roots(self):
        for kwargs in ({'orphan': True}, {'hidden': True}):
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(ValueError):
                    self.publish(self.lesson(**kwargs))
                self.assertNotIn('内存池', self.context().render())
                self.assertFalse((self.storage.GENERATED_ROOT / str(self.project) / 'lessons/lesson_1.md').exists())

    def test_explicit_existing_reparent_is_rejected(self):
        value = self.lesson()
        value['placement_changes'] = [{'concept_ref': 'major', 'to_parent_ref': 'root',
            'from_parent_id': self.ids['计算机基础'], 'reason': '重排'}]
        with self.assertRaisesRegex(ValueError, '只能追加'):
            self.publish(value)

    def test_changed_outline_invalidates_frozen_lesson(self):
        context = self.context()
        self.outline(major='并发')
        with self.assertRaisesRegex(ValueError, '总纲已变化'):
            self.publish(self.lesson(), context)
        self.assertNotEqual(context.reuse_fingerprint, self.context().reuse_fingerprint)

    def test_unindexed_disk_edit_invalidates_frozen_lesson(self):
        context = self.context()
        target = self.storage.GENERATED_ROOT / str(self.project) / 'outline.md'
        target.write_text(target.read_text(encoding='utf-8') + '\n新编辑。', encoding='utf-8', newline='\n')
        with self.assertRaisesRegex(ValueError, '总纲已变化'):
            self.publish(self.lesson(), context)

    def test_invalid_history_proposal_preserves_old_outline_before_file_publication(self):
        from app.services.personalization.teaching.publication import publish_course_document
        from app.services.personalization.teaching.manifest import canonical_comment
        from app.services.knowledge_tree_service import get_tree_snapshot
        target = self.storage.GENERATED_ROOT / str(self.project) / 'outline.md'
        previous = target.read_bytes()
        before = get_tree_snapshot(self.project)
        value = manifest([concept('major', '新的领域')])
        value['outline_knowledge'] = {'major_refs': ['major'], 'repeated_ids': ['不存在的概念']}
        with self.assertRaisesRegex(ValueError, '不可访问'):
            publish_course_document(self.project, 'outline.md', '# 新总纲\n\n' + canonical_comment(value))
        self.assertEqual(target.read_bytes(), previous)
        self.assertEqual(get_tree_snapshot(self.project), before)

    def test_sub_outline_selects_its_own_forest(self):
        self.outline(path='sub-outline-12345678.md', major='并发', repeat=False)
        context = self.context('sub-outline-12345678.md')
        self.assertEqual({n['name'] for n in context.snapshot['nodes']}, {'计算机基础', '并发'})

    def test_legacy_v2_outline_recovers_from_coverage_without_full_tree(self):
        value = manifest([concept('root', '计算机基础', existing_id=self.ids['计算机基础']),
            concept('major', '内存管理', 'root', existing_id=self.ids['内存管理'])],
            [coverage('major', '旧的学习计划。', kind='planned')])
        self.write('legacy.md', '旧的学习计划。', value)
        self.assertNotIn('数学', self.context('legacy.md').render())

    def test_unrecoverable_outline_requests_regeneration_without_model_call(self):
        target = self.storage.GENERATED_ROOT / str(self.project) / 'old.md'
        target.write_text('# 旧总纲，没有知识清单', encoding='utf-8')
        with patch('app.services.llm_client.call_openai_compatible_chat') as model:
            with self.assertRaisesRegex(ValueError, '补录或重新生成'):
                self.context('old.md')
            model.assert_not_called()

    def test_outline_split_keeps_major_refs_after_namespacing(self):
        from app.services.generation_service import _parse_outline_files
        from app.services.personalization.teaching.manifest import canonical_comment, parse_manifest
        value = manifest([concept('major', '全新领域')], [coverage('major', '本课将研究领域。', kind='planned')])
        value['outline_knowledge'] = {'major_refs': ['major'], 'repeated_ids': []}
        _, text = _parse_outline_files('## FILE: project_map.md\n# 项目\n\n## FILE: outline.md\n# 总纲\n\n本课将研究领域。\n' + canonical_comment(value))
        parsed = parse_manifest(text).require_valid()
        self.assertEqual(parsed['outline_knowledge']['major_refs'], ['outline.md::major'])

    def test_outline_rejects_premature_minor_concepts(self):
        from app.services.personalization.teaching.manifest import validate_manifest
        value = self.lesson()
        value['outline_knowledge'] = {'major_refs': ['major'], 'repeated_ids': []}
        with self.assertRaisesRegex(ValueError, '次概念'):
            validate_manifest(value)

    def test_local_related_context_omits_unrelated_forest(self):
        from app.services.personalization.teaching.generation_context import build_generation_context
        context = build_generation_context(self.project, '解释对象生命周期', related_text='')
        self.assertEqual({n['name'] for n in context.snapshot['nodes']}, {'计算机基础', '内存管理', '对象生命周期'})

    def test_large_unrelated_tree_is_not_sent_to_lesson(self):
        from app.services.knowledge_tree_service import apply_manifest
        from app.services.personalization.teaching.generation_context import build_generation_context
        apply_manifest(self.project, manifest([concept(str(i), '无关领域' + str(i)) for i in range(150)]),
                       source_type='course', source_path='unrelated', artifact_kind='root', content_hash='')
        full = build_generation_context(self.project).render()
        small = self.context().render()
        self.assertLess(len(small), len(full) / 2)


if __name__ == '__main__':
    unittest.main()
