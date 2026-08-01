from __future__ import annotations

import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.services.term_service import (
    _clean_historical_candidates,
    normalize_term_candidate,
    parse_term_metadata,
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


if __name__ == "__main__":
    unittest.main()
