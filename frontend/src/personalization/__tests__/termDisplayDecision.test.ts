import { describe, it, expect } from "vitest";
import { buildPreliminaryTermDecision } from "../termDisplayDecision";
import type { TermCandidateInput, TermPersonalizationProfile } from "../termDisplayTypes";

function candidate(overrides: Partial<TermCandidateInput> = {}): TermCandidateInput {
  return {
    candidateId: "test-1", text: "移动语义", normalizedText: "移动语义",
    conceptKey: "global:move", conceptName: "移动语义", paragraphId: "doc:p0", occurrenceIndex: 0,
    source: "model", sourceConfidence: 0.7, contextRelevance: 0.65, difficulty: 0.6,
    isInHeading: false, isInCodeBlock: false, isInlineCode: false, isInTable: false, manualLink: false,
    ...overrides,
  };
}
function decide(overrides: Partial<TermCandidateInput> = {}, profile: Partial<TermPersonalizationProfile> = {}) {
  return buildPreliminaryTermDecision(candidate(overrides), {
    conceptKey: "global:move", manualStatus: null, mastery: null, uncertainty: null,
    shadowFamiliarity: null, shadowConfidence: null, shadowEvidenceCount: 0, domainPrior: null,
    ...profile,
  }, { terminologyDensity: 0.5 }, { profileAvailable: true, paragraphCount: 5 });
}

describe("model-selected term display", () => {
  it("keeps model-selected terms subtle when knowledge is unrecorded", () => {
    expect(decide()).toMatchObject({ eligible: true, tier: "subtle", reason: "model_selected", manualUnknown: false });
    expect(decide({ text: "栈", normalizedText: "栈" }).eligible).toBe(true);
  });
  it("does not invent knowledge from mastery, shadow scores, difficulty or a hash", () => {
    const neutral = decide();
    const changed = decide({ paragraphId: "other:p45", difficulty: 1, sourceConfidence: 0.3 }, {
      mastery: 0.99, shadowFamiliarity: 0.99, shadowConfidence: 0.99, shadowEvidenceCount: 100,
    });
    expect(changed.score).toBe(neutral.score);
    expect(changed.reason).toBe("model_selected");
    expect(changed.tier).toBe("subtle");
  });
  it("honors explicit known, confirmed knowledge, and a later unknown correction", () => {
    expect(decide({}, { manualStatus: "known" })).toMatchObject({ eligible: false, reason: "manual_known" });
    expect(decide({}, { knowledgeStatus: "confirmed" })).toMatchObject({ eligible: false, reason: "confirmed_knowledge" });
    expect(decide({}, { knowledgeStatus: "confirmed", manualStatus: "unknown" })).toMatchObject({ eligible: true, tier: "prominent", reason: "manual_unknown" });
  });
  it("cannot resurrect a non-model candidate from an unknown profile", () => {
    expect(decide({ source: "unknown" }, { manualStatus: "unknown" })).toMatchObject({ eligible: false, reason: "untrusted_candidate" });
  });
  it("keeps user-created links, but never nests them in links or code blocks", () => {
    expect(decide({ manualLink: true }, { manualStatus: "known" })).toMatchObject({ eligible: true, reason: "explicit_manual_link" });
    expect(decide({ manualLink: true, isInCodeBlock: true }).eligible).toBe(false);
    expect(decide({ manualLink: true, source: "existing_link" }).eligible).toBe(false);
  });
  it("skips headings and supports model-selected inline terms and comparison tables", () => {
    expect(decide({ isInHeading: true }).eligible).toBe(false);
    expect(decide({ isInlineCode: true }).eligible).toBe(true);
    expect(decide({ isInTable: true }).eligible).toBe(true);
  });
});
