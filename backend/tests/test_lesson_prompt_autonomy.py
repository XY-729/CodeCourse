"""Lesson presentation stays flexible while frozen coverage remains mandatory."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from app.services import generation_service as generation
from app.services.personalization.teaching.generation_context import GenerationContext
from app.services.personalization.teaching.manifest import canonical_comment, parse_manifest


WRITERS = ("_run_learning_plan_lesson_task", "_run_repository_lesson_task")


def lesson_plan(section_count):
    sections = []
    for number in range(1, section_count + 1):
        section_id = f"section_{number}"
        sections.append({
            "section_id": section_id,
            "title": f"章节 {number}",
            "depends_on": [],
            "reference_only": [],
            "avoid_repeat": [],
            "items": [{
                "name": f"知识项 {number}",
                "kind": "concept",
                "focus": f"范围 {number}",
                "concept_ref": f"concept_{number}",
                "existing_id": None,
                "aspect": f"范围 {number}",
                "dimension": "conceptual",
                "owner_section_id": section_id,
                "teaching_mode": "first_explanation",
                "reference_section_ids": [],
            }],
        })
    return {"lesson_title": "自主组织的课件", "sections": sections, "textbooks": []}


def response(body="", item=None, *, aspect=None):
    manifest = {"schema_version": 2, "concepts": [], "coverage": [], "terms": []}
    if item is not None:
        manifest["concepts"].append({
            "ref": item["concept_ref"], "name": item["name"],
            "domain": "programming", "scope": "global", "existing_id": None,
        })
        manifest["coverage"].append({
            "concept_ref": item["concept_ref"], "aspect": aspect or item["aspect"],
            "dimension": item["dimension"], "kind": "explained", "core": True,
            "quote": body.split("\n\n")[-1],
        })
    return body + "\n\n" + canonical_comment(manifest)


class LessonPromptAutonomyTests(unittest.TestCase):
    def _run_writer(self, writer_name, section_count=1, *, section_mode="covered", synthesis_mode="empty"):
        plan = lesson_plan(section_count)
        prompts = []
        context = GenerationContext(
            topology_json=json.dumps({"topology_version": 3, "topology_status": "ready", "nodes": []}),
            state_json=json.dumps({"state_version": 4, "nodes": []}),
            requirements_json='[{"scope":"current","source":"user","text":"按当前问题决定讲法"}]',
        )

        def model(_base_url, _api_key, _model, messages, **_kwargs):
            prompt = next(message["content"] for message in messages if message["role"] == "user")
            prompts.append(prompt)
            if "章节标题：" in prompt:
                title = prompt.split("章节标题：", 1)[1].splitlines()[0]
                section = next(section for section in plan["sections"] if section["title"] == title)
                item = section["items"][0]
                body = f"## {title}\n\n{item['name']} 的具体讲解覆盖 {item['aspect']}。"
                if section_mode == "missing":
                    return response(f"## {title}\n\n本章保留一段准备说明。")
                if section_mode == "unowned":
                    return response(body, item, aspect="超出冻结职责的范围")
                if section_mode == "no_manifest":
                    return body
                return response(body, item)
            if "责任编辑" in prompt:
                if synthesis_mode in {"repair", "duplicate"}:
                    item = plan["sections"][0]["items"][0]
                    # Plain Markdown prose is valid; a fixed synthesis heading is unnecessary.
                    return response(f"这里补足 {item['name']} 的 {item['aspect']}。", item)
                return response()
            return json.dumps(plan, ensure_ascii=False)

        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.object(generation, "GENERATED_ROOT", Path(temporary)),
            patch.object(generation, "build_generation_context", return_value=context),
            patch.object(generation, "update_generation_task"),
            patch.object(generation, "load_prompt", return_value=""),
            patch.object(generation, "_debug_dump"),
            patch.object(generation, "call_openai_compatible_chat", side_effect=model) as calls,
        ):
            title, markdown = getattr(generation, writer_name)(
                1, 1, 1, plan["lesson_title"], "本课材料", "按当前问题决定讲法",
                {"base_url": "http://fixture.invalid", "api_key": "fixture", "model": "fixture"},
                preview=Mock(),
            )
        return title, markdown, prompts, calls.call_count

    def test_both_pipelines_accept_one_or_more_than_ten_chapters_without_fixed_sections(self):
        for writer_name in WRITERS:
            for section_count in (1, 12):
                with self.subTest(writer=writer_name, sections=section_count):
                    title, markdown, prompts, call_count = self._run_writer(writer_name, section_count)
                    self.assertEqual(title, "自主组织的课件")
                    self.assertEqual(call_count, section_count + 2)
                    parsed = parse_manifest(markdown)
                    self.assertEqual(parsed.status, "valid", parsed.errors)
                    self.assertEqual(len(parsed.manifest["coverage"]), section_count)
                    for number in range(1, section_count + 1):
                        self.assertIn(f"## 章节 {number}\n", parsed.body)
                    for heading in ("本课目标", "本课定位", "知识地图", "常见误区", "练习与自测", "本课小结", "教材参照"):
                        self.assertNotIn(heading, parsed.body)
                    self.assertNotIn("###", parsed.body)
                    self.assertNotIn("4-10", prompts[0])
                    self.assertNotIn("3-5", prompts[0])
                    for prompt in prompts[1:-1]:
                        self.assertIn("内部标题、讲解顺序、深度", prompt)
                        self.assertIn("<lesson_responsibility_map>", prompt)
                        self.assertNotIn("每个知识项必须以", prompt)
                    self.assertIn("无需补充时正文可为空", prompts[-1])

    def test_optional_synthesis_can_repair_a_missing_range_without_fixed_headings(self):
        for writer_name in WRITERS:
            with self.subTest(writer=writer_name):
                _, markdown, _, _ = self._run_writer(writer_name, section_mode="missing", synthesis_mode="repair")
                parsed = parse_manifest(markdown)
                self.assertEqual(parsed.status, "valid", parsed.errors)
                self.assertEqual(len(parsed.manifest["coverage"]), 1)
                self.assertIn("这里补足 知识项 1 的 范围 1。", parsed.body)

    def test_omitted_coverage_still_blocks_a_lesson(self):
        for writer_name in WRITERS:
            with self.subTest(writer=writer_name), self.assertRaisesRegex(ValueError, "仍有冻结职责范围未覆盖"):
                self._run_writer(writer_name, section_mode="missing")

    def test_writers_cannot_expand_or_repeat_frozen_ownership(self):
        for writer_name in WRITERS:
            with self.subTest(writer=writer_name, violation="expanded"), self.assertRaisesRegex(ValueError, "扩大了冻结职责"):
                self._run_writer(writer_name, section_mode="unowned")
            with self.subTest(writer=writer_name, violation="duplicated"), self.assertRaisesRegex(ValueError, "重复解释"):
                self._run_writer(writer_name, synthesis_mode="duplicate")

    def test_manifest_protocol_and_nonempty_plan_are_still_required(self):
        with self.assertRaisesRegex(RuntimeError, "至少一个章节"):
            generation._parse_lesson_plan('{"sections": []}')
        for writer_name in WRITERS:
            with self.subTest(writer=writer_name), self.assertRaisesRegex(ValueError, "知识清单未就绪"):
                self._run_writer(writer_name, section_mode="no_manifest")


if __name__ == "__main__":
    unittest.main()
