import { describe, it, expect } from "vitest";
import type { TermPersonalizationProfile } from "../termDisplayTypes";

import { buildPreliminaryTermDecision } from "../termDisplayDecision";
import { allocateTermDisplays } from "../termDisplayAllocator";

function profile(overrides: Partial<TermPersonalizationProfile> = {}): TermPersonalizationProfile {
  return {
    conceptKey: "global:bind",
    manualStatus: null,
    mastery: null, uncertainty: null,
    shadowFamiliarity: null, shadowConfidence: null, shadowEvidenceCount: 0,
    domainPrior: null,
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: "c1", text: "bind", normalizedText: "bind",
    conceptKey: "global:bind", conceptName: "bind",
    paragraphId: "p0", occurrenceIndex: 0,
    source: "model" as const, sourceConfidence: 0.8, contextRelevance: 0.8,
    difficulty: 0.5,
    isInHeading: false, isInCodeBlock: false, isInlineCode: false, isInTable: false,
    manualLink: false,
    ...overrides,
  };
}

describe("term display integration", () => {
  it("manual known term hides across the entire pipeline", () => {
    const d = buildPreliminaryTermDecision(
      candidate(),
      profile({ manualStatus: "known" }),
      {},
      { profileAvailable: true, paragraphCount: 5 },
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("manual_known");
  });

  it("confirmed understanding hides without claiming mastery", () => {
    const d = buildPreliminaryTermDecision(
      candidate(),
      profile({ familiarity: "self_reported_understood" }),
      {},
      { profileAvailable: true, paragraphCount: 5 },
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("self_reported_understood");
  });

  it("unrecorded terms still get one entry per concept", () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      candidateId: `c${i}`, conceptKey: `k${i}`, paragraphId: `p${i}`,
      occurrenceIndex: i, eligible: true, score: 0.5 + i * 0.01,
      tier: "subtle" as const, reason: "model_selected" as const,
      manualUnknown: false,
    }));
    const result = allocateTermDisplays({ preliminary: items });
    // Every distinct concept keeps an entry; there is no document quota.
    expect(result.filter((d) => d.visible)).toHaveLength(15);
  });

  it("a profile failure does not hide terms", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      candidateId: `c${i}`, conceptKey: `k${i}`, paragraphId: `p${i}`,
      occurrenceIndex: i, eligible: true, score: 0.6 + i * 0.01,
      tier: "subtle" as const, reason: "model_selected" as const,
      manualUnknown: false,
    }));
    const fallback = allocateTermDisplays({ preliminary: items, profileAvailable: false });
    const normal = allocateTermDisplays({ preliminary: items, profileAvailable: true });
    expect(fallback.filter((d) => d.visible)).toHaveLength(
      normal.filter((d) => d.visible).length,
    );
  });

  it("needs-help terms are prominent while legacy scoring is ignored", () => {
    const d = buildPreliminaryTermDecision(
      candidate(),
      profile({ familiarity: "needs_help" }),
      {},
      { profileAvailable: true, paragraphCount: 5 },
    );
    expect(d.eligible).toBe(true);
    expect(d.tier).toBe("prominent");
    expect(d.reason).toBe("needs_help");
  });

  it("manual linked bypasses scoring", () => {
    const d = buildPreliminaryTermDecision(
      candidate({ manualLink: true }),
      undefined, {}, { profileAvailable: true, paragraphCount: 5 },
    );
    expect(d.eligible).toBe(true);
    expect(d.tier).toBe("prominent");
    expect(d.reason).toBe("explicit_manual_link");
  });

  it("repeated occurrences of one concept share a single entry", () => {
    const allPreliminary = Array.from({ length: 40 }, (_, i) => ({
      candidateId: `c${i}`, conceptKey: `k${i % 15}`,
      paragraphId: `p${i % 20}`, occurrenceIndex: i,
      eligible: i % 5 !== 0, // some ineligible (noise)
      score: 0.3 + (i % 10) * 0.05,
      tier: "subtle" as const, reason: "model_selected" as const,
      manualUnknown: i % 13 === 0,
    }));
    const result = allocateTermDisplays({ preliminary: allPreliminary });
    const visible = result.filter((d) => d.visible);
    const visibleConcepts = new Set(visible.map((d) => d.conceptKey));
    expect(visible.length).toBe(visibleConcepts.size);
    expect(visibleConcepts.size).toBeLessThanOrEqual(15);
  });
});
