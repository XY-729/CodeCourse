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
        response = self.client.post(
            f"/api/projects/{self.project_a['id']}/personalization/term-display-profiles",
            json={"concept_keys": [concept_id]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["profiles"][0]["concept_key"], concept_id)

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

    def test_dynamic_survey_uses_completed_answers_not_preference_feedback_count(self):
        from app.services.personalization.learner_inference_service import _survey_due
        from app.services.storage import _connect

        self.client.get(
            f"/api/projects/{self.project_a['id']}/personalization/preferences"
        )
        stamp = datetime.now(timezone.utc).isoformat()
        with _connect() as conn:
            for index in range(4):
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
            self.assertFalse(_survey_due(conn))
            conn.execute(
                """INSERT INTO qa_records
                   (project_id,source_type,source_path,selected_text,question,
                    answer_md,provider,model,created_at,updated_at)
                   VALUES (?, 'course', 'outline.md', '', '问题 5', '回答 5',
                           'test', 'test', ?, ?)""",
                (self.project_a["id"], stamp, stamp),
            )
            conn.commit()
            self.assertTrue(_survey_due(conn))

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

    def test_observer_builds_conservative_network_boundary_without_cross_domain_mastery(self):
        socket = self._resolve(self.project_a["id"], "socket")
        bind = self._resolve(self.project_a["id"], "bind")
        from app.services.personalization.learner_inference_service import (
            apply_inference_updates,
        )
        from app.services.personalization.observation_schema import (
            ConceptRelationObservation,
            CurrentLearningState,
            DomainAssessmentObservation,
            InteractionObservation,
            KnowledgeEvidence,
        )
        from app.services.storage import _connect

        observation = InteractionObservation(
            schema_version=2,
            current_state=CurrentLearningState(
                intent_category="understand_term",
                intent_summary="用户在学习网络 API",
                confusion_category="terminology",
                confusion_summary="socket 与 bind 尚不清楚",
                current_goal="理解网络 API",
                urgency="low",
                cognitive_load="medium",
                confidence=0.9,
            ),
            previous_teaching_outcome=None,
            knowledge_evidence=[
                KnowledgeEvidence(
                    concept_text=name,
                    concept_key=resolved["concept"]["conceptKey"],
                    dimension="familiarity",
                    direction="negative",
                    strength=0.8,
                    confidence=0.9,
                    evidence_quote=f"{name} 是什么",
                    explanation="用户主动询问定义",
                )
                for name, resolved in (("socket", socket), ("bind", bind))
            ],
            behavior_evidence=[],
            possible_misconceptions=[],
            explicit_user_facts=[],
            concept_relations=[
                ConceptRelationObservation(
                    source_concept_text="bind",
                    source_concept_key=bind["concept"]["conceptKey"],
                    target_concept_text="socket",
                    target_concept_key=socket["concept"]["conceptKey"],
                    relation_type="prerequisite",
                    domain="networking",
                    confidence=0.85,
                    rationale="bind 作用于 socket",
                )
            ],
            domain_assessments=[
                DomainAssessmentObservation(
                    domain_key="networking",
                    state="learning",
                    summary="正在学习网络基础 API，其他领域证据不足",
                    confidence=0.9,
                    concept_keys=[
                        socket["concept"]["conceptKey"],
                        bind["concept"]["conceptKey"],
                    ],
                    evidence_quotes=["socket 是什么", "bind 是什么"],
                ),
                DomainAssessmentObservation(
                    domain_key="concurrency",
                    state="confirmed",
                    summary="没有直接证据",
                    confidence=0.75,
                    concept_keys=[],
                    evidence_quotes=[],
                ),
            ],
            survey_candidate=None,
            notes=[],
        )
        with _connect() as conn:
            apply_inference_updates(
                project_id=self.project_a["id"],
                qa_record_id=1,
                observer_run_id="observer-test-network",
                observation=observation,
                conn=conn,
            )
            conn.commit()

        profile = self.client.get(
            f"/api/projects/{self.project_a['id']}/personalization/profile"
        )
        self.assertEqual(profile.status_code, 200)
        payload = profile.json()
        networking = next(
            item for item in payload["domainProfiles"]
            if item["domainKey"] == "networking"
        )
        self.assertEqual(set(networking["learning"]), {"socket", "bind"})
        concurrency = next(
            item for item in payload["inferences"]
            if item["subjectType"] == "domain" and item["subjectKey"] == "concurrency"
        )
        self.assertEqual(concurrency["state"], "likely_prerequisite")
        self.assertNotIn("线程池", networking["confirmed"])

    def test_positive_evidence_only_confirms_its_matching_domain(self):
        socket = self._resolve(self.project_a["id"], "socket")
        from app.services.personalization.learner_inference_service import (
            apply_inference_updates,
        )
        from app.services.personalization.observation_schema import (
            CurrentLearningState,
            DomainAssessmentObservation,
            InteractionObservation,
            KnowledgeEvidence,
        )
        from app.services.storage import _connect

        observation = InteractionObservation(
            schema_version=2,
            current_state=CurrentLearningState(
                intent_category="review",
                intent_summary="用户正确总结 socket 生命周期",
                confusion_category="none",
                confusion_summary="没有表现出当前困惑",
                current_goal="复习网络 API",
                urgency="low",
                cognitive_load="low",
                confidence=0.9,
            ),
            previous_teaching_outcome=None,
            knowledge_evidence=[
                KnowledgeEvidence(
                    concept_text="socket",
                    concept_key=socket["concept"]["conceptKey"],
                    dimension="conceptual_understanding",
                    direction="positive",
                    strength=0.8,
                    confidence=0.9,
                    evidence_quote="socket 从创建到关闭",
                    explanation="用户正确描述了生命周期",
                )
            ],
            behavior_evidence=[],
            possible_misconceptions=[],
            explicit_user_facts=[],
            concept_relations=[],
            domain_assessments=[
                DomainAssessmentObservation(
                    domain_key="networking",
                    state="confirmed",
                    summary="对 socket 生命周期有直接理解证据",
                    confidence=0.9,
                    concept_keys=[socket["concept"]["conceptKey"]],
                    evidence_quotes=["socket 从创建到关闭"],
                ),
                DomainAssessmentObservation(
                    domain_key="concurrency",
                    state="confirmed",
                    summary="本轮没有并发领域证据",
                    confidence=0.8,
                    concept_keys=[],
                    evidence_quotes=[],
                ),
            ],
            survey_candidate=None,
            notes=[],
        )
        with _connect() as conn:
            apply_inference_updates(
                project_id=self.project_a["id"],
                qa_record_id=2,
                observer_run_id="observer-test-domain-isolation",
                observation=observation,
                conn=conn,
            )
            conn.commit()

        payload = self.client.get(
            f"/api/projects/{self.project_a['id']}/personalization/profile"
        ).json()
        networking = next(
            item for item in payload["inferences"]
            if item["subjectType"] == "domain" and item["subjectKey"] == "networking"
        )
        concurrency = next(
            item for item in payload["inferences"]
            if item["subjectType"] == "domain" and item["subjectKey"] == "concurrency"
        )
        self.assertEqual(networking["state"], "likely_prerequisite")
        self.assertEqual(concurrency["state"], "likely_prerequisite")

    def test_objective_diagnostic_is_linked_to_the_teaching_trial(self):
        import app.services.storage as storage
        from app.services.personalization.knowledge_state_service import (
            create_diagnostic_item,
            submit_diagnostic_answer,
        )

        resolved = self._resolve(self.project_a["id"], "event loop")
        record, trial_id = self._create_teaching_trial(self.project_a["id"])
        for index in range(4):
            storage.create_qa_record(
                project_id=self.project_a["id"],
                source_type="course",
                source_path="outline.md",
                selected_text="",
                question=f"Follow-up {index}",
                answer_md="Saved answer",
                provider="test",
                model="test-model",
            )

        item = create_diagnostic_item(
            project_id=self.project_a["id"],
            candidate={
                "concept_ids": [resolved["concept"]["id"]],
                "dimension": "conceptual",
                "item_type": "true_false",
                "prompt": "The event loop schedules ready callbacks.",
                "options": [
                    {"label": "True", "value": True},
                    {"label": "False", "value": False},
                ],
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
        self.assertIsNotNone(item)
        self.assertEqual(item["teachingTrialId"], trial_id)

        result = submit_diagnostic_answer(
            self.project_a["id"],
            item["id"],
            True,
        )
        self.assertTrue(result["correct"])
        self.assertEqual(
            result["teachingOutcome"]["evidenceType"],
            "objective_diagnostic",
        )
        self.assertTrue(result["teachingOutcome"]["policyEligible"])

        with storage._connect() as conn:
            outcome = conn.execute(
                "SELECT * FROM teaching_outcomes WHERE teaching_trial_id = ?",
                (trial_id,),
            ).fetchone()
        self.assertEqual(outcome["diagnostic_attempt_id"], result["attemptId"])
        self.assertEqual(outcome["authority"], 100)

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
