"""A acceptance: authoritative concept forest, root recognition and factual confirmation.

Covers the cases the plan requires and no existing test owned: plan roots, same-batch
parent references, cycle/multi-parent/private isolation, concurrent identity,
automatic ancestor completion, structural ancestors without quotes, source-scoped
feedback, and zero model calls for confirmation/undo/completion.
"""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from test_personalization_profile import _setup_temp_workspace


def manifest(concepts, coverage=None, terms=None, placement_changes=None):
    return {
        "schema_version": 2,
        "concepts": concepts,
        "coverage": coverage or [],
        "terms": terms or [],
        "placement_changes": placement_changes or [],
    }


def concept(ref, name, parent=None, *, domain="cpp", scope="global", existing_id=None, aliases=None):
    return {
        "ref": ref, "existing_id": existing_id, "name": name, "domain": domain,
        "scope": scope, "parent_ref": parent, "aliases": aliases or [],
    }


def coverage(ref, quote, *, aspect="机制", dimension="conceptual", kind="explained", core=True):
    return {
        "concept_ref": ref, "aspect": aspect, "kind": kind,
        "dimension": dimension, "core": core, "quote": quote,
    }


class ConceptForestTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = _setup_temp_workspace()
        from fastapi.testclient import TestClient
        from app.main import app
        self.client = TestClient(app)
        self.project = self.client.post("/api/projects/learning-plan", json={"name": "C++ 计划"}).json()
        self.other = self.client.post("/api/projects/learning-plan", json={"name": "另一个计划"}).json()

    def tearDown(self):
        self._tmpdir.cleanup()

    # ---- helpers ----

    def apply(self, payload, project=None):
        from app.services.knowledge_tree_service import apply_manifest
        return apply_manifest(
            (project or self.project)["id"], payload,
            source_type="course", source_path="lessons/lesson_1.md",
            artifact_kind="lesson", content_hash="hash", generation_id="gen",
        )

    def placement(self, concept_id):
        from app.services.storage import _connect
        with _connect() as conn:
            return conn.execute(
                "SELECT parent_id,placement_status FROM concept_tree_nodes WHERE concept_id=?",
                (concept_id,),
            ).fetchone()

    def tree(self, project=None):
        from app.services.knowledge_tree_service import get_tree_snapshot
        return get_tree_snapshot((project or self.project)["id"])

    def state_of(self, concept_id):
        from app.services.personalization.knowledge_state_service import get_states
        rows = get_states([("global", "local-user")], [concept_id])
        # No row means no evidence yet: that is exactly "unrecorded".
        return rows[0] if rows else {
            "conceptId": concept_id, "familiarity": "unrecorded", "ranges": [],
            "evidence_ids": [], "source_count": 0,
            "dimensions": {"familiarity": {"status": "uncertain", "manualStatus": None}},
        }

    # ---- roots ----

    def test_plan_roots_are_pending_then_linked_and_shared(self):
        from app.services.knowledge_tree_service import (
            apply_root_proposal, get_root_status, link_project_roots,
        )
        self.assertEqual(get_root_status(self.project["id"])["status"], "pending")
        ids = self.apply(manifest([concept("cpp", "C++")]))["ref_to_id"]
        tree = self.tree()
        status = apply_root_proposal(
            self.project["id"], {"concepts": [concept("cpp", "C++", existing_id=ids["cpp"])], "root_refs": ["cpp"]},
            tree["tree_snapshot"],
        )
        self.assertEqual(status["status"], "ready")
        self.assertEqual(status["root_concept_ids"], [ids["cpp"]])
        # A second plan links the same reusable global root without a new identity.
        again = self.apply(manifest([concept("cpp", "C++")]), project=self.other)["ref_to_id"]
        self.assertEqual(again["cpp"], ids["cpp"])
        linked = link_project_roots(self.other["id"], [ids["cpp"]], self.tree()["tree_snapshot"]["topology_version"])
        self.assertEqual(linked["status"], "ready")
        self.assertEqual(get_root_status(self.project["id"])["status"], "ready")

    # ---- same-batch parents ----

    def test_same_batch_parent_chain_is_created_and_reused(self):
        payload = manifest([
            concept("cpp", "C++"),
            concept("stl", "STL 容器", "cpp"),
            concept("vector", "std::vector", "stl", aliases=["vector"]),
        ])
        first = self.apply(payload)["ref_to_id"]
        self.assertEqual(self.placement(first["cpp"])["placement_status"], "root")
        self.assertEqual(self.placement(first["stl"])["parent_id"], first["cpp"])
        self.assertEqual(self.placement(first["vector"])["parent_id"], first["stl"])
        topology = self.tree()["tree_snapshot"]["topology_version"]
        # Re-applying the same proposal reuses every identity and edge.
        second = self.apply(manifest([
            concept("cpp", "C++"),
            concept("stl", "STL 容器", "cpp"),
            concept("vector", "std::vector", "stl"),
        ]))["ref_to_id"]
        self.assertEqual(second, first)
        self.assertEqual(self.tree()["tree_snapshot"]["topology_version"], topology)

    def test_missing_intermediate_and_full_ancestor_chain_are_completed(self):
        existing = self.apply(manifest([concept("cpp", "C++")]))["ref_to_id"]
        # C++ exists, STL 容器 is missing: the response supplies the middle layer.
        completed = self.apply(manifest([
            concept("cpp", "C++", existing_id=existing["cpp"]),
            concept("stl", "STL 容器", "cpp"),
            concept("vector", "std::vector", "stl"),
        ]))["ref_to_id"]
        self.assertEqual(completed["cpp"], existing["cpp"])
        self.assertEqual(self.placement(completed["vector"])["parent_id"], completed["stl"])
        # A brand-new branch lists its existing ancestor so parent_ref stays resolvable.
        chain = self.apply(manifest([
            concept("cpp", "C++", existing_id=existing["cpp"]),
            concept("thread", "多线程", "cpp"),
            concept("mutex", "互斥量", "thread"),
            concept("deadlock", "死锁", "mutex"),
        ]))["ref_to_id"]
        self.assertEqual(self.placement(chain["thread"])["parent_id"], existing["cpp"])
        self.assertEqual(self.placement(chain["mutex"])["parent_id"], chain["thread"])
        self.assertEqual(self.placement(chain["deadlock"])["parent_id"], chain["mutex"])

    def test_legacy_orphan_without_parent_is_auto_parented_once(self):
        from app.services.storage import _connect
        existing = self.apply(manifest([concept("cpp", "C++")]))["ref_to_id"]
        orphan = self.apply(manifest([concept("iter", "迭代器", domain="cpp")]))["ref_to_id"]
        with _connect() as conn:
            conn.execute("UPDATE concept_tree_nodes SET parent_id=NULL,placement_status='pending' WHERE concept_id=?",
                         (orphan["iter"],))
            conn.commit()
        # A later manifest may attach the existing orphan without a manual step.
        self.apply(manifest([
            concept("cpp", "C++", existing_id=existing["cpp"]),
            concept("iter", "迭代器", "cpp", existing_id=orphan["iter"]),
        ]))
        self.assertEqual(self.placement(orphan["iter"])["parent_id"], existing["cpp"])
        self.assertEqual(self.placement(orphan["iter"])["placement_status"], "placed")

    def test_already_placed_parent_requires_explicit_change_and_reports_conflicts(self):
        from app.services.storage import _connect
        ids = self.apply(manifest([
            concept("cpp", "C++"), concept("stl", "STL 容器", "cpp"), concept("vector", "std::vector", "stl"),
        ]))["ref_to_id"]
        reparent = manifest([
            concept("cpp", "C++", existing_id=ids["cpp"]),
            concept("stl", "STL 容器", "cpp", existing_id=ids["stl"]),
            concept("vector", "std::vector", "cpp", existing_id=ids["vector"]),
        ])
        with self.assertRaises(ValueError):
            self.apply(reparent)
        # A stale proposal keeps the authoritative edge and records the conflict.
        stale = json.loads(json.dumps(reparent))
        stale["placement_changes"] = [{
            "concept_ref": "vector", "from_parent_id": "stale-parent",
            "to_parent_ref": "cpp", "reason": "补父",
        }]
        result = self.apply(stale)
        self.assertEqual(self.placement(ids["vector"])["parent_id"], ids["stl"])
        self.assertTrue(any(issue["kind"] == "placement_conflict" for issue in result["issues"]))
        with _connect() as conn:
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM knowledge_tree_issues WHERE kind='placement_conflict'").fetchone()[0], 1)
        # The current parent makes the change apply.
        applied = json.loads(json.dumps(reparent))
        applied["placement_changes"] = [{
            "concept_ref": "vector", "from_parent_id": ids["stl"],
            "to_parent_ref": "cpp", "reason": "改为直达 C++",
        }]
        self.apply(applied)
        self.assertEqual(self.placement(ids["vector"])["parent_id"], ids["cpp"])

    # ---- invalid topology ----

    def test_global_child_cannot_depend_on_private_parent(self):
        project_symbol = self.apply(manifest([
            concept("sym", "Widget", scope="project", domain="widget"),
        ]))["ref_to_id"]
        with self.assertRaises(ValueError):
            self.apply(manifest([
                concept("sym", "Widget", scope="project", domain="widget", existing_id=project_symbol["sym"]),
                concept("child", "通用子概念", "sym"),
            ]))

    def test_manifest_cycle_and_multiple_parents_are_rejected(self):
        with self.assertRaises(ValueError):
            self.apply(manifest([
                concept("a", "A", "b"),
                concept("b", "B", "a"),
            ]))
        ids = self.apply(manifest([concept("cpp", "C++"), concept("stl", "STL 容器", "cpp")]))["ref_to_id"]
        with self.assertRaises(ValueError):
            self.apply(manifest([
                concept("cpp", "C++", existing_id=ids["cpp"]),
                concept("stl", "STL 容器", "cpp", existing_id=ids["stl"]),
                concept("stl_dup", "STL 容器", None, existing_id=ids["stl"]),
            ]))

    def test_private_symbols_are_isolated_between_plans(self):
        mine = self.apply(manifest([
            concept("sym", "Widget", scope="project", domain="widget"),
        ]))["ref_to_id"]
        other_tree = self.tree(self.other)
        self.assertNotIn(mine["sym"], [node["id"] for node in other_tree["nodes"]])
        with self.assertRaises(ValueError):
            self.apply(manifest([
                concept("sym", "Widget", scope="project", domain="widget", existing_id=mine["sym"]),
            ]), project=self.other)

    # ---- facts ----

    def test_generated_coverage_never_becomes_understanding(self):
        ids = self.apply(manifest(
            [concept("vector", "std::vector")],
            [coverage("vector", "vector 连续存储元素。")],
        ))["ref_to_id"]
        state = self.state_of(ids["vector"])
        self.assertEqual(state["familiarity"], "unrecorded")
        self.assertEqual(state["ranges"], [])
        self.assertNotEqual(state["dimensions"]["familiarity"]["status"], "confirmed")

    def test_structural_ancestor_stays_without_evidence(self):
        ids = self.apply(manifest(
            [concept("cpp", "C++"), concept("stl", "STL 容器", "cpp"), concept("vector", "std::vector", "stl")],
            [coverage("vector", "vector 连续存储元素。")],
        ))["ref_to_id"]
        for concept_id in (ids["cpp"], ids["stl"], ids["vector"]):
            state = self.state_of(concept_id)
            self.assertEqual(state["familiarity"], "unrecorded")
            self.assertEqual(state["ranges"], [])

    def test_completion_and_understanding_are_local_and_reversible(self):
        from app.services import storage, teaching_index as index
        from app.services.personalization.knowledge_state_service import get_states
        path = storage.GENERATED_ROOT / str(self.project["id"]) / "lessons/lesson_1.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        content = (
            "# 借用\n\n共享借用允许同时读取，而可变借用要求独占访问。\n\n"
            "<!-- codecourse-teaching: " + json.dumps({
                "schema_version": 2,
                "concepts": [concept("borrow", "借用")],
                "coverage": [coverage("borrow", "共享借用允许同时读取，而可变借用要求独占访问。", aspect="共享与可变借用")],
                "terms": [],
            }, ensure_ascii=False, separators=(",", ":")) + " -->\n"
        )
        path.write_text(content, encoding="utf-8", newline="\n")
        document = index.document_state(self.project["id"], "course", "lessons/lesson_1.md")
        self.assertEqual(document["indexStatus"], "complete")
        passage_ids = [passage["id"] for passage in document["passages"]]
        with patch("app.services.llm_client.call_openai_compatible_chat_result") as model, \
             patch("app.services.generation_service.call_openai_compatible_chat") as generation_model:
            understood = index.save_feedback(
                self.project["id"], "course", "lessons/lesson_1.md", "understood",
                passage_ids, document["contentHash"], "action-1")
            self.assertEqual(understood["status"], "understood")
            cleared = index.save_feedback(
                self.project["id"], "course", "lessons/lesson_1.md", "clear",
                passage_ids, document["contentHash"], "action-2")
            self.assertEqual(cleared["status"], "pending")
            reconfirmed = index.save_feedback(
                self.project["id"], "course", "lessons/lesson_1.md", "understood",
                passage_ids, document["contentHash"], "action-3")
            self.assertEqual(reconfirmed["status"], "understood")
            model.assert_not_called()
            generation_model.assert_not_called()
        # A new action id creates new evidence instead of reviving the voided one.
        self.assertEqual(len(reconfirmed["feedback"]), 1)
        state = get_states([("global", "local-user")], [document["passages"][0]["concept_id"]])[0]
        self.assertEqual(state["familiarity"], "self_reported_understood")
        self.assertNotEqual(state["dimensions"]["familiarity"]["status"], "confirmed")

    def test_removing_one_source_keeps_evidence_from_another(self):
        from app.services import storage, teaching_index as index
        from app.services.personalization.knowledge_state_service import get_states

        def write(path, quote):
            target = storage.GENERATED_ROOT / str(self.project["id"]) / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(
                f"# 课程\n\n{quote}\n\n<!-- codecourse-teaching: " + json.dumps({
                    "schema_version": 2,
                    "concepts": [concept("vector", "std::vector")],
                    "coverage": [coverage("vector", quote, aspect="连续存储")],
                    "terms": [],
                }, ensure_ascii=False, separators=(",", ":")) + " -->\n",
                encoding="utf-8", newline="\n")

        write("lessons/lesson_a.md", "vector 的连续存储让随机访问很快。")
        write("lessons/lesson_b.md", "vector 连续存储在缓存上更友好。")
        first = index.document_state(self.project["id"], "course", "lessons/lesson_a.md")
        second = index.document_state(self.project["id"], "course", "lessons/lesson_b.md")
        index.save_feedback(self.project["id"], "course", "lessons/lesson_a.md", "understood",
                            [p["id"] for p in first["passages"]], first["contentHash"], "a")
        index.save_feedback(self.project["id"], "course", "lessons/lesson_b.md", "understood",
                            [p["id"] for p in second["passages"]], second["contentHash"], "b")
        concept_id = first["passages"][0]["concept_id"]
        self.assertEqual(get_states([("global", "local-user")], [concept_id])[0]["familiarity"],
                         "self_reported_understood")
        with storage._connect() as conn:
            index.remove_documents(conn, self.project["id"], "lessons/lesson_a.md")
            conn.commit()
        state = get_states([("global", "local-user")], [concept_id])[0]
        self.assertEqual(state["familiarity"], "self_reported_understood")
        self.assertTrue(any(source.get("source_path") == "lessons/lesson_b.md"
                            for item in state["ranges"] for source in item["sources"]))

    def test_legacy_prior_stays_unknown_and_old_queues_never_write(self):
        from app.services import storage
        from app.services.personalization.knowledge_state_service import get_states
        from app.services.personalization.interaction_observer import recover_pending_observer_jobs
        concept_row = storage.upsert_concept(
            concept_id="legacy", concept_key="global:general:legacy",
            canonical_name="legacy", display_name="legacy",
            domain="general", concept_type="theory", aliases_json="[]", difficulty=.5)
        with storage._connect() as conn:
            conn.execute(
                """INSERT INTO concept_mastery(id,concept_id,scope_type,scope_id,known_evidence,
                   unknown_evidence,mastery,uncertainty,manual_status,sequence,last_seen_at,updated_at)
                   VALUES('m',?,'global','local-user',1,1,0.35,1, NULL,0,'2026-01-01','2026-01-01')""",
                (concept_row.id,),
            )
            conn.execute(
                """INSERT INTO observer_jobs(id,project_id,qa_record_id,reason,payload_json,status,
                   attempt_count,available_at,created_at,updated_at)
                   VALUES('legacy',?,'1','x','{}','pending',0,'2026-01-01','2026-01-01','2026-01-01')""",
                (self.project["id"],),
            )
            conn.commit()
        recover_pending_observer_jobs()
        # A prior score is migration history, not a familiarity fact.
        state = self.state_of(concept_row.id)
        self.assertEqual(state["familiarity"], "unrecorded")
        self.assertNotEqual(state["dimensions"]["familiarity"]["status"], "confirmed")
        with storage._connect() as conn:
            self.assertIn(conn.execute("SELECT status FROM observer_jobs WHERE id='legacy'").fetchone()[0],
                          {"cancelled", "retired"})
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM learning_evidence_v2").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
