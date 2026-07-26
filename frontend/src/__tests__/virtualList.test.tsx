import { act, fireEvent, render } from "@testing-library/react";
import React, { useRef, useState } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MobileCodeViewer, {
  calcScrollTop,
  calculateVisibleLine,
  computeVirtualRange,
} from "../components/MobileCodeViewer";

const ROW_HEIGHT = 24;
const OVERSCAN = 20;

vi.mock("highlight.js", () => ({
  default: {
    highlight: (code: string) => ({ value: code }),
    getLanguage: () => true,
    highlightAuto: (code: string) => ({ value: code }),
  },
}));

function largeContent(lineCount: number): string {
  return Array.from(
    { length: lineCount },
    (_, index) => `line ${index + 1}: some code content here`,
  ).join("\n");
}

let rafId = 0;
let rafQueue = new Map<number, FrameRequestCallback>();

function flushAnimationFrames() {
  act(() => {
    for (let pass = 0; pass < 10 && rafQueue.size > 0; pass += 1) {
      const current = [...rafQueue.entries()];
      rafQueue = new Map();
      current.forEach(([, callback]) => callback(performance.now()));
    }
  });
}

describe("virtual list helpers", () => {
  it("limits a 50,000-line viewport to a bounded range", () => {
    const range = computeVirtualRange(0, 600, 50000, ROW_HEIGHT, OVERSCAN);
    expect(range.start).toBe(0);
    expect(range.end).toBeGreaterThan(20);
    expect(range.end).toBeLessThan(100);
  });

  it("calculates a bounded center position for a distant line", () => {
    const scrollTop = calcScrollTop(40000, "center", 600, 50000, ROW_HEIGHT);
    expect(scrollTop).toBeGreaterThan(0);
    expect(scrollTop).toBeLessThanOrEqual(50000 * ROW_HEIGHT - 600);
  });

  it("uses the exact row height for visible-line calculation", () => {
    expect(calculateVisibleLine((100 - 1) * ROW_HEIGHT, ROW_HEIGHT, 1000)).toBe(100);
    expect(calculateVisibleLine(-50, ROW_HEIGHT, 1000)).toBe(1);
  });
});

describe("MobileCodeViewer production component", () => {
  beforeEach(() => {
    rafId = 0;
    rafQueue = new Map();
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 600,
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++rafId;
      rafQueue.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      rafQueue.delete(id);
    });
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders fewer than 300 DOM rows for a 50,000-line file", () => {
    const { container } = render(
      <MobileCodeViewer path="/large.ts" language="typescript" content={largeContent(50000)} />,
    );
    expect(container.querySelectorAll(".mobile-code-line").length).toBeLessThan(300);
  });

  it("renders line 20,000 after a real scroll event", () => {
    const { container } = render(
      <MobileCodeViewer path="/scroll.ts" language="typescript" content={largeContent(50000)} />,
    );
    flushAnimationFrames();
    const scrollArea = container.querySelector<HTMLElement>(".mobile-code-scroll")!;
    scrollArea.scrollTop = (20000 - 1) * ROW_HEIGHT;
    fireEvent.scroll(scrollArea);
    flushAnimationFrames();
    expect(container.querySelector('[data-line="20000"]')).not.toBeNull();
    expect(container.querySelectorAll(".mobile-code-line").length).toBeLessThan(300);
  });

  it("consumes restoreLine=20,000 once in the actual component", () => {
    const { container, rerender } = render(
      <MobileCodeViewer
        path="/initial.ts"
        language="typescript"
        content={largeContent(50000)}
        restoreLine={20000}
      />,
    );
    flushAnimationFrames();
    expect(container.querySelector('[data-line="20000"]')).not.toBeNull();
    const scrollArea = container.querySelector<HTMLElement>(".mobile-code-scroll")!;
    scrollArea.scrollTop = 23000 * ROW_HEIGHT;
    rerender(
      <MobileCodeViewer
        path="/initial.ts"
        language="javascript"
        content={`${largeContent(50000)}\nrefreshed`}
        restoreLine={120}
      />,
    );
    flushAnimationFrames();
    expect(scrollArea.scrollTop).toBe(23000 * ROW_HEIGHT);
  });

  it("keeps the user's scroll position when an App-style wrapper feeds persisted learning state back", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const databaseWrite = vi.fn(async (line: number) => line);

    function AppLearningStateWrapper() {
      const [savedLine, setSavedLine] = useState(1);
      const [unrelated, setUnrelated] = useState(0);
      const restoreSnapshot = useRef(savedLine);
      const saveTimer = useRef<number | null>(null);

      function handleVisibleLine(line: number) {
        if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          void databaseWrite(line).then(setSavedLine);
        }, 800);
      }

      return (
        <>
          <button data-testid="unrelated" onClick={() => setUnrelated((value) => value + 1)}>
            {unrelated}
          </button>
          <span data-testid="saved">{savedLine}</span>
          <MobileCodeViewer
            path="/feedback.ts"
            language="typescript"
            content={largeContent(2000)}
            restoreLine={restoreSnapshot.current}
            onVisibleLineChange={handleVisibleLine}
          />
        </>
      );
    }

    const { container, getByTestId } = render(<AppLearningStateWrapper />);
    flushAnimationFrames();
    const scrollArea = container.querySelector<HTMLElement>(".mobile-code-scroll")!;
    const userPosition = (200 - 1) * ROW_HEIGHT;
    scrollArea.scrollTop = userPosition;
    fireEvent.scroll(scrollArea);
    flushAnimationFrames();
    expect(databaseWrite).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(799));
    expect(databaseWrite).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(databaseWrite).toHaveBeenCalledTimes(1);
    expect(databaseWrite).toHaveBeenCalledWith(200);
    expect(getByTestId("saved").textContent).toBe("200");
    expect(scrollArea.scrollTop).toBe(userPosition);

    fireEvent.click(getByTestId("unrelated"));
    flushAnimationFrames();
    expect(scrollArea.scrollTop).toBe(userPosition);
  });

  it("executes a new jump ID once even when it targets the same line", () => {
    const consumed = vi.fn();
    const { container, rerender } = render(
      <MobileCodeViewer
        path="/jump.ts"
        language="typescript"
        content={largeContent(2000)}
        jumpRequest={{ id: "A", line: 80, align: "start" }}
        onJumpConsumed={consumed}
      />,
    );
    flushAnimationFrames();
    const scrollArea = container.querySelector<HTMLElement>(".mobile-code-scroll")!;
    expect(scrollArea.scrollTop).toBe((80 - 1) * ROW_HEIGHT);
    expect(consumed).toHaveBeenCalledWith("A");

    scrollArea.scrollTop = 12345;
    rerender(
      <MobileCodeViewer
        path="/jump.ts"
        language="typescript"
        content={largeContent(2000)}
        jumpRequest={{ id: "A", line: 80, align: "start" }}
        onJumpConsumed={consumed}
      />,
    );
    flushAnimationFrames();
    expect(scrollArea.scrollTop).toBe(12345);

    rerender(
      <MobileCodeViewer
        path="/jump.ts"
        language="typescript"
        content={largeContent(2000)}
        jumpRequest={{ id: "B", line: 80, align: "start" }}
        onJumpConsumed={consumed}
      />,
    );
    flushAnimationFrames();
    expect(scrollArea.scrollTop).toBe((80 - 1) * ROW_HEIGHT);
    expect(consumed).toHaveBeenCalledWith("B");
    expect(consumed).toHaveBeenCalledTimes(2);
  });

  it("waits 200ms before searching and first next selects line 40,000", () => {
    vi.useFakeTimers();
    const content = Array.from(
      { length: 50000 },
      (_, index) => index === 39999 ? "unique-distant-symbol" : `line ${index + 1}`,
    ).join("\n");
    const { container } = render(
      <MobileCodeViewer path="/search.ts" language="typescript" content={content} />,
    );
    fireEvent.click(container.querySelector(".viewer-actions button")!);
    const input = container.querySelector<HTMLInputElement>(".mobile-code-search input")!;
    fireEvent.change(input, { target: { value: "unique-distant-symbol" } });
    act(() => vi.advanceTimersByTime(199));
    expect(container.querySelector(".search-match-active")).toBeNull();
    act(() => vi.advanceTimersByTime(1));

    const buttons = container.querySelectorAll(".mobile-code-search button");
    fireEvent.click(buttons[1]);
    expect(container.querySelector('[data-line="40000"]')).not.toBeNull();
    expect(container.querySelector('[data-line="40000"]')?.classList).toContain("search-match-active");
  });

  it("reports a visible line once per animation frame", () => {
    const onVisibleLineChange = vi.fn();
    const { container } = render(
      <MobileCodeViewer
        path="/raf.ts"
        language="typescript"
        content={largeContent(50000)}
        onVisibleLineChange={onVisibleLineChange}
      />,
    );
    flushAnimationFrames();
    onVisibleLineChange.mockClear();
    const scrollArea = container.querySelector<HTMLElement>(".mobile-code-scroll")!;
    scrollArea.scrollTop = 1000;
    fireEvent.scroll(scrollArea);
    fireEvent.scroll(scrollArea);
    flushAnimationFrames();
    expect(onVisibleLineChange).toHaveBeenCalledTimes(1);
  });

  it("reports line 100 from the real non-virtual component geometry", () => {
    const onVisibleLineChange = vi.fn();
    const { container } = render(
      <MobileCodeViewer
        path="/ordinary.ts"
        language="typescript"
        content={largeContent(500)}
        onVisibleLineChange={onVisibleLineChange}
      />,
    );
    flushAnimationFrames();
    onVisibleLineChange.mockClear();
    const scrollArea = container.querySelector<HTMLElement>(".mobile-code-scroll")!;
    scrollArea.scrollTop = (100 - 1) * ROW_HEIGHT;
    fireEvent.scroll(scrollArea);
    flushAnimationFrames();
    expect(onVisibleLineChange).toHaveBeenLastCalledWith(100);
  });

  it("round-trips a saved visible line within one row", () => {
    let savedLine = 1;
    const first = render(
      <MobileCodeViewer
        path="/roundtrip.ts"
        language="typescript"
        content={largeContent(2000)}
        onVisibleLineChange={(line) => { savedLine = line; }}
      />,
    );
    flushAnimationFrames();
    const firstScroll = first.container.querySelector<HTMLElement>(".mobile-code-scroll")!;
    firstScroll.scrollTop = (500 - 1) * ROW_HEIGHT;
    fireEvent.scroll(firstScroll);
    flushAnimationFrames();
    expect(savedLine).toBe(500);
    first.unmount();

    const second = render(
      <MobileCodeViewer
        path="/roundtrip.ts"
        language="typescript"
        content={largeContent(2000)}
        restoreLine={savedLine}
      />,
    );
    flushAnimationFrames();
    const restoredTop = second.container.querySelector<HTMLElement>(".mobile-code-scroll")!.scrollTop;
    expect(calculateVisibleLine(restoredTop, ROW_HEIGHT, 2000)).toBe(500);
  });

  it("isolates file state and cancels stale animation work on keyed file switch", () => {
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");
    const content = largeContent(2000);
    const { container, rerender } = render(
      <MobileCodeViewer key="A" path="/a.ts" language="typescript" content={content} restoreLine={400} />,
    );
    flushAnimationFrames();
    fireEvent.click(container.querySelector(".viewer-actions button")!);
    fireEvent.change(container.querySelector(".mobile-code-search input")!, {
      target: { value: "line 900" },
    });
    const aScroll = container.querySelector<HTMLElement>(".mobile-code-scroll")!;
    aScroll.scrollTop = 7777;
    fireEvent.scroll(aScroll);

    rerender(
      <MobileCodeViewer key="B" path="/b.ts" language="javascript" content={content} restoreLine={25} />,
    );
    flushAnimationFrames();
    const bScroll = container.querySelector<HTMLElement>(".mobile-code-scroll")!;
    expect(bScroll.scrollTop).toBe((25 - 1) * ROW_HEIGHT);
    expect(container.querySelector(".mobile-code-search")).toBeNull();
    expect(container.querySelector(".search-match-active")).toBeNull();
    expect(cancelSpy).toHaveBeenCalled();
  });

  it("pins an Android selection anchor without rendering the full file", () => {
    const onSelectionChange = vi.fn();
    const { container } = render(
      <MobileCodeViewer
        path="/selection.ts"
        language="typescript"
        content={largeContent(50000)}
        onSelectionChange={onSelectionChange}
      />,
    );
    flushAnimationFrames();
    const firstCode = container.querySelector('[data-line="1"] code')!;
    const range = document.createRange();
    range.selectNodeContents(firstCode);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event("selectionchange"));

    const scrollArea = container.querySelector<HTMLElement>(".mobile-code-scroll")!;
    scrollArea.scrollTop = (20000 - 1) * ROW_HEIGHT;
    fireEvent.scroll(scrollArea);
    flushAnimationFrames();
    expect(container.querySelector('[data-line="1"]')).not.toBeNull();
    expect(container.querySelector('[data-line="20000"]')).not.toBeNull();
    expect(container.querySelectorAll(".mobile-code-line").length).toBeLessThan(300);
    expect(onSelectionChange).toHaveBeenCalled();
  });

  it("keeps the code-row CSS geometry stable", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toContain("--mobile-code-row-height: 24px");
    expect(css).toMatch(/\.mobile-code-line\s*\{[\s\S]*height:\s*var\(--mobile-code-row-height\)/);
    expect(css).toMatch(/\.mobile-code-line code\s*\{[\s\S]*white-space:\s*pre/);
    expect(css).toContain("overflow-anchor: none");
    expect(css).not.toContain("content-visibility: auto");
  });
});
