import asyncio
import json
import unittest
from unittest.mock import patch

from test_qa_records import _setup_temp_db
from app.models.schemas import QAAskRequest, SelectionRange
from app.services import qa_service as qa, storage


class QAUsabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp, self.workspace, generated = _setup_temp_db()
        self.addCleanup(self.temp.cleanup)
        root = self.workspace / "repo"
        root.mkdir()
        self.project = storage.upsert_project("test", "https://example.com/repo", root, "scanned")
        storage.set_setting("llm.enabled", "true")
        storage.set_setting("llm.api_key", "fake")
        p = patch.object(qa, "project_course_dir", lambda pid: generated / str(pid))
        p.start()
        self.addCleanup(p.stop)
        self.payload = QAAskRequest(source_type="file", source_path="example.py", selected_text="return a + b",
            question="解释返回值", defer_metadata=True,
            selection_range=SelectionRange(start_line=2, start_column=5, end_line=2, end_column=17))

    def test_history_title_retains_subject_words_without_changing_answer(self):
        question = "用两句话解释 Python 的 return 语句"
        title, body = qa._parse_answer_title("正文完整保留，包括推导和例子。", question, "", None)
        self.assertEqual(title, question)
        self.assertEqual(body, "正文完整保留，包括推导和例子。")

    def test_source_range_is_saved_and_returned_without_reading_source(self):
        from app.api.qa import _to_response
        with patch.object(qa, "read_text_file", side_effect=AssertionError("implicit read")):
            record = qa.finalize_question(qa.prepare_question(self.project.id, self.payload), "完整正文")
        restored = storage.get_qa_record(self.project.id, record.id)
        self.assertEqual(_to_response(restored).selection_range, self.payload.selection_range)
        self.assertEqual(restored.answer_md, "完整正文")

    def test_old_records_recover_range_from_existing_authorized_request(self):
        record = qa.finalize_question(qa.prepare_question(self.project.id, self.payload), "完整正文")
        with storage._connect() as conn, conn:
            conn.execute("ALTER TABLE qa_records DROP COLUMN selection_range_json")
        storage.init_storage()
        restored = storage.get_qa_record(self.project.id, record.id)
        self.assertEqual(json.loads(restored.selection_range_json), self.payload.selection_range.model_dump())

    def test_stopping_partial_stream_does_not_create_successful_answer(self):
        from app.api.qa import ask_stream
        async def model(*args, **kwargs):
            yield "未完成正文"
            await asyncio.Event().wait()
        async def scenario():
            response = await ask_stream(self.project.id, self.payload)
            iterator = response.body_iterator
            while "event: delta" not in await anext(iterator):
                pass
            await iterator.aclose()
        with patch("app.api.qa.stream_openai_compatible_chat", model):
            asyncio.run(scenario())
        self.assertEqual(storage.list_qa_records(self.project.id), [])
