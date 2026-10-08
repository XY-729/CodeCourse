import asyncio
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from test_qa_records import _setup_temp_db
from app.models.schemas import QAAskRequest, SelectionRange
from app.services import qa_service as qa
from app.services import qa_background as background


class FastQATests(unittest.TestCase):
    def setUp(self):
        self.temp, self.workspace, generated = _setup_temp_db()
        from app.services.storage import upsert_project, set_setting
        root = self.workspace / "repo"
        root.mkdir()
        (root / "selected.py").write_text("EXPLICIT_ATTACHMENT", encoding="utf-8")
        (root / "source.py").write_text("PRIVATE_SURROUNDINGS", encoding="utf-8")
        self.project = upsert_project("fast", "https://example.com/repo", root, "scanned")
        set_setting("llm.enabled", "true")
        set_setting("llm.api_key", "fake")
        self.patcher = patch.object(qa, "project_course_dir", lambda pid: generated / str(pid))
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.addCleanup(self.temp.cleanup)

    def payload(self, **kwargs):
        return QAAskRequest(source_type="file", source_path="source.py", selected_text="print(1)",
                            question="解释这个选区", **kwargs)

    def test_default_does_not_read_retrieve_plan_or_create_concepts(self):
        with (patch.object(qa, "read_text_file", side_effect=AssertionError("file read")),
              patch.object(qa, "_retrieval_context", side_effect=AssertionError("retrieval")),
              patch.object(qa, "_maybe_plan_teaching", side_effect=AssertionError("planner")),
              patch("app.services.personalization_service.resolve_concept", side_effect=AssertionError("mutation"))):
            prepared = qa.prepare_question(self.project.id, self.payload(selection_range=SelectionRange(start_line=1, end_line=1)))
        text = str(prepared.messages)
        self.assertIn("print(1)", text)
        self.assertNotIn("PRIVATE_SURROUNDINGS", text)

    def test_explicit_files_do_not_expand_to_source(self):
        prepared = qa.prepare_question(self.project.id, self.payload(context_files=["selected.py"]))
        self.assertIn("EXPLICIT_ATTACHMENT", str(prepared.messages))
        self.assertNotIn("PRIVATE_SURROUNDINGS", str(prepared.messages))
        with self.assertRaises(RuntimeError):
            qa.prepare_question(self.project.id, self.payload(context_files=["../outside.txt"]))

    def test_opt_in_context_and_files_can_be_combined(self):
        with patch.object(qa, "_retrieval_context", return_value=("RETRIEVAL", "", [])) as retrieve:
            prepared = qa.prepare_question(self.project.id, self.payload(include_context=True,
                context_files=["selected.py"], selection_range=SelectionRange(start_line=1, end_line=1)))
        retrieve.assert_called_once()
        for expected in ["PRIVATE_SURROUNDINGS", "EXPLICIT_ATTACHMENT", "RETRIEVAL"]:
            self.assertIn(expected, str(prepared.messages))

    def test_complete_answer_is_saved_before_idempotent_background_work(self):
        prepared = qa.prepare_question(self.project.id, self.payload())
        answer = "开头" + "完整内容" * 1000 + "尾部独有信息"
        with patch.object(qa, "record_question_learning") as evidence:
            record = qa.finalize_question(prepared, answer + "\nTITLE: 完整回答")
            evidence.assert_not_called()
            self.assertEqual(record.answer_md, answer)
            with (patch("app.services.personalization.interaction_observer.schedule_interaction_observation"),
                  patch("app.services.personalization.teaching.planner_scheduler._should_plan", return_value=False)):
                background._run(self.project.id, record.id)
                background._run(self.project.id, record.id)
            evidence.assert_called_once()
        self.assertNotIn("PRIVATE_SURROUNDINGS", background.authorized_context(self.project.id, record.id))
        self.assertEqual(background.complete_answer_context(answer, {}), answer)

    def test_large_answer_reduction_covers_tail_and_every_chunk(self):
        answer = "A" * 24000 + "FINAL_DISTINCT_FACT"
        with patch("app.services.llm_client.call_openai_compatible_chat", return_value="segment summary") as model:
            background.complete_answer_context(answer, {"base_url": "url", "api_key": "key", "model": "model"})
        transmitted = "".join(call.args[3][1]["content"] for call in model.call_args_list)
        self.assertEqual(transmitted, answer)

    def test_first_delta_is_available_before_model_completion(self):
        from app.api.qa import ask_stream
        finished = False
        async def model(*args, **kwargs):
            nonlocal finished
            yield "首段正文"
            await asyncio.sleep(0.05)
            finished = True
            yield "\n第二段\nTITLE: 测试\nTERMS: []"
        async def scenario():
            response = await ask_stream(self.project.id, self.payload())
            iterator = response.body_iterator
            while True:
                event = await anext(iterator)
                if "event: delta" in event:
                    self.assertIn("首段正文", event)
                    self.assertFalse(finished)
                    break
            remainder = "".join([event async for event in iterator])
            self.assertIn("event: completed", remainder)
        with (patch("app.api.qa.stream_openai_compatible_chat", model),
              patch.object(background, "dispatch_answer")):
            asyncio.run(scenario())

    def test_title_inside_code_is_preserved(self):
        title, body = qa._parse_answer_title("```text\nTITLE: literal\n```\n正文\nTITLE: 真正标题", "问题", "", None)
        self.assertEqual(title, "真正标题")
        self.assertIn("TITLE: literal", body)

    def test_failed_save_does_not_leave_a_successful_record_or_job(self):
        from app.services.storage import list_qa_records, _connect
        prepared = qa.prepare_question(self.project.id, self.payload())
        with patch.object(qa, "_write_record_markdown", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                qa.finalize_question(prepared, "正文")
        self.assertEqual(list_qa_records(self.project.id), [])
        with _connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM qa_postprocess_jobs").fetchone()[0], 0)

    def test_deleted_answer_discards_authorized_snapshot(self):
        from app.services.storage import delete_qa_record
        prepared = qa.prepare_question(self.project.id, self.payload(context_files=["selected.py"]))
        record = qa.finalize_question(prepared, "正文")
        self.assertIn("EXPLICIT_ATTACHMENT", background.authorized_context(self.project.id, record.id))
        delete_qa_record(self.project.id, record.id)
        self.assertEqual(background.authorized_context(self.project.id, record.id), "")


if __name__ == "__main__":
    unittest.main()
