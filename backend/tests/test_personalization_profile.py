import tempfile
import unittest
import json
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

    import app.services.project_deletion_service as deletion_svc
    deletion_svc.REPOS_ROOT = cfg.REPOS_ROOT
    deletion_svc.GENERATED_ROOT = cfg.GENERATED_ROOT
    deletion_svc.WORKSPACE_ROOT = cfg.WORKSPACE_ROOT

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

    def _create_teaching_trial(self, project_id: int, *, mode: str = "assist"):
        import app.services.storage as storage

        record = storage.create_qa_record(
            project_id=project_id,
            source_type="course",
            source_path="outline.md",
            selected_text="",
            question="Explain this concept",
            answer_md="A teaching answer",
            provider="test",
            model="test-model",
            session_id=None,
        )
        context = {
            "schema_version": 1,
            "mode": "planned" if mode == "assist" else "default",
            "user_goal": "understand_mechanism" if mode == "assist" else "unknown",
            "teaching_goal": "Build a verifiable mental model",
            "strategies": ["worked_example", "execution_sequence"],
            "assumed_known": [],
            "explain_briefly": [],
            "explain_in_detail": [],
            "skip_topics": [],
            "avoid": [],
            "assessment_needed": True,
            "assessment_format": "true_false",
            "diagnostic_question_needed": True,
            "planner_run_id": None,
        }
        trial_id = storage.persist_applied_teaching_trial(
            project_id=project_id,
            session_id=None,
            qa_record_id=record.id,
            planner_run_id=None,
            teaching_plan_id=None,
            effective_context_json=json.dumps(context),
            mode=mode,
            answer_model="test-model",
            strategy_rationale="A mechanism question benefits from a worked example.",
        )
        return record, trial_id

    def test_restart_migrates_legacy_manual_mastery(self):
        import app.services.storage as storage

        storage.upsert_concept_mastery(
            mastery_id="legacy-manual-fastapi",
            concept_id="legacy-fastapi",
            scope_type="global",
            scope_id="global",
            known_evidence=2,
            unknown_evidence=1,
            mastery=0.8,
            uncertainty=0.2,
            manual_status="known",
        )

        # A real desktop restart runs the full migration against an existing
        # database. This used to fail because init_storage returned tuples.
        storage.init_storage()

        with storage._connect() as conn:
            row = conn.execute(
                """SELECT action, direction FROM learning_evidence_v2
                   WHERE concept_id = ? AND source = 'manual'""",
                ("legacy-fastapi",),
            ).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row["action"], "manual_known")
        self.assertEqual(row["direction"], "positive")

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

    def test_v2_evidence_api_replays_and_voids_manual_feedback(self):
        resolved = self._resolve(self.project_a["id"], "SQLite")
        concept_id = resolved["concept"]["id"]
        marked = self.client.post(
            f"/api/projects/{self.project_a['id']}/personalization/mark-unknown",
            json={
                "conceptId": concept_id,
                "idempotencyKey": "v2-sqlite-unknown",
                "evidenceText": "尚未学习 SQLite",
            },
        )
        self.assertEqual(marked.status_code, 200)

        state_response = self.client.get(
            f"/api/projects/{self.project_b['id']}/personalization/knowledge-state",
            params={"concept_ids": concept_id},
        )
        self.assertEqual(state_response.status_code, 200)
        state = state_response.json()["states"][0]
        self.assertEqual(state["dimensions"]["familiarity"]["manualStatus"], "unknown")
        self.assertEqual(state["dimensions"]["familiarity"]["status"], "learning")

        profile = self.client.get(
            f"/api/projects/{self.project_a['id']}/personalization/profile"
        ).json()
        evidence = next(
            item for item in profile["learningEvidence"]
            if item["conceptId"] == concept_id and item["action"] == "manual_unknown"
        )
        voided = self.client.post(
            f"/api/projects/{self.project_a['id']}/personalization/evidence/{evidence['id']}/void",
            json={
                "idempotencyKey": "void-v2-sqlite-unknown",
                "reason": "用户撤销",
            },
        )
        self.assertEqual(voided.status_code, 200)
        familiarity = voided.json()["state"]["dimensions"]["familiarity"]
        self.assertIsNone(familiarity["manualStatus"])
        self.assertEqual(familiarity["status"], "uncertain")

    def test_term_display_profile_route_uses_project_scope(self):
        resolved = self._resolve(self.project_a["id"], "WebSocket")
        concept_id = resolved["concept"]["id"]
        self.client.post(
            f"/api/projects/{self.project_a['id']}/personalization/mark-unknown",
            json={"conceptId": concept_id, "idempotencyKey": "term-profile-unknown", "evidenceText": "还不理解"},
        )
        response = self.client.post(
            f"/api/projects/{self.project_a['id']}/personalization/term-display-profiles",
            json={"concept_keys": [concept_id]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["profiles"][0]["concept_key"], concept_id)
        self.assertEqual(response.json()["profiles"][0]["manual_status"], "unknown")
        self.assertEqual(response.json()["profiles"][0]["knowledge_status"], "learning")

    def test_project_delete_removes_private_concepts_and_intelligence_cache(self):
        symbol = self._resolve(self.project_a["id"], "PrivateRunner", "index")
        from app.services.storage import _connect
        with _connect() as conn:
            stamp = datetime.now(timezone.utc).isoformat()
            conn.execute(
                """INSERT INTO term_model_scans
                   (project_id,source_type,source_path,content_hash,status,terms_json,created_at,updated_at)
                   VALUES(?,?,?,?,?,'[]',?,?)""",
                (
                    self.project_a["id"], "course", "outline.md",
                    "delete-test", "completed", stamp, stamp,
                ),
            )
            conn.commit()

        deleted = self.client.delete(f"/api/projects/{self.project_a['id']}")
        self.assertEqual(deleted.status_code, 200)
        with _connect() as conn:
            self.assertIsNone(
                conn.execute(
                    "SELECT id FROM concepts WHERE id=?",
                    (symbol["concept"]["id"],),
                ).fetchone()
            )
            self.assertIsNone(
                conn.execute(
                    "SELECT project_id FROM term_model_scans WHERE project_id=?",
                    (self.project_a["id"],),
                ).fetchone()
            )

    def test_fixed_style_feedback_is_retired_without_mutating_preferences(self):
        initial = self.client.get(
            f"/api/projects/{self.project_a['id']}/personalization/preferences"
        ).json()
        for source in ("implicit_question", "survey"):
            response = self.client.post(
                f"/api/projects/{self.project_a['id']}/personalization/answer-feedback",
                json={
                    "dimension": "answer_depth",
                    "choice": "more",
                    "source": source,
                    "idempotency_key": f"{source}-depth",
                },
            )
            self.assertEqual(response.status_code, 410)
        unchanged = self.client.get(
            f"/api/projects/{self.project_a['id']}/personalization/preferences"
        ).json()
        self.assertEqual(unchanged, initial)

    def test_style_survey_cooldown_is_timezone_independent(self):
        from app.api.personalization import _survey_is_due

        now = datetime(2026, 7, 26, 4, 0, tzinfo=timezone.utc)
        self.assertFalse(_survey_is_due("2026-07-26T01:00:00+08:00", now))
        self.assertTrue(_survey_is_due("2026-07-25T03:59:59Z", now))

    def test_dynamic_style_survey_is_retired(self):
        from app.services.storage import _connect

        stamp = datetime.now(timezone.utc).isoformat()
        with _connect() as conn:
            for index in range(6):
                conn.execute(
                    """INSERT INTO qa_records
                       (project_id,source_type,source_path,selected_text,question,
                        answer_md,provider,model,created_at,updated_at)
                       VALUES (?, 'course', 'outline.md', '', ?, ?, 'test', 'test', ?, ?)""",
                    (
                        self.project_a["id"],
                        f"问题 {index}",
                        f"回答 {index}",
                        stamp,
                        stamp,
                    ),
                )
            conn.commit()
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM survey_candidates").fetchone()[0], 0)
        profile = self.client.get(
            f"/api/projects/{self.project_a['id']}/personalization/profile"
        ).json()
        self.assertIsNone(profile.get("survey"))
        for action in ("answer", "dismiss"):
            response = self.client.post(
                f"/api/projects/{self.project_a['id']}/personalization/surveys/survey-1/{action}",
                json={"choice": "deeper"},
            )
            self.assertEqual(response.status_code, 410)

    def test_unified_teaching_and_evidence_analysis_are_always_on(self):
        initial = self.client.get("/api/settings/personalization")
        self.assertEqual(initial.status_code, 200)
        self.assertEqual(
            initial.json(),
            {
                "supported": True,
                "teacher_planner_enabled": True,
                "observer_enabled": True,
                "teacher_planner_mode": "assist",
                "observer_mode": "shadow",
            },
        )
        # A legacy opt-out cannot switch the unified flow back off.
        saved = self.client.put(
            "/api/settings/personalization",
            json={"teacher_planner_enabled": False, "observer_enabled": False},
        )
        self.assertEqual(saved.status_code, 200)
        self.assertTrue(saved.json()["teacher_planner_enabled"])
        self.assertTrue(saved.json()["observer_enabled"])
        self.assertTrue(self.client.get("/api/settings/personalization").json()["observer_enabled"])

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
        v2_states = self.client.get(
            f"/api/projects/{self.project_a['id']}/personalization/knowledge-state"
        ).json()
        self.assertEqual(v2_states["states"], [])

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

    def test_changed_document_requires_model_choices_without_local_guesses(self):
        import app.services.storage as storage
        from app.services.term_service import register_document_terms

        target = storage.GENERATED_ROOT / str(self.project_a["id"]) / "outline.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("这里使用 **FastAPI** 构建接口。", encoding="utf-8")
        register_document_terms(self.project_a["id"], "course", "outline.md", target.read_text(encoding="utf-8"), ["FastAPI"])
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
        self.assertNotIn("SQLite", terms)
        self.assertNotIn("FastAPI", terms)

    def test_manifest_terms_are_registered_without_any_model_scan(self):
        from unittest.mock import patch
        from app.services.term_service import register_document_terms, get_document_term_status
        import app.services.storage as storage
        from teaching_manifest_fixture import with_manifest

        project_id = self.project_a["id"]
        body = "# 课件\n\n`printAge` 会把参数转换为字符串。"
        content = with_manifest(
            body,
            [("printAge", "`printAge` 会把参数转换为字符串。")],
            terms=[(1, "printAge", "`printAge` 会把参数转换为字符串。")],
        )
        target = storage.GENERATED_ROOT / str(project_id) / "outline.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8", newline="\n")
        with patch("app.services.term_service.schedule_term_model_scan") as scan:
            terms = register_document_terms(project_id, "course", "outline.md", content)
            status = get_document_term_status(project_id, "course", "outline.md")
        scan.assert_not_called()
        self.assertEqual([term.term_text for term in terms], ["printAge"])
        self.assertEqual(status["candidate_count"], 1)
    def test_term_prompt_is_project_scoped_and_resolves_manual_conflicts(self):
        from app.services.term_service import term_learning_context
        from app.services.storage import upsert_concept_mastery
        common = self._resolve(self.project_a["id"], "WebSocket")["concept"]["id"]
        private = self._resolve(self.project_b["id"], "OtherProjectWidget", source="index")["concept"]["id"]
        for concept, scope, scope_id, status in (
            (common, "global", "local-user", "known"),
            (common, "project", str(self.project_a["id"]), "unknown"),
            (private, "project", str(self.project_b["id"]), "known"),
        ):
            upsert_concept_mastery(f"test:{concept}:{scope}:{scope_id}", concept, scope, scope_id, 1, 1, 0.5, 0.7, manual_status=status)
        payload = term_learning_context(self.project_a["id"])
        data = json.loads(payload.split("<term_learning_context>\n", 1)[1].split("\n</term_learning_context>")[0])
        self.assertIn("WebSocket", data["needs_support"])
        self.assertNotIn("WebSocket", data["known"])
        self.assertNotIn("OtherProjectWidget", payload)
        self.assertIn("未列出的概念只是未知", data["rule"])

    def test_successful_empty_rescan_replaces_choices_but_preserves_history(self):
        from app.services.term_service import register_document_terms
        from app.services.storage import list_document_terms, _connect
        project_id = self.project_a["id"]
        content = "事件循环使用队列。"
        first = register_document_terms(project_id, "course", "lesson.md", content, ["事件循环", "队列"])
        event_id = next(term.id for term in first if term.term_text == "事件循环")
        with _connect() as conn:
            conn.execute("UPDATE document_terms SET link_origin='manual' WHERE id=?", (event_id,))
            conn.commit()
        kept = register_document_terms(project_id, "course", "lesson.md", content, [])
        self.assertEqual([term.term_text for term in kept], ["事件循环"])
        history = list_document_terms(project_id, "course", "lesson.md")
        self.assertEqual(len(history), 2)
        self.assertEqual(next(term.status for term in history if term.term_text == "队列"), "superseded")
        refreshed = register_document_terms(project_id, "course", "lesson.md", content, ["队列"])
        self.assertEqual({term.term_text for term in refreshed}, {"事件循环", "队列"})

    def test_term_model_scan_is_not_queued_twice_for_same_content_hash(self):
        from unittest.mock import patch
        import app.services.term_service as term_service
        from app.services.storage import _connect

        content = "这里讨论一个尚未被本地规则识别的技术概念。"
        content_hash = "stable-document-hash"
        try:
            with patch.object(term_service, "_term_scan_enabled", return_value=True), patch.object(
                term_service._SCAN_EXECUTOR,
                "submit",
            ) as submit:
                term_service.schedule_term_model_scan(
                    self.project_a["id"],
                    "course",
                    "outline.md",
                    content,
                    content_hash,
                )
                term_service.schedule_term_model_scan(
                    self.project_a["id"],
                    "course",
                    "outline.md",
                    content,
                    content_hash,
                )
            self.assertEqual(submit.call_count, 1)
            with _connect() as conn:
                count = conn.execute(
                    """SELECT COUNT(*) FROM term_model_scans
                       WHERE project_id=? AND source_type='course'
                         AND source_path='outline.md' AND content_hash=?""",
                    (self.project_a["id"], content_hash),
                ).fetchone()[0]
            self.assertEqual(count, 1)
        finally:
            term_service._QUEUED_SCANS.clear()

    def test_deleted_project_explanation_is_not_reused(self):
        resolved = self._resolve(self.project_a["id"], "WebSocket")
        concept_id = resolved["concept"]["id"]
        from app.services.personalization.learner_inference_service import (
            find_concept_explanation,
            register_concept_explanation,
        )
        from app.services.storage import _connect

        stamp = datetime.now(timezone.utc).isoformat()
        with _connect() as conn:
            cursor = conn.execute(
                """INSERT INTO qa_records
                   (project_id,source_type,source_path,selected_text,question,
                    answer_md,provider,model,created_at,updated_at)
                   VALUES (?, 'course', 'outline.md', 'WebSocket',
                           'WebSocket 是什么', 'WebSocket 解释',
                           'test', 'test', ?, ?)""",
                (self.project_a["id"], stamp, stamp),
            )
            qa_id = int(cursor.lastrowid)
            conn.commit()
        register_concept_explanation(
            concept_id,
            self.project_a["id"],
            qa_id,
            "WebSocket 解释",
        )
        self.assertIsNotNone(find_concept_explanation(concept_id))

        deleted = self.client.delete(f"/api/projects/{self.project_a['id']}")
        self.assertEqual(deleted.status_code, 200)
        self.assertIsNone(find_concept_explanation(concept_id))

    def test_evidence_never_propagates_through_relations(self):
        from app.services import storage
        from app.services.personalization.knowledge_state_service import append_evidence, get_states

        socket = self._resolve(self.project_a["id"], "socket")["concept"]["id"]
        bind = self._resolve(self.project_a["id"], "bind")["concept"]["id"]
        with storage._connect() as conn:
            conn.execute(
                """INSERT OR IGNORE INTO concept_relations(id,source_concept_id,target_concept_id,
                   relation_type,domain,confidence,evidence_json,origin,status,created_at,updated_at)
                   VALUES('rel-1',?,'socket','prerequisite','networking',0.85,'[]','legacy','active',
                   '2026-10-01','2026-10-01')""",
                (bind,),
            )
            conn.commit()
        append_evidence({
            "id": "socket-positive", "conceptId": socket, "scopeType": "global", "scopeId": "local-user",
            "dimension": "familiarity", "direction": "positive", "strength": .8, "reliability": .72,
            "source": "summary", "action": "self_understood",
            "result": {"ranges": [{"aspect": "生命周期", "dimension": "conceptual", "kind": "explained"}]},
            "eventTime": "2026-10-21T00:00:00+00:00",
        })
        states = {state["conceptId"]: state for state in get_states([("global", "local-user")], [socket, bind])}
        self.assertEqual(states[socket]["familiarity"], "self_reported_understood")
        # A prerequisite edge is not mastery and never propagates down or up.
        # A concept with no evidence has no state row at all: that is "unknown".
        bind_state = states.get(bind)
        self.assertTrue(bind_state is None or bind_state["familiarity"] == "unrecorded")
        self.assertTrue(bind_state is None or bind_state["ranges"] == [])
    def test_soft_positive_evidence_does_not_confirm_but_manual_declaration_does(self):
        from app.services.personalization.knowledge_state_service import append_evidence, get_states

        socket = self._resolve(self.project_a["id"], "socket")["concept"]["id"]
        bind = self._resolve(self.project_a["id"], "bind")["concept"]["id"]
        append_evidence({
            "id": "socket-soft", "conceptId": socket, "scopeType": "global", "scopeId": "local-user",
            "dimension": "familiarity", "direction": "positive", "strength": .8, "reliability": .9,
            "source": "summary", "action": "self_understood",
            "result": {"ranges": [{"aspect": "生命周期", "dimension": "conceptual", "kind": "explained"}]},
            "eventTime": "2026-10-21T00:00:00+00:00",
        })
        state = {item["conceptId"]: item for item in get_states([("global", "local-user")], [socket])}[socket]
        self.assertEqual(state["familiarity"], "self_reported_understood")
        self.assertNotEqual(state["dimensions"]["familiarity"]["status"], "confirmed")
        # A manual declaration is the only path that confirms a dimension, and it
        # confirms only the concept the user explicitly named.
        append_evidence({
            "id": "socket-manual", "conceptId": socket, "scopeType": "global", "scopeId": "local-user",
            "dimension": "familiarity", "direction": "positive", "strength": 1, "reliability": 1,
            "source": "manual", "action": "manual_known",
            "result": {"ranges": [{"aspect": "生命周期", "dimension": "conceptual", "kind": "explained"}]},
            "eventTime": "2026-10-21T00:00:01+00:00",
        })
        states = {item["conceptId"]: item for item in get_states([("global", "local-user")], [socket, bind])}
        self.assertEqual(states[socket]["dimensions"]["familiarity"]["status"], "confirmed")
        bind_state = states.get(bind)
        self.assertTrue(bind_state is None or bind_state["familiarity"] == "unrecorded")
    def test_retired_diagnostic_never_creates_items_or_outcomes(self):
        import app.services.storage as storage
        from app.services.personalization.knowledge_state_service import (
            create_diagnostic_item,
            submit_diagnostic_answer,
        )

        resolved = self._resolve(self.project_a["id"], "event loop")
        record, trial_id = self._create_teaching_trial(self.project_a["id"])
        item = create_diagnostic_item(
            project_id=self.project_a["id"],
            candidate={
                "concept_ids": [resolved["concept"]["id"]],
                "dimension": "conceptual",
                "item_type": "true_false",
                "prompt": "The event loop schedules ready callbacks.",
                "options": [{"label": "True", "value": True}, {"label": "False", "value": False}],
                "answer_key": True,
                "source_refs": [{
                    "source_type": "course",
                    "source_path": "outline.md",
                    "excerpt": "The event loop schedules ready callbacks.",
                }],
                "rationale": "Checks the mechanism taught in the answer.",
                "difficulty": 0.5,
            },
            source_qa_record_id=record.id,
            session_id=None,
            strategy_version="test",
            teaching_trial_id=trial_id,
        )
        self.assertIsNone(item)
        pending = self.client.get(
            f"/api/projects/{self.project_a['id']}/personalization/diagnostics/pending"
        )
        self.assertEqual(pending.status_code, 200)
        self.assertEqual(pending.json(), {"item": None, "retired": True})
        answer = self.client.post(
            f"/api/projects/{self.project_a['id']}/personalization/diagnostics/missing/answer",
            json={"answer": True},
        )
        self.assertEqual(answer.status_code, 410)
        with self.assertRaises(ValueError):
            submit_diagnostic_answer(self.project_a["id"], "missing", True)
        with storage._connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM diagnostic_items").fetchone()[0], 0)
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM teaching_outcomes WHERE evidence_type='objective_diagnostic'"
            ).fetchone()[0], 0)
    def test_manual_teaching_feedback_is_visible_in_profile_summary(self):
        record, trial_id = self._create_teaching_trial(self.project_a["id"])
        response = self.client.post(
            (
                f"/api/projects/{self.project_a['id']}/personalization/"
                f"teaching/{record.id}/feedback"
            ),
            json={
                "result": "successful",
                "idempotency_key": f"manual-teaching:{trial_id}",
                "reason": "The worked example made the sequence clear.",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["evidenceType"], "manual_feedback")
        self.assertTrue(response.json()["policyEligible"])

        profile = self.client.get(
            f"/api/projects/{self.project_a['id']}/personalization/profile"
        ).json()
        teaching = profile["evidenceSummary"]["teaching"]
        self.assertEqual(teaching["verifiedTrialCount"], 1)
        self.assertEqual(
            teaching["recentTrials"][0]["result"],
            "successful",
        )


if __name__ == "__main__":
    unittest.main()
