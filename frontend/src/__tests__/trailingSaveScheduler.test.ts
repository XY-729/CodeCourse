import { afterEach, describe, expect, it, vi } from "vitest";
import { TrailingSaveScheduler } from "../learning/trailingSaveScheduler";

describe("TrailingSaveScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces 100 scroll updates into one trailing database request", () => {
    vi.useFakeTimers();
    const scheduler = new TrailingSaveScheduler(800);
    const save = vi.fn();

    for (let line = 1; line <= 100; line += 1) {
      scheduler.schedule("file:src/main.ts", () => save(line));
    }

    vi.advanceTimersByTime(799);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(100);
  });
});
