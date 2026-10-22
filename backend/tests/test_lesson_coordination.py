"""Regressions using the recorded 2026-09-21 C++ lesson's actual section plan."""

import json
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import test_lesson_concurrency as fixtures


class LessonCoordinationTests(unittest.TestCase):
    setUp = fixtures.RepositoryLessonConcurrencyTests.setUp
    tearDown = fixtures.RepositoryLessonConcurrencyTests.tearDown

    def _exercise_writer(self, writer_name, log_suffix):
        from app.services import generation_service as generation, storage

        plan = json.loads((Path(__file__).parent / "fixtures/cpp_chrono_filesystem_plan.json").read_text(encoding="utf-8"))
        plan = fixtures.responsibility_plan(plan)
        original_sections = json.dumps(plan["sections"], ensure_ascii=False)
        task = storage.create_generation_task(
            self.project.id, "outline_lesson", "recorded-cpp-plan", "test",
        )
        prompts = {}
        barrier = threading.Barrier(4)
        lock = threading.Lock()
        settings = {"base_url": "http://fixture.invalid", "api_key": "fake", "model": "unchanged-model"}
        instructions = "保留必要推导和教学示例"
        materials = "本课材料原样保留，不以缩短输入实现协调。"

        def model(base_url, api_key, model_name, messages, **kwargs):
            self.assertEqual((base_url, api_key, model_name), tuple(settings.values()))
            prompt = messages[1]["content"]
            if "核心正文章节" in prompt:
                title = prompt.split("章节标题：", 1)[1].splitlines()[0]
                index = next(i for i, section in enumerate(plan["sections"]) if section["title"] == title)
                with lock:
                    prompts[index] = prompt
                # A serial implementation cannot get four writers to this point.
                barrier.wait(timeout=5)
                section = plan["sections"][index]
                body = "## " + title + "\n\n" + "\n\n".join(
                    f"### {item['name']}\n\n本章重点：{item['focus']}" for item in section["items"]
                )
                return fixtures.response_manifest(body, section["items"])
            if "责任编辑" in prompt:
                return fixtures.response_manifest("## 本课小结\n\n本课知识项通过综合应用串联。")
            return json.dumps(plan, ensure_ascii=False)

        with patch.object(generation, "call_openai_compatible_chat", side_effect=model) as calls:
            title, markdown = getattr(generation, writer_name)(
                self.project.id, task.id, 7, plan["lesson_title"], materials, instructions, settings,
            )

        self.assertEqual(title, plan["lesson_title"])
        self.assertEqual(calls.call_count, len(plan["sections"]) + 2)
        self.assertEqual(len(prompts), 8)
        self.assertEqual(json.dumps(plan["sections"], ensure_ascii=False), original_sections)
        for index, prompt in prompts.items():
            with self.subTest(writer=writer_name, section=index + 1):
                overview = prompt.split("本课章节分工", 1)[1].split("章节协调要求", 1)[0]
                self.assertEqual(overview.count("（当前章，由你编写）"), 1)
                self.assertIn(f"第 {index + 1} 章：{plan['sections'][index]['title']}（当前章，由你编写）", overview)
                for number, section in enumerate(plan["sections"], 1):
                    self.assertIn(f"第 {number} 章：{section['title']}", overview)
                    for item in section["items"]:
                        self.assertIn(item["name"], overview)
                        self.assertIn(item["focus"], overview)
                        self.assertIn(f"### {item['name']}", markdown)
                self.assertIn(materials, prompt)
                self.assertIn(instructions, prompt)
                self.assertIn("保留本章新增的推导、应用、边界条件和必要示例", prompt)
                self.assertIn("不得虚构其代码、例子、结论", prompt)
                self.assertIn("前面小节已讲清的基础可直接引用", prompt)
                saved = self.generated.parent / ".debug"
                snapshots = list(saved.glob(f"*_task-{task.id}_L7-{log_suffix}section-{index + 1}-prompt.txt"))
                self.assertEqual(len(snapshots), 1)
                self.assertEqual(snapshots[0].read_text(encoding="utf-8"), prompt)

        # The real lesson's two overlap cases now have both owners visible.
        self.assertIn("文件状态查询与错误码接口", prompts[6])
        self.assertIn("错误码重载（std::error_code 参数）", prompts[6])
        self.assertIn("filesystem 模块边界与 path", prompts[7])
        self.assertIn("std::filesystem::path", prompts[7])

    def test_learning_plan_writers_share_the_recorded_cpp_plan_without_extra_calls(self):
        self._exercise_writer("_run_learning_plan_lesson_task", "")

    def test_repository_writers_share_the_recorded_cpp_plan_without_extra_calls(self):
        self._exercise_writer("_run_repository_lesson_task", "repo-")


if __name__ == "__main__":
    unittest.main()
