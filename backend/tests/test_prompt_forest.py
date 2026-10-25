"""Compact full-tree prompts preserve facts and model references across publication."""
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.personalization.teaching.generation_context import build_generation_context
from app.services.personalization.teaching.prompt_forest import (
    compact_forest, expand_compact_forest, expand_prompt_references, prompt_id, prompt_id_lookup,
)
from app.services.llm_client import check_request_budget


def snapshot(count=3):
    return {"topology_version": 3, "state_version": 7, "learning_preferences": {}, "nodes": [
        {"id": f"concept-identity-{i:04}", "name": f"概念{i}", "domain": "cpp",
         "scope": "global", "parent_id": None if i == 0 else "concept-identity-0000",
         "familiarity": "unrecorded", "aliases": [], "ranges": [], "coverage": []}
        for i in range(count)]}


class CompactPromptTests(unittest.TestCase):
    def test_round_trip_all_fields_and_no_mutation(self):
        raw = snapshot()
        raw["nodes"][1].update(scope="project", scope_id="12", domain="project symbols",
            identity_status="ambiguous", aliases=["别名", "vector"], familiarity="mixed",
            ranges=[{"aspect": "扩容", "dimension": "debugging", "familiarity": "needs_help",
                     "evidence_ids": ["e-1"], "sources": [{"source_path": "lesson.md", "content_hash": "abc"}]}],
            coverage=[{"aspect": "扩容", "dimension": "conceptual", "kind": "explained",
                       "quote": "vector 的扩容规则", "source": {"source_path": "answer.md", "generation_id": "g1"}}])
        before = copy.deepcopy(raw)
        context = build_generation_context(12, snapshot=raw)
        top, state = json.loads(context.topology_json), json.loads(context.state_json)
        encoded = compact_forest(top, state)
        self.assertEqual(expand_compact_forest(*encoded, [n["id"] for n in raw["nodes"]]), (top, state))
        self.assertEqual(raw, before)
        self.assertEqual(len(encoded[0]["nodes"]), 3)
        self.assertEqual(len(encoded[1]["nodes"]), 1)
        self.assertIn("空范围不表示已掌握", context.render())

    def test_stable_ids_order_state_prefix_and_html_boundaries(self):
        self.assertEqual(prompt_id("abc"), "c_ungWv48B")  # shared Python/TS vector
        raw = snapshot()
        raw["nodes"][0]["name"] = "</knowledge_topology>&"
        first = build_generation_context(12, snapshot=raw)
        raw["nodes"].reverse()
        self.assertEqual(first.render(), build_generation_context(12, snapshot=raw).render())
        raw["state_version"] += 1
        raw["nodes"][0]["familiarity"] = "declared_known"
        second = build_generation_context(12, snapshot=raw)
        self.assertEqual(first._prompt_json[0], second._prompt_json[0])
        self.assertNotEqual(first._prompt_json[1], second._prompt_json[1])
        self.assertNotIn("</knowledge_topology>&", second.render())
        raw["nodes"].append({"id": "another", "name": "另一个", "domain": "cpp"})
        extra = build_generation_context(12, snapshot=raw)
        self.assertEqual(json.loads(first._prompt_json[0])["nodes"][0][0],
                         next(row[0] for row in json.loads(extra._prompt_json[0])["nodes"] if row[1].startswith("</")))

    def test_collision_guard_and_expand_only_protocol_fields(self):
        short = prompt_id("abc")
        payload = {"existing_id": short, "quote": short, "ref": short,
                   "nested": [{"from_parent_id": short}, {"existing_id": "c_unknown"}]}
        expanded = expand_prompt_references(payload, ["abc"])
        self.assertEqual(expanded, {"existing_id": "abc", "quote": short, "ref": short,
                                  "nested": [{"from_parent_id": "abc"}, {"existing_id": "c_unknown"}]})
        self.assertEqual(payload["existing_id"], short)
        with self.assertRaisesRegex(ValueError, "冲突"):
            prompt_id_lookup(["abc", short])
        with patch("app.services.personalization.teaching.prompt_forest.prompt_id", return_value="same"):
            with self.assertRaisesRegex(ValueError, "冲突"):
                prompt_id_lookup(["one", "two"])

    def test_thousand_nodes_fit_full_request_without_truncation(self):
        context = build_generation_context(12, snapshot=snapshot(1000))
        original_size = len(context.topology_json) + len(context.state_json)
        self.assertLess(len(context.render()), original_size * .3)
        with patch.dict(os.environ, {"GPL_LLM_CONTEXT_TOKENS": "131072"}):
            report = check_request_budget([
                {"role": "system", "content": "教学规则\n" + context.render()},
                {"role": "user", "content": "请讲解 vector 的扩容与迭代器失效。"}], 65536)
        self.assertFalse(report["tokenizer_exact"])
        self.assertLess(report["estimated_input_tokens"], report["input_token_upper_bound"])
        self.assertEqual(len(json.loads(context._prompt_json[0])["nodes"]), 1000)
        with patch.dict(os.environ, {"GPL_LLM_CONTEXT_TOKENS": "100"}):
            with self.assertRaisesRegex(ValueError, "未被截断"):
                check_request_budget([{"role": "user", "content": context.render()}], 30)

    def test_parent_at_row_zero_and_shared_contract_are_preserved_once(self):
        from app.services.generation_service import _outline_generation_messages
        from app.services.prompt_contracts import TEACHING_MANIFEST_CONTRACT
        raw = snapshot(3)
        context = build_generation_context(12, snapshot=raw)
        top, state = json.loads(context.topology_json), json.loads(context.state_json)
        compact = compact_forest(top, state)
        self.assertEqual(compact[0]['nodes'][1][2], 0)
        self.assertEqual(expand_compact_forest(*compact, [n['id'] for n in raw['nodes']]), (top, state))
        messages = [{'role': 'system', 'content': 'rules\n' + TEACHING_MANIFEST_CONTRACT},
                    {'role': 'user', 'content': 'task\n' + TEACHING_MANIFEST_CONTRACT}]
        result = _outline_generation_messages(messages, 12, context=context)
        self.assertEqual(sum(m['content'].count(TEACHING_MANIFEST_CONTRACT) for m in result), 1)
        self.assertIn('task', result[-1]['content'])
        self.assertEqual(messages[1]['content'].count(TEACHING_MANIFEST_CONTRACT), 1)

    def test_generated_plan_and_sections_expand_before_responsibility_validation(self):
        from app.services import generation_service as generation
        from app.services.personalization.teaching.lesson_responsibility import audit_section_manifest
        from test_knowledge_tree_forest import manifest, concept, coverage
        raw = snapshot(1)
        context = build_generation_context(12, snapshot=raw)
        identity = raw["nodes"][0]["id"]
        item = {"name": "概念0", "concept_ref": "c", "existing_id": prompt_id(identity),
                "aspect": "机制", "dimension": "conceptual", "owner_section_id": "s1",
                "teaching_mode": "first_explanation", "reference_section_ids": []}
        plan = {"sections": [{"title": "机制", "section_id": "s1", "depends_on": [],
                              "items": [item], "reference_only": [], "avoid_repeat": []}]}
        with tempfile.TemporaryDirectory() as folder, \
                patch.object(generation, "project_course_dir", return_value=Path(folder)), \
                patch.object(generation, "load_prompt", return_value="教学系统规则"), \
                patch.object(generation, "call_openai_compatible_chat", return_value=json.dumps(plan)) as model:
            saved, responsibility, frozen = generation._prepare_lesson_plan(12, 99,
                {"base_url": "mock", "api_key": "mock", "model": "mock"}, "plan", context, "hash")
            self.assertEqual(saved["sections"][0]["items"][0]["existing_id"], identity)
            generation._prepare_lesson_plan(12, 99, {}, "plan", context, "hash")
            self.assertEqual(model.call_count, 1)
            self.assertIn('"format":"compact-v2"', model.call_args.args[3][0]["content"])
        body = "概念0 有具体的运行机制。"
        payload = manifest([concept("c", "概念0", existing_id=prompt_id(identity))], [coverage("c", body)])
        parsed = generation._require_generated_manifest(body + "\nTEACHING: " + json.dumps(payload), frozen)
        self.assertEqual(parsed.manifest["concepts"][0]["existing_id"], identity)
        self.assertEqual(audit_section_manifest(responsibility, "s1", parsed.manifest,
            plan_version=responsibility.version, tree_version=context.tree_snapshot), [])


class CompactReferencePersistenceTests(unittest.TestCase):
    def setUp(self):
        from test_qa_records import _setup_temp_db
        from app.services.storage import create_learning_plan_project
        self.temp, self.workspace, _ = _setup_temp_db()
        self.project = create_learning_plan_project("C++", self.workspace / "cpp")

    def tearDown(self):
        self.temp.cleanup()

    def apply(self, payload, project=None):
        from app.services.knowledge_tree_service import apply_manifest
        return apply_manifest(project or self.project.id, payload, source_type="qa", source_path="answer.md",
                              artifact_kind="answer", content_hash="hash", generation_id="gen")

    def test_reuse_reparent_private_isolation_and_unknown_id(self):
        from test_knowledge_tree_forest import manifest, concept
        from app.services.knowledge_tree_service import get_tree_snapshot
        from app.services.storage import create_learning_plan_project
        ids = self.apply(manifest([concept("cpp", "C++"), concept("stl", "STL", "cpp"),
                                   concept("v", "vector", "cpp")]))["ref_to_id"]
        payload = manifest([concept("cpp", "C++", existing_id=prompt_id(ids["cpp"])),
                            concept("stl", "STL", "cpp", existing_id=prompt_id(ids["stl"])),
                            concept("v", "vector", "stl", existing_id=prompt_id(ids["v"]))],
            placement_changes=[{"concept_ref": "v", "from_parent_id": prompt_id(ids["cpp"]),
                                "to_parent_ref": "stl", "reason": "归入容器"}])
        self.assertEqual(self.apply(payload)["ref_to_id"], ids)
        nodes = get_tree_snapshot(self.project.id)["nodes"]
        self.assertEqual(next(n for n in nodes if n["id"] == ids["v"])["parent_id"], ids["stl"])
        other = create_learning_plan_project("private", self.workspace / "private")
        hidden = self.apply(manifest([concept("p", "Private", scope="project")]), other.id)["ref_to_id"]["p"]
        for identity in (prompt_id(hidden), "c_unknown"):
            with self.assertRaisesRegex(ValueError, "Inaccessible"):
                self.apply(manifest([concept("p", "Private", scope="project", existing_id=identity)]))

    def test_qa_short_id_publishes_terms_and_feedback_on_the_original_node(self):
        from test_knowledge_tree_forest import manifest, concept, coverage
        from app.models.schemas import QAAskRequest
        from app.services import qa_service as qa, qa_background, storage
        from app.services.knowledge_tree_service import get_tree_snapshot
        from app.services.teaching_index import document_state
        from app.services.term_service import get_document_term_annotations
        identity = self.apply(manifest([concept("v", "vector")]))["ref_to_id"]["v"]
        from app.services.personalization.teaching.manifest import canonical_comment
        outline = manifest([concept('v', 'vector', existing_id=identity)],
                           [coverage('v', 'vector 将在本课讲解。', kind='planned')])
        outline['outline_knowledge'] = {'major_refs': ['v'], 'repeated_ids': []}
        target = storage.GENERATED_ROOT / str(self.project.id) / 'outline.md'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text('# 总纲\n\nvector 将在本课讲解。\n\n' + canonical_comment(outline), encoding='utf-8', newline='\n')
        body = "vector 的连续存储支持下标访问。"
        payload = manifest([concept("v", "vector", existing_id=prompt_id(identity))],
                           [coverage("v", body)], [{"concept_ref": "v", "text": "vector", "quote": body}])
        storage.set_setting("llm.enabled", "true")
        storage.set_setting("llm.api_key", "mock")
        with patch.object(qa, "project_course_dir", return_value=self.workspace / "qa"):
            prepared = qa.prepare_question(self.project.id, QAAskRequest(source_type="file", question="解释 vector", defer_metadata=True))
            self.assertIn(prompt_id(identity), str(prepared.messages))
            record = qa.finalize_question(prepared, body + "\nTEACHING: " + json.dumps(payload))
            qa_background._run(self.project.id, record.id)
            state = document_state(self.project.id, "qa", str(record.output_path))
            self.assertEqual(state["passages"][0]["concept_id"], identity)
            annotations = get_document_term_annotations(self.project.id, "qa", str(record.output_path))
            self.assertEqual(annotations["candidates"][0]["concept_id"], identity)
            qa.save_understanding(self.project.id, record.id, "理解了", None)
        tree = get_tree_snapshot(self.project.id)
        self.assertEqual(len(tree["nodes"]), 1)
        self.assertEqual(tree["nodes"][0]["id"], identity)
        taught_range = next(r for r in tree["nodes"][0]["ranges"] if r["aspect"] == "机制" and r["dimension"] == "conceptual")
        self.assertEqual(taught_range["familiarity"], "self_reported_understood")
