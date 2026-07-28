import json
import unittest
from pathlib import Path

from app.services.personalization.knowledge_state_resolver import (
    POLICY_VERSION,
    resolve_knowledge_state,
)
from app.services.personalization.knowledge_state_service import (
    _is_objective_diagnostic_candidate,
)


VECTORS_PATH = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "personalization"
    / "__tests__"
    / "knowledgeStateGolden.json"
)


def _evidence(raw: dict, metadata: dict) -> dict:
    event = {
        "id": raw["id"],
        "idempotencyKey": raw["id"],
        "schemaVersion": 2,
        "conceptId": metadata["conceptId"],
        "scopeType": "global",
        "scopeId": metadata["scopeId"],
        "dimension": "familiarity",
        "direction": "neutral",
        "strength": 1,
        "reliability": 0.5,
        "source": "question",
        "action": "observed",
        "object": {},
        "result": {},
        "context": {},
        "eventTime": metadata["now"],
        "sessionId": None,
        "qaRecordId": None,
        "diagnosticAttemptId": None,
        "objectiveCorrect": None,
        "targetEvidenceId": None,
        "voided": False,
        "modelVersion": None,
        "policyVersion": POLICY_VERSION,
    }
    event.update(raw)
    return event


class KnowledgeStateV2GoldenTests(unittest.TestCase):
    def test_v2_golden_vectors_match_typescript_contract(self):
        metadata = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))
        self.assertEqual(metadata["policyVersion"], POLICY_VERSION)
        empty_dimension = {
            "probability": 0.35,
            "uncertainty": 0.92,
            "status": "uncertain",
            "evidenceCount": 0,
            "directEvidenceCount": 0,
            "objectiveAttemptCount": 0,
            "reliableCorrectSessions": 0,
            "manualStatus": None,
            "lastEvidenceAt": None,
        }
        for vector in metadata["vectors"]:
            with self.subTest(vector=vector["id"]):
                state = resolve_knowledge_state(
                    metadata["conceptId"],
                    metadata["scopeType"],
                    metadata["scopeId"],
                    [_evidence(event, metadata) for event in vector["events"]],
                    metadata["now"],
                )
                self.assertEqual(
                    state["dimensions"]["familiarity"],
                    vector["expected"],
                )
                for dimension, value in state["dimensions"].items():
                    if dimension != "familiarity":
                        self.assertEqual(value, empty_dimension)

    def test_diagnostic_requires_sources_and_a_unique_answer(self):
        candidate = {
            "item_type": "single_choice",
            "answer_key": "address",
            "options": [
                {"value": "address", "label": "关联本地地址"},
                {"value": "connect", "label": "建立远端连接"},
            ],
            "source_refs": [
                {
                    "source_type": "course",
                    "source_path": "lessons/lesson_1.md",
                    "excerpt": "bind associates a local address with a socket.",
                }
            ],
        }
        self.assertTrue(_is_objective_diagnostic_candidate(candidate))
        candidate["options"][1]["value"] = "address"
        self.assertFalse(_is_objective_diagnostic_candidate(candidate))
        candidate["options"][1]["value"] = "connect"
        candidate["source_refs"][0]["excerpt"] = ""
        self.assertFalse(_is_objective_diagnostic_candidate(candidate))


if __name__ == "__main__":
    unittest.main()
