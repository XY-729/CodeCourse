import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GESTURE_COMPLETE_EVENT } from "../components/GestureLayer";
import { useGestureCommands } from "./useGestureCommands";

function commands(left: () => string | null) {
  return {
    left,
    right: vi.fn(() => null),
    up: vi.fn(() => null),
    down: vi.fn(() => null),
    "up-right": vi.fn(() => null),
    "up-left": vi.fn(() => null),
    "down-right": vi.fn(() => null),
    "down-left": vi.fn(() => null),
  };
}

describe("useGestureCommands", () => {
  it("executes the current command and exposes its immediate hint", () => {
    const first = vi.fn(() => "old");
    const second = vi.fn(() => "← 已撤销");
    let value = commands(first);
    const { result, rerender } = renderHook(() => useGestureCommands(value));
    value = commands(second);
    rerender();

    act(() => {
      window.dispatchEvent(new CustomEvent(GESTURE_COMPLETE_EVENT, {
        detail: {
          points: [
            { x: 140, y: 60, timestamp: 1 },
            { x: 60, y: 60, timestamp: 2 },
          ],
        },
      }));
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(result.current?.text).toBe("← 已撤销");
  });
});
