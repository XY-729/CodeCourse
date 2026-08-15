import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTermDisplay } from "../useTermDisplay";

describe("useTermDisplay empty state", () => {
  it("settles without an update loop when there are no candidates", async () => {
    const loadProfiles = vi.fn();
    let renderCount = 0;
    const { result, rerender } = renderHook(() => {
      renderCount += 1;
      return useTermDisplay({
        projectId: 1,
        sourceKey: "course:outline.md",
        content: "# Outline",
        rawTerms: [],
        terminologyDensity: 0.5,
        loadProfiles,
      });
    });

    await act(async () => { await Promise.resolve(); });
    const settledRenderCount = renderCount;
    rerender();
    await act(async () => { await Promise.resolve(); });

    expect(result.current.status).toBe("idle");
    expect(result.current.visibleCandidateIds.size).toBe(0);
    expect(loadProfiles).not.toHaveBeenCalled();
    expect(renderCount - settledRenderCount).toBe(1);
  });
});
