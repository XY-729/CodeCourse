from __future__ import annotations

import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.services.term_service import (
    _clean_historical_candidates,
    _clean_term,
    _local_candidates,
    _normalize_source_path,
    get_document_term_status,
    normalize_term_candidate,
    parse_term_metadata,
    rescan_document_terms,
)


ROOT = Path(__file__).resolve().parents[2]


class TermCandidateTests(unittest.TestCase):
    def test_python_matches_shared_typescript_term_vectors(self):
        data = json.loads(
            (
                ROOT
                / "frontend"
                / "src"
                / "personalization"
                / "__tests__"
                / "termCandidateGolden.json"
            ).read_text(encoding="utf-8")
        )
        for vector in data["vectors"]:
            result = normalize_term_candidate(
                vector["input"],
                vector["content"],
                default_source="model",
                default_confidence=0.94,
            )
            actual = result["display_name"] if result else None
            with self.subTest(vector=vector["name"]):
                self.assertEqual(actual, vector["expected"])
                if result:
                    span = result["source_span"]
                    self.assertEqual(
                        vector["content"][span["start"] : span["end"]],
                        actual,
                    )

    def test_metadata_parser_accepts_structured_and_legacy_terms(self):
        raw = """TITLE: bind
TERMS: [{"display_name":"bind","canonical_name":"bind","category":"api","confidence":0.9,"source_span":{"text":"bind"}}, "套接字"]
bind 会把套接字绑定到本地地址。"""
        content, terms = parse_term_metadata(raw)
        self.assertTrue(content.startswith("TITLE: bind"))
        self.assertEqual(
            [term["display_name"] for term in terms],
            ["bind", "套接字"],
        )
        self.assertEqual(terms[0]["category"], "api")

    def test_metadata_parser_drops_non_visible_and_sentence_candidates(self):
        raw = """TERMS: ["不存在的术语", "主线程如何安全地等待子线程结束？"]
正文只介绍事件循环。"""
        _, terms = parse_term_metadata(raw)
        self.assertEqual(terms, [])

    def test_historical_cleanup_preserves_linked_terms(self):
        malformed = "主线程如何安全地等待子线程结束？"
        terms = [
            SimpleNamespace(
                id=1,
                status="candidate",
                term_text=malformed,
                canonical_name=malformed,
                category="other",
                confidence=0.9,
                source_span=None,
                detection_source="model",
            ),
            SimpleNamespace(
                id=2,
                status="linked",
                term_text=malformed,
                canonical_name=malformed,
                category="other",
                confidence=0.9,
                source_span=None,
                detection_source="model",
            ),
        ]
        with patch(
            "app.services.term_service.delete_document_term_candidates_by_id"
        ) as delete_candidates:
            kept = _clean_historical_candidates(
                7,
                terms,
                f"正文中保留一条旧链接：{malformed}",
            )
        self.assertEqual([term.id for term in kept], [2])
        delete_candidates.assert_called_once_with(7, [1])

    def test_status_does_not_poll_when_local_candidates_are_sufficient(self):
        terms = [SimpleNamespace(confidence=0.9) for _ in range(4)]
        with (
            patch("app.services.term_service._load_document_content", return_value="FastAPI SQLite React Electron"),
            patch("app.services.term_service.register_document_terms", return_value=terms),
            patch("app.services.term_service.get_term_scan_state", return_value=None),
            patch("app.services.term_service._term_scan_enabled", return_value=True),
        ):
            status = get_document_term_status(1, "course", "outline.md")
        self.assertEqual(status["scan_status"], "completed")
        self.assertEqual(status["candidate_count"], 4)

    def test_rescan_invalidates_current_content_hash(self):
        content = "FastAPI 使用 SQLite"
        with (
            patch("app.services.term_service._load_document_content", return_value=content),
            patch("app.services.term_service.delete_term_scan_state") as delete_state,
            patch("app.services.term_service.register_document_terms", return_value=[]),
            patch("app.services.term_service.get_document_term_status", return_value={"scan_status": "idle"}),
        ):
            status = rescan_document_terms(3, "course", "lesson.md")
        self.assertEqual(status["scan_status"], "idle")
        delete_state.assert_called_once()

    def test_emphasis_rule_rejects_headings_keeps_inline_terms(self):
        content = (
            "**一句话大白话**\n\n"
            "原子变量是一种特殊的变量。\n\n"
            "**数据竞争**：C++ 标准规定两个线程同时访问同一个非原子变量就是未定义行为。\n"
        )
        with patch("app.services.term_service.list_code_chunks", return_value=[]):
            candidates = _local_candidates(1, content)
        names = [str(c["display_name"]) for c in candidates]
        # The inline bold term is kept…
        self.assertIn("数据竞争", names)
        # …but the bold section heading on its own line is not a term.
        self.assertNotIn("一句话大白话", names)
        self.assertNotIn("原子变量是一种特殊的变量", names)

    def test_chinese_tech_rule_keeps_dictionary_words_only(self):
        content = (
            "事件循环由中间件驱动，依赖注入是它的关键。"
            "轮流分给各个进程的时间片由调度器决定。"
            "每个核有自己的缓存，主线程开了一个子线程。"
        )
        with patch("app.services.term_service.list_code_chunks", return_value=[]):
            candidates = _local_candidates(1, content)
        names = [str(c["display_name"]) for c in candidates]
        # The dictionary words themselves are detected…
        self.assertIn("事件循环", names)
        self.assertIn("中间件", names)
        self.assertIn("依赖", names)
        self.assertIn("进程", names)
        self.assertIn("缓存", names)
        self.assertIn("线程", names)
        # …but whole sentences that merely END in a tech word are not.
        self.assertNotIn("轮流分给各个进程", names)
        self.assertNotIn("每个核有自己的缓存", names)
        self.assertNotIn("主线程开了一个子线程", names)

    def test_clean_term_rejects_expressions_glosses_and_heading_phrases(self):
        self.assertEqual(_clean_term("rusage.ru_utime + rusage.ru_stime"), "")
        self.assertEqual(_clean_term("时间片（time slice）"), "")
        self.assertEqual(_clean_term("生产代码里不要手动忙等线程结束"), "")
        self.assertEqual(_clean_term("常见坑和误解"), "")
        self.assertEqual(_clean_term("下一步学习建议"), "")
        # Inline-bold sentences that start with a verb are not terms either.
        self.assertEqual(_clean_term("以为 BPF 规则能限制 CPU 时间和内存"), "")
        self.assertEqual(_clean_term("以为规则可以提前随意加上"), "")
        self.assertEqual(_clean_term("精确地按“系统调用”级别过滤"), "")
        self.assertEqual(_clean_term("直接杀死进程"), "")
        self.assertEqual(_clean_term("依赖注入"), "依赖注入")
        self.assertEqual(_clean_term("事件循环"), "事件循环")

    def test_source_path_is_normalized_to_forward_slashes(self):
        self.assertEqual(_normalize_source_path("selection_answers\\原子变量_0034.md"), "selection_answers/原子变量_0034.md")
        self.assertEqual(_normalize_source_path("lessons/lesson_01.md"), "lessons/lesson_01.md")


if __name__ == "__main__":
    unittest.main()
