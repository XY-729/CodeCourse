"""Tests for failed-generation cleanup: placeholder files must not survive as ghost courses."""

import asyncio
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

    repos.mkdir(parents=True, exist_ok=True)
    generated.mkdir(parents=True, exist_ok=True)

    import app.api.projects as project_api

    project_api.REPOS_ROOT = repos

    storage.init_storage()
    return tmpdir, workspace, generated


class GhostCourseCleanupTests(unittest.TestCase):
    """SSE error from a stream branch must leave no placeholder file behind."""

    def setUp(self):
        self._tmpdir, self.workspace, self.generated = _setup_temp_workspace()

        from app.main import app
        from app.services.storage import set_setting, upsert_project

        repo_dir = self.workspace / "repos" / "repo"
        repo_dir.mkdir(parents=True)
        (repo_dir / "README.md").write_text("# Repo\n", encoding="utf-8")
        (repo_dir / "src").mkdir()
        (repo_dir / "src" / "main.py").write_text(
            "def start():\n    return 'running'\n",
            encoding="utf-8",
        )
        self.project = upsert_project("repo", "https://github.com/test/repo.git", repo_dir, "scanned")
        set_setting("llm.enabled", "true")
        set_setting("llm.provider", "deepseek")
        set_setting("llm.base_url", "https://api.deepseek.com")
        set_setting("llm.model", "deepseek-test")
        set_setting("llm.api_key", "fake-key")

        self.client = TestClient(app)

    def tearDown(self):
        self._tmpdir.cleanup()

    def _course_dir(self):
        return self.generated / str(self.project.id)

    def test_file_lesson_failure_removes_placeholder(self):
        with patch(
            "app.services.generation_service.call_openai_compatible_chat",
            return_value="",
        ):
            response = self.client.post(
                f"/api/projects/{self.project.id}/lessons/file",
                json={"path": "src/main.py", "mode": "detailed", "instructions": ""},
            )

        self.assertEqual(response.status_code, 200)
        task = self.client.get(f"/api/projects/{self.project.id}/tasks/{response.json()['id']}").json()
        self.assertEqual(task["status"], "failed")
        self.assertEqual(task["stage_label"], "生成失败")

        leftovers = list(self._course_dir().glob("*main.py*detailed*.md"))
        self.assertEqual(leftovers, [], f"placeholder survived failed file_lesson: {leftovers}")

    def test_outline_lesson_failure_removes_placeholder(self):
        course_dir = self._course_dir()
        course_dir.mkdir(parents=True, exist_ok=True)
        (course_dir / "outline.md").write_text(
            "# 项目学习总纲\n\n### 第 1 课：入口与启动\n",
            encoding="utf-8",
        )
        from app.services.storage import upsert_lesson_files

        upsert_lesson_files(self.project.id, 1, [("src/main.py", "index")])

        invalid_plan = json.dumps(
            {"lesson_title": "入口与启动", "sections": [{"title": "只有一章", "items": ["start"]}]},
            ensure_ascii=False,
        )
        with patch(
            "app.services.generation_service.call_openai_compatible_chat",
            return_value=invalid_plan,
        ):
            response = self.client.post(
                f"/api/projects/{self.project.id}/lessons/outline",
                json={"lesson_number": 1, "title": "入口与启动", "instructions": "详细讲解"},
            )

        self.assertEqual(response.status_code, 200)
        task = self.client.get(f"/api/projects/{self.project.id}/tasks/{response.json()['id']}").json()
        self.assertEqual(task["status"], "failed")

        leftovers = list(course_dir.glob("lesson_*.md"))
        self.assertEqual(leftovers, [], f"placeholder survived failed outline_lesson: {leftovers}")

    def test_outline_failure_removes_placeholder_files(self):
        with patch(
            "app.services.generation_service.call_openai_compatible_chat",
            return_value="",
        ):
            response = self.client.post(
                f"/api/projects/{self.project.id}/outline/generate",
                json={"scope": {"type": "full_project", "paths": []}, "instructions": ""},
            )

        self.assertEqual(response.status_code, 200)
        task = self.client.get(f"/api/projects/{self.project.id}/tasks/{response.json()['id']}").json()
        self.assertEqual(task["status"], "failed")

        course_dir = self._course_dir()
        self.assertFalse((course_dir / "outline.md").exists(), "outline.md placeholder survived")
        self.assertFalse(
            (course_dir / "project_map.md").exists(), "project_map.md placeholder survived"
        )

    def test_cancelled_file_lesson_removes_placeholder(self):
        from app.services.generation_service import stream_file_lesson_generation

        async def cancel_stream(*_args, **_kwargs):
            raise asyncio.CancelledError
            yield  # pragma: no cover — make this an async generator so `async for` can drive it

        async def collect():
            events = []
            with patch("app.services.generation_service._stream_and_accumulate", cancel_stream):
                try:
                    async for event in stream_file_lesson_generation(
                        self.project.id, "src/main.py", "detailed",
                    ):
                        events.append(event)
                except asyncio.CancelledError:
                    pass
            return events

        asyncio.run(collect())

        import sqlite3

        db_path = self.workspace / "app.db"
        conn = sqlite3.connect(db_path)
        row = conn.execute(
            "SELECT id, status, stage_label FROM generation_tasks ORDER BY id DESC LIMIT 1"
        ).fetchone()
        conn.close()
        self.assertIsNotNone(row)
        self.assertEqual(row[1], "failed")
        self.assertEqual(row[2], "已取消")

        leftovers = list(self._course_dir().glob("*main.py*detailed*.md"))
        self.assertEqual(leftovers, [], f"placeholder survived cancelled file_lesson: {leftovers}")


if __name__ == "__main__":
    unittest.main()
