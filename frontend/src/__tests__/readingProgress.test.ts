import { describe, it, expect } from "vitest";
import { calculateReadingProgress } from "../components/MarkdownViewer";

describe("calculateReadingProgress", () => {
  it("returns 0 at top", () => {
    expect(calculateReadingProgress(0, 1000, 500)).toBe(0);
  });

  it("returns ~0.5 in middle", () => {
    const r = calculateReadingProgress(250, 1000, 500);
    expect(r).toBeGreaterThan(0.4);
    expect(r).toBeLessThan(0.6);
  });

  it("returns 1 at bottom", () => {
    expect(calculateReadingProgress(500, 1000, 500)).toBe(1);
  });

  it("returns 1 when unscrollable (height <= clientHeight)", () => {
    expect(calculateReadingProgress(0, 400, 500)).toBe(1);
  });

  it("returns 0 for negative scrollTop", () => {
    expect(calculateReadingProgress(-100, 1000, 500)).toBe(0);
  });

  it("returns 1 for scrollTop exceeding max", () => {
    expect(calculateReadingProgress(600, 1000, 500)).toBe(1);
  });

  it("handles zero scrollHeight gracefully", () => {
    expect(calculateReadingProgress(0, 0, 500)).toBe(1);
  });

  it("handles zero clientHeight gracefully", () => {
    expect(calculateReadingProgress(0, 1000, 0)).toBe(1);
  });

  it("approaches 1 as scroll approaches bottom", () => {
    expect(calculateReadingProgress(499, 1000, 500)).toBeCloseTo(0.998, 2);
  });
});
