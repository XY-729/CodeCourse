"""Regressions for latency caused by buffering and oversized QA history reads."""

import sqlite3
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from app.services.metadata_stream import StreamingMetadataFilter
from test_qa_records import _setup_temp_db


class StreamingPrefixTests(unittest.TestCase):
    def test_ordinary_words_starting_with_metadata_names_are_not_buffered(self):
        for prefix, suffix in [("术语", "解释如下"), ("TITLE", " means a heading"),
                               ("TERMS", " used in Python"), ("HANDOFF", " between threads")]:
            with self.subTest(prefix=prefix):
                stream = StreamingMetadataFilter()
                self.assertEqual(stream.push(prefix), [])
                self.assertEqual(stream.push(suffix), [prefix + suffix])
                self.assertEqual(stream.finish(), [])

    def test_inline_code_and_tildes_stream_before_line_or_response_ends(self):
        for prefix, text in [("`", "return"), ("``", "a`b"), ("~", "5 秒"), ("~~", "旧方法")]:
            with self.subTest(prefix=prefix):
                stream = StreamingMetadataFilter()
                for char in prefix:
                    self.assertEqual(stream.push(char), [])
                self.assertEqual("".join(stream.push(text)), prefix + text)
                self.assertEqual(stream.push(" 后续正文"), [" 后续正文"])
                self.assertEqual(stream.finish(), [])

    def test_inline_body_is_visible_while_trailing_metadata_is_still_arriving(self):
        stream = StreamingMetadataFilter()
        self.assertEqual(stream.push("`return` 返回结果。"), ["`return` 返回结果。"])
        output = "".join(piece for char in '\nTITLE: 返回\nTERMS: []\nHANDOFF: {"topic":"返回"}'
                         for piece in stream.push(char)) + "".join(stream.finish())
        self.assertEqual(output, "\n")

    def test_split_fences_keep_metadata_literals_and_filter_real_metadata(self):
        for fence in ("```", "~~~~"):
            raw = f'`return` 正文。\n{fence}text\nTITLE: literal\nTERMS: []\n{fence}\nTITLE: private\nHANDOFF: {{}}'
            expected = f'`return` 正文。\n{fence}text\nTITLE: literal\nTERMS: []\n{fence}\n'
            for step in (1, 2, 7, len(raw)):
                with self.subTest(fence=fence, step=step):
                    stream = StreamingMetadataFilter()
                    output = "".join(piece for start in range(0, len(raw), step)
                                     for piece in stream.push(raw[start:start + step]))
                    self.assertEqual(output + "".join(stream.finish()), expected)

    def test_unclosed_fence_streams_body_and_bold_heading_never_wait_for_newline(self):
        stream = StreamingMetadataFilter()
        self.assertEqual(stream.push("``"), [])
        self.assertEqual(stream.push("`python\n"), ["```python\n"])
        self.assertEqual(stream.push("TITLE: code"), ["TITLE: code"])
        self.assertEqual(stream.finish(), [])
        for text in ("**结论**", "# 结论"):
            stream = StreamingMetadataFilter()
            self.assertEqual("".join(part for char in text for part in stream.push(char)), text)


class LightweightHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp, self.workspace, _ = _setup_temp_db()
        self.addCleanup(self.temp.cleanup)
        from app.services import storage
        root = self.workspace / "repo"
        root.mkdir()
        self.project = storage.upsert_project("latency", "https://example.com/latency", root, "scanned")
        self.session = storage.get_or_create_qa_session(self.project.id)

    def record(self, question, *, session_id=None, title=None, answer="回答内容"):
        from app.services.storage import create_qa_record
        return create_qa_record(
            project_id=self.project.id, source_type="file", source_path="main.py",
            selected_text="", question=question, answer_md=answer, provider="test", model="test",
            session_id=self.session.id if session_id is None else session_id, display_title=title,
        )

    def test_topics_match_legacy_grouping_without_reading_any_answer_body(self):
        from app.services import continuity_service as continuity, storage
        first = self.record("legacy question", title="Legacy")
        self.record("same legacy session", title="Later title must not replace Legacy")
        second_session = storage.get_or_create_qa_session(self.project.id)
        other = self.record("other legacy", session_id=second_session.id, title="Other")
        current = self.record("explicit topic", answer="large body" * 10000)
        continuity.persist_teaching_handoff(current, {
            "topic": "Current", "progressSummary": "progress", "establishedPoints": [],
            "unresolvedPoints": [], "nextActions": [], "usedPriorContext": False,
        })
        with storage._connect() as conn, conn:
            conn.execute("UPDATE qa_records SET updated_at='2026-10-07T00:00:00Z' WHERE id IN (?, ?)",
                         (first.id, other.id))
        expected = list(dict.fromkeys(item["topic"] for item in continuity.list_qa_thread_summaries(self.project.id)))
        connect = storage._connect

        @contextmanager
        def reject_answer_reads():
            with connect() as conn:
                def authorize(action, table, column, _database, _trigger):
                    if action == sqlite3.SQLITE_READ and table == "qa_records" and column == "answer_md":
                        return sqlite3.SQLITE_DENY
                    return sqlite3.SQLITE_OK
                conn.set_authorizer(authorize)
                yield conn

        with (patch.object(storage, "_connect", reject_answer_reads),
              patch.object(continuity, "list_qa_records", side_effect=AssertionError("full record loader")),
              patch.object(continuity, "list_teaching_handoffs", side_effect=AssertionError("full handoff loader"))):
            self.assertEqual(continuity.existing_qa_topics(self.project.id), expected)
            self.assertEqual(continuity.existing_qa_topics(self.project.id + 1000), [])

        storage.dismiss_current_teaching_handoff(self.project.id)
        expected = list(dict.fromkeys(item["topic"] for item in continuity.list_qa_thread_summaries(self.project.id)))
        self.assertEqual(continuity.existing_qa_topics(self.project.id), expected)

    def test_saved_memory_and_original_recent_excerpts_are_preserved(self):
        from app.services import qa_service as qa, storage
        for index in range(8):
            self.record(f"Unique question {index} END", answer=f"answer {index} " * 2000)
        storage.update_qa_session_memory(self.project.id, self.session.id,
                                         "Earlier unique requirement outside recent records")
        context = qa._session_context(self.project.id, self.session.id)
        for index in range(3, 8):
            self.assertEqual(context.count(f"Unique question {index} END"), 1)
        self.assertIn("Earlier unique requirement outside recent records", context)
        self.assertIn(qa._shorten("answer 7 " * 2000, 400), context)
        qa._refresh_session_memory(self.project.id, self.session.id, "main.py")
        memory = storage.get_qa_session(self.project.id, self.session.id).memory_summary
        self.assertIn("Unique question 2 END", memory)
        self.assertIn("Unique question 3 END", memory)
        self.assertIn("Unique question 7 END", memory)
        self.assertIn(qa._shorten("answer 7 " * 2000, 220), memory)

    def test_long_recent_question_keeps_its_final_constraint_and_answer_excerpt(self):
        from app.services import qa_service as qa
        question = "Question begins " + "x" * 7000 + " DO NOT CHANGE PUBLIC API"
        self.record(question, answer="OLD_ANSWER_CONTENT" * 1000)
        context = qa._session_context(self.project.id, self.session.id)
        self.assertIn(question, context)
        self.assertIn(qa._shorten("OLD_ANSWER_CONTENT" * 1000, 400), context)
        self.assertNotIn("历史回答因预算省略", context)

    def test_long_saved_memory_is_not_discarded_for_a_new_input_budget(self):
        from app.services import qa_service as qa, storage
        earlier_memory = "Earlier constraint " + "x" * 2000 + " FINAL_CONSTRAINT"
        storage.update_qa_session_memory(self.project.id, self.session.id, earlier_memory)
        for index in range(5):
            self.record(f"recent question {index}")
        context = qa._session_context(self.project.id, self.session.id)
        self.assertIn(earlier_memory, context)
        self.assertNotIn("历史预算未附带", context)
        for index in range(5):
            self.assertIn(f"recent question {index}", context)


if __name__ == "__main__":
    unittest.main()
