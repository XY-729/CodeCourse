import { describe, it, expect } from "vitest";
import { allocateTermDisplays } from "../termDisplayAllocator";
import type { PreliminaryTermDecision } from "../termDisplayTypes";

function dec(overrides: Partial<PreliminaryTermDecision> = {}): PreliminaryTermDecision {
  return {
    candidateId: "c1",
    conceptKey: "global:test:concept",
    paragraphId: "doc:p0",
    occurrenceIndex: 0,
    eligible: true,
    score: 0.5,
    tier: "subtle",
    reason: "model_selected",
    manualUnknown: false,
    ...overrides,
  };
}

describe("allocateTermDisplays", () => {
  it("same concept shown only once", () => {
    const items = [
      dec({ candidateId: "c1", conceptKey: "a", occurrenceIndex: 0 }),
      dec({ candidateId: "c2", conceptKey: "a", occurrenceIndex: 1 }),
    ];
    const result = allocateTermDisplays({ preliminary: items });
    const visible = result.filter((d) => d.visible);
    expect(visible.length).toBe(1);
    expect(result.find((d) => d.candidateId === "c2")!.reason).toBe("duplicate_concept");
  });

  it("gives every distinct concept one entry instead of a fixed quota", () => {
    // 30 distinct technical concepts in 30 paragraphs: none may be dropped by
    // document or paragraph density limits.
    const items = Array.from({ length: 30 }, (_, i) =>
      dec({ candidateId: `c${i}`, conceptKey: `k${i}`, paragraphId: `doc:p${i}`, occurrenceIndex: i }),
    );
    const result = allocateTermDisplays({ preliminary: items });
    expect(result.filter((d) => d.visible)).toHaveLength(30);
  });

  it("keeps several concepts visible in one paragraph", () => {
    const items = [
      dec({ candidateId: "c1", conceptKey: "a", paragraphId: "doc:p0", occurrenceIndex: 0 }),
      dec({ candidateId: "c2", conceptKey: "b", paragraphId: "doc:p0", occurrenceIndex: 1 }),
    ];
    const result = allocateTermDisplays({ preliminary: items });
    expect(result.filter((d) => d.visible && d.paragraphId === "doc:p0")).toHaveLength(2);
    expect(
      result.some((d) => d.reason === "duplicate_concept" || d.reason === "below_threshold"),
    ).toBe(false);
  });

  it("manual unknown prioritized when one concept repeats", () => {
    const items = [
      dec({ candidateId: "c1", conceptKey: "a", manualUnknown: false, score: 0.9 }),
      dec({ candidateId: "c2", conceptKey: "b", manualUnknown: true, score: 0.3 }),
      dec({ candidateId: "c3", conceptKey: "b", manualUnknown: false, score: 0.99 }),
    ];
    const result = allocateTermDisplays({ preliminary: items });
    // The explicit "I do not know b" occurrence is the one that stays visible.
    expect(result.find((d) => d.candidateId === "c2")?.visible).toBe(true);
    expect(result.find((d) => d.candidateId === "c3")?.reason).toBe("duplicate_concept");
  });

  it("shows nothing for ineligible candidates", () => {
    const items = [
      dec({ candidateId: "c1", conceptKey: "a", eligible: false, reason: "unsupported_location" }),
      dec({ candidateId: "c2", conceptKey: "b", eligible: false, reason: "manual_known" }),
    ];
    const result = allocateTermDisplays({ preliminary: items });
    expect(result.filter((d) => d.visible)).toHaveLength(0);
    expect(result.map((d) => d.reason).sort()).toEqual(["manual_known", "unsupported_location"]);
  });

  it("stable sorting", () => {
    const items = [
      dec({ candidateId: "c1", conceptKey: "a", occurrenceIndex: 2, score: 0.5 }),
      dec({ candidateId: "c2", conceptKey: "b", occurrenceIndex: 1, score: 0.5 }),
    ];
    const r1 = allocateTermDisplays({ preliminary: items });
    const r2 = allocateTermDisplays({ preliminary: items });
    expect(r1.map((d) => d.candidateId)).toEqual(r2.map((d) => d.candidateId));
  });

  it("manual link always visible", () => {
    const items = [
      dec({ candidateId: "c1", conceptKey: "manual", occurrenceIndex: 0, score: 0.1, eligible: true, reason: "explicit_manual_link" }),
    ];
    const result = allocateTermDisplays({ preliminary: items });
    expect(result[0].visible).toBe(true);
  });
});
