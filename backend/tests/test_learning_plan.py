"""Tests for learning-plan projects."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


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
        generated_outline = "# 学习计划总纲\n\n生成方式：AI 生成\n\n## 学习目标\n\n围绕动态规划建立学习路径。"

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
        self.assertIn("正式出版物", prompt)
        self.assertNotIn("## 三、推荐代码阅读顺序", prompt)
        self.assertNotIn("**涉及文件**", prompt)
        self.assertNotIn("RAG 索引检索片段：", prompt)

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
                {"title": "协程直觉", "items": [{"name": "协程", "kind": "concept", "focus": "执行暂停与恢复"}]},
                {"title": "异步函数", "items": [{"name": "async", "kind": "function", "focus": "声明异步函数"}]},
                {"title": "等待结果", "items": [{"name": "await", "kind": "function", "focus": "让出控制权"}]},
                {"title": "调度机制", "items": [{"name": "事件循环", "kind": "concept", "focus": "任务调度"}]},
            ],
            "textbooks": [
                {"title": "Fluent Python", "author": "Luciano Ramalho", "topics": "协程与并发"}
            ],
        }
        responses = [json.dumps(plan, ensure_ascii=False)] + [
            "## 协程直觉\n\n### 协程\n\n定义、直觉、过程、例子、误区与练习。",
            "## 异步函数\n\n### async\n\n用途、形式、执行步骤、教学示例、错误与练习。",
            "## 等待结果\n\n### await\n\n用途、形式、执行步骤、教学示例、错误与练习。",
            "## 调度机制\n\n### 事件循环\n\n定义、直觉、过程、例子、误区与练习。",
        ]

        with patch("app.services.generation_service.call_openai_compatible_chat", side_effect=responses) as mocked:
            created = self.client.post(
                f"/api/projects/{project['id']}/lessons/outline",
                json={"lesson_number": 1, "title": "异步编程基础", "instructions": "面向初学者"},
            )

        self.assertEqual(created.status_code, 200)
        task_id = created.json()["id"]
        task = self.client.get(f"/api/projects/{project['id']}/tasks/{task_id}").json()
        self.assertEqual(task["status"], "completed")
        self.assertEqual(task["progress_current"], 5)
        self.assertEqual(task["progress_total"], 5)
        self.assertEqual(task["stage_label"], "生成完成")
        self.assertEqual(mocked.call_count, 5)
        lesson = (course_dir / "lessons" / "lesson_01.md").read_text(encoding="utf-8")
        for item in ("协程", "async", "await", "事件循环"):
            self.assertIn(item, lesson)
        self.assertIn("《Fluent Python》", lesson)
        self.assertIn("未直接读取教材原文", lesson)
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
