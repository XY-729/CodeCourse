"""Tests for learning-plan projects."""

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

        with patch("app.services.generation_service.call_openai_compatible_chat", return_value=generated_outline):
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


if __name__ == "__main__":
    unittest.main()
