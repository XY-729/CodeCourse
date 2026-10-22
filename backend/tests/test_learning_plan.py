"""Tests for learning-plan projects."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from teaching_manifest_fixture import with_manifest


def _setup_temp_workspace():
    import app.core.config as cfg
    import app.services.generation_service as generation_service
    import app.services.storage as storage

    tmpdir = tempfile.TemporaryDirectory()
    workspace = Path(tmpdir.name)

    db_path = workspace / "app.db"
    repos = workspace / "repos"
    generated = workspace / "generated"

    cfg.DB_PATH = db_path
    cfg.WORKSPACE_ROOT = workspace
    cfg.REPOS_ROOT = repos
    cfg.GENERATED_ROOT = generated

    storage.DB_PATH = db_path
    storage.GENERATED_ROOT = generated
    storage.REPOS_ROOT = repos
    storage.WORKSPACE_ROOT = workspace
    generation_service.GENERATED_ROOT = generated

    try:
        import app.api.projects as project_api

        project_api.REPOS_ROOT = repos
    except Exception:
        pass

    storage.init_storage()
    return tmpdir, workspace, generated


class LearningPlanProjectTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir, self.workspace, self.generated = _setup_temp_workspace()

        from app.main import app
        from app.services.storage import set_setting

        set_setting("llm.enabled", "true")
        set_setting("llm.provider", "deepseek")
        set_setting("llm.base_url", "https://api.deepseek.com")
        set_setting("llm.model", "deepseek-test")
        set_setting("llm.api_key", "fake-key")

        self.client = TestClient(app)

    def tearDown(self):
        self._tmpdir.cleanup()

    def test_create_learning_plan_has_empty_course_list(self):
        response = self.client.post("/api/projects/learning-plan", json={"name": "C++ 模板元编程"})

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["project_type"], "learning_plan")
        self.assertEqual(data["course_files"], [])

        courses = self.client.get(f"/api/projects/{data['id']}/course")
        self.assertEqual(courses.status_code, 200)
        self.assertEqual(courses.json(), [])

    def test_learning_plan_outline_generation_uses_instructions(self):
        project = self.client.post("/api/projects/learning-plan", json={"name": "算法复习计划"}).json()
        generated_outline = with_manifest(
            "# 学习计划总纲\n\n生成方式：AI 生成\n\n## 学习目标\n\n围绕动态规划建立学习路径。",
            [("动态规划", "围绕动态规划建立学习路径。", "课程目标", "planned")],
        )

        with patch("app.services.generation_service.call_openai_compatible_chat", return_value=generated_outline) as mocked:
            task = self.client.post(
                f"/api/projects/{project['id']}/outline/generate",
                json={
                    "scope": {"type": "learning_plan", "paths": []},
                    "instructions": "我想系统学习动态规划，从背包到区间 DP。",
                },
            )

        self.assertEqual(task.status_code, 200)
        task_data = task.json()
        self.assertIn(task_data["status"], {"queued", "running", "completed"})

        courses = self.client.get(f"/api/projects/{project['id']}/course")
        self.assertEqual(courses.status_code, 200)
        self.assertEqual([item["filename"] for item in courses.json()], ["outline.md"])

        outline = self.client.get(f"/api/projects/{project['id']}/course/outline.md")
        self.assertEqual(outline.status_code, 200)
        self.assertIn("动态规划", outline.json()["content"])
        prompt = mocked.call_args.args[3][1]["content"]
        # The learning-plan outline prompt states the real publication target and
        # still excludes the retired repository-only sections.
        self.assertIn("学习计划总纲", prompt)
        self.assertIn("### 第 X 课", prompt)
        self.assertIn("我想系统学习动态规划", prompt)
        self.assertNotIn("## 三、推荐代码阅读顺序", prompt)
        self.assertNotIn("**涉及文件**", prompt)
        self.assertNotIn("RAG 索引检索片段：", prompt)
        self.assertEqual(mocked.call_args.kwargs["timeout"], 180)

    def test_survey_answers_invalidate_cached_outline_reuse(self):
        project = self.client.post("/api/projects/learning-plan", json={"name": "DP 强化"}).json()
        generated_outline = with_manifest(
            "# 学习计划总纲\n\n生成方式：AI 生成\n\n## 学习目标\n\n围绕动态规划建立学习路径。",
            [("动态规划", "围绕动态规划建立学习路径。", "课程目标", "planned")],
        )

        with patch("app.services.generation_service.call_openai_compatible_chat", return_value=generated_outline) as mocked:
            first = self.client.post(
                f"/api/projects/{project['id']}/outline/generate",
                json={"scope": {"type": "learning_plan", "paths": []}, "instructions": ""},
            ).json()

        self.assertEqual(first["status"], "queued")

        # Same input again reuses the cached task (no new generation).
        with patch("app.services.generation_service.call_openai_compatible_chat", return_value=generated_outline) as mocked:
            second = self.client.post(
                f"/api/projects/{project['id']}/outline/generate",
                json={"scope": {"type": "learning_plan", "paths": []}, "instructions": ""},
            ).json()
            self.assertEqual(mocked.call_count, 0)

        # Same input WITH survey answers must NOT reuse the cached task.
        with patch("app.services.generation_service.call_openai_compatible_chat", return_value=generated_outline) as mocked:
            third = self.client.post(
                f"/api/projects/{project['id']}/outline/generate",
                json={
                    "scope": {"type": "learning_plan", "paths": []},
                    "instructions": "",
                    "survey_answers": [
                        {
                            "question": "你对 DP 的了解程度？",
                            "question_type": "single_choice",
                            "dimension": "prerequisite_level",
                            "selected": "none",
                        }
                    ],
                },
            ).json()
            self.assertEqual(third["status"], "queued")
            self.assertNotEqual(third["id"], first["id"])
            self.assertEqual(mocked.call_count, 1)

    def test_learning_plan_lesson_is_generated_in_bounded_sections(self):
        project = self.client.post("/api/projects/learning-plan", json={"name": "Python 异步编程"}).json()
        course_dir = self.generated / str(project["id"])
        course_dir.mkdir(parents=True, exist_ok=True)
        (course_dir / "outline.md").write_text(
            "# 学习计划总纲\n\n### 第 1 课：异步编程基础\n\n"
            "必须完整讲解：协程、async、await、事件循环。\n",
            encoding="utf-8",
        )
        plan = {
            "lesson_title": "异步编程基础",
            "position": "建立异步程序的执行模型。",
            "objectives": ["能够解释协程如何由事件循环调度"],
            "sections": [
                {
                    "section_id": "s1", "title": "协程直觉", "depends_on": [],
                    "reference_only": [], "avoid_repeat": [],
                    "items": [{
                        "name": "协程", "kind": "concept", "focus": "执行暂停与恢复",
                        "concept_ref": "coroutine", "existing_id": None,
                        "aspect": "执行暂停与恢复", "dimension": "conceptual",
                        "owner_section_id": "s1", "teaching_mode": "first_explanation",
                        "reference_section_ids": [],
                    }],
                },
                {
                    "section_id": "s2", "title": "异步函数", "depends_on": ["s1"],
                    "reference_only": [], "avoid_repeat": [],
                    "items": [{
                        "name": "async", "kind": "function", "focus": "声明异步函数",
                        "concept_ref": "async_function", "existing_id": None,
                        "aspect": "声明异步函数", "dimension": "implementation",
                        "owner_section_id": "s2", "teaching_mode": "first_explanation",
                        "reference_section_ids": [],
                    }],
                },
                {
                    "section_id": "s3", "title": "等待结果", "depends_on": ["s2"],
                    "reference_only": [], "avoid_repeat": [],
                    "items": [{
                        "name": "await", "kind": "function", "focus": "让出控制权",
                        "concept_ref": "await_expression", "existing_id": None,
                        "aspect": "让出控制权", "dimension": "implementation",
                        "owner_section_id": "s3", "teaching_mode": "first_explanation",
                        "reference_section_ids": [],
                    }],
                },
                {
                    "section_id": "s4", "title": "调度机制", "depends_on": ["s3"],
                    "reference_only": [], "avoid_repeat": [],
                    "items": [{
                        "name": "事件循环", "kind": "concept", "focus": "任务调度",
                        "concept_ref": "event_loop", "existing_id": None,
                        "aspect": "任务调度", "dimension": "conceptual",
                        "owner_section_id": "s4", "teaching_mode": "first_explanation",
                        "reference_section_ids": [],
                    }],
                },
            ],
            "textbooks": [
                {"id": "fluent-python-2", "topics": ["concurrency"]}
            ],
        }
        section_payloads = {
            "协程直觉": with_manifest(
                "## 协程直觉\n\n### 协程\n\n协程在暂停点保存自己的执行状态。",
                [{"ref": "coroutine", "name": "协程", "aspect": "执行暂停与恢复",
                  "dimension": "conceptual", "quote": "协程在暂停点保存自己的执行状态。"}]),
            "异步函数": with_manifest(
                "## 异步函数\n\n### async\n\nasync 关键字声明一个可等待的异步函数。",
                [{"ref": "async_function", "name": "async", "aspect": "声明异步函数",
                  "dimension": "implementation", "quote": "async 关键字声明一个可等待的异步函数。"}]),
            "等待结果": with_manifest(
                "## 等待结果\n\n### await\n\nawait 表达式让出控制权等待结果就绪。",
                [{"ref": "await_expression", "name": "await", "aspect": "让出控制权",
                  "dimension": "implementation", "quote": "await 表达式让出控制权等待结果就绪。"}]),
            "调度机制": with_manifest(
                "## 调度机制\n\n### 事件循环\n\n事件循环负责安排就绪任务继续执行。",
                [{"ref": "event_loop", "name": "事件循环", "aspect": "任务调度",
                  "dimension": "conceptual", "quote": "事件循环负责安排就绪任务继续执行。"}]),
        }
        synthesis_payload = with_manifest(
            "## 综合串联\n\n协程通过 async 声明，在 await 处让出控制权，由事件循环继续调度。\n\n"
            "## 练习与自测\n\n解释一次暂停与恢复过程，并检查四个知识项之间的关系。",
            [],
        )

        def respond(*args, **kwargs):
            # Sections are generated concurrently, so answer from the prompt
            # instead of relying on call order.
            messages = args[3]
            content = messages[-1]["content"]
            if "<lesson_responsibility_contract>" in content:
                return json.dumps(plan, ensure_ascii=False)
            if "责任编辑" in content:
                return synthesis_payload
            for title, payload in section_payloads.items():
                # The shared responsibility map repeats every section title, so
                # only the current writer's own section heading identifies it.
                if f"章节标题：{title}" in content:
                    return payload
            raise AssertionError(f"unexpected planner/section prompt: {content[:200]}")

        with patch("app.services.generation_service.call_openai_compatible_chat", side_effect=respond) as mocked:
            created = self.client.post(
                f"/api/projects/{project['id']}/lessons/outline",
                json={"lesson_number": 1, "title": "异步编程基础", "instructions": "面向初学者"},
            )

        self.assertEqual(created.status_code, 200)
        task_id = created.json()["id"]
        task = self.client.get(f"/api/projects/{project['id']}/tasks/{task_id}").json()
        self.assertTrue(task["status"] == "completed", task)
        # Progress includes publishing the finished document, not just LLM calls.
        self.assertEqual(task["progress_current"], task["progress_total"])
        self.assertGreaterEqual(task["progress_total"], mocked.call_count)
        self.assertEqual(task["stage_label"], "生成完成")
        self.assertLessEqual(mocked.call_count, 12)
        self.assertEqual(mocked.call_count, 6)
        lesson = (course_dir / "lessons" / "lesson_01.md").read_text(encoding="utf-8")
        for item in ("协程", "async", "await", "事件循环"):
            self.assertIn(item, lesson)
        self.assertIn("《Fluent Python》", lesson)
        self.assertIn("未读取教材原文", lesson)
        self.assertEqual(lesson.count("## 练习与自测"), 1)
        self.assertEqual(lesson.count("## 教材参照"), 1)
        planner_prompt = mocked.call_args_list[0].args[3][1]["content"]
        self.assertNotIn("RAG 索引检索片段：", planner_prompt)
        self.assertNotIn("## 阅读地图", planner_prompt)

    def test_learning_plan_lesson_failure_keeps_previous_file(self):
        project = self.client.post("/api/projects/learning-plan", json={"name": "线性代数"}).json()
        course_dir = self.generated / str(project["id"])
        lesson_dir = course_dir / "lessons"
        lesson_dir.mkdir(parents=True, exist_ok=True)
        (course_dir / "outline.md").write_text(
            "# 学习计划总纲\n\n### 第 1 课：向量空间\n\n讲解向量、线性组合、基与维数。\n",
            encoding="utf-8",
        )
        output_path = lesson_dir / "lesson_01.md"
        output_path.write_text("# 旧课件\n\n保留我。\n", encoding="utf-8")
        invalid_plan = json.dumps(
            {"lesson_title": "向量空间", "sections": [{"title": "只有一章", "items": ["向量"]}]},
            ensure_ascii=False,
        )

        with patch("app.services.generation_service.call_openai_compatible_chat", return_value=invalid_plan):
            created = self.client.post(
                f"/api/projects/{project['id']}/lessons/outline",
                json={"lesson_number": 1, "title": "向量空间", "instructions": "详细讲解"},
            )

        task_id = created.json()["id"]
        task = self.client.get(f"/api/projects/{project['id']}/tasks/{task_id}").json()
        self.assertEqual(task["status"], "failed")
        self.assertEqual(task["stage_label"], "生成失败")
        self.assertEqual(output_path.read_text(encoding="utf-8"), "# 旧课件\n\n保留我。\n")


if __name__ == "__main__":
    unittest.main()
