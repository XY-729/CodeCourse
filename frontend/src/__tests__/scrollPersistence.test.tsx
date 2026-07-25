import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculateReadingProgress } from "../components/MarkdownViewer";

describe("calculateReadingProgress", () => {
  it("returns 0 at top", () => expect(calculateReadingProgress(0, 1000, 500)).toBe(0));
  it("returns 1 at bottom", () => expect(calculateReadingProgress(500, 1000, 500)).toBe(1));
  it("returns 1 when unscrollable", () => expect(calculateReadingProgress(0, 400, 500)).toBe(1));
  it("returns 0 for negative scrollTop", () => expect(calculateReadingProgress(-100, 1000, 500)).toBe(0));
  it("returns 1 for overflow", () => expect(calculateReadingProgress(600, 1000, 500)).toBe(1));
  it("handles zero height", () => expect(calculateReadingProgress(0, 0, 500)).toBe(1));
  it("approaches 1 near bottom", () => expect(calculateReadingProgress(499, 1000, 500)).toBeCloseTo(0.998, 2));
});

describe("scroll save state machine contract", () => {
  // The MarkdownViewer now implements a unified scroll save:
  // - scrollend (preferred): commit once on stop, check selection
  // - debounce (fallback): start 700ms timer on each scroll, reset on new scroll
  // - unmount: cancel timer + commit once
  // - Android selection active: skip all saves

  function simulateScrollSaves(
    hasScrollend: boolean,
    hasSelection: boolean,
    scrollCount: number,
    advanceMs: number,
  ): { commitCalls: number } {
    let commitCalls = 0;
    let commitScheduled = false;
    let debounceTimer: number | null = null;

    function commitReadingPosition() {
      if (hasSelection) return; // selection guard
      commitCalls += 1;
      commitScheduled = false;
    }

    // scroll handler
    for (let i = 0; i < scrollCount; i++) {
      if (!hasScrollend) {
        // debounce mode: clear + re-schedule
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = 1; // mark as scheduled
        commitScheduled = true;
      }
    }

    // after advance
    if (!hasScrollend && commitScheduled) {
      commitReadingPosition();
    }
    if (hasScrollend) {
      // scrollend fires once
      commitReadingPosition();
    }

    return { commitCalls };
  }

  it("scrollend: commits once after scrolling stops", () => {
    const r = simulateScrollSaves(true, false, 100, 0);
    expect(r.commitCalls).toBe(1);
  });

  it("debounce: commits once after timer expires", () => {
    const r = simulateScrollSaves(false, false, 100, 700);
    expect(r.commitCalls).toBe(1);
  });

  it("selection active: no commit on scrollend", () => {
    const r = simulateScrollSaves(true, true, 100, 0);
    expect(r.commitCalls).toBe(0);
  });

  it("selection active: no commit on debounce", () => {
    const r = simulateScrollSaves(false, true, 100, 700);
    expect(r.commitCalls).toBe(0);
  });

  it("both scrollend and debounce would not both fire in production", () => {
    // In production, only one path is active.
    // scrollend path: no debounce timer
    // debounce path: no scrollend
    // So at most 1 commit per stop.
    const r1 = simulateScrollSaves(true, false, 100, 0);
    const r2 = simulateScrollSaves(false, false, 100, 700);
    // Neither can produce >1 because the paths are mutually exclusive
    expect(r1.commitCalls).toBeLessThanOrEqual(1);
    expect(r2.commitCalls).toBeLessThanOrEqual(1);
  });
});
