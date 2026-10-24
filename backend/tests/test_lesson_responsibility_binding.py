"""A writer binds to frozen ownership without comparing prose descriptions."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from app.services import generation_service as generation
from app.services.personalization.teaching.lesson_responsibility import (
    audit_section_manifest, audit_synthesis_manifest, freeze_responsibility_map,
)
from test_lesson_prompt_autonomy import lesson_plan, response
from app.services.personalization.teaching.manifest import merge_manifests, parse_manifest, validate_manifest
from app.services.personalization.teaching.generation_context import GenerationContext


class ResponsibilityBindingTests(unittest.TestCase):
    def setUp(self):
        self.plan = lesson_plan(2)
        self.tree = {"topology_version": 3, "state_version": 4}
        self.frozen = freeze_responsibility_map(self.plan, self.tree)
        rendered = self.frozen.render().split("\n")[1]
        self.bound_plan = json.loads(rendered)

    def manifest(self, index=0):
        item = self.bound_plan["sections"][index]["items"][0]
        value = parse_manifest(response("真实正文。", item)).manifest
        value["coverage"][0]["responsibility_id"] = item["responsibility_id"]
        return value

    def audit(self, value, section="section_1"):
        return audit_section_manifest(self.frozen, section, value,
                                      plan_version=self.frozen.version, tree_version=self.tree)

    def test_explicit_binding_canonicalizes_rephrased_range_without_changing_frozen_version(self):
        original = self.frozen.plan_json
        value = self.manifest()
        value["coverage"][0]["aspect"] = "正文中以另一种说法描述范围"
        self.assertEqual(self.audit(value), [])
        self.assertEqual(value["coverage"][0]["aspect"], "范围 1")
        self.assertEqual(self.frozen.plan_json, original)
        self.assertEqual(freeze_responsibility_map(self.plan, self.tree).render(), self.frozen.render())

    def test_legacy_unbound_paraphrase_is_not_guessed(self):
        value = self.manifest()
        value["coverage"][0].pop("responsibility_id")
        value["coverage"][0]["aspect"] = "另一个范围"
        with self.assertRaisesRegex(ValueError, "扩大了冻结职责"):
            self.audit(value)

    def test_binding_cannot_claim_another_concept_dimension_or_owner(self):
        for field, replacement in (("concept_ref", "other"), ("dimension", "transfer"),
                                   ("responsibility_id", "unknown")):
            with self.subTest(field=field):
                value = self.manifest()
                value["coverage"][0][field] = replacement
                if field == "concept_ref":
                    value["concepts"][0]["ref"] = replacement
                    value["concepts"][0]["name"] = "另一个概念"
                with self.assertRaises(ValueError):
                    self.audit(value)
        with self.assertRaisesRegex(ValueError, "扩大了冻结职责"):
            self.audit(self.manifest(1))

    def test_binding_with_exact_name_recovers_a_response_local_ref_and_missing_existing_id(self):
        self.plan["sections"][0]["items"][0]["existing_id"] = "known"
        self.frozen = freeze_responsibility_map(self.plan, self.tree)
        self.bound_plan = json.loads(self.frozen.render().split("\n")[1])
        value = self.manifest()
        value["concepts"][0]["ref"] = "renamed"
        value["coverage"][0]["concept_ref"] = "renamed"
        self.assertEqual(self.audit(value), [])
        self.assertEqual(value["concepts"][0]["existing_id"], "known")
        value["concepts"][0]["existing_id"] = "other-known"
        with self.assertRaisesRegex(ValueError, "概念身份"):
            self.audit(value)

    def test_synthesis_checks_bound_missing_ranges_and_rejects_duplicates(self):
        value = self.manifest()
        value["coverage"][0]["aspect"] = "另一种描述"
        audit_synthesis_manifest(self.frozen, value, [self.plan["sections"][0]["items"][0]])
        with self.assertRaisesRegex(ValueError, "重复解释"):
            audit_synthesis_manifest(self.frozen, value, [])
        with self.assertRaisesRegex(ValueError, "仍有冻结职责"):
            audit_synthesis_manifest(self.frozen, {"concepts": [], "coverage": []},
                                     [self.plan["sections"][0]["items"][0]])


class LessonResponseCacheTests(unittest.TestCase):
    def test_rejected_response_is_reused_only_after_local_revalidation_passes(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(generation, "GENERATED_ROOT", Path(temporary)), \
                patch.object(generation, "call_openai_compatible_chat", return_value="body") as model:
            args = (1, 95, "section-1", {"base_url": "fixture", "api_key": "fixture", "model": "fixture"}, [], "v1")
            generation._lesson_response(*args)
            validate = Mock()
            self.assertEqual(generation._lesson_response(*args, validate_cached=validate), "body")
            validate.assert_called_once_with("body")
            self.assertEqual(model.call_count, 1)
            validate.side_effect = ValueError("still invalid")
            generation._lesson_response(*args, validate_cached=validate)
            self.assertEqual(model.call_count, 2)

    def test_retry_reuses_successful_sibling_and_frozen_planner_in_both_pipelines(self):
        for writer in ("_run_learning_plan_lesson_task", "_run_repository_lesson_task"):
            with self.subTest(writer=writer), tempfile.TemporaryDirectory() as temporary:
                plan = lesson_plan(2)
                counts = {"planner": 0, "章节 1": 0, "章节 2": 0}
                context = GenerationContext(
                    topology_json='{"topology_version":3,"topology_status":"ready","nodes":[]}',
                    state_json='{"state_version":4,"nodes":[]}',
                    requirements_json='[]', learning_preferences_json='{}')

                def model(_base, _key, _model, messages, **_kwargs):
                    prompt = next(m["content"] for m in messages if m["role"] == "user")
                    if "章节标题：" in prompt:
                        title = prompt.split("章节标题：", 1)[1].splitlines()[0]
                        counts[title] += 1
                        if title == "章节 1" and counts[title] == 1:
                            raise RuntimeError("fixture failure")
                        item = next(s for s in plan["sections"] if s["title"] == title)["items"][0]
                        return response(f"## {title}\n\n{title} 的真实讲解。", item)
                    if "责任编辑" in prompt:
                        return response()
                    counts["planner"] += 1
                    return json.dumps(plan, ensure_ascii=False)

                with patch.object(generation, "GENERATED_ROOT", Path(temporary)), \
                        patch.object(generation, "build_generation_context", return_value=context), \
                        patch.object(generation, "update_generation_task"), \
                        patch.object(generation, "load_prompt", return_value=""), \
                        patch.object(generation, "_debug_dump"), \
                        patch.object(generation, "call_openai_compatible_chat", side_effect=model):
                    args = (1, 95, 1, "课件", "相同材料", "", {"base_url": "fixture", "api_key": "fixture", "model": "fixture"})
                    with self.assertRaisesRegex(RuntimeError, "fixture failure"):
                        getattr(generation, writer)(*args, preview=Mock())
                    _, markdown = getattr(generation, writer)(*args, preview=Mock())
                    self.assertEqual(parse_manifest(markdown).status, "valid")
                self.assertEqual(counts, {"planner": 1, "章节 1": 2, "章节 2": 1})

    def test_only_validated_same_request_same_plan_can_skip_model(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(generation, "GENERATED_ROOT", Path(temporary)), \
                patch.object(generation, "call_openai_compatible_chat", side_effect=["first", "second", "third", "fourth"]) as model:
            settings = {"base_url": "fixture", "api_key": "fixture", "model": "fixture"}
            messages = [{"role": "user", "content": "原始要求"}]
            call = lambda version="v1", msgs=messages: generation._lesson_response(1, 95, "section-1", settings, msgs, version)
            self.assertEqual(call(), "first")
            self.assertEqual(call(), "second")  # An unaudited response is diagnostic data only.
            generation._accept_lesson_response(1, 95, "section-1")
            self.assertEqual(call(), "second")
            self.assertEqual(model.call_count, 2)
            self.assertEqual(call("v2"), "third")
            generation._accept_lesson_response(1, 95, "section-1")
            self.assertEqual(call("v2", [{"role": "user", "content": "变化的要求"}]), "fourth")


class FrozenPlacementRepairTests(unittest.TestCase):
    def test_restoring_known_scope_also_restores_parent_and_includes_missing_ancestors(self):
        context = GenerationContext(
            topology_json=json.dumps({"topology_version": 3, "topology_status": "ready", "nodes": [
                {"id": "root", "name": "通用编程", "domain": "cpp", "scope": "global", "parent_id": None},
                {"id": "known", "name": "已知知识", "domain": "cpp", "scope": "global", "parent_id": "root"},
                {"id": "project", "name": "项目", "domain": "repo", "scope": "project", "parent_id": None},
            ]}), state_json='{"state_version":4,"nodes":[{"id":"root"},{"id":"known"},{"id":"project"}]}',
            requirements_json='[]', learning_preferences_json='{}')
        value = {"schema_version": 2, "concepts": [
            {"ref": "p", "existing_id": "project", "name": "项目", "domain": "repo", "scope": "project", "parent_ref": None},
            {"ref": "c", "existing_id": "known", "name": "已知知识", "domain": "repo", "scope": "project", "parent_ref": "p"},
        ], "coverage": [], "terms": []}
        repaired, _notes = generation._repair_manifest_identity(value, context)
        validate_manifest(repaired)
        by_id = {c["existing_id"]: c for c in repaired["concepts"]}
        self.assertEqual(by_id["known"]["scope"], "global")
        self.assertEqual(by_id["known"]["parent_ref"], by_id["root"]["ref"])
        self.assertEqual(value["concepts"][1]["parent_ref"], "p")


class AssembledQuoteTests(unittest.TestCase):
    def test_same_phrase_keeps_each_chapters_own_anchor_after_assembly(self):
        sources = {"one": "## 客户端\n\n这里讲解术语。客户端继续。",
                   "two": "## 服务端\n\n这里讲解术语。服务端继续。"}
        final = "# 整课\n\n" + "\n\n".join(sources.values())
        value = {"schema_version": 2,
                 "concepts": [{"ref": "term", "name": "术语", "domain": "cpp", "scope": "global"}],
                 "coverage": [{"concept_ref": "term", "aspect": "范围", "dimension": "conceptual",
                               "kind": "explained", "core": True, "quote": "这里讲解术语。"}],
                 "terms": [{"concept_ref": "term", "text": "术语", "quote": "这里讲解术语。"}]}
        parts = [(key, value) for key in sources]
        with self.assertRaisesRegex(ValueError, "唯一定位"):
            merge_manifests(parts, final)
        merged = merge_manifests(parts, final, source_bodies=sources)
        for field in ("coverage", "terms"):
            for namespace, row in zip(sources, merged[field]):
                self.assertEqual(final.count(row["quote"]), 1)
                self.assertIn(row["quote"], sources[namespace])
                self.assertTrue(row["concept_ref"].startswith(namespace + "::"))
        self.assertEqual(value["coverage"][0]["quote"], "这里讲解术语。")
        with self.assertRaisesRegex(ValueError, "章节原文无法唯一定位"):
            merge_manifests(parts, final, source_bodies={"one": "不在整课中的正文"})


if __name__ == "__main__":
    unittest.main()
