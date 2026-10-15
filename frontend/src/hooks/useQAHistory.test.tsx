import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listQARecords, type QARecord } from "../api/client";
import { useQAHistory } from "./useQAHistory";

vi.mock("../api/client", () => ({ listQARecords: vi.fn() }));
const list = vi.mocked(listQARecords);
const record = (id: number) => ({ id } as QARecord);
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function debounce() { await act(async () => { await vi.advanceTimersByTimeAsync(180); }); }

beforeEach(() => { vi.useFakeTimers(); list.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe("QA history request scope", () => {
  it("ignores an older search completing after the newest search", async () => {
    const old = pending<QARecord[]>(), next = pending<QARecord[]>();
    list.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const hook = renderHook(props => useQAHistory(props), { initialProps: { projectId: 1, query: "old", favoriteOnly: false } });
    await debounce();
    hook.rerender({ projectId: 1, query: "new", favoriteOnly: false });
    await debounce();
    await act(async () => { next.resolve([record(2)]); });
    await act(async () => { old.resolve([record(1)]); });
    expect(hook.result.current.qaHistory).toEqual([record(2)]);
    expect(hook.result.current.qaHistoryLoading).toBe(false);
  });

  it("invalidates a request as soon as the filters change, before the next debounce", async () => {
    const old = pending<QARecord[]>();
    list.mockReturnValueOnce(old.promise).mockResolvedValue([]);
    const hook = renderHook(props => useQAHistory(props), { initialProps: { projectId: 1, query: "", favoriteOnly: false } });
    await debounce();
    hook.rerender({ projectId: 1, query: "", favoriteOnly: true });
    await act(async () => { old.resolve([record(1)]); });
    expect(hook.result.current.qaHistory).toEqual([]);
    expect(hook.result.current.qaHistoryLoading).toBe(true);
    await debounce();
    expect(list).toHaveBeenLastCalledWith(1, "", true);
  });

  it("uses current search and favorites in a background callback saved by an older render", async () => {
    list.mockResolvedValue([]);
    const hook = renderHook(props => useQAHistory(props), { initialProps: { projectId: 1, query: "", favoriteOnly: false } });
    const backgroundRefresh = hook.result.current.refreshQAHistory;
    hook.rerender({ projectId: 1, query: "return", favoriteOnly: true });
    await act(async () => { await backgroundRefresh(1); });
    expect(list).toHaveBeenLastCalledWith(1, "return", true);
  });

  it("clears old project records and ignores both its in-flight request and background callback", async () => {
    const old = pending<QARecord[]>();
    list.mockResolvedValueOnce([record(1)]).mockReturnValueOnce(old.promise).mockResolvedValue([record(2)]);
    const hook = renderHook(props => useQAHistory(props), { initialProps: { projectId: 1, query: "", favoriteOnly: false } });
    await debounce();
    let refresh!: Promise<void>;
    act(() => { refresh = hook.result.current.refreshQAHistory(1); });
    hook.rerender({ projectId: 2, query: "", favoriteOnly: false });
    expect(hook.result.current.qaHistory).toEqual([]);
    await act(async () => { await hook.result.current.refreshQAHistory(1); old.resolve([record(99)]); await refresh; });
    expect(list).toHaveBeenCalledTimes(2);
    expect(hook.result.current.qaHistory).toEqual([]);
    await debounce();
    expect(hook.result.current.qaHistory).toEqual([record(2)]);
  });

  it("shows a failed load and can retry it without losing the search criteria", async () => {
    list.mockRejectedValueOnce(new Error("数据库暂时不可用")).mockResolvedValue([record(3)]);
    const hook = renderHook(() => useQAHistory({ projectId: 1, query: "return", favoriteOnly: true }));
    await debounce();
    expect(hook.result.current.qaHistoryError).toBe("数据库暂时不可用");
    expect(hook.result.current.qaHistoryLoading).toBe(false);
    await act(async () => { await hook.result.current.refreshQAHistory(); });
    expect(list).toHaveBeenLastCalledWith(1, "return", true);
    expect(hook.result.current.qaHistoryError).toBe("");
    expect(hook.result.current.qaHistory).toEqual([record(3)]);
  });

  it("does not let an obsolete request error replace a successful search", async () => {
    const old = pending<QARecord[]>();
    list.mockReturnValueOnce(old.promise).mockResolvedValue([record(2)]);
    const hook = renderHook(props => useQAHistory(props), { initialProps: { projectId: 1, query: "old", favoriteOnly: false } });
    await debounce();
    hook.rerender({ projectId: 1, query: "new", favoriteOnly: false });
    await debounce();
    await act(async () => { old.reject(new Error("过期请求失败")); });
    expect(hook.result.current.qaHistoryError).toBe("");
    expect(hook.result.current.qaHistory).toEqual([record(2)]);
  });
});
