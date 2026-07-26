import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


def _setup_temp_workspace():
    import app.core.config as cfg
    import app.services.generation_service as generation_service
    import app.services.storage as storage
    import app.services.term_service as term_service

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
    term_service.GENERATED_ROOT = cfg.GENERATED_ROOT
    import app.api.projects as project_api

    project_api.REPOS_ROOT = cfg.REPOS_ROOT
    storage.init_storage()
    return tmpdir


class PersonalizationProfileTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = _setup_temp_workspace()
        from app.main import app

        self.client = TestClient(app)
        self.project_a = self.client.post(
            "/api/projects/learning-plan", json={"name": "Project A"}
        ).json()
        self.project_b = self.client.post(
            "/api/projects/learning-plan", json={"name": "Project B"}
        ).json()

    def tearDown(self):
        self._tmpdir.cleanup()

    def _resolve(self, project_id, text, source="rule"):
        response = self.client.post(
            f"/api/projects/{project_id}/personalization/resolve",
            json={"terms": [{"text": text, "source": source, "confidence": 0.9}]},
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["terms"][0]

    def test_general_concepts_are_global_and_symbols_are_project_scoped(self):
        fastapi_a = self._resolve(self.project_a["id"], "FastAPI")
        fastapi_b = self._resolve(self.project_b["id"], "fastapi")
        self.assertEqual(fastapi_a["concept"]["id"], fastapi_b["concept"]["id"])

        symbol_a = self._resolve(self.project_a["id"], "JudgeRunner", "index")
        symbol_b = self._resolve(self.project_b["id"], "JudgeRunner", "index")
        self.assertNotEqual(symbol_a["concept"]["id"], symbol_b["concept"]["id"])

    def test_manual_feedback_is_visible_cross_project_for_global_concept(self):
        resolved = self._resolve(self.project_a["id"], "RAG")
        concept_id = resolved["concept"]["id"]
        marked = self.client.post(
            f"/api/projects/{self.project_a['id']}/personalization/mark-unknown",
            json={
                "conceptId": concept_id,
                "idempotencyKey": "mark-rag-unknown",
                "evidenceText": "I do not know this term",
            },
        )
        self.assertEqual(marked.status_code, 200)
        other = self.client.get(
            f"/api/projects/{self.project_b['id']}/personalization/mastery",
            params={"concept_ids": concept_id},
        ).json()
        self.assertEqual(other[concept_id]["manualStatus"], "unknown")

    def test_implicit_and_survey_preference_changes_are_bounded(self):
        initial = self.client.get(
            f"/api/projects/{self.project_a['id']}/personalization/preferences"
        ).json()
        implicit = self.client.post(
            f"/api/projects/{self.project_a['id']}/personalization/answer-feedback",
            json={
                "dimension": "answer_depth",
                "choice": "more",
                "source": "implicit_question",
                "idempotency_key": "implicit-depth",
            },
        ).json()
        self.assertLessEqual(
            implicit["answerDepth"] - initial["answerDepth"], 0.0200001
        )
        survey = self.client.post(
            f"/api/projects/{self.project_a['id']}/personalization/answer-feedback",
            json={
                "dimension": "answer_depth",
                "choice": "more",
                "source": "survey",
                "idempotency_key": "survey-depth",
            },
        ).json()
        self.assertLessEqual(
            survey["answerDepth"] - implicit["answerDepth"], 0.0500001
        )

    def test_changed_document_rescans_and_removes_stale_candidates(self):
        import app.services.storage as storage

        target = storage.GENERATED_ROOT / str(self.project_a["id"]) / "outline.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("这里使用 **FastAPI** 构建接口。", encoding="utf-8")
        first = self.client.get(
            f"/api/projects/{self.project_a['id']}/terms",
            params={"source_type": "course", "source_path": "outline.md"},
        ).json()
        self.assertIn("FastAPI", {item["term_text"] for item in first})

        target.write_text("这里改用 **SQLite** 保存数据。", encoding="utf-8")
        second = self.client.get(
            f"/api/projects/{self.project_a['id']}/terms",
            params={"source_type": "course", "source_path": "outline.md"},
        ).json()
        terms = {item["term_text"] for item in second}
        self.assertIn("SQLite", terms)
        self.assertNotIn("FastAPI", terms)


if __name__ == "__main__":
    unittest.main()
