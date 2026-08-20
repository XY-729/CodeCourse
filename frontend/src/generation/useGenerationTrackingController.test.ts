import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGenerationTrackingController } from "./useGenerationTrackingController";

function options(acquireStartLock: () => boolean, isBusy: () => boolean) {
  return {
    project: null,
    getCurrentProjectId: vi.fn(() => null),
    acquireStartLock,
    releaseStartLock: vi.fn(),
    isBusy,
    beginTracking: vi.fn(() => false),
    endTracking: vi.fn(),
    replaceTasks: vi.fn((_projectId, tasks) => tasks),
    upsertTask: vi.fn(),
    onProjectData: vi.fn(),
    onOpenCourse: vi.fn(),
    onCompleted: vi.fn(),
    onKnowledgeChanged: vi.fn(),
    onShowMobileTasks: vi.fn(),
    onDismissMobileGeneration: vi.fn(),
    onMessage: vi.fn(),
    onToast: vi.fn(),
    onError: vi.fn(),
  };
}

describe("useGenerationTrackingController", () => {
  it("rejects duplicate starts synchronously", () => {
    const value = options(vi.fn(() => false), vi.fn(() => false));
    const { result } = renderHook(() => useGenerationTrackingController(value));
    let acquired = true;
    act(() => { acquired = result.current.acquireStart(); });
    expect(acquired).toBe(false);
    expect(value.onToast).toHaveBeenCalledWith("当前已有内容正在生成，请等待完成");
  });

  it("blocks project mutation while a task is active", () => {
    const value = options(vi.fn(() => true), vi.fn(() => true));
    const { result } = renderHook(() => useGenerationTrackingController(value));
    expect(result.current.rejectProjectMutationWhileBusy()).toBe(true);
    expect(value.onToast).toHaveBeenCalledWith("当前内容仍在生成，请完成后再切换或修改项目");
  });
});
