import tempfile
import unittest
from datetime import datetime, timezone
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

    def test_style_survey_cooldown_is_timezone_independent(self):
        from app.api.personalization import _survey_is_due

        now = datetime(2026, 7, 26, 4, 0, tzinfo=timezone.utc)
        self.assertFalse(_survey_is_due("2026-07-26T01:00:00+08:00", now))
        self.assertTrue(_survey_is_due("2026-07-25T03:59:59Z", now))

    def test_personalization_runtime_settings_are_explicit_and_default_off(self):
        initial = self.client.get("/api/settings/personalization")
        self.assertEqual(initial.status_code, 200)
        self.assertEqual(
            initial.json(),
            {
                "supported": True,
                "teacher_planner_enabled": False,
                "observer_enabled": False,
                "teacher_planner_mode": "assist",
                "observer_mode": "shadow",
            },
        )

        saved = self.client.put(
            "/api/settings/personalization",
            json={
                "teacher_planner_enabled": True,
                "observer_enabled": True,
            },
        )
        self.assertEqual(saved.status_code, 200)
        self.assertTrue(saved.json()["teacher_planner_enabled"])
        self.assertTrue(saved.json()["observer_enabled"])

        from app.services.storage import get_setting

        self.assertEqual(get_setting("personalization.teacher_planner.mode"), "assist")
        self.assertEqual(get_setting("personalization.observer.mode"), "shadow")

    def test_reset_all_clears_global_and_project_personalization(self):
        global_term = self._resolve(self.project_a["id"], "RAG")
        project_term = self._resolve(self.project_b["id"], "JudgeRunner", "index")

        for project, term, status in (
            (self.project_a, global_term, "unknown"),
            (self.project_b, project_term, "known"),
        ):
            response = self.client.post(
                f"/api/projects/{project['id']}/personalization/mark-{status}",
                json={
                    "conceptId": term["concept"]["id"],
                    "idempotencyKey": f"reset-all-{status}",
                },
            )
            self.assertEqual(response.status_code, 200)

        self.client.put(
            f"/api/projects/{self.project_a['id']}/personalization/preferences",
            json={"terminology_density": 0.75, "scope": "global"},
        )

        reset = self.client.delete(
            f"/api/projects/{self.project_a['id']}/personalization/profile",
            params={"scope": "all"},
        )
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(reset.json()["scope"], "all")
        self.assertGreaterEqual(reset.json()["deletedMasteryCount"], 2)

        global_mastery = self.client.get(
            f"/api/projects/{self.project_a['id']}/personalization/mastery",
            params={"concept_ids": global_term["concept"]["id"]},
        ).json()
        project_mastery = self.client.get(
            f"/api/projects/{self.project_b['id']}/personalization/mastery",
            params={"concept_ids": project_term["concept"]["id"]},
        ).json()
        self.assertEqual(global_mastery, {})
        self.assertEqual(project_mastery, {})

        preferences = self.client.get(
            f"/api/projects/{self.project_a['id']}/personalization/preferences"
        ).json()
        self.assertEqual(preferences["terminologyDensity"], 0.5)
        self.assertEqual(preferences["feedbackCount"], 0)

    def test_planner_assist_eligibility_keeps_simple_questions_fast(self):
        from types import SimpleNamespace
        from app.services.qa_service import _should_use_planner_assist

        def prepared(question: str, *, parent_id=None, relation_type="follow_up"):
            return SimpleNamespace(
                question=question,
                parent_id=parent_id,
                payload=SimpleNamespace(relation_type=relation_type),
            )

        self.assertFalse(_should_use_planner_assist(prepared("这个报错是什么意思")))
        self.assertTrue(_should_use_planner_assist(prepared("为什么 accept 会返回新的 socket？")))
        self.assertTrue(_should_use_planner_assist(prepared("还是没懂，换种方式解释", parent_id=12)))
        self.assertTrue(_should_use_planner_assist(prepared("再解释一次", relation_type="alternate")))
        self.assertFalse(_should_use_planner_assist(prepared("解释 socket", parent_id=12, relation_type="term_explanation")))

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
