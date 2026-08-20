import io
import json
import sqlite3
import tempfile
import unittest
import zipfile
from contextlib import closing
from pathlib import Path
from unittest.mock import patch


def _init_workspace(root: Path) -> tuple[Path, Path, Path]:
    import app.core.config as cfg
    import app.services.storage as storage

    db_path = root / "app.db"
    repos_root = root / "repos"
    generated_root = root / "generated"
    cfg.DB_PATH = db_path
    cfg.WORKSPACE_ROOT = root
    cfg.REPOS_ROOT = repos_root
    cfg.GENERATED_ROOT = generated_root
    storage.DB_PATH = db_path
    storage.WORKSPACE_ROOT = root
    storage.REPOS_ROOT = repos_root
    storage.GENERATED_ROOT = generated_root
    storage.init_storage()
    return db_path, repos_root, generated_root


def _seed_source(db_path: Path, repos_root: Path, generated_root: Path) -> None:
    stamp = "2026-08-20T12:00:00+00:00"
    repo = repos_root / "portable-source"
    (repo / "src").mkdir(parents=True)
    (repo / "src" / "main.py").write_text("print('portable')\n", encoding="utf-8")
    (repo / "README.md").write_text("# Portable project\n", encoding="utf-8")
    course = generated_root / "7"
    course.mkdir(parents=True)
    (course / "outline.md").write_text("# 项目总纲\n\n迁移测试\n", encoding="utf-8")

    with closing(sqlite3.connect(db_path)) as conn:
        conn.execute(
            """INSERT INTO projects
               (id,name,url,local_path,status,created_at,updated_at,repo_key,project_type)
               VALUES(7,'Portable','https://example.test/portable',?,'ready',?,?,?,'repository')""",
            (str(repo), stamp, stamp, "example/portable"),
        )
        conn.execute(
            """INSERT INTO qa_sessions
               (id,project_id,title,memory_summary,active_source_path,created_at,updated_at)
               VALUES(31,7,'迁移问答','保留上下文','outline.md',?,?)""",
            (stamp, stamp),
        )
        conn.execute(
            """INSERT INTO qa_records
               (id,project_id,session_id,parent_qa_id,relation_type,source_type,source_path,
                display_title,selected_text,question,answer_md,provider,model,output_path,
                retrieval_trace,retrieval_sources_json,favorite,created_at,updated_at)
               VALUES(41,7,31,NULL,'follow_up','course','outline.md','为什么','迁移',
                      '为什么？','因为关系会保留。','deepseek','deepseek-chat',NULL,
                      '{}','[]',1,?,?)""",
            (stamp, stamp),
        )
        conn.execute(
            """INSERT INTO knowledge_nodes
               (id,project_id,node_type,title,ref_type,ref_id,ref_path,summary,x,y,created_at,updated_at)
               VALUES(51,7,'course','项目总纲','course',NULL,'outline.md','总纲',10,20,?,?)""",
            (stamp, stamp),
        )
        conn.execute(
            """INSERT INTO knowledge_nodes
               (id,project_id,node_type,title,ref_type,ref_id,ref_path,summary,x,y,created_at,updated_at)
               VALUES(52,7,'qa','为什么','qa',41,NULL,'问答',30,40,?,?)""",
            (stamp, stamp),
        )
        conn.execute(
            """INSERT INTO knowledge_edges
               (id,project_id,source_node_id,target_node_id,relation_type,label,created_at,updated_at)
               VALUES(61,7,51,52,'explains','解释',?,?)""",
            (stamp, stamp),
        )
        conn.execute(
            """INSERT INTO learning_states
               (id,project_id,source_type,source_path,status,position_kind,position_value,
                last_opened_at,completed_at,updated_at)
               VALUES(71,7,'course','outline.md','in_progress','scroll_ratio',0.42,?,NULL,?)""",
            (stamp, stamp),
        )
        conn.execute(
            "INSERT INTO app_settings(key,value,updated_at) VALUES('llm.api_key','source-secret',?)",
            (stamp,),
        )
        conn.execute(
            "INSERT INTO app_settings(key,value,updated_at) VALUES('reader.font_size','18',?)",
            (stamp,),
        )
        conn.commit()


def _rewrite_archive(payload: bytes, transform) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(payload)) as source, zipfile.ZipFile(
        output, "w", compression=zipfile.ZIP_DEFLATED,
    ) as target:
        for info in source.infolist():
            name, content = transform(info.filename, source.read(info.filename))
            target.writestr(name, content)
    return output.getvalue()


class DataTransferTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        self.source_root = root / "source"
        self.target_root = root / "target"
        self.source_root.mkdir()
        self.target_root.mkdir()
        self.source_db, self.source_repos, self.source_generated = _init_workspace(self.source_root)
        _seed_source(self.source_db, self.source_repos, self.source_generated)

        from app.services.data_transfer import export_data_archive

        self.payload, self.filename = export_data_archive(
            db_path=self.source_db,
            generated_root=self.source_generated,
        )

    def tearDown(self):
        self.tempdir.cleanup()

    def test_round_trip_preserves_relations_and_keeps_secrets_device_local(self):
        with zipfile.ZipFile(io.BytesIO(self.payload)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            database = json.loads(archive.read("database.json"))
            self.assertEqual(manifest["format"], "codecourse-data-archive")
            self.assertEqual(manifest["project_count"], 1)
            self.assertNotIn("llm.api_key", database["settings"])
            self.assertNotIn("code_chunks", database["tables"])

        target_db, _target_repos, target_generated = _init_workspace(self.target_root)
        stamp = "2026-08-20T13:00:00+00:00"
        with closing(sqlite3.connect(target_db)) as conn:
            conn.execute(
                "INSERT INTO app_settings(key,value,updated_at) VALUES('llm.api_key','target-secret',?)",
                (stamp,),
            )
            conn.commit()

        from app.services.data_transfer import import_data_archive

        result = import_data_archive(
            self.payload,
            db_path=target_db,
            workspace_root=self.target_root,
            generated_root=target_generated,
        )
        self.assertTrue(result["imported"])
        self.assertEqual(result["project_count"], 1)
        self.assertEqual(
            (self.target_root / "portable-projects" / "7" / "repo" / "src" / "main.py").read_text(encoding="utf-8"),
            "print('portable')\n",
        )
        self.assertIn("项目总纲", (target_generated / "7" / "outline.md").read_text(encoding="utf-8"))

        with closing(sqlite3.connect(target_db)) as conn:
            conn.row_factory = sqlite3.Row
            project = conn.execute("SELECT * FROM projects").fetchone()
            self.assertEqual(project["id"], 7)
            self.assertEqual(
                Path(project["local_path"]),
                (self.target_root / "portable-projects" / "7" / "repo").resolve(),
            )
            self.assertEqual(conn.execute("SELECT id FROM qa_records").fetchone()[0], 41)
            edge = conn.execute("SELECT source_node_id,target_node_id FROM knowledge_edges").fetchone()
            self.assertEqual(tuple(edge), (51, 52))
            self.assertAlmostEqual(conn.execute("SELECT position_value FROM learning_states").fetchone()[0], 0.42)
            settings = dict(conn.execute("SELECT key,value FROM app_settings"))
            self.assertEqual(settings["llm.api_key"], "target-secret")
            self.assertEqual(settings["reader.font_size"], "18")
            self.assertEqual(settings["llm.enabled"], "false")

    def test_rejects_path_traversal_and_unsupported_version(self):
        from app.services.data_transfer import DataTransferError, import_data_archive

        traversal = io.BytesIO(self.payload)
        with zipfile.ZipFile(traversal, "a", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("../outside.txt", "bad")
        target_db, _repos, target_generated = _init_workspace(self.target_root)
        with self.assertRaisesRegex(DataTransferError, "路径"):
            import_data_archive(
                traversal.getvalue(),
                db_path=target_db,
                workspace_root=self.target_root,
                generated_root=target_generated,
            )

        def bump_version(name: str, content: bytes):
            if name == "manifest.json":
                value = json.loads(content)
                value["version"] = 999
                return name, json.dumps(value).encode()
            return name, content

        unsupported = _rewrite_archive(self.payload, bump_version)
        with self.assertRaisesRegex(DataTransferError, "版本"):
            import_data_archive(
                unsupported,
                db_path=target_db,
                workspace_root=self.target_root,
                generated_root=target_generated,
            )

    def test_database_failure_restores_files_and_rows(self):
        target_db, _repos, target_generated = _init_workspace(self.target_root)
        old_projects = self.target_root / "portable-projects"
        old_projects.mkdir()
        (old_projects / "old.txt").write_text("old project", encoding="utf-8")
        target_generated.mkdir(exist_ok=True)
        (target_generated / "old.md").write_text("old course", encoding="utf-8")
        stamp = "2026-08-20T13:00:00+00:00"
        with closing(sqlite3.connect(target_db)) as conn:
            conn.execute(
                """INSERT INTO projects
                   (id,name,url,local_path,status,created_at,updated_at,repo_key,project_type)
                   VALUES(99,'Existing','',?,'ready',?,?,?,'learning_plan')""",
                (str(old_projects), stamp, stamp, "existing"),
            )
            conn.commit()

        from app.services.data_transfer import import_data_archive

        with patch("app.services.data_transfer._insert_snapshot_table", side_effect=RuntimeError("forced")):
            with self.assertRaisesRegex(RuntimeError, "forced"):
                import_data_archive(
                    self.payload,
                    db_path=target_db,
                    workspace_root=self.target_root,
                    generated_root=target_generated,
                )
        self.assertEqual((old_projects / "old.txt").read_text(encoding="utf-8"), "old project")
        self.assertEqual((target_generated / "old.md").read_text(encoding="utf-8"), "old course")
        with closing(sqlite3.connect(target_db)) as conn:
            self.assertEqual(conn.execute("SELECT id FROM projects").fetchone()[0], 99)


if __name__ == "__main__":
    unittest.main()
