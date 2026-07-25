import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState, useEffect, useRef } from "react";

/**
 * Test the search debounce hook — a standalone version of what
 * MobileCodeViewer will use. We test the hook separately to verify timing.
 */
function useSearchDebounce(initialValue = "") {
  const [searchInput, setSearchInput] = useState(initialValue);
  const [debouncedQuery, setDebouncedQuery] = useState(initialValue);
  const timerRef = useRef<number>(0);

  useEffect(() => {
    // Clear immediately if input is empty
    if (!searchInput.trim()) {
      window.clearTimeout(timerRef.current);
      setDebouncedQuery("");
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchInput);
    }, 200);
    timerRef.current = timer;
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const clear = () => {
    window.clearTimeout(timerRef.current);
    setSearchInput("");
    setDebouncedQuery("");
  };

  return { searchInput, setSearchInput, debouncedQuery, clear };
}

describe("search debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT update debouncedQuery before 200ms", () => {
    const { result } = renderHook(() => useSearchDebounce());
    act(() => {
      result.current.setSearchInput("hello");
    });
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current.debouncedQuery).toBe("");
  });

  it("updates debouncedQuery after 200ms", () => {
    const { result } = renderHook(() => useSearchDebounce());
    act(() => {
      result.current.setSearchInput("hello");
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.debouncedQuery).toBe("hello");
  });

  it("debounces rapid input to single update", () => {
    const { result } = renderHook(() => useSearchDebounce());
    act(() => {
      result.current.setSearchInput("h");
    });
    act(() => {
      vi.advanceTimersByTime(100);
      result.current.setSearchInput("he");
    });
    act(() => {
      vi.advanceTimersByTime(100);
      result.current.setSearchInput("hel");
    });
    act(() => {
      vi.advanceTimersByTime(100);
      result.current.setSearchInput("hello");
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.debouncedQuery).toBe("hello");
  });

  it("clearing input immediately resets debouncedQuery", () => {
    const { result } = renderHook(() => useSearchDebounce());
    act(() => {
      result.current.setSearchInput("hello");
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.debouncedQuery).toBe("hello");

    act(() => {
      result.current.clear();
    });
    expect(result.current.debouncedQuery).toBe("");
    expect(result.current.searchInput).toBe("");
  });

  it("old timer does not update after file switch", () => {
    const { result } = renderHook(() => useSearchDebounce());
    act(() => {
      result.current.setSearchInput("oldfile");
    });
    // Simulate file switch: clear and set new input
    act(() => {
      result.current.clear();
      result.current.setSearchInput("newfile");
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // Should get the new input, not the old one
    expect(result.current.debouncedQuery).toBe("newfile");
    expect(result.current.debouncedQuery).not.toBe("oldfile");
  });
});
