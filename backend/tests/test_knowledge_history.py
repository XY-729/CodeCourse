import json
import unittest
from test_personalization_profile import _setup_temp_workspace


class KnowledgeHistoryTests(unittest.TestCase):
    def setUp(self):
        self.workspace = _setup_temp_workspace()
        from app.services import storage
        self.storage = storage
        self.project = storage.create_learning_plan_project("C++", storage.WORKSPACE_ROOT / "plan")

    def tearDown(self):
        self.workspace.cleanup()

    def add(self, name, key):
        return self.storage.upsert_concept(key, "global:general:" + key, name, name, "general", "theory", "[]", 0.5)

    def test_classifies_without_losing_identity_or_evidence_and_hides_isolated_records(self):
        from app.services.knowledge_history import apply_history_classification
        from app.services.personalization.knowledge_state_service import append_evidence
        from app.services.knowledge_tree_service import get_tree_snapshot
        valid = self.add("std::vector", "vector")
        broken = self.add("cout << ??? broken code", "broken")
        append_evidence({"idempotencyKey": "manual-vector", "conceptId": valid.id,
            "scopeType": "global", "scopeId": "local-user", "dimension": "familiarity",
            "direction": "positive", "strength": 1, "reliability": 1,
            "source": "manual", "action": "manual_known", "object": {}, "result": {}, "context": {}})
        plan = {"job_id": "clean-once", "items": [
            {"id": valid.id, "original_name": valid.canonical_name, "status": "keep", "path": ["C++", "容器"]},
            {"id": broken.id, "original_name": broken.canonical_name, "status": "archive", "reason": "代码碎片"},
        ], "project_roots": [{"project_id": self.project.id, "path": ["C++"]}]}
        result = apply_history_classification(plan)
        self.assertEqual(result["created_categories"], 2)
        self.assertEqual(result["archived"], 1)
        tree = get_tree_snapshot(self.project.id)
        nodes = {node["id"]: node for node in tree["nodes"]}
        self.assertNotIn(broken.id, nodes)
        self.assertEqual(nodes[valid.id]["familiarity"], "declared_known")
        self.assertEqual(nodes[nodes[valid.id]["parent_id"]]["name"], "容器")
        with self.storage._connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM learning_evidence_v2").fetchone()[0], 1)
            self.assertEqual(conn.execute("SELECT concept_type FROM concepts WHERE id=?", (broken.id,)).fetchone()[0], "archived")
        self.assertEqual(apply_history_classification(plan)["status"], "already_applied")

    def test_reuses_existing_category_and_rejects_stale_names_transactionally(self):
        from app.services.knowledge_history import apply_history_classification
        from app.services.knowledge_tree_service import get_tree_snapshot
        cpp = self.add("C++", "cpp")
        vector = self.add("vector", "vector")
        items = [
            {"id": cpp.id, "original_name": "C++", "status": "keep", "path": ["C++"]},
            {"id": vector.id, "original_name": "vector", "status": "keep", "path": ["C++", "容器"]},
        ]
        apply_history_classification({"job_id": "reuse", "items": items})
        tree = get_tree_snapshot(self.project.id)
        self.assertEqual(sum(n["name"] == "C++" for n in tree["nodes"]), 1)
        self.assertIsNone(next(n for n in tree["nodes"] if n["id"] == cpp.id)["parent_id"])
        with self.assertRaises(ValueError):
            apply_history_classification({"job_id": "stale", "items": [{
                "id": vector.id, "original_name": "old unrelated name", "status": "archive"}]})
        self.assertIn(vector.id, {n["id"] for n in get_tree_snapshot(self.project.id)["nodes"]})

    def test_concept_api_returns_parent_and_excludes_archived_and_other_private_scopes(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services.knowledge_history import apply_history_classification
        vector = self.add("vector", "vector")
        broken = self.add("unreadable example", "bad")
        other = self.storage.create_learning_plan_project("Other", self.storage.WORKSPACE_ROOT / "other")
        self.storage.upsert_concept("private", "project:" + str(other.id) + ":symbol:secret",
            "secret", "secret", "project", "project_symbol", "[]", 0.5)
        apply_history_classification({"job_id": "api", "items": [
            {"id": vector.id, "original_name": "vector", "status": "keep", "path": ["C++"]},
            {"id": broken.id, "original_name": "unreadable example", "status": "archive"}]})
        result = TestClient(app).get("/api/projects/" + str(self.project.id) + "/personalization/concepts")
        self.assertEqual(result.status_code, 200)
        nodes = {node["id"]: node for node in result.json()}
        self.assertNotIn(broken.id, nodes)
        self.assertNotIn("private", nodes)
        self.assertTrue(nodes[vector.id]["parent_id"])
        self.assertEqual(nodes[vector.id]["placement_status"], "placed")

    def test_archived_identity_does_not_block_future_valid_manifest(self):
        from app.services.knowledge_history import apply_history_classification
        from app.services.knowledge_tree_service import apply_manifest, get_tree_snapshot
        concept = self.storage.upsert_concept("old", "global:local-user:general:vector",
            "vector", "vector", "general", "theory", "[]", 0.5)
        with self.storage._connect() as conn:
            conn.execute("INSERT INTO concept_alias_bindings VALUES('global','local-user','general','vector','old')")
        apply_history_classification({"job_id": "isolate", "items": [
            {"id": concept.id, "original_name": "vector", "status": "archive", "reason": "bad legacy candidate"}]})
        apply_manifest(self.project.id, {"schema_version": 2,
            "concepts": [{"ref": "v", "name": "vector", "domain": "general", "scope": "global", "parent_ref": None}],
            "coverage": [], "terms": []}, source_type="course", source_path="lessons/vector.md",
            artifact_kind="lesson", content_hash="new")
        active = [n for n in get_tree_snapshot(self.project.id)["nodes"] if n["name"] == "vector"]
        self.assertEqual(len(active), 1)
        self.assertNotEqual(active[0]["id"], concept.id)
