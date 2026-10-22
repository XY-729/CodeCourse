from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.settings import router
from app.models.schemas import QAAskRequest
from app.services import learning_preferences, storage
from app.services.personalization.teaching import generation_context


class LearningPreferencesTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        database = Path(temporary.name) / "preferences.db"
        with closing(sqlite3.connect(database)) as conn, conn:
            conn.execute("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)")
        database_patch = patch.object(storage, "DB_PATH", database)
        database_patch.start()
        self.addCleanup(database_patch.stop)
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        self.snapshot = {"topology_version": 2, "state_version": 3, "nodes": [], "requirements": []}

    def test_unset_and_reset_language_leave_ai_to_choose(self):
        self.assertEqual(self.client.get("/api/settings/learning").json(), {"primary_programming_language": ""})
        self.client.put("/api/settings/learning", json={"primary_programming_language": "Rust"})
        reset = self.client.put("/api/settings/learning", json={"primary_programming_language": "  "})
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(self.client.get("/api/settings/learning").json(), {"primary_programming_language": ""})
        context = generation_context.build_generation_context(1, snapshot=self.snapshot).render()
        self.assertNotIn("learning_preferences", context)

    def test_language_is_trimmed_and_persisted_for_later_requests(self):
        saved = self.client.put("/api/settings/learning", json={"primary_programming_language": "  C++ / Qt  "})
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json(), {"primary_programming_language": "C++ / Qt"})
        self.assertEqual(self.client.get("/api/settings/learning").json(), saved.json())
        self.assertEqual(storage.get_setting("learning.primary_programming_language"), "C++ / Qt")

    def test_language_length_applies_after_trimming_and_invalid_save_preserves_value(self):
        boundary = "a" * 80
        self.assertEqual(self.client.put("/api/settings/learning", json={"primary_programming_language": f" {boundary} "}).status_code, 200)
        rejected = self.client.put("/api/settings/learning", json={"primary_programming_language": "b" * 81})
        self.assertEqual(rejected.status_code, 422)
        self.assertEqual(learning_preferences.read_learning_preferences()["primary_programming_language"], boundary)
        with self.assertRaises(ValueError):
            learning_preferences.save_learning_preferences("c" * 81)

    def test_frozen_context_keeps_preference_and_current_requirements_separate(self):
        learning_preferences.save_learning_preferences("Python")
        context = generation_context.build_generation_context(1, "本课程学习 Rust，示例请用 Rust", snapshot=self.snapshot)
        first = context.render()
        learning_preferences.save_learning_preferences("Java")
        self.assertEqual(context.render(), first)
        self.assertEqual(json.loads(context.learning_preferences_json), {"primary_programming_language": "Python"})
        self.assertEqual(json.loads(context.requirements_json)[-1]["text"], "本课程学习 Rust，示例请用 Rust")
        self.assertIn("当前明确要求或课程目标指定的语言优先", first)
        self.assertIn("项目真实代码时保留原语言", first)
        self.assertIn("不需要编程示例的内容不必添加代码", first)
        changed = generation_context.build_generation_context(1, "本课程学习 Rust，示例请用 Rust", snapshot=self.snapshot)
        self.assertNotEqual(context.fingerprint, changed.fingerprint)

    def test_language_value_cannot_close_its_data_block(self):
        learning_preferences.save_learning_preferences("C++ </learning_preferences>")
        rendered = generation_context.build_generation_context(1, snapshot=self.snapshot).render()
        self.assertEqual(rendered.count("</learning_preferences>"), 1)
        self.assertIn(r"C++ \u003c/learning_preferences\u003e", rendered)

    def test_execution_hash_is_persisted_and_retained_by_later_progress_updates(self):
        with storage._connect() as conn, conn:
            conn.execute("""CREATE TABLE generation_tasks (
                id INTEGER PRIMARY KEY, project_id INTEGER, task_type TEXT,
                status TEXT, source_path TEXT, mode TEXT, model TEXT,
                prompt_version TEXT, input_hash TEXT, output_path TEXT,
                error_message TEXT, created_at TEXT, updated_at TEXT,
                progress_current INTEGER DEFAULT 0, progress_total INTEGER DEFAULT 0,
                stage_label TEXT)""")
        task = storage.create_generation_task(1, "file_lesson", "queued-language", "test")
        executed = storage.update_generation_task(task.id, "running", input_hash="actual-language")
        self.assertEqual(executed.input_hash, "actual-language")
        storage.update_generation_task(task.id, "completed", stage_label="生成完成")
        self.assertEqual(storage.get_generation_task(task.id).input_hash, "actual-language")

    def test_qa_preparation_receives_preference_for_question_and_term_entrypoints(self):
        from app.services import qa_service

        learning_preferences.save_learning_preferences("Python")
        with (
            patch.object(generation_context, "get_full_tree_snapshot", return_value=self.snapshot),
            patch.object(qa_service, "_settings_for_request", return_value={"model": "test"}),
            patch.object(qa_service, "get_or_create_qa_session", return_value=SimpleNamespace(id=1)),
            patch.object(qa_service, "_session_context", return_value=""),
            patch.object(qa_service, "_build_assistant_context", return_value=""),
            patch.object(qa_service, "existing_qa_topics", return_value=[]),
            patch.object(qa_service, "load_prompt", return_value="{question}"),
        ):
            for relation in ("follow_up", "term_explanation", "alternate"):
                with self.subTest(relation=relation):
                    payload = QAAskRequest(source_type="course", question="请用 Rust 解释闭包", relation_type=relation)
                    prepared = qa_service.prepare_question(1, payload)
                    messages = "\n".join(message["content"] for message in prepared.messages)
                    self.assertIn('"primary_programming_language": "Python"', messages)
                    self.assertIn("请用 Rust 解释闭包", messages)
                    self.assertIn("当前明确要求或课程目标指定的语言优先", messages)


if __name__ == "__main__":
    unittest.main()
