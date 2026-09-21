"""Project-scoped teaching handoff parsing, persistence, and history tests."""

import json
import tempfile
import unittest
from pathlib import Path


def _setup_temp_db():
    import app.core.config as cfg
    import app.services.continuity_service as continuity
    import app.services.storage as storage

    tmpdir = tempfile.TemporaryDirectory()
    workspace = Path(tmpdir.name)
    db_path = workspace / "app.db"
    generated = workspace / "generated"
    repos = workspace / "repos"
    cfg.DB_PATH = db_path
    cfg.WORKSPACE_ROOT = workspace
    cfg.GENERATED_ROOT = generated
    cfg.REPOS_ROOT = repos
    storage.DB_PATH = db_path
    storage.WORKSPACE_ROOT = workspace
    storage.GENERATED_ROOT = generated
    storage.REPOS_ROOT = repos
    continuity.GENERATED_ROOT = generated
    storage.init_storage()
    return tmpdir, workspace, generated


def _metadata(**overrides):
    value = {
        "engagement": "learning",
        "continuity": "update",
        "topic": "理解请求生命周期",
        "progress_summary": "已经从路由跟到服务层。",
        "established_points": ["路由负责校验输入"],
        "unresolved_points": ["事务边界在哪里"],
        "next_actions": [{"kind": "follow_up", "label": "继续追踪", "prompt": "事务在哪里开始？"}],
        "used_prior_context": True,
    }
    value.update(overrides)
    return value


class TeachingContinuityTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir, self.workspace, self.generated = _setup_temp_db()
        from app.services.storage import upsert_project

        repo = self.workspace / "repos" / "one"
        repo.mkdir(parents=True)
        (repo / "main.py").write_text("print('one')\n", encoding="utf-8")
        other = self.workspace / "repos" / "two"
        other.mkdir(parents=True)
        (other / "main.py").write_text("print('two')\n", encoding="utf-8")
        self.project = upsert_project("one", "https://github.com/test/one.git", repo, "scanned")
        self.other_project = upsert_project("two", "https://github.com/test/two.git", other, "scanned")

    def tearDown(self):
        self._tmpdir.cleanup()

    def _record(self, project_id, question="第一问"):
        from app.services.storage import create_qa_record, get_or_create_qa_session

        session = get_or_create_qa_session(project_id)
        return create_qa_record(
            project_id=project_id,
            source_type="file",
            source_path="main.py",
            selected_text="print",
            question=question,
            answer_md="回答正文",
            provider="test",
            model="test-model",
            session_id=session.id,
        )

    def test_parser_strips_valid_and_malicious_duplicate_metadata(self):
        from app.services.continuity_service import parse_handoff_metadata

        raw = "正文\nHANDOFF: " + json.dumps(_metadata(), ensure_ascii=False) + "\nHANDOFF: {not-json}"
        visible, parsed = parse_handoff_metadata(raw, source_type="file", source_path="main.py")
        self.assertEqual(visible, "正文")
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["topic"], "理解请求生命周期")
        self.assertEqual(len(parsed["nextActions"]), 1)

    def test_utility_malformed_and_oversized_metadata_preserve_state(self):
        from app.services.continuity_service import parse_handoff_metadata

        utility = _metadata(engagement="utility", continuity="preserve")
        cases = [
            "回答\nHANDOFF: " + json.dumps(utility, ensure_ascii=False),
            "回答\nHANDOFF: {bad-json}",
            "回答\nHANDOFF: " + json.dumps(_metadata(topic="太" * 81), ensure_ascii=False),
            "回答\nHANDOFF: " + json.dumps(_metadata(established_points=["a", "b", "c", "d", "e"]), ensure_ascii=False),
        ]
        for raw in cases:
            with self.subTest(raw=raw[-40:]):
                visible, parsed = parse_handoff_metadata(raw, source_type="file", source_path="main.py")
                self.assertEqual(visible, "回答")
                self.assertIsNone(parsed)

    def test_new_learning_answer_replaces_only_its_project_current_state(self):
        from app.services.continuity_service import persist_teaching_handoff
        from app.services.storage import get_current_teaching_handoff, list_teaching_handoffs

        first = self._record(self.project.id, "第一问")
        second = self._record(self.project.id, "第二问")
        other = self._record(self.other_project.id, "其他项目")
        persist_teaching_handoff(first, {
            "topic": "主题一", "progressSummary": "进展一", "establishedPoints": [],
            "unresolvedPoints": [], "nextActions": [], "usedPriorContext": False,
        })
        persist_teaching_handoff(other, {
            "topic": "其他主题", "progressSummary": "其他进展", "establishedPoints": [],
            "unresolvedPoints": [], "nextActions": [], "usedPriorContext": False,
        })
        persist_teaching_handoff(second, {
            "topic": "主题二", "progressSummary": "进展二", "establishedPoints": ["认识"],
            "unresolvedPoints": ["待办"], "nextActions": [], "usedPriorContext": True,
        })

        self.assertEqual(get_current_teaching_handoff(self.project.id).qa_record_id, second.id)
        self.assertEqual(get_current_teaching_handoff(self.other_project.id).qa_record_id, other.id)
        self.assertEqual(sum(1 for item in list_teaching_handoffs(self.project.id) if item.is_current), 1)

    def test_dismiss_source_degradation_and_thread_fallback(self):
        from app.services.continuity_service import (
            list_qa_thread_summaries,
            persist_teaching_handoff,
            teaching_handoff_payload,
        )
        from app.services.storage import dismiss_current_teaching_handoff, get_current_teaching_handoff

        record = self._record(self.project.id)
        handoff = persist_teaching_handoff(record, {
            "topic": "文件主题", "progressSummary": "看完入口", "establishedPoints": [],
            "unresolvedPoints": ["继续看服务"],
            "nextActions": [{"kind": "open_source", "label": "打开文件", "sourceType": "file", "sourcePath": "main.py"}],
            "usedPriorContext": False,
        })
        payload = teaching_handoff_payload(handoff)
        self.assertTrue(payload["sourceAvailable"])
        (Path(self.project.local_path) / "main.py").unlink()
        payload = teaching_handoff_payload(handoff)
        self.assertFalse(payload["sourceAvailable"])
        self.assertEqual(payload["nextActions"], [])

        threads = list_qa_thread_summaries(self.project.id)
        self.assertEqual(threads[0]["topic"], "文件主题")
        legacy = self._record(self.project.id, "没有交接的旧问题")
        threads = list_qa_thread_summaries(self.project.id)
        self.assertTrue(any(item["latestQaRecordId"] == legacy.id and item["topic"] == "没有交接的旧问题" for item in threads))

        dismissed = dismiss_current_teaching_handoff(self.project.id)
        self.assertEqual(dismissed.id, handoff.id)
        self.assertIsNone(get_current_teaching_handoff(self.project.id))

    def test_learning_context_lists_existing_topics_for_model_classification(self):
        from app.services.continuity_service import persist_teaching_handoff, render_project_learning_context

        record = self._record(self.project.id)
        persist_teaching_handoff(record, {
            "topic": "C++ 新特性", "progressSummary": "理解智能指针", "establishedPoints": [],
            "unresolvedPoints": [], "nextActions": [], "usedPriorContext": False,
        })
        context = render_project_learning_context(self.project.id)
        self.assertIn("<existing_qa_topics>", context)
        self.assertIn('["C++ 新特性"]', context)
        self.assertIn("语义匹配时优先复用", context)

    def test_explicit_routing_and_invalid_choices(self):
        from app.services.continuity_service import parse_handoff_metadata
        for fields, expected in [
            ({"is_new_topic": False, "new_topic": "", "existing_topic": "std"}, "std"),
            ({"is_new_topic": True, "new_topic": "shared_ptr", "existing_topic": ""}, "shared_ptr"),
            ({"is_new_topic": False, "new_topic": "", "existing_topic": "unknown"}, None),
            ({"is_new_topic": True, "new_topic": "new", "existing_topic": "std"}, None),
            ({"is_new_topic": "false", "new_topic": "", "existing_topic": "std"}, None),
            ({"is_new_topic": False, "existing_topic": "std"}, None),
        ]:
            visible, parsed = parse_handoff_metadata(
                "正文\nHANDOFF: " + json.dumps(_metadata(**fields)),
                source_type="file", source_path="main.py", existing_topics=["std"],
            )
            self.assertEqual(visible, "正文")
            self.assertEqual(parsed["topic"] if parsed else None, expected)

    def test_utility_routing_preserves_learning_and_separates_topics_within_session(self):
        from dataclasses import replace
        from app.services.continuity_service import parse_handoff_metadata, persist_teaching_handoff, list_qa_thread_summaries
        from app.services.storage import get_current_teaching_handoff, get_teaching_handoff_for_qa, run_in_transaction
        first = self._record(self.project.id)
        current = persist_teaching_handoff(first, {"topic": "std", "progressSummary": "学习中", "usedPriorContext": False})
        second = self._record(self.project.id, "新问题")
        run_in_transaction(lambda conn: conn.execute("UPDATE qa_records SET session_id=? WHERE id=?", (first.session_id, second.id)))
        second = replace(second, session_id=first.session_id)
        _, parsed = parse_handoff_metadata("HANDOFF: " + json.dumps(_metadata(
            engagement="utility", continuity="preserve", is_new_topic=True, new_topic="网络", existing_topic="",
        )), source_type="file", source_path="main.py", existing_topics=["std"])
        persist_teaching_handoff(second, parsed)
        self.assertEqual(get_current_teaching_handoff(self.project.id).id, current.id)
        self.assertIsNone(get_teaching_handoff_for_qa(self.project.id, second.id))
        groups = list_qa_thread_summaries(self.project.id)
        self.assertEqual({item["topic"]: item["records"] for item in groups}, {"std": [first.id], "网络": [second.id]})

    def test_all_topic_names_are_sent_unchanged(self):
        from app.services.continuity_service import persist_teaching_handoff, existing_qa_topics, render_project_learning_context
        topics = ["shared_ptr"] + [f"主题{i}" for i in range(31)]
        for topic in topics:
            persist_teaching_handoff(self._record(self.project.id, topic), {"topic": topic, "progressSummary": "进展", "usedPriorContext": False})
        self.assertEqual(set(existing_qa_topics(self.project.id)), set(topics))
        context = render_project_learning_context(self.project.id)
        for topic in topics:
            self.assertIn('"' + topic + '"', context)

    def test_project_deletion_removes_handoff_rows(self):
        from app.services.continuity_service import persist_teaching_handoff
        from app.services.storage import delete_project, list_teaching_handoffs

        record = self._record(self.project.id)
        persist_teaching_handoff(record, {
            "topic": "待删除主题", "progressSummary": "待删除进展", "establishedPoints": [],
            "unresolvedPoints": [], "nextActions": [], "usedPriorContext": False,
        })
        self.assertEqual(len(list_teaching_handoffs(self.project.id)), 1)
        self.assertTrue(delete_project(self.project.id))
        self.assertEqual(list_teaching_handoffs(self.project.id), [])


if __name__ == "__main__":
    unittest.main()
