"""A7: the archive carries the authoritative forest across platforms.

The desktop database stores the forest under physical names that differ from
Android's. The archive therefore uses canonical tables; this test proves a
desktop export contains them and a fresh import restores parents, plan roots and
user requirements instead of flattening the tree.
"""

from __future__ import annotations

import io
import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

from test_personalization_profile import _setup_temp_workspace


def manifest(concepts):
    return {
        "schema_version": 2,
        "concepts": concepts,
        "coverage": [],
        "terms": [],
        "placement_changes": [],
    }


def concept(ref, name, parent=None, domain="cpp"):
    return {
        "ref": ref, "existing_id": None, "name": name, "domain": domain,
        "scope": "global", "parent_ref": parent, "aliases": [],
    }


class ForestArchiveTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = _setup_temp_workspace()
        from fastapi.testclient import TestClient
        from app.main import app
        self.client = TestClient(app)
        self.project = self.client.post("/api/projects/learning-plan", json={"name": "迁移计划"}).json()
        self.project_id = int(self.project["id"])

    def tearDown(self):
        self._tmpdir.cleanup()

    def seed_forest(self):
        from app.services import storage
        from app.services.knowledge_tree_service import apply_manifest, apply_root_proposal, save_requirement
        applied = apply_manifest(
            self.project_id, manifest([concept("cpp", "C++"), concept("vector", "std::vector", "cpp")]),
            source_type="course", source_path="outline.md", artifact_kind="outline",
            content_hash="hash", generation_id="gen",
        )
        ids = applied["ref_to_id"]
        apply_root_proposal(self.project_id, {
            "concepts": [concept("cpp", "C++")], "root_refs": ["cpp"],
        }, applied["tree_snapshot"])
        save_requirement(self.project_id, "只讲 vector 的扩容", "project", "manual", "action-1")
        with storage._connect() as conn:
            conn.execute(
                """INSERT INTO observer_jobs(id,project_id,qa_record_id,reason,payload_json,status,
                   attempt_count,available_at,created_at,updated_at)
                   VALUES('legacy-job',?,1,'x','{}','pending',0,'2026-10-01','2026-10-01','2026-10-01')""",
                (self.project_id,),
            )
            conn.execute(
                "INSERT OR REPLACE INTO app_settings(key,value,updated_at) VALUES('personalization.observer.enabled','false','2026-10-01')"
            )
            conn.execute(
                "INSERT OR REPLACE INTO app_settings(key,value,updated_at) VALUES('personalization.answer_depth','0.9','2026-10-01')"
            )
            conn.commit()
        return ids

    def test_archive_uses_canonical_tables_and_restores_the_tree(self):
        from app.services import storage
        from app.services.data_transfer import export_data_archive, import_data_archive
        ids = self.seed_forest()
        source_db, source_generated = Path(storage.DB_PATH), Path(storage.GENERATED_ROOT)
        payload, _ = export_data_archive(db_path=source_db, generated_root=source_generated)
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            database = json.loads(archive.read("database.json"))
        tables = database["tables"]
        self.assertIn("concept_placements", tables)
        self.assertIn("plan_concept_roots", tables)
        self.assertIn("plan_root_status", tables)
        self.assertIn("user_teaching_requirements", tables)
        placements = tables["concept_placements"]
        parent_index = placements["columns"].index("parent_concept_id")
        concept_index = placements["columns"].index("concept_id")
        parents = {row[concept_index]: row[parent_index] for row in placements["rows"]}
        self.assertEqual(parents[ids["vector"]], ids["cpp"])
        # The retired opt-out switch never travels as false.
        self.assertEqual(database["settings"]["personalization.observer.enabled"], "true")
        self.assertNotIn("personalization.answer_depth", database["settings"])

        # Import into an empty database in a fresh workspace.
        other = _setup_temp_workspace()
        self.addCleanup(other.cleanup)
        import app.core.config as cfg
        import_data_archive(
            payload,
            db_path=Path(storage.DB_PATH),
            workspace_root=Path(cfg.WORKSPACE_ROOT),
            generated_root=Path(storage.GENERATED_ROOT),
        )
        with storage._connect() as conn:
            nodes = {row["concept_id"]: dict(row) for row in conn.execute("SELECT * FROM concept_tree_nodes")}
            self.assertEqual(nodes[ids["vector"]]["parent_id"], ids["cpp"])
            self.assertEqual(nodes[ids["cpp"]]["placement_status"], "root")
            roots = [row["root_concept_id"] for row in conn.execute(
                "SELECT root_concept_id FROM project_knowledge_roots WHERE project_id=?", (self.project_id,))]
            self.assertEqual(roots, [ids["cpp"]])
            requirements = [dict(row) for row in conn.execute(
                "SELECT scope_type,scope_id,text FROM user_teaching_requirements WHERE active=1")]
            self.assertEqual(requirements[0]["text"], "只讲 vector 的扩容")
            self.assertIn(
                conn.execute("SELECT status FROM observer_jobs WHERE id='legacy-job'").fetchone()[0],
                {"cancelled", "retired"},
            )
            settings = {row["key"]: row["value"] for row in conn.execute("SELECT key,value FROM app_settings")}
            self.assertEqual(settings["personalization.observer.enabled"], "true")
            self.assertNotIn("personalization.answer_depth", settings)
            self.assertGreater(
                conn.execute("SELECT topology_version FROM knowledge_tree_versions WHERE id=1").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
