import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GenerationTask } from "../api/client";
import { useGenerationTaskController } from "./useGenerationTaskController";

function task(id: number, status: string, projectId = 1): GenerationTask {
  return {
    id,
    project_id: projectId,
    task_type: "outline",
    status,
    progress_current: 0,
    progress_total: 1,
    created_at: `2026-01-0${id}T00:00:00Z`,
    updated_at: `2026-01-0${id}T00:00:00Z`,
  } as GenerationTask;
}

describe("generation task controller", () => {
  it("rejects same-frame duplicate starts", () => {
    const { result } = renderHook(() => useGenerationTaskController({
      getCurrentProjectId: () => 1,
      taskMessage: (entry) => entry.status,
      onMessage: vi.fn(),
    }));
    act(() => {
      expect(result.current.acquireStart()).toBe(true);
      expect(result.current.acquireStart()).toBe(false);
    });
    expect(result.current.starting).toBe(true);
    act(() => result.current.releaseStart());
    expect(result.current.starting).toBe(false);
  });

  it("ignores stale project task updates", () => {
    let projectId = 2;
    const { result } = renderHook(() => useGenerationTaskController({
      getCurrentProjectId: () => projectId,
      taskMessage: (entry) => entry.status,
      onMessage: vi.fn(),
    }));
    act(() => {
      result.current.replaceTasks(1, [task(1, "running")]);
      result.current.replaceTasks(2, [task(2, "completed", 2)]);
    });
    expect(result.current.tasks.map((entry) => entry.id)).toEqual([2]);
    projectId = 3;
    act(() => { result.current.upsertTask(2, task(3, "running", 2)); });
    expect(result.current.tasks.map((entry) => entry.id)).toEqual([2]);
  });

  it("deduplicates trackers by project and task", () => {
    const { result } = renderHook(() => useGenerationTaskController({
      getCurrentProjectId: () => 1,
      taskMessage: (entry) => entry.status,
      onMessage: vi.fn(),
    }));
    expect(result.current.beginTracking(1, 9)).toBe(true);
    expect(result.current.beginTracking(1, 9)).toBe(false);
    result.current.endTracking(1, 9);
    expect(result.current.beginTracking(1, 9)).toBe(true);
  });
});
