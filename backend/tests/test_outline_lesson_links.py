import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services import generation_service as generation
from app.services.personalization.teaching.manifest import canonical_comment, parse_manifest


class OutlineLessonLinksTests(unittest.TestCase):
    def test_all_eighteen_heading_lessons_have_links_and_duplicates_are_ignored(self):
        outline = '# 总纲\n\n' + '\n\n'.join(f'### 第 {i} 课：主题{i}\n本课内容{i}。' for i in range(1, 19))
        outline += '\n### 第 18 课：重复标题\n'
        linked = generation.add_outline_lesson_links(outline)
        self.assertEqual(len(generation.extract_outline_lessons(outline)), 18)
        self.assertEqual(linked.count('https://codecourse.local/generate-lesson/'), 18)
        self.assertIn('/generate-lesson/18?', linked)
        self.assertEqual(generation.add_outline_lesson_links(linked), linked)

    def test_table_outline_and_sub_outline_include_later_lessons(self):
        outline = '| 课次 | 课程名称 |\n| --- | --- |\n' + '\n'.join(f'| {i} | 主题{i} |' for i in range(1, 19))
        linked = generation.add_outline_lesson_links(outline, 'sub-outline-12345678.md')
        self.assertEqual(len(generation.extract_outline_lessons(outline)), 18)
        self.assertEqual(linked.count('https://codecourse.local/generate-lesson/'), 18)
        self.assertIn('/generate-lesson/18?', linked)
        self.assertEqual(linked.count('&outline_path=sub-outline-12345678.md'), 18)

    def test_opening_old_outline_backfills_links_without_model_calls_or_invalidating_quotes(self):
        body = '# 总纲\n\n' + '\n\n'.join(f'### 第 {i} 课：主题{i}\n本课内容{i}。' for i in range(1, 19))
        # The old app generated only the first twelve entry points.
        legacy = body + '\n\n' + generation.LESSON_LINKS_START + '\n'
        legacy += '\n'.join(f'- [第{i}课](https://codecourse.local/generate-lesson/{i}?title=old)' for i in range(1, 13))
        legacy += '\n' + generation.LESSON_LINKS_END
        manifest = {'schema_version': 2, 'concepts': [{'ref': 'c', 'existing_id': None, 'name': '主题13',
            'domain': 'general', 'scope': 'global', 'parent_ref': None, 'aliases': []}],
            'coverage': [{'concept_ref': 'c', 'aspect': '计划内容', 'dimension': 'conceptual', 'kind': 'planned',
                'core': True, 'quote': '主题13'}], 'terms': [], 'placement_changes': []}
        original = legacy + '\n\n' + canonical_comment(manifest)
        with tempfile.TemporaryDirectory() as folder, patch.object(generation, 'GENERATED_ROOT', Path(folder)), \
                patch.object(generation, 'call_openai_compatible_chat') as model:
            for filename in ('outline.md', 'sub-outline-12345678.md'):
                target = Path(folder) / '1' / filename
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(original, encoding='utf-8')
                result = generation.read_project_course_file(Path(folder), 1, filename)
                self.assertEqual(result.count('https://codecourse.local/generate-lesson/'), 18)
                parsed = parse_manifest(result)
                self.assertEqual(parsed.status, 'valid', parsed.errors)
                self.assertEqual(len(parsed.manifest['coverage']), 1)
                self.assertEqual(result, generation.read_project_course_file(Path(folder), 1, filename))
            model.assert_not_called()
