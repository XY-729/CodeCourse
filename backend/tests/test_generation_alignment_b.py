"""B contract regressions across real generation, publication and QA services."""
from __future__ import annotations

import asyncio
import copy
import json
import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from test_qa_records import _setup_temp_db
from app.models.schemas import QAAskRequest, LearningScopeRequest
from app.services import storage, generation_service as generation, qa_service as qa, qa_background
from app.services.llm_client import check_request_budget, parse_usage, stream_openai_compatible_chat
from app.services.metadata_stream import StreamingMetadataFilter
from app.services.personalization.teaching.generation_context import build_generation_context
from app.services.personalization.teaching.manifest import canonical_comment, merge_manifests, parse_manifest
from app.services.personalization.teaching.lesson_responsibility import freeze_responsibility_map, audit_section_manifest
from app.services.personalization.teaching.publication import publish_course_document, recover_course_publications
from app.services.term_service import parse_term_metadata, register_document_terms, get_document_term_annotations


def manifest_for(body, count=1):
    names = [f"Term{i}" for i in range(count)]
    concepts = [{"ref": name, "existing_id": None, "name": name, "domain": "cpp", "scope": "global", "parent_ref": None, "aliases": []} for name in names]
    return {"schema_version": 2, "concepts": concepts,
            "coverage": [{"concept_ref": name, "aspect": f"range{i}", "kind": "explained", "dimension": "conceptual", "core": True,
                          "quote": next(line for line in body.splitlines() if name + " " in line)} for i, name in enumerate(names)],
            "terms": [{"concept_ref": name, "text": name, "quote": next(line for line in body.splitlines() if name + " " in line)} for name in names]}


def response(count=1):
    body = "# 技术解释\n\n" + "\n".join(f"Term{i} has a distinct technical meaning {i}." for i in range(count))
    manifest = manifest_for(body, count)
    return body, manifest, body + "\nTEACHING: " + json.dumps(manifest, ensure_ascii=False)


class PureGenerationContracts(unittest.TestCase):
    def test_complete_stable_tree_and_state_only_prefix_change(self):
        raw = {"topology_version": 3, "state_version": 7, "nodes": [
            {"id": f"id{i:03}", "name": f"概念{i}", "scope": "global", "parent_id": None if i == 0 else "id000", "familiarity": "unrecorded", "ranges": []}
            for i in range(200)]}
        first = build_generation_context(1, snapshot=raw)
        raw["nodes"].reverse()
        self.assertEqual(first.render(), build_generation_context(1, snapshot=raw).render())
        raw["state_version"] += 1
        raw["nodes"][0]["familiarity"] = "declared_known"
        second = build_generation_context(1, snapshot=raw)
        self.assertEqual(first.topology_json, second.topology_json)
        self.assertNotEqual(first.state_json, second.state_json)
        self.assertEqual(len(second.snapshot["nodes"]), 200)
        raw["topology_version"] += 1
        raw["nodes"][0]["parent_id"] = "id001"
        self.assertNotEqual(second.topology_json, build_generation_context(1, snapshot=raw).topology_json)
        raw["nodes"].append({"id": "new", "name": "新节点", "scope": "global", "parent_id": "id000"})
        self.assertEqual(len(build_generation_context(1, snapshot=raw).snapshot["nodes"]), 201)

    def test_v2_terms_are_complete_authoritative_and_header_inline_table_supported(self):
        body, manifest, raw = response(60)
        content, terms = parse_term_metadata('TERMS: ["legacy"]\n' + raw)
        self.assertEqual(len(terms), 60)
        self.assertEqual(parse_manifest(content).status, "valid")
        from app.services.term_service import normalize_term_candidate
        for sample in ("# Term0", "| `Term0` | value |", "`Term0` is a term"):
            self.assertIsNotNone(normalize_term_candidate("Term0", sample))
        self.assertIsNone(normalize_term_candidate("Term0", "```cpp\nTerm0\n```"))
        self.assertIsNone(normalize_term_candidate("Term0", "[Term0](https://example.com)"))

    def test_invalid_v2_never_falls_back_to_legacy(self):
        with self.assertRaises(ValueError):
            parse_term_metadata('Term0 appears.\nTEACHING: {broken\nTERMS: ["Term0"]')

    def test_ref_namespace_and_final_quote_validation(self):
        body, manifest, _ = response()
        other = copy.deepcopy(manifest)
        other["coverage"][0]["quote"] = "Term0 has another application."
        other["terms"][0]["quote"] = other["coverage"][0]["quote"]
        merged = merge_manifests([("a", manifest), ("b", other)], body + "\n" + other["coverage"][0]["quote"])
        self.assertEqual([c["ref"] for c in merged["concepts"]], ["a::Term0", "b::Term0"])
        self.assertEqual(merged["coverage"][1]["concept_ref"], "b::Term0")
        with self.assertRaises(ValueError):
            merge_manifests([("a", manifest)], "changed content")

    def test_metadata_stream_chunk_boundaries_resource_limit_and_literal_fences(self):
        _, _, raw = response()
        filter = StreamingMetadataFilter()
        output = "".join(piece for char in raw for piece in filter.push(char)) + "".join(filter.finish())
        self.assertNotIn("TEACHING", output)
        self.assertIn("Term0 has", output)
        literal = "```text\nTEACHING: {literal}\n```\n"
        filter = StreamingMetadataFilter()
        self.assertEqual("".join(filter.push(literal) + filter.finish()), literal)
        with patch("app.services.metadata_stream.MAX_METADATA_BYTES", 20):
            filter = StreamingMetadataFilter()
            with self.assertRaisesRegex(ValueError, "资源限制"):
                filter.push('TEACHING: {"oversized":"' + "a" * 100)

    def test_budget_rejects_whole_request_without_truncating(self):
        messages = [{"role": "user", "content": "全部内容" * 100}]
        unchanged = copy.deepcopy(messages)
        with patch.dict(os.environ, {"GPL_LLM_CONTEXT_TOKENS": "100"}):
            with self.assertRaisesRegex(ValueError, "未被截断"):
                check_request_budget(messages, 30)
        self.assertEqual(messages, unchanged)

    def test_cache_measurements_and_unknown(self):
        self.assertIsNone(parse_usage({"prompt_tokens": 3})["cached_input_tokens"])
        self.assertEqual(parse_usage({"prompt_tokens_details": {"cached_tokens": 0}})["cached_input_tokens"], 0)
        self.assertEqual(parse_usage({"prompt_cache_hit_tokens": 123})["cached_input_tokens"], 123)
        self.assertEqual(parse_usage({"input_tokens_details": {"cached_tokens": 44}})["cached_input_tokens"], 44)

    def test_stream_usage_only_event_does_not_drop_content(self):
        async def lines():
            for line in ('data: {"choices":[{"delta":{"content":"body"}}]}',
                         'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
                         'data: {"choices":[],"usage":{"prompt_tokens":50,"prompt_tokens_details":{"cached_tokens":40},"completion_tokens":2}}',
                         'data: [DONE]'):
                yield line
        reply = MagicMock(status_code=200, headers={"content-type": "text/event-stream"})
        reply.aiter_lines = lines
        cm = MagicMock(__aenter__=AsyncMock(return_value=reply), __aexit__=AsyncMock(return_value=False))
        client = MagicMock()
        client.stream.return_value = cm
        usage = []
        async def consume():
            return "".join([chunk async for chunk in stream_openai_compatible_chat("http://test", "fake", "m", [], usage_callback=usage.append)])
        with patch("app.services.llm_client._async_client", return_value=client):
            self.assertEqual(asyncio.run(consume()), "body")
        self.assertEqual(usage[0].usage["cached_input_tokens"], 40)


class GenerationIntegration(unittest.TestCase):
    def setUp(self):
        self.temp, self.workspace, self.generated = _setup_temp_db()
        self.addCleanup(self.temp.cleanup)
        root = self.workspace / "repo"
        root.mkdir()
        (root / "main.cpp").write_text("int main() {}", encoding="utf-8")
        self.project = storage.upsert_project("repo", "https://example.com/b", root, "scanned")
        storage.set_setting("llm.enabled", "true")
        storage.set_setting("llm.api_key", "fake")
        for module in (generation, qa):
            p = patch.object(module, "GENERATED_ROOT", self.generated) if hasattr(module, "GENERATED_ROOT") else patch.object(module, "project_course_dir", lambda pid: self.generated / str(pid))
            p.start()
            self.addCleanup(p.stop)

    def test_qa_same_response_no_background_models_and_understanding_reconfirm(self):
        body, manifest, raw = response(2)
        payload = QAAskRequest(source_type="file", source_path="main.cpp", question="解释这两个概念", defer_metadata=True)
        with patch.object(qa, "call_openai_compatible_chat", return_value=raw + "\nTITLE: 技术说明") as model:
            record = qa.ask_question(self.project.id, payload)
        self.assertEqual(model.call_count, 1)
        self.assertNotIn("<knowledge_topology>", str(model.call_args.args[3]))
        with (patch("app.services.llm_client.call_openai_compatible_chat_result", side_effect=AssertionError("second model")),
              patch("app.services.qa_metadata.extract_answer_metadata", side_effect=AssertionError("second extract"))):
            qa_background._run(self.project.id, record.id)
            qa_background._run(self.project.id, record.id)
            qa.save_understanding(self.project.id, record.id, "我理解了", None)
            first = build_generation_context(self.project.id).snapshot
            qa.remove_understanding(self.project.id, record.id)
            qa.save_understanding(self.project.id, record.id, "再次确认", None)
            second = build_generation_context(self.project.id).snapshot
        self.assertTrue(all(n["familiarity"] == "self_reported_understood" for n in first["nodes"]))
        self.assertGreater(second["state_version"], first["state_version"])
        with storage._connect() as conn:
            job = conn.execute("SELECT * FROM qa_postprocess_jobs WHERE qa_record_id=?", (record.id,)).fetchone()
        self.assertEqual(job["status"], "completed")
        self.assertEqual(parse_manifest(record.answer_md).status, "valid")

    def test_final_terms_use_latest_feedback_and_keep_all_twenty_last_terms(self):
        body, manifest, raw = response(60)
        content, candidates = parse_term_metadata(raw)
        publish_course_document(self.project.id, "lesson.md", content)
        terms = register_document_terms(self.project.id, "course", "lesson.md", content, candidates)
        self.assertEqual(len(terms), 60)
        annotations = get_document_term_annotations(self.project.id, "course", "lesson.md")
        self.assertEqual(len(annotations["candidates"]), 60)
        self.assertIn("Term59", [item["text"] for item in annotations["candidates"]])
        from app.services.teaching_index import document_state, save_feedback
        state = document_state(self.project.id, "course", "lesson.md")
        save_feedback(self.project.id, "course", "lesson.md", "understood", [state["passages"][0]["id"]], state["contentHash"], "understand-first")
        latest = get_document_term_annotations(self.project.id, "course", "lesson.md")
        self.assertNotEqual(annotations["cache_key"], latest["cache_key"])
        self.assertEqual(sum(not c["offer_explanation"] for c in latest["candidates"]), 1)

    def test_identity_failure_preserves_old_document_and_does_not_publish_evidence(self):
        body, manifest, raw = response()
        target = self.generated / str(self.project.id) / "lesson.md"
        target.parent.mkdir(parents=True)
        target.write_text("# 旧课件\n保留", encoding="utf-8")
        manifest["concepts"][0]["existing_id"] = "inaccessible-id"
        with self.assertRaises(ValueError):
            publish_course_document(self.project.id, "lesson.md", body + "\n\n" + canonical_comment(manifest))
        self.assertEqual(target.read_text(encoding="utf-8"), "# 旧课件\n保留")
        self.assertEqual(build_generation_context(self.project.id).snapshot["nodes"], [])

    def test_invalid_qa_metadata_is_saved_as_unready_without_model_repair(self):
        payload = QAAskRequest(source_type="file", question="说明", defer_metadata=True)
        record = qa.finalize_question(qa.prepare_question(self.project.id, payload), "正文可阅读。\nTEACHING: {broken\nTERMS: [\"正文\"]")
        self.assertIn("知识清单未就绪", record.answer_md)
        self.assertNotIn("TEACHING:", record.answer_md)
        with storage._connect() as conn:
            row = conn.execute("SELECT index_status FROM teaching_documents WHERE project_id=?", (self.project.id,)).fetchone()
        self.assertNotEqual(row[0], "complete")
        qa.save_understanding(self.project.id, record.id, "只保存手写总结", None)
        self.assertEqual(build_generation_context(self.project.id).snapshot["nodes"], [])

    def test_dual_outline_coverage_is_only_associated_with_its_own_quote(self):
        body = "## FILE: project_map.md\n# 项目结构\nTerm0 map-only explanation.\n## FILE: outline.md\n# 总纲\nTerm1 outline-only explanation."
        manifest = manifest_for(body, 2)
        first, second = generation._parse_outline_files(body + "\n" + canonical_comment(manifest))
        self.assertEqual(len(parse_manifest(first).manifest["coverage"]), 1)
        self.assertEqual(len(parse_manifest(second).manifest["coverage"]), 1)
        self.assertIn("map-only", parse_manifest(first).manifest["coverage"][0]["quote"])
        self.assertIn("outline-only", parse_manifest(second).manifest["coverage"][0]["quote"])


if __name__ == "__main__":
    unittest.main()
