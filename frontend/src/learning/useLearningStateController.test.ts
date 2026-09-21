import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateLearningState, type LearningState } from "../api/client";
import { useLearningStateController } from "./useLearningStateController";
vi.mock("../api/client", () => ({ updateLearningState: vi.fn(), resetLearningStates: vi.fn() }));
const state = { source_type: "course", source_path: "lessons/lesson_1.md", status: "completed", position_kind: "scroll_ratio", position_value: 0, completed_at: "now" } as LearningState;
beforeEach(() => vi.clearAllMocks());
describe("explicit course completion", () => {
  it("never reports success after a failed save and allows retry", async () => {
    const onStatus = vi.fn(), onError = vi.fn();
    vi.mocked(updateLearningState).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(state);
    const { result } = renderHook(() => useLearningStateController({ projectId: 1, onStatus, onError }));
    await act(async () => { expect(await result.current.toggleLessonComplete(state.source_path)).toBe(false); });
    expect(onStatus).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("offline");
    expect(result.current.states).toEqual([]);
    await act(async () => { expect(await result.current.toggleLessonComplete(state.source_path)).toBe(true); });
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(result.current.states[0].status).toBe("completed");
  });
  it("deduplicates clicks and does not let a scroll update overwrite pending completion", async () => {
    let finish!: (state: LearningState) => void;
    vi.mocked(updateLearningState).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useLearningStateController({ projectId: 1, onStatus: vi.fn(), onError: vi.fn() }));
    let request!: Promise<boolean>;
    act(() => { request = result.current.toggleLessonComplete(state.source_path); });
    await waitFor(() => expect(updateLearningState).toHaveBeenCalledOnce());
    await act(async () => {
      expect(await result.current.toggleLessonComplete(state.source_path)).toBe(false);
      result.current.queueUpdate("course", state.source_path, "scroll_ratio", 0.5, undefined, true);
    });
    expect(updateLearningState).toHaveBeenCalledOnce();
    await act(async () => { finish(state); await request; });
    expect(result.current.states[0].status).toBe("completed");
  });
  it("ignores a previous project's late response", async () => {
    let finish!: (state: LearningState) => void;
    const onStatus = vi.fn();
    vi.mocked(updateLearningState).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ projectId }) => useLearningStateController({ projectId, onStatus, onError: vi.fn() }), { initialProps: { projectId: 1 } });
    let request!: Promise<boolean>;
    act(() => { request = result.current.toggleLessonComplete(state.source_path); });
    await waitFor(() => expect(updateLearningState).toHaveBeenCalledOnce());
    rerender({ projectId: 2 });
    await act(async () => { finish(state); expect(await request).toBe(false); });
    expect(onStatus).not.toHaveBeenCalled();
    expect(result.current.states).toEqual([]);
  });
});
