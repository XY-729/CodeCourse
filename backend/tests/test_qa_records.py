"""Tests for persistent selected-text QA records."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


def _setup_temp_db():
    import app.core.config as cfg
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

    storage.init_storage()
    return tmpdir, workspace, generated


def _generated_file(generated: Path, project_id: int, output_path: str) -> Path:
    path = Path(output_path)
    if path.is_absolute():
        return path
    return generated / str(project_id) / path


class QARecordEndpointTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir, self.workspace, self.generated = _setup_temp_db()

        import app.services.generation_service as generation_service
        import app.services.qa_service as qa_service
        from app.main import app

        generation_service.GENERATED_ROOT = self.generated
        qa_service.project_course_dir = lambda project_id: (self.generated / str(project_id)).resolve()
        self.client = TestClient(app)

        from app.services.storage import set_setting, upsert_project

        repo_dir = self.workspace / "repos" / "repo"
        repo_dir.mkdir(parents=True)
        (repo_dir / "README.md").write_text("# Test\n", encoding="utf-8")
        (repo_dir / "src").mkdir()
        (repo_dir / "src" / "main.py").write_text(
            "from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get('/')\ndef health():\n    return {'ok': True}\n",
            encoding="utf-8",
        )
        self.project = upsert_project("repo", "https://github.com/test/repo.git", repo_dir, "scanned")
        set_setting("llm.enabled", "true")
        set_setting("llm.api_key", "fake-key")

    def tearDown(self):
        self._tmpdir.cleanup()

    def test_ask_creates_record_and_markdown_file(self):
        model_answer = "TITLE: main 函数返回值说明\n\n## 结论\nUse the selected function."
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value=model_answer):
            resp = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "file",
                    "source_path": "src/main.py",
                    "selected_text": "def main():\n    return 1",
                    "question": "这段代码负责什么？",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["source_path"], "src/main.py")
        self.assertEqual(data["display_title"], "def main")
        self.assertNotIn("TITLE:", data["answer_md"])
        self.assertIn("Use the selected function.", data["answer_md"])

        output_path = _generated_file(self.generated, self.project.id, data["output_path"])
        self.assertTrue(output_path.is_file())
        text = output_path.read_text(encoding="utf-8")
        self.assertIn("# def main", text)
        self.assertIn("这段代码负责什么？", text)
        self.assertIn("Use the selected function.", text)
        self.assertIn("## 附带上下文", text)
        self.assertGreater(text.find("## 记录信息"), text.find("## 回答"))
        self.assertGreater(text.find("来源类型"), text.find("## 记录信息"))

    def test_generic_question_uses_selection_and_source_for_fallback_title(self):
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="## 结论\n这是后端框架线索。"):
            resp = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "course",
                    "source_path": "project_map.md",
                    "selected_text": "FastAPI",
                    "question": "这是什么",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["display_title"], "FastAPI")
        self.assertNotEqual(data["display_title"], "这是什么说明")

    def test_search_favorite_and_edit_update_markdown(self):
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="初始回答"):
            created = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "course",
                    "source_path": "outline.md",
                    "selected_text": "学习总纲",
                    "question": "如何开始？",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            ).json()

        fav = self.client.post(f"/api/projects/{self.project.id}/qa/{created['id']}/favorite", json={"favorite": True})
        self.assertEqual(fav.status_code, 200)
        self.assertTrue(fav.json()["favorite"])

        filtered = self.client.get(f"/api/projects/{self.project.id}/qa?query=开始&favorite=true")
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(len(filtered.json()), 1)

        edited = self.client.put(
            f"/api/projects/{self.project.id}/qa/{created['id']}",
            json={"answer_md": "编辑后的 Markdown 回答"},
        )
        self.assertEqual(edited.status_code, 200)
        output_path = _generated_file(self.generated, self.project.id, edited.json()["output_path"])
        self.assertIn("编辑后的 Markdown 回答", output_path.read_text(encoding="utf-8"))

    def test_missing_api_key_does_not_create_empty_record(self):
        with patch("app.services.qa_service.get_llm_settings", return_value={"enabled": "false", "api_key": ""}):
            resp = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "file",
                    "source_path": "src/main.py",
                    "selected_text": "print('x')",
                    "question": "解释",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(resp.status_code, 400)
        history = self.client.get(f"/api/projects/{self.project.id}/qa")
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json(), [])

    def test_empty_selection_is_allowed_and_written_as_placeholder(self):
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="Answer without a selection."):
            resp = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "selection",
                    "source_path": None,
                    "selected_text": "",
                    "question": "How should I start?",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["selected_text"], "")
        output_path = _generated_file(self.generated, self.project.id, data["output_path"])
        self.assertIn("无附带上下文", output_path.read_text(encoding="utf-8"))

    def test_file_context_without_selection_uses_file_summary(self):
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="TITLE: main.py\n\n这个文件提供健康检查接口。") as mocked:
            resp = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "file",
                    "source_path": "src/main.py",
                    "selected_text": "",
                    "question": "这个文件是干什么用的？",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(resp.status_code, 200)
        messages = mocked.call_args.args[3]
        prompt = messages[1]["content"]
        self.assertIn("上下文类型：当前代码文件", prompt)
        self.assertIn("src/main.py", prompt)
        self.assertIn("FastAPI", prompt)
        self.assertIn("health", prompt)

    def test_course_context_without_selection_uses_course_summary(self):
        course_dir = self.generated / str(self.project.id)
        course_dir.mkdir(parents=True, exist_ok=True)
        (course_dir / "outline.md").write_text("# 项目学习总纲\n\n从 FastAPI 路由开始读。", encoding="utf-8")

        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="TITLE: outline.md\n\n先按总纲读入口。") as mocked:
            resp = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "course",
                    "source_path": "outline.md",
                    "selected_text": "",
                    "question": "这个课件怎么学？",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(resp.status_code, 200)
        messages = mocked.call_args.args[3]
        prompt = messages[1]["content"]
        self.assertIn("上下文类型：当前课件", prompt)
        self.assertIn("outline.md", prompt)
        self.assertIn("从 FastAPI 路由开始读", prompt)

    def test_rename_history_updates_display_title_only(self):
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="Answer."):
            created = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "course",
                    "source_path": "outline.md",
                    "selected_text": "scope",
                    "question": "Original question",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            ).json()

        renamed = self.client.put(
            f"/api/projects/{self.project.id}/qa/{created['id']}",
            json={"display_title": "Renamed history item"},
        )

        self.assertEqual(renamed.status_code, 200)
        data = renamed.json()
        self.assertEqual(data["display_title"], "Renamed history item")
        self.assertEqual(data["question"], "Original question")
        output_path = _generated_file(self.generated, self.project.id, data["output_path"])
        self.assertIn("Renamed history item", output_path.read_text(encoding="utf-8"))

    def test_highlight_create_list_and_delete(self):
        created = self.client.post(
            f"/api/projects/{self.project.id}/highlights",
            json={
                "source_type": "course",
                "source_path": "outline.md",
                "selected_text": "Important concept",
                "color": "#fff59d",
            },
        )

        self.assertEqual(created.status_code, 200)
        highlight = created.json()
        self.assertEqual(highlight["selected_text"], "Important concept")

        listed = self.client.get(f"/api/projects/{self.project.id}/highlights?source_type=course&source_path=outline.md")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()), 1)

        deleted = self.client.delete(f"/api/projects/{self.project.id}/highlights/{highlight['id']}")
        self.assertEqual(deleted.status_code, 200)

        listed_again = self.client.get(f"/api/projects/{self.project.id}/highlights?source_type=course&source_path=outline.md")
        self.assertEqual(listed_again.status_code, 200)
        self.assertEqual(listed_again.json(), [])

    def test_prompt_api_exposes_qa_answer_prompt(self):
        resp = self.client.get("/api/settings/prompts")

        self.assertEqual(resp.status_code, 200)
        prompts = resp.json()
        self.assertEqual(
            list(prompts.keys()),
            [
                "prompt.system",
                "prompt.file_lesson.detailed_expected",
                "prompt.file_lesson.brief_expected",
                "prompt.qa.answer",
            ],
        )
        self.assertNotIn("prompt.outline", prompts)
        self.assertNotIn("prompt.file_lesson.template", prompts)
        self.assertIn("prompt.qa.answer", prompts)
        self.assertIn("TITLE:", prompts["prompt.qa.answer"])
        self.assertIn("刚开始读这个项目的小白开发者", prompts["prompt.qa.answer"])
        self.assertIn("上下文材料", prompts["prompt.qa.answer"])
        self.assertIn("项目内置的 AI 助手", prompts["prompt.qa.answer"])
        self.assertIn("只写核心名词或最短主题", prompts["prompt.qa.answer"])


if __name__ == "__main__":
    unittest.main()
