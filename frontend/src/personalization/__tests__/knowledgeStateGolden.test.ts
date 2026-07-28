import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_DIMENSIONS,
  KNOWLEDGE_POLICY_VERSION,
  resolveKnowledgeState,
  type LearningEvidenceV2,
} from "../knowledgeState";
import vectors from "./knowledgeStateGolden.json";

type VectorEvent = Partial<LearningEvidenceV2> & { id: string };

function evidenceFromVector(event: VectorEvent): LearningEvidenceV2 {
  const { id, ...overrides } = event;
  return {
    id,
    idempotencyKey: id,
    schemaVersion: 2,
    conceptId: vectors.conceptId,
    scopeType: "global",
    scopeId: vectors.scopeId,
    dimension: "familiarity",
    direction: "neutral",
    strength: 1,
    reliability: 0.5,
    source: "question",
    action: "observed",
    object: {},
    result: {},
    context: {},
    eventTime: vectors.now,
    sessionId: null,
    qaRecordId: null,
    diagnosticAttemptId: null,
    objectiveCorrect: null,
    targetEvidenceId: null,
    voided: false,
    modelVersion: null,
    policyVersion: KNOWLEDGE_POLICY_VERSION,
    ...overrides,
  };
}

describe("KnowledgeStateResolver V2 golden vectors", () => {
  for (const vector of vectors.vectors) {
    it(vector.id, () => {
      const state = resolveKnowledgeState(
        vectors.conceptId,
        "global",
        vectors.scopeId,
        vector.events.map((event) => evidenceFromVector(event as VectorEvent)),
        vectors.now,
      );
      expect(state.policyVersion).toBe(vectors.policyVersion);
      expect(state.dimensions.familiarity).toEqual(vector.expected);
      for (const dimension of KNOWLEDGE_DIMENSIONS.filter((item) => item !== "familiarity")) {
        expect(state.dimensions[dimension]).toEqual({
          probability: 0.35,
          uncertainty: 0.92,
          status: "uncertain",
          evidenceCount: 0,
          directEvidenceCount: 0,
          objectiveAttemptCount: 0,
          reliableCorrectSessions: 0,
          manualStatus: null,
          lastEvidenceAt: null,
        });
      }
    });
  }
});
