import asyncio
import json
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from test_qa_records import _setup_temp_db
from app.models.schemas import QAAskRequest
from app.services import qa_service as qa, qa_background as background, storage


class DeferredMetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp, self.workspace, self.generated = _setup_temp_db()
        self.addCleanup(self.temp.cleanup)
        root = self.workspace / "repo"
        root.mkdir()
        (root / "private.py").write_text("UNAUTHORIZED_FILE", encoding="utf-8")
        self.project = storage.upsert_project("test", "https://example.com/test", root, "scanned")
        storage.set_setting("llm.enabled", "true")
        storage.set_setting("llm.api_key", "fake")
        p = patch.object(qa, "project_course_dir", lambda pid: self.generated / str(pid))
        p.start()
        self.addCleanup(p.stop)

    def payload(self):
        return QAAskRequest(source_type="file", source_path="private.py", selected_text="return x",
                            question="解释返回值", defer_metadata=True)

    def record(self, answer="`return` 返回结果。"):
        return qa.finalize_question(qa.prepare_question(self.project.id, self.payload()), answer)

    def test_body_prompt_and_save_do_not_wait_for_metadata_or_read_files(self):
        with (patch.object(qa, "read_text_file", side_effect=AssertionError("file read")),
              patch("app.services.qa_metadata.extract_answer_metadata", side_effect=AssertionError("metadata call"))):
            prepared = qa.prepare_question(self.project.id, self.payload())
            self.assertNotIn("## 元数据", prepared.messages[1]["content"])
            self.assertIn("existing_qa_topics", prepared.messages[1]["content"])
            record = qa.finalize_question(prepared, "`return` 返回结果。")
        self.assertEqual(record.answer_md, "`return` 返回结果。")
        with storage._connect() as conn:
            job = conn.execute("SELECT * FROM qa_postprocess_jobs WHERE qa_record_id=?", (record.id,)).fetchone()
        self.assertEqual(job["metadata_done"], 0)
        self.assertNotIn("UNAUTHORIZED_FILE", job["context_snapshot"])

    def test_deferred_prompt_preserves_all_substantive_instructions_and_inputs(self):
        from app.services.prompt_store import DEFAULT_QA_ANSWER_PROMPT
        prior = self.record("此前讲解中的例子、推导和边界。")
        storage.update_qa_session_memory(self.project.id, prior.session_id, "必须保留的较早约束 " + "内容" * 1200)
        payload = self.payload().model_copy(update={"session_id": prior.session_id})
        deferred = qa.prepare_question(self.project.id, payload)
        legacy = qa.prepare_question(self.project.id, payload.model_copy(update={"defer_metadata": False, "session_id": deferred.session_id}))
        metadata_section = "## 元数据" + DEFAULT_QA_ANSWER_PROMPT.split("## 元数据", 1)[1]
        self.assertEqual(deferred.messages[1]["content"].strip(), legacy.messages[1]["content"].replace(metadata_section, "").strip())
        self.assertEqual(deferred.settings, legacy.settings)
        self.assertIn("必须保留的较早约束", deferred.messages[1]["content"])
        self.assertIn("此前讲解中的例子、推导和边界", deferred.messages[1]["content"])
        self.assertIn("回答深度、推导、例子和限制条件按原任务要求决定", deferred.messages[0]["content"])

    def test_stream_completes_and_next_question_can_start_before_metadata(self):
        from app.api.qa import ask_stream
        requests = []
        async def model(*args, **kwargs):
            requests.append(args[3])
            yield "`"
            yield "return` 返回结果。"
            await asyncio.sleep(0.01)
        async def run():
            events = []
            for _ in range(2):
                response = await ask_stream(self.project.id, self.payload())
                events.append("".join([event async for event in response.body_iterator]))
            return events
        with (patch("app.api.qa.stream_openai_compatible_chat", model),
              patch.object(background, "dispatch_answer") as dispatch,
              patch("app.services.qa_metadata.extract_answer_metadata", side_effect=AssertionError("foreground metadata"))):
            events = asyncio.run(run())
        self.assertEqual(len(requests), 2)
        self.assertEqual(dispatch.call_count, 2)
        for event in events:
            self.assertIn("event: delta", event)
            self.assertIn("event: completed", event)
            self.assertNotIn("event: error", event)

    def test_crash_after_metadata_result_does_not_call_model_again(self):
        record = self.record()
        metadata = {"terms": [], "handoff": None}
        with (patch("app.services.qa_metadata.extract_answer_metadata", return_value=metadata) as extract,
              patch("app.services.continuity_service.persist_teaching_handoff", side_effect=OSError("interrupted"))):
            background._run(self.project.id, record.id)
        with storage._connect() as conn:
            self.assertEqual(conn.execute("SELECT status FROM qa_postprocess_jobs WHERE qa_record_id=?", (record.id,)).fetchone()[0], "failed")
        with (patch("app.services.qa_metadata.extract_answer_metadata", side_effect=AssertionError("repeat metadata")),
              patch.object(qa, "postprocess_answer") as evidence,
              patch("app.services.personalization.interaction_observer.schedule_interaction_observation"),
              patch("app.services.personalization.teaching.planner_scheduler._should_plan", return_value=False)):
            background._run(self.project.id, record.id)
            background._run(self.project.id, record.id)
        extract.assert_called_once()
        evidence.assert_called_once()
        with storage._connect() as conn:
            job = conn.execute("SELECT * FROM qa_postprocess_jobs WHERE qa_record_id=?", (record.id,)).fetchone()
        self.assertEqual((job["metadata_done"], job["status"]), (1, "completed"))

    def test_metadata_uses_entire_answer_and_saved_scope_without_reopening_files(self):
        from app.services.qa_metadata import extract_answer_metadata
        answer = "`return` 返回结果。\n尾部独有信息"
        record = self.record(answer)
        raw = json.dumps({"terms": [{"display_name": "return", "canonical_name": "return", "category": "symbol", "confidence": 0.9, "source_span": {"text": "return"}}], "handoff": None})
        with (patch("app.services.llm_client.call_openai_compatible_chat_result", return_value=SimpleNamespace(content=raw)) as model,
              patch.object(qa, "read_text_file", side_effect=AssertionError("file read"))):
            result = extract_answer_metadata(record, self.payload(), "AUTHORIZED_SNAPSHOT")
        transmitted = model.call_args.args[3][1]["content"]
        self.assertIn("尾部独有信息", transmitted)
        self.assertIn("AUTHORIZED_SNAPSHOT", transmitted)
        self.assertNotIn("UNAUTHORIZED_FILE", transmitted)
        self.assertEqual(result["terms"][0]["display_name"], "return")

    def test_old_background_handoff_does_not_overwrite_newer_learning_topic(self):
        from app.services.continuity_service import persist_teaching_handoff
        old, new = self.record(), self.record()
        def metadata(topic):
            return {"topic": topic, "progressSummary": "讲解主题", "establishedPoints": [],
                    "unresolvedPoints": [], "nextActions": [], "usedPriorContext": False}
        persist_teaching_handoff(new, metadata("新的主题"))
        persist_teaching_handoff(old, metadata("旧的主题"))
        self.assertEqual(storage.get_current_teaching_handoff(self.project.id).qa_record_id, new.id)

    def test_term_polling_continues_until_deferred_metadata_is_applied(self):
        from app.services.term_service import get_document_term_status
        record = self.record()
        path = str(record.output_path)
        self.assertEqual(get_document_term_status(self.project.id, "qa", path)["scan_status"], "queued")
        with storage._connect() as conn, conn:
            conn.execute("UPDATE qa_postprocess_jobs SET status='running' WHERE qa_record_id=?", (record.id,))
        self.assertEqual(get_document_term_status(self.project.id, "qa", path)["scan_status"], "running")
        with (patch("app.services.qa_metadata.extract_answer_metadata", return_value={"terms": [], "handoff": None}),
              patch("app.services.personalization.interaction_observer.schedule_interaction_observation"),
              patch("app.services.personalization.teaching.planner_scheduler._should_plan", return_value=False)):
            background._run(self.project.id, record.id)
        self.assertNotIn(get_document_term_status(self.project.id, "qa", path)["scan_status"], ["queued", "running"])


class BackgroundPriorityTests(unittest.TestCase):
    def test_stream_closed_from_another_task_releases_background_work(self):
        from app.services.qa_work_scheduler import foreground_work, background_work, wait_before_model_request
        ready, sent = threading.Event(), threading.Event()
        def background_request():
            with background_work():
                ready.set()
                wait_before_model_request()
                sent.set()
        thread = threading.Thread(target=background_request, daemon=True)
        async def stream():
            with foreground_work():
                yield "正文"
        async def scenario():
            response = stream()
            self.assertEqual(await anext(response), "正文")
            thread.start()
            self.assertTrue(ready.wait(1))
            self.assertFalse(sent.wait(0.03))
            await asyncio.create_task(response.aclose())
            self.assertTrue(sent.wait(1))
        asyncio.run(scenario())
        thread.join(1)

    def test_background_request_yields_to_foreground_and_exception_releases_it(self):
        from app.services.qa_work_scheduler import foreground_work, background_work, wait_before_model_request
        ready, sent = threading.Event(), threading.Event()
        def background_request():
            with background_work():
                ready.set()
                wait_before_model_request()
                sent.set()
        thread = threading.Thread(target=background_request, daemon=True)
        with self.assertRaisesRegex(RuntimeError, "cancelled"):
            with foreground_work():
                thread.start()
                self.assertTrue(ready.wait(1))
                self.assertFalse(sent.wait(0.03))
                # Foreground model calls are never gated by background work.
                wait_before_model_request()
                raise RuntimeError("cancelled")
        self.assertTrue(sent.wait(1))
        thread.join(1)


class AnswerSummaryCacheTests(unittest.TestCase):
    setUp = DeferredMetadataTests.setUp
    payload = DeferredMetadataTests.payload
    record = DeferredMetadataTests.record
    def test_shared_summary_reuses_completed_segments_after_failure(self):
        from app.services.qa_answer_context import complete_answer_context
        record = self.record("A" * 24000 + "TAIL_FACT")
        settings = {"base_url": "https://example.com", "api_key": "fake", "model": "test"}
        ids = {"project_id": self.project.id, "qa_record_id": record.id}
        with patch("app.services.llm_client.call_openai_compatible_chat", side_effect=["first summary", RuntimeError("retry")]) as first:
            with self.assertRaisesRegex(RuntimeError, "retry"):
                complete_answer_context(record.answer_md, settings, **ids)
        self.assertEqual(first.call_count, 2)
        with patch("app.services.llm_client.call_openai_compatible_chat", side_effect=["second summary", "TAIL_FACT"]) as retry:
            summary = complete_answer_context(record.answer_md, settings, **ids)
            self.assertEqual(complete_answer_context(record.answer_md, settings, **ids), summary)
        self.assertEqual(retry.call_count, 2)
        self.assertIn("TAIL_FACT", summary)
        self.assertEqual(retry.call_args.args[3][1]["content"], "TAIL_FACT")
        storage.delete_qa_record(self.project.id, record.id)
        with storage._connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM qa_answer_context_cache").fetchone()[0], 0)
