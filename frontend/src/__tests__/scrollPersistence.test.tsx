import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";

function useScrollHandler(onScrollRatioChange: (ratio: number) => void) {
  const scrollFrameRef = useRef(0);
  const debounceTimerRef = useRef(0);

  function simulateScroll(scrollTop: number, scrollHeight = 1000, clientHeight = 500) {
    if (!scrollFrameRef.current) {
      scrollFrameRef.current = 1;
      scrollFrameRef.current = 0;
    }
    window.clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = window.setTimeout(() => {
      const ratio = Math.max(0, Math.min(1, scrollTop / (scrollHeight - clientHeight)));
      onScrollRatioChange(ratio);
    }, 700) as unknown as number;
  }

  function cleanup() {
    window.clearTimeout(debounceTimerRef.current);
    window.clearTimeout(scrollFrameRef.current);
  }

  return { simulateScroll, cleanup };
}

describe("scroll persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT call onScrollRatioChange during continuous scrolling", () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useScrollHandler(onSave as unknown as (ratio: number) => void));

    for (let i = 0; i < 100; i++) {
      act(() => {
        result.current.simulateScroll(i * 5);
      });
    }
    expect(onSave).not.toHaveBeenCalled();
  });

  it("calls onScrollRatioChange exactly once after scrolling stops", () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useScrollHandler(onSave as unknown as (ratio: number) => void));

    act(() => { result.current.simulateScroll(250); });
    act(() => { result.current.simulateScroll(300); });

    expect(onSave).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(700); });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("only saves final position after burst", () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useScrollHandler(onSave as unknown as (ratio: number) => void));

    act(() => { result.current.simulateScroll(100); });
    act(() => { result.current.simulateScroll(200); });
    act(() => { result.current.simulateScroll(500); });
    act(() => { vi.advanceTimersByTime(700); });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(1);
  });

  it("cleanup clears pending debounce timers", () => {
    const onSave = vi.fn();
    const { result, unmount } = renderHook(() => useScrollHandler(onSave as unknown as (ratio: number) => void));

    act(() => { result.current.simulateScroll(300); });
    act(() => { result.current.cleanup(); });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(onSave).not.toHaveBeenCalled();
  });
});
