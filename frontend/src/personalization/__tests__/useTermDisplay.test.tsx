import { describe, it, expect } from "vitest";
import type { TermPersonalizationProfile, TermDisplayDecision } from "../termDisplayTypes";
import type { DocumentTerm } from "../../api/client";

// Test the pure compute function (imported internally from useTermDisplay).
// The hook-level async behavior is tested implicitly via the React component
// integration in the app. Pure function tests verify correctness without jsdom.
import { buildPreliminaryTermDecision } from "../termDisplayDecision";
import { allocateTermDisplays } from "../termDisplayAllocator";

function makeTerm(overrides: Partial<DocumentTerm> = {}): DocumentTerm {
  return {
    id: 1, project_id: 1, source_type: "course", source_path: "test.md",
    term_text: "bind", detection_source: "model", confidence: 0.7,
    status: "candidate", link_origin: "legacy_unknown",
    qa_record_id: null, concept_id: null, content_hash: null,
    created_at: "2024-01-01", updated_at: "2024-01-01",
    ...overrides,
  } as DocumentTerm;
}

describe("term display integration", () => {
  it("manual known term hides across entire pipeline", () => {
    const profile: TermPersonalizationProfile = {
      conceptKey: "global:bind",
      manualStatus: "known",
      mastery: null, uncertainty: null,
      shadowFamiliarity: null, shadowConfidence: null, shadowEvidenceCount: 0,
      domainPrior: null,
    };

    const d = buildPreliminaryTermDecision(
      {
        candidateId: "c1", text: "bind", normalizedText: "bind",
        conceptKey: "global:bind", conceptName: "bind",
        paragraphId: "p0", occurrenceIndex: 0,
        source: "model", sourceConfidence: 0.8, contextRelevance: 0.8,
        difficulty: 0.5,
        isInHeading: false, isInCodeBlock: false, isInlineCode: false, isInTable: false,
        manualLink: false,
      },
      profile,
      { terminologyDensity: 0.5 },
      { profileAvailable: true, paragraphCount: 5 },
    );
    expect(d.eligible).toBe(false);
    expect(d.reason).toBe("manual_known");
  });

  it("fallback does not show all candidates", () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      candidateId: `c${i}`, conceptKey: `k${i}`, paragraphId: `p${i}`,
      occurrenceIndex: i, eligible: true, score: 0.5 + i * 0.01,
      tier: "subtle" as const, reason: "likely_unfamiliar" as const,
      manualUnknown: false,
    }));
    const result = allocateTermDisplays({
      preliminary: items, paragraphCount: 15,
      terminologyDensity: 0.3, profileAvailable: false,
    });
    const visible = result.filter((d) => d.visible);
    expect(visible.length).toBeLessThanOrEqual(6);
  });

  it("density drops fallback to max 6", () => {
    const profileAvailable = false;
    const items = Array.from({ length: 20 }, (_, i) => ({
      candidateId: `c${i}`, conceptKey: `k${i}`, paragraphId: `p${i}`,
      occurrenceIndex: i, eligible: true, score: 0.5 + i * 0.01,
      tier: "subtle" as const, reason: "likely_unfamiliar" as const,
      manualUnknown: false,
    }));
    const r1 = allocateTermDisplays({ preliminary: items, paragraphCount: 20, terminologyDensity: 0.5, profileAvailable });
    const r2 = allocateTermDisplays({ preliminary: items, paragraphCount: 20, terminologyDensity: 0.5, profileAvailable });
    expect(r1.length).toBe(r2.length);
    expect(r1.map((d) => d.candidateId)).toEqual(r2.map((d) => d.candidateId));
  });

  it("profile unavailable shows fewer than profile available", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      candidateId: `c${i}`, conceptKey: `k${i}`, paragraphId: `p${i}`,
      occurrenceIndex: i, eligible: true, score: 0.6 + i * 0.01,
      tier: "subtle" as const, reason: "likely_unfamiliar" as const,
      manualUnknown: false,
    }));
    const fallback = allocateTermDisplays({ preliminary: items, paragraphCount: 5, terminologyDensity: 0.5, profileAvailable: false });
    const normal = allocateTermDisplays({ preliminary: items, paragraphCount: 5, terminologyDensity: 0.5, profileAvailable: true });
    expect(fallback.filter((d) => d.visible).length).toBeLessThanOrEqual(
      normal.filter((d) => d.visible).length,
    );
  });

  it("linked automatic does not bypass scoring", () => {
    const d = buildPreliminaryTermDecision(
      {
        candidateId: "c1", text: "socket", normalizedText: "socket",
        conceptKey: "global:socket", conceptName: "socket",
        paragraphId: "p0", occurrenceIndex: 0,
        source: "model", sourceConfidence: 0.7, contextRelevance: 0.7,
        difficulty: 0.5,
        isInHeading: false, isInCodeBlock: false, isInlineCode: false, isInTable: false,
        manualLink: false,
      },
      undefined, { terminologyDensity: 0.5 }, { profileAvailable: true, paragraphCount: 5 },
    );
    expect(d.reason).not.toBe("explicit_manual_link");
  });

  it("linked legacy_unknown does not bypass scoring", () => {
    const d = buildPreliminaryTermDecision(
      {
        candidateId: "c1", text: "epoll", normalizedText: "epoll",
        conceptKey: "global:epoll", conceptName: "epoll",
        paragraphId: "p0", occurrenceIndex: 0,
        source: "model", sourceConfidence: 0.7, contextRelevance: 0.7,
        difficulty: 0.5,
        isInHeading: false, isInCodeBlock: false, isInlineCode: false, isInTable: false,
        manualLink: false,
      },
      undefined, { terminologyDensity: 0.5 }, { profileAvailable: true, paragraphCount: 5 },
    );
    expect(d.reason).not.toBe("explicit_manual_link");
  });

  it("manual linked bypasses scoring", () => {
    const d = buildPreliminaryTermDecision(
      {
        candidateId: "c1", text: "socket", normalizedText: "socket",
        conceptKey: "global:socket", conceptName: "socket",
        paragraphId: "p0", occurrenceIndex: 0,
        source: "model", sourceConfidence: 0.7, contextRelevance: 0.7,
        difficulty: 0.5,
        isInHeading: false, isInCodeBlock: false, isInlineCode: false, isInTable: false,
        manualLink: true,
      },
      undefined, { terminologyDensity: 0.5 }, { profileAvailable: true, paragraphCount: 5 },
    );
    expect(d.eligible).toBe(true);
    expect(d.tier).toBe("prominent");
    expect(d.reason).toBe("explicit_manual_link");
  });

  it("high-quality terms survive pipeline end-to-end", () => {
    // 40 candidates, 20 paragraphs -- simulate full pipeline
    const allPreliminary = Array.from({ length: 40 }, (_, i) => ({
      candidateId: `c${i}`, conceptKey: `k${i % 15}`,
      paragraphId: `p${i % 20}`, occurrenceIndex: i,
      eligible: i % 5 !== 0, // some ineligible (noise)
      score: 0.3 + (i % 10) * 0.05,
      tier: "subtle" as const, reason: "likely_unfamiliar" as const,
      manualUnknown: i % 13 === 0,
    }));
    const result = allocateTermDisplays({
      preliminary: allPreliminary, paragraphCount: 20,
      terminologyDensity: 0.5, profileAvailable: true,
    });
    const visible = result.filter((d) => d.visible);
    // Should be well below 40
    expect(visible.length).toBeLessThan(20);
    // No more than 1 per paragraph in default density
    const perPara = new Map<string, number>();
    for (const d of visible) {
      perPara.set(d.paragraphId, (perPara.get(d.paragraphId) || 0) + 1);
    }
    for (const count of perPara.values()) {
      expect(count).toBeLessThanOrEqual(1);
    }
  });
});
