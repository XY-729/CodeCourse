import sqlite3
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


def _setup_temp_workspace():
    import app.core.config as cfg
    import app.services.generation_service as generation_service
    import app.services.storage as storage
    import app.services.local_import_service as local_import
    import app.services.code_intelligence as code_intelligence
    import app.services.index_service as index_service

    tmpdir = tempfile.TemporaryDirectory()
    workspace = Path(tmpdir.name)
    cfg.DB_PATH = workspace / "app.db"
    cfg.WORKSPACE_ROOT = workspace
    cfg.REPOS_ROOT = workspace / "repos"
    cfg.GENERATED_ROOT = workspace / "generated"
    cfg.CODE_INTELLIGENCE_CACHE_ROOT = workspace / "code-intelligence-cache"
    cfg.CODE_INTELLIGENCE_SNAPSHOTS_ROOT = workspace / "code-intelligence-snapshots"

    storage.DB_PATH = cfg.DB_PATH
    storage.WORKSPACE_ROOT = cfg.WORKSPACE_ROOT
    storage.REPOS_ROOT = cfg.REPOS_ROOT
    storage.GENERATED_ROOT = cfg.GENERATED_ROOT
    generation_service.GENERATED_ROOT = cfg.GENERATED_ROOT
    local_import.REPOS_ROOT = cfg.REPOS_ROOT

    code_intelligence.REPOS_ROOT = cfg.REPOS_ROOT
    code_intelligence.CODE_INTELLIGENCE_CACHE_ROOT = cfg.CODE_INTELLIGENCE_CACHE_ROOT
    code_intelligence.CODE_INTELLIGENCE_SNAPSHOTS_ROOT = cfg.CODE_INTELLIGENCE_SNAPSHOTS_ROOT

    index_service.DB_PATH = cfg.DB_PATH

    with index_service._BUILDING_LOCK_MUTEX:
        index_service._BUILDING_LOCKS.clear()

    import app.api.projects as project_api
    project_api.REPOS_ROOT = cfg.REPOS_ROOT

    import app.services.project_deletion_service as deletion_svc
    deletion_svc.REPOS_ROOT = cfg.REPOS_ROOT
    deletion_svc.GENERATED_ROOT = cfg.GENERATED_ROOT
    deletion_svc.WORKSPACE_ROOT = cfg.WORKSPACE_ROOT

    cfg.REPOS_ROOT.mkdir(parents=True, exist_ok=True)
    cfg.GENERATED_ROOT.mkdir(parents=True, exist_ok=True)
    cfg.CODE_INTELLIGENCE_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    cfg.CODE_INTELLIGENCE_SNAPSHOTS_ROOT.mkdir(parents=True, exist_ok=True)

    storage.init_storage()
    return tmpdir


def _create_local_project(client: TestClient, name: str) -> dict:
    source = tempfile.TemporaryDirectory()
    src_root = Path(source.name) / name
    src_root.mkdir()
    (src_root / "README.md").write_text(f"# {name}", encoding="utf-8")
    (src_root / "src").mkdir()
    (src_root / "src" / "main.py").write_text("print('hello')", encoding="utf-8")
    (src_root / ".git").mkdir()
    (src_root / ".git" / "objects").mkdir()
    (src_root / ".git" / "objects" / "pack").mkdir()

    resp = client.post("/api/projects/import-local", json={"path": str(src_root)})
    assert resp.status_code == 200, resp.text
    project = resp.json()
    source.cleanup()
    return project


class ProjectDeletionTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = _setup_temp_workspace()
        from app.main import app
        self.client = TestClient(app)

    def tearDown(self):
        self._tmpdir.cleanup()

    def test_normal_project_deletion(self):
        project = _create_local_project(self.client, "test-project")
        repo_root = Path(project["local_path"])

        self.assertTrue(repo_root.exists())

        resp = self.client.delete(f"/api/projects/{project['id']}")
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.json()["status"], "deleted")

        self.assertFalse(repo_root.exists())

        get_resp = self.client.delete(f"/api/projects/{project['id']}")
        self.assertEqual(get_resp.status_code, 404)

    def test_readonly_file_is_removed(self):
        project = _create_local_project(self.client, "readonly-project")
        repo_root = Path(project["local_path"])

        readonly_file = repo_root / ".git" / "objects" / "readonly-object"
        readonly_file.parent.mkdir(parents=True, exist_ok=True)
        readonly_file.write_text("test", encoding="utf-8")
        readonly_file.chmod(stat.S_IREAD)

        resp = self.client.delete(f"/api/projects/{project['id']}")
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertFalse(repo_root.exists())

    def test_running_task_blocks_deletion(self):
        project = _create_local_project(self.client, "running-task-project")
        repo_root = Path(project["local_path"])

        import app.services.storage as storage

        task = storage.create_generation_task(
            project_id=project["id"],
            task_type="outline",
            input_hash="test-hash",
            prompt_version="1",
            status="running",
        )

        resp = self.client.delete(f"/api/projects/{project['id']}")
        self.assertEqual(resp.status_code, 409, resp.text)
        self.assertIn("generation", resp.json()["detail"].lower())
        self.assertTrue(repo_root.exists())
        self.assertIsNotNone(storage.get_project(project["id"]))

        storage.update_generation_task(task.id, "completed")

    def test_database_failure_restores_files(self):
        project = _create_local_project(self.client, "db-fail-project")
        repo_root = Path(project["local_path"])
        self.assertTrue(repo_root.exists())

        import app.services.storage as storage

        def fail_delete(_project_id: int) -> bool:
            raise sqlite3.OperationalError("database is locked")

        with patch(
            "app.services.project_deletion_service.delete_project", fail_delete
        ):
            resp = self.client.delete(f"/api/projects/{project['id']}")

        self.assertEqual(resp.status_code, 409, resp.text)
        self.assertTrue(repo_root.exists(), "repo files should be restored after DB failure")
        self.assertIsNotNone(storage.get_project(project["id"]),
                             "project record should still exist after DB failure")

    def test_nonexistent_project_returns_404(self):
        resp = self.client.delete("/api/projects/99999")
        self.assertEqual(resp.status_code, 404)

    def test_active_index_blocks_deletion(self):
        project = _create_local_project(self.client, "index-running-project")
        repo_root = Path(project["local_path"])

        with patch(
            "app.services.project_deletion_service.is_project_index_building",
            return_value=True,
        ):
            response = self.client.delete(f"/api/projects/{project['id']}")

        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn("index", response.json()["detail"].lower())
        self.assertTrue(repo_root.exists())

        import app.services.storage as storage
        self.assertIsNotNone(storage.get_project(project["id"]))

    def test_windows_sharing_violation_returns_409(self):
        project = _create_local_project(self.client, "busy-repository")
        repo_root = Path(project["local_path"])

        busy_error = PermissionError(13, "file is being used")

        with (
            patch(
                "app.services.project_deletion_service.os.replace",
                side_effect=busy_error,
            ),
            patch(
                "app.services.project_deletion_service.time.sleep",
                return_value=None,
            ),
        ):
            response = self.client.delete(f"/api/projects/{project['id']}")

        self.assertEqual(response.status_code, 409, response.text)
        self.assertTrue(repo_root.exists())

        import app.services.storage as storage
        self.assertIsNotNone(storage.get_project(project["id"]))

    def test_structural_cleanup_failure_does_not_block_delete(self):
        project = _create_local_project(self.client, "structural-cleanup-project")
        repo_root = Path(project["local_path"])

        with patch(
            "app.services.project_deletion_service.remove_structural_project_data",
            side_effect=RuntimeError("simulated structural cleanup failure"),
        ):
            response = self.client.delete(f"/api/projects/{project['id']}")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(repo_root.exists())

        import app.services.storage as storage
        self.assertIsNone(storage.get_project(project["id"]))

    def test_unexpected_error_returns_detail(self):
        project = _create_local_project(self.client, "unexpected-error-project")

        with patch(
            "app.api.projects.stage_and_delete_project",
            side_effect=RuntimeError("simulated deletion error"),
        ):
            response = self.client.delete(f"/api/projects/{project['id']}")

        self.assertEqual(response.status_code, 500)
        detail = response.json()["detail"]
        self.assertIn("RuntimeError", detail)
        self.assertIn("simulated deletion error", detail)


if __name__ == "__main__":
    unittest.main()
