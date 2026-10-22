"""Regression coverage for the 2026-10-22 acceptance findings R02/R05/R08/R09/R10.

R02: GET /terms is the authoritative span/identity sidecar, so two concepts that
     share a spelling are both returned instead of collapsing into one row.
R05: term-display-profiles carries the factual familiarity/ranges/tree snapshot,
     keyed by the identifier the caller used (UUID or business key).
R08: the actual Markdown generation protocol includes placement_changes and the
     automatic-parent rule, not only the parser.
R09: a plain first question records a neutral asked_question contact.
R10: deleting the answer voids the facts that answer created, and only those.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_personalization_profile import _setup_temp_workspace  # noqa: E402


def manifest(payload: dict) -> str:
    body = payload.pop("body")
    return f"{body}\n\n<!-- codecourse-teaching: {json.dumps(payload, ensure_ascii=False)} -->"


class Acceptance20261022Tests(unittest.TestCase):
    def setUp(self):
        self.workspace = _setup_temp_workspace()
        from fastapi.testclient import TestClient
        from app.main import app
        self.client = TestClient(app)
        self.project = self.client.post("/api/projects/learning-plan", json={"name": "验收计划"}).json()["id"]

    def tearDown(self):
        self.workspace.cleanup()

    def publish_homonyms(self) -> dict:
        from app.services.personalization.teaching.publication import publish_course_document
        body = (
            "# 课件\n\n"
            "C++ 的 stack 是后进先出的容器适配器。\n\n"
            "Python 的 stack 通常用 list 模拟。"
        )
        content = manifest({
            "body": body,
            "schema_version": 2,
            "concepts": [
                {"ref": "cpp_stack", "existing_id": None, "name": "stack", "domain": "cpp",
                 "scope": "global", "parent_ref": None, "aliases": []},
                {"ref": "py_stack", "existing_id": None, "name": "stack", "domain": "python",
                 "scope": "global", "parent_ref": None, "aliases": []},
            ],
            "coverage": [
                {"concept_ref": "cpp_stack", "aspect": "LIFO 语义", "kind": "explained",
                 "dimension": "conceptual", "core": True, "quote": "C++ 的 stack 是后进先出的容器适配器。"},
                {"concept_ref": "py_stack", "aspect": "list 模拟", "kind": "explained",
                 "dimension": "implementation", "core": True, "quote": "Python 的 stack 通常用 list 模拟。"},
            ],
            "terms": [
                {"concept_ref": "cpp_stack", "text": "stack", "quote": "C++ 的 stack 是后进先出的容器适配器。"},
                {"concept_ref": "py_stack", "text": "stack", "quote": "Python 的 stack 通常用 list 模拟。"},
            ],
        })
        publish_course_document(self.project, "lessons/homonyms.md", content)
        from app.services.teaching_index import document_state
        return document_state(self.project, "course", "lessons/homonyms.md")

    def test_same_spelling_terms_keep_both_identities_and_spans(self):
        state = self.publish_homonyms()
        response = self.client.get(
            f"/api/projects/{self.project}/terms",
            params={"source_type": "course", "source_path": "lessons/homonyms.md"},
        )
        self.assertEqual(response.status_code, 200)
        items = response.json()
        spans = {(item["concept_id"], item["source_span"]["start"], item["source_span"]["end"]) for item in items}
        self.assertEqual(len({item["concept_id"] for item in items}), 2)
        self.assertEqual(len(spans), 2)
        self.assertTrue(all(item["term_text"] == "stack" for item in items))
        # Both are real entities and the quotes are span-specific.
        self.assertEqual(len({item["quote"] for item in items}), 2)
        for item in items:
            self.assertIn("familiarity", item)
            self.assertIn("tree_snapshot", item)
        self.assertEqual(len(state["passages"]), 2)

    def test_term_display_profiles_return_factual_ranges_and_echo_identity(self):
        from app.services import storage
        state = self.publish_homonyms()
        passage = next(item for item in state["passages"] if item["aspect"] == "LIFO 语义")
        concept_id = passage["concept_id"]
        from app.services.teaching_index import save_feedback
        save_feedback(self.project, "course", "lessons/homonyms.md", "understood",
                      [passage["id"]], state["contentHash"], "accept-understood")
        for requested in (concept_id, "global:local-user:cpp:stack"):
            response = self.client.post(
                f"/api/projects/{self.project}/personalization/term-display-profiles",
                json={"concept_keys": [requested]},
            )
            self.assertEqual(response.status_code, 200)
            profile = response.json()["profiles"][0]
            self.assertEqual(profile["concept_key"], requested)
            self.assertEqual(profile["concept_id"], concept_id)
            self.assertEqual(profile["familiarity"], "self_reported_understood")
            self.assertTrue(any(item["aspect"] == "LIFO 语义" for item in profile["ranges"]))
            self.assertIsInstance(profile["tree_snapshot"]["topology_version"], int)
            self.assertIsInstance(profile["tree_snapshot"]["state_version"], int)

    def test_generation_protocol_includes_placement_changes_and_auto_parent(self):
        from app.services.prompt_contracts import compose_system_prompt
        markdown = compose_system_prompt("可编辑规则", "markdown")
        self.assertIn("placement_changes", markdown)
        self.assertIn("补父", markdown)
        self.assertIn("from_parent_id", markdown)
        self.assertIn("先匹配、后创建", markdown)
        # The JSON kinds stay JSON-only and do not swallow the manifest protocol.
        self.assertNotIn("placement_changes", compose_system_prompt("可编辑规则", "json"))

    def test_plain_first_question_records_neutral_contact_and_deletion_revokes_it(self):
        from app.services import personalization_service, storage
        from app.services.personalization.knowledge_state_service import get_states
        concept = personalization_service.resolve_concept(self.project, "vector", "rule", 0.9)
        record = storage.create_qa_record(
            self.project, "course", None, "", "vector 是什么？", "# 回答\n\nvector 是连续存储的动态数组。",
            "test", "test", relation_type="follow_up",
        )
        personalization_service.record_question_learning(self.project, record)
        state = get_states([("global", "local-user")], [concept.id])[0]
        self.assertEqual(state["familiarity"], "encountered")
        self.assertTrue(state["ranges"])
        from app.services.storage import _connect
        with _connect() as conn:
            rows = conn.execute(
                "SELECT action FROM learning_evidence_v2 WHERE concept_id=? AND voided=0", (concept.id,)
            ).fetchall()
        self.assertIn("asked_question", {row["action"] for row in rows})

        # A different answer mentioning the same concept must stay valid.
        other = storage.create_qa_record(
            self.project, "course", None, "", "vector 和 list 的区别？", "# 回答\n\n两者不同。",
            "test", "test", relation_type="follow_up",
        )
        personalization_service.record_question_learning(self.project, other)
        storage.delete_qa_record(self.project, record.id)
        remaining = get_states([("global", "local-user")], [concept.id])[0]
        self.assertEqual(remaining["familiarity"], "encountered")  # still touched by the other answer
        with _connect() as conn:
            alive = conn.execute(
                """SELECT COUNT(*) FROM learning_evidence_v2 e
                   WHERE e.concept_id=? AND e.action='asked_question' AND NOT EXISTS (
                     SELECT 1 FROM learning_evidence_v2 v
                     WHERE v.target_evidence_id=e.id AND v.action='void_evidence' AND v.voided=0)""",
                (concept.id,),
            ).fetchone()[0]
            voided = conn.execute(
                "SELECT COUNT(*) FROM learning_evidence_v2 WHERE concept_id=? AND action='void_evidence'",
                (concept.id,),
            ).fetchone()[0]
        self.assertEqual(alive, 1)
        self.assertGreaterEqual(voided, 1)

    def test_deleting_the_only_answer_returns_to_unrecorded(self):
        from app.services import personalization_service, storage
        from app.services.personalization.knowledge_state_service import get_states
        concept = personalization_service.resolve_concept(self.project, "mutex", "rule", 0.9)
        record = storage.create_qa_record(
            self.project, "course", None, "", "mutex 是什么？", "# 回答\n\nmutex 是互斥量。",
            "test", "test", relation_type="follow_up",
        )
        personalization_service.record_question_learning(self.project, record)
        self.assertEqual(get_states([("global", "local-user")], [concept.id])[0]["familiarity"], "encountered")
        storage.delete_qa_record(self.project, record.id)
        self.assertEqual(get_states([("global", "local-user")], [concept.id])[0]["familiarity"], "unrecorded")


if __name__ == "__main__":
    unittest.main()
