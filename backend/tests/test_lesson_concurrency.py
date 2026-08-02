"""Tests for concurrent lesson generation and task progress reporting."""

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


class RepositoryLessonConcurrencyTests(unittest.TestCase):
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

        course_dir = self.generated / str(self.project.id)
        course_dir.mkdir(parents=True, exist_ok=True)
        (course_dir / "outline.md").write_text(
            "# 项目学习总纲\n\n### 第 1 课：入口与启动\n\n"
            "必须完整讲解：start、运行入口、启动流程。\n",
            encoding="utf-8",
        )

        self.client = TestClient(app)

    def tearDown(self):
        self._tmpdir.cleanup()

    def _plan(self):
        return json.dumps(
            {
                "lesson_title": "入口与启动",
                "position": "理解程序从何处启动。",
                "objectives": ["能够解释 start 的调用链"],
                "sections": [
                    {"title": "启动入口", "items": [{"name": "start", "kind": "function", "focus": "入口函数"}]},
                    {"title": "启动流程", "items": [{"name": "运行入口", "kind": "concept", "focus": "程序起点"}]},
                    {"title": "错误处理", "items": [{"name": "启动失败", "kind": "concept", "focus": "异常路径"}]},
                    {"title": "验证方式", "items": [{"name": "验证启动", "kind": "concept", "focus": "如何验证"}]},
                ],
            },
            ensure_ascii=False,
        )

    def _responses(self):
        return [
            self._plan(),
            "## 启动入口\n\n### start\n\n入口函数，程序从这里开始执行。",
            "## 启动流程\n\n### 运行入口\n\n从 main 进入，调用 start。",
            "## 错误处理\n\n### 启动失败\n\n异常会记录并退出。",
            "## 验证方式\n\n### 验证启动\n\n运行命令验证。",
            "## 综合串联\n\nstart 是唯一入口，失败时记录日志。\n\n## 本课小结\n\n从入口到验证的完整路径。",
        ]

    def test_repository_lesson_is_generated_in_concurrent_sections_with_progress(self):
        from app.services.storage import upsert_lesson_files

        upsert_lesson_files(self.project.id, 1, [("src/main.py", "index")])
        responses = self._responses()

        with patch(
            "app.services.generation_service.call_openai_compatible_chat",
            side_effect=responses,
        ) as mocked:
            created = self.client.post(
                f"/api/projects/{self.project.id}/lessons/outline",
                json={"lesson_number": 1, "title": "入口与启动", "instructions": "详细讲解"},
            )

        self.assertEqual(created.status_code, 200)
        task_id = created.json()["id"]
        task = self.client.get(f"/api/projects/{self.project.id}/tasks/{task_id}").json()
        self.assertEqual(task["status"], "completed")
        self.assertEqual(task["progress_current"], 6)
        self.assertEqual(task["progress_total"], 6)
        self.assertEqual(task["stage_label"], "生成完成")
        self.assertEqual(mocked.call_count, 6)

        planner_prompt = mocked.call_args_list[0].args[3][1]["content"]
        self.assertIn("章节规划", planner_prompt)
        self.assertIn("4-10 个章节", planner_prompt)

        section_prompt = mocked.call_args_list[1].args[3][1]["content"]
        self.assertIn("核心正文章节", section_prompt)
        self.assertIn("src/main.py", section_prompt)
        self.assertIn("RAG 索引检索片段", section_prompt)

        lesson_path = self.generated / str(self.project.id) / "lessons" / "lesson_01.md"
        lesson = lesson_path.read_text(encoding="utf-8")
        self.assertIn("# 第 1 课：入口与启动", lesson)
        for item in ("启动入口", "启动流程", "错误处理", "验证方式"):
            self.assertIn(item, lesson)
        self.assertIn("## 本课目标", lesson)
        self.assertIn("本课定位", lesson)

    def test_repository_lesson_failure_keeps_previous_file(self):
        lesson_dir = self.generated / str(self.project.id) / "lessons"
        lesson_dir.mkdir(parents=True, exist_ok=True)
        output_path = lesson_dir / "lesson_01.md"
        output_path.write_text("# 旧课件\n\n保留我。\n", encoding="utf-8")

        invalid_plan = json.dumps(
            {"lesson_title": "入口与启动", "sections": [{"title": "只有一章", "items": ["start"]}]},
            ensure_ascii=False,
        )

        with patch(
            "app.services.generation_service.call_openai_compatible_chat",
            return_value=invalid_plan,
        ):
            created = self.client.post(
                f"/api/projects/{self.project.id}/lessons/outline",
                json={"lesson_number": 1, "title": "入口与启动", "instructions": "详细讲解"},
            )

        task_id = created.json()["id"]
        task = self.client.get(f"/api/projects/{self.project.id}/tasks/{task_id}").json()
        self.assertEqual(task["status"], "failed")
        self.assertEqual(task["stage_label"], "生成失败")
        self.assertEqual(output_path.read_text(encoding="utf-8"), "# 旧课件\n\n保留我。\n")

    def test_evidence_preview_self_heals_empty_lesson_file_list(self):
        preview = self.client.post(
            f"/api/projects/{self.project.id}/lessons/outline/evidence",
            json={"lesson_number": 1, "title": "入口与启动", "instructions": ""},
        )
        self.assertEqual(preview.status_code, 200)
        payload = preview.json()
        self.assertTrue(payload["ready"])
        self.assertGreaterEqual(payload["file_count"], 1)
        self.assertGreaterEqual(payload["snippet_count"], 1)
        self.assertIn("README.md", payload["included"])

    def test_zero_code_evidence_blocks_generation_before_model_call(self):
        (Path(self.project.local_path) / "README.md").unlink()
        (Path(self.project.local_path) / "src" / "main.py").unlink()
        with patch("app.services.generation_service.call_openai_compatible_chat") as mocked:
            response = self.client.post(
                f"/api/projects/{self.project.id}/lessons/outline",
                json={"lesson_number": 1, "title": "入口与启动", "instructions": ""},
            )
        self.assertEqual(response.status_code, 409)
        self.assertIn("重新构建索引", response.json()["detail"])
        mocked.assert_not_called()


class OutlineProgressTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir, self.workspace, self.generated = _setup_temp_workspace()

        from app.main import app
        from app.services.storage import set_setting, upsert_project

        repo_dir = self.workspace / "repos" / "repo"
        repo_dir.mkdir(parents=True)
        (repo_dir / "README.md").write_text("# Repo\n", encoding="utf-8")
        self.project = upsert_project("repo", "https://github.com/test/repo.git", repo_dir, "scanned")
        set_setting("llm.enabled", "true")
        set_setting("llm.provider", "deepseek")
        set_setting("llm.base_url", "https://api.deepseek.com")
        set_setting("llm.model", "deepseek-test")
        set_setting("llm.api_key", "fake-key")

        self.client = TestClient(app)

    def tearDown(self):
        self._tmpdir.cleanup()

    def test_outline_task_reports_four_step_progress(self):
        generated = "# 项目学习总纲\n\n## FILE: project_map.md\n\n# 项目结构说明\n\n## FILE: outline.md\n\n# 学习路线\n\n### 第 1 课：启动\n\n讲解启动流程。"
        with patch(
            "app.services.generation_service.call_openai_compatible_chat",
            return_value=generated,
        ):
            task = self.client.post(
                f"/api/projects/{self.project.id}/outline/generate",
                json={"scope": {"type": "full_project", "paths": []}, "instructions": ""},
            )

        task_id = task.json()["id"]
        task_detail = self.client.get(f"/api/projects/{self.project.id}/tasks/{task_id}").json()
        self.assertEqual(task_detail["status"], "completed")
        self.assertEqual(task_detail["progress_current"], 4)
        self.assertEqual(task_detail["progress_total"], 4)
        self.assertEqual(task_detail["stage_label"], "生成完成")
        self.assertTrue((self.generated / str(self.project.id) / "outline.md").is_file())

        from app.services.storage import get_lesson_files

        self.assertTrue(get_lesson_files(self.project.id, 1))

    def test_streaming_outline_also_persists_ranked_lesson_files(self):
        from app.models.schemas import LearningScopeRequest
        from app.services.generation_service import stream_outline_generation
        from app.services.storage import get_lesson_file_records

        generated = "# 项目学习总纲\n\n## FILE: project_map.md\n\n# 项目结构说明\n\n## FILE: outline.md\n\n# 学习路线\n\n### 第 1 课：启动\n\n讲解启动流程。"

        async def fake_stream(*_args, **_kwargs):
            yield {"event": "accumulated", "data": {"text": generated}}

        async def collect():
            with patch("app.services.generation_service._stream_and_accumulate", fake_stream):
                return [
                    event async for event in stream_outline_generation(
                        self.project.id,
                        LearningScopeRequest(type="full_project", paths=[]),
                    )
                ]

        events = asyncio.run(collect())
        self.assertTrue(any(event["event"] == "completed" for event in events))
        records = get_lesson_file_records(self.project.id, 1)
        self.assertTrue(records)
        self.assertEqual([row["relevance_rank"] for row in records], list(range(len(records))))


class FileLessonProgressTests(unittest.TestCase):
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

    def test_file_lesson_task_reports_three_step_progress(self):
        with patch(
            "app.services.generation_service.call_openai_compatible_chat",
            return_value="# 详细分析：main.py\n\n## 职责\n\n启动应用。",
        ):
            task = self.client.post(
                f"/api/projects/{self.project.id}/lessons/file",
                json={"path": "src/main.py", "mode": "detailed", "instructions": ""},
            )

        task_id = task.json()["id"]
        task_detail = self.client.get(f"/api/projects/{self.project.id}/tasks/{task_id}").json()
        self.assertEqual(task_detail["status"], "completed")
        self.assertEqual(task_detail["progress_current"], 3)
        self.assertEqual(task_detail["progress_total"], 3)
        self.assertEqual(task_detail["stage_label"], "生成完成")


if __name__ == "__main__":
    unittest.main()
