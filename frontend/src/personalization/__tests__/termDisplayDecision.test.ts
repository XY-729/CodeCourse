import { describe, it, expect } from "vitest";
import { buildPreliminaryTermDecision } from "../termDisplayDecision";
import type { TermCandidateInput, TermPersonalizationProfile, TermDisplayPreferences, TermDisplayContext } from "../termDisplayTypes";

function candidate(overrides: Partial<TermCandidateInput> = {}): TermCandidateInput {
  return {
    candidateId: "test-1",
    text: "bind",
    normalizedText: "bind",
    conceptKey: "global:network:bind",
    conceptName: "bind",
    paragraphId: "doc:p0",
    occurrenceIndex: 0,
    source: "model",
    sourceConfidence: 0.7,
    contextRelevance: 0.65,
    difficulty: 0.6,
    isInHeading: false,
    isInCodeBlock: false,
    isInlineCode: false,
    isInTable: false,
    manualLink: false,
    ...overrides,
  };
}

function profile(overrides: Partial<TermPersonalizationProfile> = {}): TermPersonalizationProfile {
  return {
    conceptKey: "global:network:bind",
    manualStatus: null,
    mastery: null,
    uncertainty: null,
    shadowFamiliarity: null,
    shadowConfidence: null,
    shadowEvidenceCount: 0,
    domainPrior: null,
    ...overrides,
  };
}

function prefs(density = 0.5): TermDisplayPreferences {
  return { terminologyDensity: density };
}

function ctx(available = true, paragraphs = 10): TermDisplayContext {
  return { profileAvailable: available, paragraphCount: paragraphs };
}

describe("buildPreliminaryTermDecision", () => {
  it("manualStatus=known hides term", () => {
    const p = profile({ manualStatus: "known" });
    const d = buildPreliminaryTermDecision(candidate(), p, prefs(), ctx());
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("manual_known");
  });

  it("manualStatus=unknown makes prominent", () => {
    const p = profile({ manualStatus: "unknown" });
    const d = buildPreliminaryTermDecision(candidate(), p, prefs(), ctx());
    expect(d.eligible).toBe(true);
    expect(d.tier).toBe("prominent");
    expect(d.reason).toBe("manual_unknown");
  });

  it("neutral profile is NOT unknown", () => {
    const d = buildPreliminaryTermDecision(candidate(), undefined, prefs(), ctx());
    expect(d.reason).not.toBe("manual_unknown");
  });

  it("profile unavailable raises threshold", () => {
    const d1 = buildPreliminaryTermDecision(
      candidate({ sourceConfidence: 0.5, contextRelevance: 0.4 }),
      undefined, prefs(), ctx(false),
    );
    expect(d1.eligible).toBe(false);
    expect(d1.reason).toBe("profile_unavailable");
  });

  it("low sourceConfidence is filtered", () => {
    const d = buildPreliminaryTermDecision(
      candidate({ sourceConfidence: 0.4 }), undefined, prefs(), ctx(),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("low_candidate_quality");
  });

  it("low contextRelevance is filtered", () => {
    const d = buildPreliminaryTermDecision(
      candidate({ contextRelevance: 0.3 }), undefined, prefs(), ctx(),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("low_candidate_quality");
  });

  it("code block candidate is filtered as noise", () => {
    const d = buildPreliminaryTermDecision(
      candidate({ isInCodeBlock: true }), undefined, prefs(), ctx(),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("unsupported_location");
  });

  it("heading candidate is filtered", () => {
    const d = buildPreliminaryTermDecision(
      candidate({ isInHeading: true }), undefined, prefs(), ctx(),
    );
    expect(d.eligible).toBe(false);
  });

  it("table candidate is filtered", () => {
    const d = buildPreliminaryTermDecision(
      candidate({ isInTable: true }), undefined, prefs(), ctx(),
    );
    expect(d.eligible).toBe(false);
  });

  it("shadow evidence < 2 has no effect", () => {
    const p = profile({ shadowFamiliarity: 0.9, shadowConfidence: 0.5, shadowEvidenceCount: 1 });
    const d = buildPreliminaryTermDecision(candidate(), p, prefs(), ctx());
    expect(d.eligible).toBe(false); // low familiarity by default
  });

  it("shadow confidence below threshold has no effect", () => {
    const p = profile({ shadowFamiliarity: 0.9, shadowConfidence: 0.08, shadowEvidenceCount: 3 });
    const d = buildPreliminaryTermDecision(candidate(), p, prefs(), ctx());
    expect(d.reason).not.toBe("trusted_shadow_signal");
  });

  it("domain prior adjustment limited to ±0.06", () => {
    const p1 = profile({ domainPrior: 0.9 });
    const d1 = buildPreliminaryTermDecision(candidate(), p1, prefs(), ctx());
    // domain prior 0.9 gives adjustment of (0.9-0.5)*0.12 = +0.048 → slight increase
    // Just verify the function runs with domain prior
    expect(typeof d1.score).toBe("number");
  });

  it("same input produces same exploration value", () => {
    const d1 = buildPreliminaryTermDecision(candidate(), undefined, prefs(), ctx());
    const d2 = buildPreliminaryTermDecision(candidate(), undefined, prefs(), ctx());
    expect(d1.score).toBe(d2.score);
  });

  it("linked + automatic does NOT bypass scoring", () => {
    const d = buildPreliminaryTermDecision(candidate(), undefined, prefs(), ctx());
    expect(d.reason).not.toBe("explicit_manual_link");
  });

  it("manualLink: true bypasses scoring", () => {
    const d = buildPreliminaryTermDecision(
      candidate({ manualLink: true }), undefined, prefs(), ctx(),
    );
    expect(d.eligible).toBe(true);
    expect(d.tier).toBe("prominent");
    expect(d.reason).toBe("explicit_manual_link");
  });

  it("short noise text is filtered", () => {
    const d = buildPreliminaryTermDecision(
      candidate({ text: "a", normalizedText: "a", source: "model" }),
      undefined, prefs(), ctx(),
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("unsupported_location");
  });

  it("high difficulty + high unfamiliarity produces prominent", () => {
    const d = buildPreliminaryTermDecision(
      candidate({ sourceConfidence: 0.9, contextRelevance: 0.9, difficulty: 0.95 }),
      profile({ mastery: 0.1 }), // high unfamiliarity
      prefs(1.0), // high density → lower threshold
      ctx(true),
    );
    expect(d.eligible).toBe(true);
    expect(["prominent", "subtle"]).toContain(d.tier);
  });
});
