import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCommandPaletteItems } from "./useCommandPaletteItems";

function options(openAssistant: () => void) {
  return {
    open: true,
    mobile: false,
    projectAvailable: true,
    learningPlan: false,
    hasLearningProgress: true,
    version: "0.4.4",
    courses: [],
    files: [],
    qaHistory: [],
    callGuides: [],
    projects: [],
    actions: {
      createCallGuide: vi.fn(),
      openAssistant,
      openGeneration: vi.fn(),
      openCourses: vi.fn(),
      openFiles: vi.fn(),
      openSettings: vi.fn(),
      openPrompts: vi.fn(),
      buildIndex: vi.fn(),
      resetProgress: vi.fn(),
      checkUpdates: vi.fn(),
      openDiagnostics: vi.fn(),
      openCourse: vi.fn(),
      openFile: vi.fn(),
      openQA: vi.fn(),
      openCallGuide: vi.fn(),
      deleteCallGuide: vi.fn(),
      openProject: vi.fn(),
    },
  };
}

describe("useCommandPaletteItems", () => {
  it("returns no work until the palette opens", () => {
    const value = options(vi.fn());
    value.open = false;
    const { result } = renderHook(() => useCommandPaletteItems(value));
    expect(result.current).toEqual([]);
  });

  it("keeps stable items wired to the latest actions", () => {
    const first = vi.fn();
    const second = vi.fn();
    let value = options(first);
    const { result, rerender } = renderHook(() => useCommandPaletteItems(value));
    const assistantItem = result.current.find((item) => item.id === "command:assistant");

    value = options(second);
    rerender();
    act(() => assistantItem?.run());

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
