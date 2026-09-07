from __future__ import annotations

import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.services.term_service import (
    _clean_historical_candidates,
    _clean_term,
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

    def test_historical_filter_preserves_only_manual_malformed_links(self):
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
                link_origin="automatic",
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
                link_origin="manual",
            ),
        ]
        kept = _clean_historical_candidates(7, terms, f"正文中保留一条旧链接：{malformed}")
        self.assertEqual([term.id for term in kept], [2])

    def test_status_does_not_poll_when_local_candidates_are_sufficient(self):
        terms = [SimpleNamespace(confidence=0.9, detection_source="model") for _ in range(4)]
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
            patch("app.services.term_service.schedule_term_model_scan") as schedule,
            patch("app.services.term_service.get_document_term_status", return_value={"scan_status": "idle"}),
        ):
            status = rescan_document_terms(3, "course", "lesson.md")
        self.assertEqual(status["scan_status"], "idle")
        delete_state.assert_called_once()
        schedule.assert_called_once()

    def test_legacy_rule_guesses_are_hidden_even_when_linked(self):
        terms = [SimpleNamespace(detection_source=source, link_origin="automatic", status="linked")
                 for source in ("rule", "index", "dictionary", "legacy_unknown")]
        self.assertEqual(_clean_historical_candidates(1, terms, "anything"), [])

    def test_bad_metadata_is_hidden_and_code_examples_are_preserved(self):
        for header in ('TERMS: [broken', 'TERMS: [\n {"display_name":', 'TERMS: ```json\n[broken\n```'):
            with self.subTest(header=header):
                body, terms = parse_term_metadata(header + '\n\n正文介绍 C++。')
                self.assertEqual(body, '正文介绍 C++。')
                self.assertEqual(terms, [])
        literal = '```text\nTERMS: ["example"]\n```'
        self.assertEqual(parse_term_metadata(literal), (literal, []))

    def test_multiline_metadata_and_section_anchors(self):
        raw = 'TERMS: [\n {"display_name":"C++","source_span":{"text":"C++"}}\n]\n# 课程\nC++ 支持泛型编程。'
        body, terms = parse_term_metadata(raw)
        self.assertEqual([item['display_name'] for item in terms], ['C++'])
        self.assertNotIn('TERMS', body)

    def test_stream_never_exposes_metadata_across_chunk_boundaries(self):
        from app.services.metadata_stream import StreamingMetadataFilter
        raw = 'TITLE: 学习\nTERMS: [\n {"display_name":"C++"}\n]\nHANDOFF: {}\n正文讨论 C++。\n```text\nTERMS: literal\n```\n'
        expected = '正文讨论 C++。\n```text\nTERMS: literal\n```\n'
        for step in (1, 2, 7, 21, len(raw)):
            stream = StreamingMetadataFilter()
            visible = ''.join(piece for offset in range(0, len(raw), step)
                              for piece in stream.push(raw[offset:offset + step]))
            visible += ''.join(stream.finish())
            self.assertEqual(visible, expected)


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
