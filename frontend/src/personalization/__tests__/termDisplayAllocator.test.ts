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
    reason: "likely_unfamiliar",
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
    const result = allocateTermDisplays({ preliminary: items, paragraphCount: 5, terminologyDensity: 0.5, profileAvailable: true });
    const visible = result.filter((d) => d.visible);
    expect(visible.length).toBe(1);
    expect(result.find((d) => d.candidateId === "c2")!.reason).toBe("duplicate_concept");
  });

  it("manual unknown prioritized", () => {
    const items = [
      dec({ candidateId: "c1", conceptKey: "a", manualUnknown: false, score: 0.9 }),
      dec({ candidateId: "c2", conceptKey: "b", manualUnknown: true, score: 0.3 }),
    ];
    const result = allocateTermDisplays({ preliminary: items, paragraphCount: 1, terminologyDensity: 0.5, profileAvailable: true });
    const visible = result.filter((d) => d.visible);
    expect(visible[0].conceptKey).toBe("b");
  });

  it("default max 1 per paragraph", () => {
    const items = [
      dec({ candidateId: "c1", conceptKey: "a", paragraphId: "doc:p0", occurrenceIndex: 0 }),
      dec({ candidateId: "c2", conceptKey: "b", paragraphId: "doc:p0", occurrenceIndex: 1 }),
    ];
    const result = allocateTermDisplays({ preliminary: items, paragraphCount: 5, terminologyDensity: 0.5, profileAvailable: true });
    const visibleP0 = result.filter((d) => d.visible && d.paragraphId === "doc:p0");
    expect(visibleP0.length).toBe(1);
  });

  it("high density allows 2 per paragraph", () => {
    const items = [
      dec({ candidateId: "c1", conceptKey: "a", paragraphId: "doc:p0", occurrenceIndex: 0 }),
      dec({ candidateId: "c2", conceptKey: "b", paragraphId: "doc:p0", occurrenceIndex: 1 }),
    ];
    const result = allocateTermDisplays({ preliminary: items, paragraphCount: 5, terminologyDensity: 0.9, profileAvailable: true });
    const visibleP0 = result.filter((d) => d.visible && d.paragraphId === "doc:p0");
    expect(visibleP0.length).toBe(2);
  });

  it("profile unavailable caps at 6", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      dec({ candidateId: `c${i}`, conceptKey: `k${i}`, paragraphId: `doc:p${i}`, occurrenceIndex: i }),
    );
    const result = allocateTermDisplays({ preliminary: items, paragraphCount: 20, terminologyDensity: 0.5, profileAvailable: false });
    const visible = result.filter((d) => d.visible);
    expect(visible.length).toBeLessThanOrEqual(6);
  });

  it("default max 12", () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      dec({ candidateId: `c${i}`, conceptKey: `k${i}`, paragraphId: `doc:p${i}`, occurrenceIndex: i }),
    );
    const result = allocateTermDisplays({ preliminary: items, paragraphCount: 30, terminologyDensity: 0.5, profileAvailable: true });
    const visible = result.filter((d) => d.visible);
    expect(visible.length).toBeLessThanOrEqual(12);
  });

  it("stable sorting", () => {
    const items = [
      dec({ candidateId: "c1", conceptKey: "a", occurrenceIndex: 2, score: 0.5 }),
      dec({ candidateId: "c2", conceptKey: "b", occurrenceIndex: 1, score: 0.5 }),
    ];
    const r1 = allocateTermDisplays({ preliminary: items, paragraphCount: 5, terminologyDensity: 0.5, profileAvailable: true });
    const r2 = allocateTermDisplays({ preliminary: items, paragraphCount: 5, terminologyDensity: 0.5, profileAvailable: true });
    expect(r1.map((d) => d.candidateId)).toEqual(r2.map((d) => d.candidateId));
  });

  it("paragraph limit reason is correct", () => {
    const items = [
      dec({ candidateId: "c1", conceptKey: "a", paragraphId: "doc:p0", occurrenceIndex: 0, score: 0.9 }),
      dec({ candidateId: "c2", conceptKey: "b", paragraphId: "doc:p0", occurrenceIndex: 1, score: 0.8 }),
    ];
    const result = allocateTermDisplays({ preliminary: items, paragraphCount: 5, terminologyDensity: 0.5, profileAvailable: true });
    const limited = result.find((d) => !d.visible && d.candidateId === "c2");
    expect(limited?.reason).toBe("paragraph_density_limit");
  });

  it("document limit reason is correct", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      dec({ candidateId: `c${i}`, conceptKey: `k${i}`, paragraphId: `doc:p${i}`, occurrenceIndex: i, score: 0.5 + i * 0.01 }),
    );
    const result = allocateTermDisplays({ preliminary: items, paragraphCount: 3, terminologyDensity: 0.1, profileAvailable: true });
    const limited = result.filter((d) => d.reason === "document_density_limit");
    expect(limited.length).toBeGreaterThan(0);
  });

  it("manual link always visible", () => {
    const items = [
      dec({ candidateId: "c1", conceptKey: "manual", occurrenceIndex: 0, score: 0.1, eligible: true }),
    ];
    const result = allocateTermDisplays({ preliminary: items, paragraphCount: 1, terminologyDensity: 0.0, profileAvailable: false });
    expect(result[0].visible).toBe(true);
  });
});
