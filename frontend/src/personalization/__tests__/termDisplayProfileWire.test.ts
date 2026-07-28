import { describe, expect, it } from "vitest";
import { normalizeTermDisplayProfile } from "../../api/client";

describe("term display profile wire format", () => {
  it("normalizes the desktop and Android snake-case response", () => {
    expect(normalizeTermDisplayProfile({
      concept_key: "global:theory:socket",
      manual_status: "unknown",
      mastery: 0.25,
      uncertainty: 0.4,
      shadow_familiarity: 0.3,
      shadow_confidence: 0.7,
      shadow_evidence_count: 3,
      domain_prior: null,
    })).toEqual({
      conceptKey: "global:theory:socket",
      manualStatus: "unknown",
      mastery: 0.25,
      uncertainty: 0.4,
      shadowFamiliarity: 0.3,
      shadowConfidence: 0.7,
      shadowEvidenceCount: 3,
      domainPrior: null,
    });
  });
});
