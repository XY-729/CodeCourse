"""Metadata repair for freshly generated documents.

A readable body must never be discarded because one quote was re-punctuated,
repeated in the body, or because an identity claim cannot be confirmed.
"""
from __future__ import annotations

import unittest
from types import SimpleNamespace

from app.services import generation_service as generation
from app.services.personalization.teaching.manifest import (
    canonical_comment,
    locate_quote,
    parse_manifest,
    visible_body,
)
from app.services.teaching_index import _validate_coverage, _validate_terms


def coverage(ref: str, quote: str, *, aspect: str = "核心范围", kind: str = "explained") -> dict:
    return {"concept_ref": ref, "aspect": aspect, "kind": kind, "dimension": "conceptual",
            "core": True, "quote": quote}


def concept(ref: str, name: str, *, existing_id: str | None = None,
            domain: str = "history:项目代码", scope: str = "project") -> dict:
    return {"ref": ref, "existing_id": existing_id, "name": name, "domain": domain,
            "scope": scope, "parent_ref": None, "aliases": []}


def document(body: str, concepts: list, coverage_rows: list, terms: list | None = None) -> str:
    payload = {"schema_version": 2, "concepts": concepts, "coverage": coverage_rows,
               "terms": terms or [], "placement_changes": []}
    return body.rstrip("\n") + "\n\n" + canonical_comment(payload) + "\n"


def count(body: str, quote: str) -> int:
    return visible_body(body).count(quote)


class LocateQuoteTest(unittest.TestCase):
    def test_punctuation_difference_maps_to_the_exact_body_span(self):
        body = "停止时不再接收新任务、完成已经提交的任务，最后回收连接与线程。"
        quote = "停止时不再接收新任务，完成已经提交的任务"
        self.assertEqual(locate_quote(body, quote), "停止时不再接收新任务、完成已经提交的任务")

    def test_repeated_quote_is_widened_to_its_own_region(self):
        body = "- 队列数量/载荷字节双限制；超载返回 BUSY。\n\n重点核对队列数量/载荷字节双限制。"
        located = locate_quote(body, "队列数量/载荷字节双限制")
        self.assertIsNotNone(located)
        self.assertEqual(body.count(located), 1)
        self.assertIn("队列数量/载荷字节双限制", located)

    def test_term_text_must_be_unique_inside_the_located_span(self):
        body = "`session.cc` 与 `async_session.cc` 管理连接侧会话。"
        self.assertIsNone(locate_quote(body, "`session.cc` 与 `async_session.cc`", "session.cc"))
        self.assertEqual(locate_quote(body, "`session.cc` 与 `async_session.cc`", "async_session.cc"),
                         "`session.cc` 与 `async_session.cc`")

    def test_unrelated_quote_is_not_matched(self):
        self.assertIsNone(locate_quote("正文只讲队列与过载保护。", "停止时排空已提交任务"))


class LenientParseTest(unittest.TestCase):
    def test_strict_parse_still_rejects_a_repeated_quote(self):
        body = "# 总纲\n\n同一段讲解出现两次：会话串行与响应顺序。\n\n会话串行与响应顺序"
        text = document(body, [concept("c", "会话")], [coverage("c", "会话串行与响应顺序")])
        result = parse_manifest(text)
        self.assertEqual(result.status, "invalid")
        self.assertIn("quote 必须在最终正文唯一定位", result.errors[0])

    def test_lenient_parse_repairs_rows_and_keeps_the_body(self):
        body = "# 总纲\n\n同一段讲解出现两次：会话串行与响应顺序。\n\n会话串行与响应顺序"
        text = document(body, [concept("c", "会话")],
                        [coverage("c", "会话串行与响应顺序"),
                         coverage("c", "停止时排空已提交任务")])
        result = parse_manifest(text, drop_unlocatable=True)
        self.assertEqual(result.status, "valid", result.errors)
        self.assertEqual(len(result.manifest["coverage"]), 1)
        self.assertEqual(count(text, result.manifest["coverage"][0]["quote"]), 1)
        self.assertEqual(len(result.warnings), 1)
        self.assertIn("同一段讲解出现两次", result.body)

    def test_repaired_metadata_passes_index_validation(self):
        body = "# 总纲\n\n## 第 7 课：会话串行与响应顺序\n\n讲解同一连接内的命令串行执行；语义相同、范围相同。"
        text = document(body, [concept("c", "会话")],
                        [coverage("c", "同一连接内的命令串行执行，语义相同、范围相同")],
                        terms=[{"concept_ref": "c", "text": "命令串行", "quote": "命令串行执行。"}])
        repaired = generation._repair_generated_manifest(text)
        self.assertNotEqual(repaired, text)
        parsed = parse_manifest(repaired)
        self.assertEqual(parsed.status, "valid", parsed.errors)
        visible = visible_body(repaired)
        self.assertEqual(len(_validate_coverage(visible, parsed.manifest["coverage"])), 1)
        self.assertEqual(len(_validate_terms(visible, parsed.manifest["terms"])), 1)


class GeneratedDocumentRepairTest(unittest.TestCase):
    def test_dual_file_outline_is_repaired_before_publication(self):
        body = (
            "## FILE: project_map.md\n# 项目结构说明\n\n连接侧会话由 `session.cc` 处理，"
            "`async_session.cc` 负责异步写入。\n\n"
            "## FILE: outline.md\n# 项目学习总纲\n\n### 第 7 课：会话串行与响应顺序\n\n"
            "本课解释会话串行、请求顺序与响应顺序之间的关系：同一连接内的命令串行执行；语义相同、范围相同。\n"
        )
        manifest = {
            "schema_version": 2,
            "concepts": [concept("c", "会话串行", scope="global", domain="history:网络")],
            "coverage": [
                coverage("c", "连接侧会话由 `session.cc` 处理"),
                coverage("c", "会话串行、请求顺序与响应顺序"),
                coverage("c", "同一连接内的命令串行执行，语义相同、范围相同"),
                coverage("c", "同一连接内的命令串行执行"),
            ],
            "terms": [{"concept_ref": "c", "text": "async_session.cc",
                       "quote": "`async_session.cc` 负责异步写入。"}],
            "placement_changes": [],
        }
        text = body.rstrip("\n") + "\n\n" + canonical_comment(manifest) + "\n"
        self.assertEqual(parse_manifest(text).status, "invalid")
        repaired = generation._repair_generated_manifest(text)
        self.assertEqual(parse_manifest(repaired).status, "valid", parse_manifest(repaired).errors)
        # The lesson-link block repeats each lesson title after validation time.
        linked = generation.add_outline_lesson_links(repaired)
        linked = generation._repair_generated_manifest(linked)
        self.assertEqual(parse_manifest(linked).status, "valid", parse_manifest(linked).errors)
        project_map, outline = generation._parse_outline_files(linked)
        for name, part in (("project_map.md", project_map), ("outline.md", outline)):
            parsed = parse_manifest(part)
            self.assertEqual(parsed.status, "valid", (name, parsed.errors))
            visible = visible_body(part)
            self.assertEqual(len(_validate_coverage(visible, parsed.manifest["coverage"])),
                             len(parsed.manifest["coverage"]))
            self.assertEqual(len(_validate_terms(visible, parsed.manifest["terms"])),
                             len(parsed.manifest["terms"]))
        self.assertEqual(len(parse_manifest(project_map).manifest["coverage"]), 1)
        self.assertEqual(len(parse_manifest(outline).manifest["coverage"]), 3)

    def test_linked_lesson_titles_do_not_invalidate_a_title_quote(self):
        body = ("## FILE: project_map.md\n# 项目结构\n\n概览。\n\n"
                "## FILE: outline.md\n# 总纲\n\n### 第 3 课：队列与过载\n\n正文。\n")
        manifest = {"schema_version": 2, "concepts": [concept("c", "队列", scope="global")],
                    "coverage": [coverage("c", "队列与过载")], "terms": [], "placement_changes": []}
        text = body.rstrip("\n") + "\n\n" + canonical_comment(manifest) + "\n"
        _, outline = generation._parse_outline_files(text)
        linked = generation.add_outline_lesson_links(outline)
        self.assertEqual(parse_manifest(linked).status, "invalid")
        repaired = generation._repair_generated_manifest(linked)
        parsed = parse_manifest(repaired)
        self.assertEqual(parsed.status, "valid", parsed.errors)
        self.assertEqual(len(parsed.manifest["coverage"]), 1)
        self.assertEqual(visible_body(repaired).count(parsed.manifest["coverage"][0]["quote"]), 1)


class IdentityRepairTest(unittest.TestCase):
    def context(self, nodes):
        return SimpleNamespace(snapshot={"nodes": nodes, "state_version": 1,
                                         "topology_version": 1, "topology_status": "ready"})

    def test_unknown_id_is_cleared_and_known_fields_follow_the_tree(self):
        node = {"id": "known", "name": "CMake", "domain": "general", "scope": "global",
                "scope_id": "local-user", "range_catalog": []}
        manifest = {"schema_version": 2,
                    "concepts": [concept("build", "CMake", existing_id="known",
                                         domain="history:构建与测试", scope="global"),
                                 concept("tcp", "TCP", existing_id="c_invented")],
                    "coverage": [], "terms": [], "placement_changes": []}
        repaired, notes = generation._repair_manifest_identity(manifest, self.context([node]))
        self.assertEqual(repaired["concepts"][0]["domain"], "general")
        self.assertEqual(repaired["concepts"][0]["scope"], "global")
        self.assertEqual(repaired["concepts"][0]["scope_id"], "local-user")
        self.assertIsNone(repaired["concepts"][1]["existing_id"])
        self.assertGreaterEqual(len(notes), 2)

    def test_unknown_range_id_is_cleared_instead_of_blocking_publish(self):
        node = {"id": "known", "name": "队列", "domain": "general", "scope": "global",
                "scope_id": "local-user", "range_catalog": []}
        manifest = {"schema_version": 2,
                    "concepts": [concept("q", "队列", existing_id="known",
                                         domain="general", scope="global")],
                    "coverage": [{**coverage("q", "队列限制"), "aspect_id": "r_missing"}],
                    "terms": [], "placement_changes": []}
        repaired, notes = generation._repair_manifest_identity(manifest, self.context([node]))
        self.assertNotIn("aspect_id", repaired["coverage"][0])
        self.assertEqual(repaired["coverage"][0]["aspect"], "核心范围")
        self.assertTrue(any("r_missing" in note for note in notes))


if __name__ == "__main__":
    unittest.main()
