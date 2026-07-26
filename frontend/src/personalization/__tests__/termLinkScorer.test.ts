/**
 * Tests for termLinkScorer.ts — pure functions, must pass identically on all platforms.
 */
import { describe, it, expect } from "vitest";
import {
  scoreTermLink,
  scoreTermLinks,
  getDisplayTier,
  selectTopTerms,
} from "../termLinkScorer";
import { createInitialMastery } from "../masteryEngine";
import type { TermCandidate, ConceptMastery, PersonalizationScope } from "../types";

const scope: PersonalizationScope = { type: "project", id: "test-project" };
const now = "2026-07-26T00:00:00Z";

function makeCandidate(overrides: Partial<TermCandidate> = {}): TermCandidate {
  return {
    text: overrides.text ?? "React",
    conceptId: overrides.conceptId ?? "concept-react",
    source: overrides.source ?? "dictionary",
    termConfidence: overrides.termConfidence ?? 0.9,
    contextRelevance: overrides.contextRelevance ?? 0.5,
    generalDifficulty: overrides.generalDifficulty ?? 0.3,
  };
}

// ---- Test 11: Known concept gets low score, unknown gets high score ----
describe("scoreTermLink", () => {
  it("known concept (mastery=0.93) gets low score", () => {
    const mastery: ConceptMastery = {
      ...createInitialMastery("concept-react", scope, now),
      knownEvidence: 14, // 1 + some events
      unknownEvidence: 1,
      mastery: 0.93,
      uncertainty: 1 / Math.sqrt(15),
    };
    const candidate = makeCandidate({ generalDifficulty: 0.3, contextRelevance: 0.5 });
    const result = scoreTermLink(candidate, mastery, now, 0);
    // 0.50 * 0.07 + 0.20 * 0.3 + 0.20 * 0.5 + 0.10 * 0 = 0.035 + 0.06 + 0.10 = 0.195
    expect(result.linkScore).toBeCloseTo(0.195, 3);
    expect(result.displayTier).toBe("none");
  });

  it("unknown concept (mastery=0.18) gets high score", () => {
    const mastery: ConceptMastery = {
      ...createInitialMastery("concept-fts5", scope, now),
      knownEvidence: 1,
      unknownEvidence: 5, // after marked_unknown
      mastery: 1 / 6, // ≈0.167
      uncertainty: 1 / Math.sqrt(6),
    };
    const candidate = makeCandidate({
      text: "FTS5",
      conceptId: "concept-fts5",
      generalDifficulty: 0.6,
      contextRelevance: 0.9,
    });
    const result = scoreTermLink(candidate, mastery, now, 0.5);
    // 0.50 * (1-0.167) + 0.20 * 0.6 + 0.20 * 0.9 + 0.10 * exploration
    // exploration: seed=0.5, uncertainty≈0.408 > 0.3, mastery between 0.4 and 0.6
    // bonus = 0.05 + 0.5 * 0.05 = 0.075
    // total = 0.4165 + 0.12 + 0.18 + 0.0075 = 0.7235
    expect(result.linkScore).toBeGreaterThan(0.7);
    expect(result.displayTier).not.toBe("none");
  });
});

// ---- Test 12: Same inputs produce same linkScore (deterministic) ----
describe("scoreTermLink determinism", () => {
  it("produces identical results with same seed", () => {
    const mastery: ConceptMastery = {
      ...createInitialMastery("c1", scope, now),
      mastery: 0.5,
      uncertainty: 0.5,
    };
    const candidate = makeCandidate();
    const r1 = scoreTermLink(candidate, mastery, now, 0.5);
    const r2 = scoreTermLink(candidate, mastery, now, 0.5);
    expect(r1.linkScore).toBe(r2.linkScore);
    expect(r1.displayTier).toBe(r2.displayTier);
  });

  it("produces different results with different seeds (exploration varies)", () => {
    const mastery: ConceptMastery = {
      ...createInitialMastery("c1", scope, now),
      mastery: 0.5,
      uncertainty: 0.5,
    };
    const candidate = makeCandidate();
    const r1 = scoreTermLink(candidate, mastery, now, 0.0); // no exploration
    const r2 = scoreTermLink(candidate, mastery, now, 0.9); // high exploration
    expect(r1.linkScore).toBeLessThanOrEqual(r2.linkScore);
  });
});

// ---- Test 13: Display tiers ----
describe("getDisplayTier", () => {
  it("returns 'none' for low scores", () => {
    expect(getDisplayTier(0.3, null)).toBe("none");
  });

  it("returns 'subtle' for medium scores", () => {
    expect(getDisplayTier(0.6, null)).toBe("subtle");
  });

  it("returns 'prominent' for high scores", () => {
    expect(getDisplayTier(0.8, null)).toBe("prominent");
  });

  it("forces 'none' for manual_status='known'", () => {
    expect(getDisplayTier(0.9, "known")).toBe("none");
  });

  it("forces at least 'subtle' for manual_status='unknown'", () => {
    expect(getDisplayTier(0.3, "unknown")).toBe("subtle");
  });
});

// ---- Test 14: Density caps ----
describe("selectTopTerms", () => {
  it("deduplicates by conceptId", () => {
    const terms = [
      { ...makeCandidate({ conceptId: "c1", text: "React" }), mastery: 0.5, uncertainty: 0.5, manualStatus: null, linkScore: 0.8, displayTier: "prominent" as const },
      { ...makeCandidate({ conceptId: "c1", text: "React" }), mastery: 0.5, uncertainty: 0.5, manualStatus: null, linkScore: 0.7, displayTier: "subtle" as const },
    ];
    const result = selectTopTerms(terms as any, 500);
    expect(result.length).toBe(1); // Only first occurrence
  });

  it("respects per-1000-char density limit", () => {
    const terms = Array.from({ length: 20 }, (_, i) => ({
      ...makeCandidate({ conceptId: `c${i}`, text: `Term${i}` }),
      mastery: 0.3,
      uncertainty: 0.4,
      manualStatus: null,
      linkScore: 0.8,
      displayTier: "prominent" as const,
    }));
    const result = selectTopTerms(terms as any, 2000); // 2000 chars → max 12 terms
    expect(result.length).toBeLessThanOrEqual(12);
  });

  it("excludes terms with displayTier='none'", () => {
    const terms = [
      { ...makeCandidate({ conceptId: "c1" }), mastery: 0.9, uncertainty: 0.1, manualStatus: null, linkScore: 0.2, displayTier: "none" as const },
      { ...makeCandidate({ conceptId: "c2" }), mastery: 0.3, uncertainty: 0.4, manualStatus: null, linkScore: 0.8, displayTier: "prominent" as const },
    ];
    const result = selectTopTerms(terms as any, 500);
    expect(result.length).toBe(1);
    expect(result[0].conceptId).toBe("c2");
  });

  it("boosts explicitly asked concepts to prominent", () => {
    const terms = [
      { ...makeCandidate({ conceptId: "c1" }), mastery: 0.9, uncertainty: 0.1, manualStatus: null, linkScore: 0.2, displayTier: "none" as const },
    ];
    const result = selectTopTerms(terms as any, 500, new Set(["c1"]));
    expect(result.length).toBe(1);
    expect(result[0].displayTier).toBe("prominent");
    expect(result[0].linkScore).toBe(1.0);
  });
});

// ---- Test 15: Unknown mastery -> neutral default ----
describe("scoreTermLink with null mastery", () => {
  it("uses mastery=0.5 when mastery is null", () => {
    const candidate = makeCandidate({ generalDifficulty: 0.3, contextRelevance: 0.5 });
    const result = scoreTermLink(candidate, null, now, 0);
    // mastery=0.5 → unfamiliarity=0.5
    // 0.50*0.5 + 0.20*0.3 + 0.20*0.5 = 0.25 + 0.06 + 0.10 = 0.41
    expect(result.linkScore).toBeCloseTo(0.41, 2);
  });

  it("keeps a high-confidence cold-start term discoverable", () => {
    const candidate = makeCandidate({
      text: "Tree-sitter",
      conceptId: "concept-tree-sitter",
      termConfidence: 0.92,
      generalDifficulty: 0.65,
      contextRelevance: 0.8,
    });
    expect(scoreTermLink(candidate, null, now, 0).displayTier).not.toBe("none");
  });
});
