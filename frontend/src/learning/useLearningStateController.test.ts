import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateLearningState, getLearningStates, type LearningState } from "../api/client";
import { TEACHING_CHANGED } from "../personalization/teachingApi";
import { useLearningStateController } from "./useLearningStateController";
vi.mock("../api/client", () => ({ updateLearningState: vi.fn(), resetLearningStates: vi.fn(), getLearningStates: vi.fn(async () => []) }));
const state = { source_type: "course", source_path: "lessons/lesson_1.md", status: "completed", position_kind: "scroll_ratio", position_value: 0, completed_at: "now" } as LearningState;
beforeEach(() => vi.clearAllMocks());
describe("explicit course completion", () => {
  it("refreshes completed profile jobs without replacing the current reading position", async () => {
    const pending = { ...state, id: 1, profile_status: "pending" as const, position_value: .7 };
    vi.mocked(getLearningStates).mockResolvedValue([{ ...pending, profile_status: "completed", profile_concept_count: 3, position_value: .1 }]);
    const onStatus = vi.fn();
    const { result } = renderHook(() => useLearningStateController({ projectId: 1, onStatus, onError: vi.fn() }));
    act(() => { result.current.replaceStates([pending]); });
    await act(async () => { window.dispatchEvent(new CustomEvent(TEACHING_CHANGED)); });
    await waitFor(() => expect(result.current.states[0].profile_status).toBe("completed"));
    expect(result.current.states[0].position_value).toBe(.7);
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining("3 个已学知识点"));
  });
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

it("does not persist an in-memory answer preview as a learning source", () => {
  const { result } = renderHook(() => useLearningStateController({ projectId: 1, onStatus: vi.fn(), onError: vi.fn() }));
  act(() => result.current.touchOpenItem({ id: "qa-preview:test", type: "course", path: "qa-preview:test", title: "回答", content: "片段", qaPreview: { key: "draft:1", label: "正在回答", status: "streaming", startedAt: 0 } }));
  expect(updateLearningState).not.toHaveBeenCalled();
});
