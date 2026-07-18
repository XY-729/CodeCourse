import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


def _setup_temp_workspace():
    import app.core.config as cfg
    import app.services.generation_service as generation_service
    import app.services.storage as storage

    tmpdir = tempfile.TemporaryDirectory()
    workspace = Path(tmpdir.name)
    cfg.DB_PATH = workspace / "app.db"
    cfg.WORKSPACE_ROOT = workspace
    cfg.REPOS_ROOT = workspace / "repos"
    cfg.GENERATED_ROOT = workspace / "generated"
    storage.DB_PATH = cfg.DB_PATH
    storage.WORKSPACE_ROOT = cfg.WORKSPACE_ROOT
    storage.REPOS_ROOT = cfg.REPOS_ROOT
    storage.GENERATED_ROOT = cfg.GENERATED_ROOT
    generation_service.GENERATED_ROOT = cfg.GENERATED_ROOT
    import app.api.projects as project_api

    project_api.REPOS_ROOT = cfg.REPOS_ROOT
    storage.init_storage()
    return tmpdir


class LearningStateTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = _setup_temp_workspace()
        from app.main import app

        self.client = TestClient(app)
        self.project = self.client.post("/api/projects/learning-plan", json={"name": "学习状态测试"}).json()
        response = self.client.post(
            f"/api/projects/{self.project['id']}/course/empty",
            json={"title": "第1课"},
        )
        self.assertEqual(response.status_code, 200)
        self.course = response.json()

    def tearDown(self):
        self._tmpdir.cleanup()

    def _put(self, **overrides):
        payload = {
            "source_type": "course",
            "source_path": self.course["filename"],
            "status": "in_progress",
            "position_kind": "scroll_ratio",
            "position_value": 0.35,
            **overrides,
        }
        return self.client.put(f"/api/projects/{self.project['id']}/learning-state", json=payload)

    def test_learning_state_upsert_and_complete(self):
        created = self._put()
        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.json()["status"], "in_progress")
        self.assertAlmostEqual(created.json()["position_value"], 0.35)

        completed = self._put(status="completed", position_value=0.9)
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.json()["status"], "completed")
        self.assertIsNotNone(completed.json()["completed_at"])

        states = self.client.get(f"/api/projects/{self.project['id']}/learning-state").json()
        self.assertEqual(len(states), 1)
        self.assertEqual(states[0]["source_path"], self.course["filename"])

    def test_course_delete_cleans_learning_state(self):
        self.assertEqual(self._put().status_code, 200)
        deleted = self.client.delete(
            f"/api/projects/{self.project['id']}/course/{self.course['filename']}"
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(
            self.client.get(f"/api/projects/{self.project['id']}/learning-state").json(),
            [],
        )

    def test_project_isolation_and_reset(self):
        self.assertEqual(self._put().status_code, 200)
        other = self.client.post("/api/projects/learning-plan", json={"name": "另一个计划"}).json()
        self.assertEqual(
            self.client.get(f"/api/projects/{other['id']}/learning-state").json(),
            [],
        )
        reset = self.client.delete(f"/api/projects/{self.project['id']}/learning-state")
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(reset.json()["deleted"], 1)

    def test_invalid_source_and_scroll_ratio_are_rejected(self):
        invalid_source = self._put(source_path="missing.md")
        self.assertEqual(invalid_source.status_code, 404)
        invalid_ratio = self._put(position_value=1.2)
        self.assertEqual(invalid_ratio.status_code, 400)


if __name__ == "__main__":
    unittest.main()
