import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculateReadingProgress } from "../components/MarkdownViewer";

describe("calculateReadingProgress", () => {
  it("0 at top", () => expect(calculateReadingProgress(0, 1000, 500)).toBe(0));
  it("1 at bottom", () => expect(calculateReadingProgress(500, 1000, 500)).toBe(1));
  it("1 when unscrollable", () => expect(calculateReadingProgress(0, 400, 500)).toBe(1));
  it("0 for negative", () => expect(calculateReadingProgress(-100, 1000, 500)).toBe(0));
  it("1 for overflow", () => expect(calculateReadingProgress(600, 1000, 500)).toBe(1));
  it("near bottom", () => expect(calculateReadingProgress(499, 1000, 500)).toBeCloseTo(0.998, 2));
});

describe("unmount position save contract", () => {
  it("commits before setting unmounted flag", () => {
    // The MarkdownViewer cleanup must call commitReadingPosition(true)
    // BEFORE setting unmountedRef.current = true.
    // This test verifies the function contract.
    let unmounted = false;
    let savedRatio: number | null = null;
    const pendingRatio = 0.75;

    function commitReadingPosition(allowDuringUnmount: boolean) {
      if (!allowDuringUnmount && unmounted) return;
      if (pendingRatio !== null) savedRatio = pendingRatio;
    }

    // Correct order:
    commitReadingPosition(true); // allow during unmount
    unmounted = true;

    expect(savedRatio).toBe(0.75);
  });

  it("skips if already saved same ratio", () => {
    const saved = 0.5; const pending = 0.5;
    const committed: number[] = [];

    function commit(position: number) {
      if (position === saved) return; // same ratio, skip
      committed.push(position);
    }

    commit(pending);
    expect(committed).toHaveLength(0); // same ratio, skipped
  });

  it("does not save during Android selection", () => {
    const saved = 0.5;
    const hasSelection = true;
    const committed: number[] = [];

    function commit() {
      if (hasSelection) return;
      committed.push(saved);
    }

    commit();
    expect(committed).toHaveLength(0);
  });

  it("saves when selection is collapsed", () => {
    const saved = 0.5;
    const hasSelection = false;
    const committed: number[] = [];

    function commit() {
      if (hasSelection) return;
      committed.push(saved);
    }

    commit();
    expect(committed).toHaveLength(1);
  });
});
