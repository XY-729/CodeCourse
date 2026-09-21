import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGenerationTrackingController } from "./useGenerationTrackingController";
import { getCourseFiles, getProject, type GenerationTask, type Project } from "../api/client";

vi.mock("../api/client", () => ({
  getCourseFiles: vi.fn(), getProject: vi.fn(), getGenerationTask: vi.fn(),
  listGenerationTasks: vi.fn(), retryGenerationTask: vi.fn(),
}));

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
  it("refreshes completed desktop tasks without stealing the current reader", async () => {
    vi.mocked(getCourseFiles).mockResolvedValue([{ filename: "lessons/lesson_01.md", title: "课程", group: "项目课件" }]);
    vi.mocked(getProject).mockResolvedValue({ id: 1 } as Project);
    const value = { ...options(vi.fn(() => true), vi.fn(() => false)),
      autoOpenCompleted: false,
      getCurrentProjectId: vi.fn(() => 1), beginTracking: vi.fn(() => true),
    };
    const { result, unmount } = renderHook(() => useGenerationTrackingController(value));
    await act(async () => result.current.trackTask(1, {
      id: 2, project_id: 1, status: "completed", task_type: "outline_lesson", output_path: "lessons/lesson_01.md",
    } as GenerationTask));
    expect(value.onProjectData).toHaveBeenCalledOnce();
    expect(value.onCompleted).toHaveBeenCalledOnce();
    expect(value.onOpenCourse).not.toHaveBeenCalled();
    expect(value.endTracking).toHaveBeenCalledWith(1, 2);
    unmount();
  });
  it("auto-opens the finished course with the relative name on Windows output paths", async () => {
    vi.mocked(getCourseFiles).mockResolvedValue([{ filename: "lessons/lesson_06.md", title: "课程", group: "项目课件" }]);
    vi.mocked(getProject).mockResolvedValue({ id: 1 } as Project);
    const value = { ...options(vi.fn(() => true), vi.fn(() => false)),
      autoOpenCompleted: true,
      getCurrentProjectId: vi.fn(() => 1), beginTracking: vi.fn(() => true),
    };
    const { result, unmount } = renderHook(() => useGenerationTrackingController(value));
    await act(async () => result.current.trackTask(1, {
      id: 3, project_id: 1, status: "completed", task_type: "outline_lesson",
      output_path: "C:\\Users\\xiyua\\AppData\\Roaming\\CodeCourse\\generated\\1\\lessons\\lesson_06.md",
    } as GenerationTask));
    expect(value.onOpenCourse).toHaveBeenCalledWith(1, "lessons/lesson_06.md");
    expect(value.onDismissMobileGeneration).toHaveBeenCalled();
    unmount();
  });

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
