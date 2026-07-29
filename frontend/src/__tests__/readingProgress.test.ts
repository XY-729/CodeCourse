import { describe, it, expect } from "vitest";
import {
  advanceReadingChrome,
  calculateReadingProgress,
  type ReadingChromeState,
} from "../components/MarkdownViewer";

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

describe("advanceReadingChrome", () => {
  const visibleState = (lastScrollTop = 20): ReadingChromeState => ({
    lastScrollTop,
    downwardTravel: 0,
    upwardTravel: 0,
    hidden: false,
  });

  it("hides the reading chrome after 18px of downward travel", () => {
    const halfway = advanceReadingChrome(visibleState(33), 42);
    expect(halfway.hidden).toBe(false);

    const hidden = advanceReadingChrome(halfway, 51);
    expect(hidden.hidden).toBe(true);
    expect(hidden.downwardTravel).toBe(18);
  });

  it("does not hide for small alternating scroll jitter", () => {
    const down = advanceReadingChrome(visibleState(40), 46);
    const up = advanceReadingChrome(down, 42);
    const downAgain = advanceReadingChrome(up, 48);

    expect(downAgain.hidden).toBe(false);
    expect(downAgain.downwardTravel).toBe(6);
  });

  it("restores the reading chrome after 8px of upward travel", () => {
    const hidden: ReadingChromeState = {
      lastScrollTop: 80,
      downwardTravel: 18,
      upwardTravel: 0,
      hidden: true,
    };

    const halfway = advanceReadingChrome(hidden, 76);
    expect(halfway.hidden).toBe(true);

    const visible = advanceReadingChrome(halfway, 72);
    expect(visible.hidden).toBe(false);
    expect(visible.upwardTravel).toBe(8);
  });

  it("always restores the reading chrome near the document top", () => {
    const hidden: ReadingChromeState = {
      lastScrollTop: 60,
      downwardTravel: 24,
      upwardTravel: 0,
      hidden: true,
    };

    expect(advanceReadingChrome(hidden, 12)).toEqual({
      lastScrollTop: 12,
      downwardTravel: 0,
      upwardTravel: 0,
      hidden: false,
    });
  });
});
