import { describe, expect, it } from "vitest";
import { normalizeTermDisplayProfile } from "../../api/client";

describe("term display profile wire format", () => {
  it("normalizes the desktop and Android snake-case response", () => {
    expect(normalizeTermDisplayProfile({
      concept_key: "global:theory:socket",
      concept_id: "concept-uuid",
      request_key: "concept-uuid",
      manual_status: "unknown",
      knowledge_status: "needs_support",
      familiarity: "needs_help",
      ranges: [{ aspect: "握手", dimension: "conceptual", familiarity: "needs_help" }],
      tree_snapshot: { topology_version: 3, state_version: 4 },
      mastery: 0.25,
      uncertainty: 0.4,
      shadow_familiarity: 0.3,
      shadow_confidence: 0.7,
      shadow_evidence_count: 3,
      domain_prior: null,
    })).toEqual({
      conceptKey: "global:theory:socket",
      conceptId: "concept-uuid",
      requestKey: "concept-uuid",
      manualStatus: "unknown",
      familiarity: "needs_help",
      ranges: [{ aspect: "握手", dimension: "conceptual", familiarity: "needs_help" }],
      treeSnapshot: { topology_version: 3, state_version: 4 },
      knowledgeStatus: "needs_support",
      mastery: 0.25,
      uncertainty: 0.4,
      shadowFamiliarity: 0.3,
      shadowConfidence: 0.7,
      shadowEvidenceCount: 3,
      domainPrior: null,
    });
  });

  it("keeps a factual profile indexed by the UUID the caller requested", () => {
    const profile = normalizeTermDisplayProfile({
      concept_key: "global:theory:socket",
      concept_id: "vector-uuid",
      request_key: "vector-uuid",
      familiarity: "self_reported_understood",
      ranges: [{ aspect: "扩容", dimension: "conceptual", familiarity: "self_reported_understood" }],
      tree_snapshot: { topology_version: 1, state_version: 2 },
    });
    // The caller maps by requestKey/conceptId; the business key is still returned.
    expect(profile.requestKey).toBe("vector-uuid");
    expect(profile.conceptId).toBe("vector-uuid");
    expect(profile.familiarity).toBe("self_reported_understood");
    expect(profile.ranges?.[0].aspect).toBe("扩容");
  });
});
