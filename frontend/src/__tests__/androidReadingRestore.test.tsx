import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: vi.fn(() => "web"),
    isNativePlatform: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => ({})),
}));

const originalUserAgent = window.navigator.userAgent;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
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

import MarkdownViewer from "../components/MarkdownViewer";

const markdown = `# 第一课

## 一节

内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容。

## 二节

更多内容更多内容更多内容更多内容更多内容更多内容更多内容。

## 三节

结尾结尾结尾结尾结尾结尾结尾结尾结尾结尾结尾结尾结尾。`;

beforeEach(() => {
  rafId = 0;
  rafQueue = new Map();
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => 1200,
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = ++rafId;
    rafQueue.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    rafQueue.delete(id);
  });
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value:
      "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A) AppleWebKit/537.36 Version/4.0 Chrome/130 Mobile Safari/537.36 wv",
  });
});

afterEach(() => {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: originalUserAgent,
  });
  document.documentElement.classList.remove("platform-android");
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe("Android reading position restore", () => {
  it("restores the saved scroll ratio on Android", () => {
    const onScrollRatioChange = vi.fn();
    const { container } = render(
      <MarkdownViewer
        title="第一课"
        sourcePath="lesson-1.md"
        sourceType="course"
        content={markdown}
        initialScrollRatio={0.5}
        onScrollRatioChange={onScrollRatioChange}
      />,
    );
    flushAnimationFrames();

    const article = container.querySelector<HTMLElement>(".markdown-scroll-viewport")!;
    const scrollHeight = article.scrollHeight;
    const maxScroll = Math.max(0, scrollHeight - article.clientHeight);
    expect(maxScroll).toBeGreaterThan(0);
    expect(article.scrollTop).toBeCloseTo(maxScroll * 0.5, 0);
  });

  it("does not restore while an Android selection is active", () => {
    const { container } = render(
      <MarkdownViewer
        title="第一课"
        sourcePath="lesson-1.md"
        sourceType="course"
        content={markdown}
        initialScrollRatio={0.5}
      />,
    );

    // Simulate an active native selection (non-collapsed Range inside article).
    const article = container.querySelector<HTMLElement>(".markdown-scroll-viewport")!;
    const range = document.createRange();
    range.selectNodeContents(article);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    flushAnimationFrames();

    // Scroll restore is deferred while the selection is live.
    expect(article.scrollTop).toBe(0);
  });

  it("restores at ratio 0 to the top", () => {
    const { container } = render(
      <MarkdownViewer
        title="第一课"
        sourcePath="lesson-1.md"
        sourceType="course"
        content={markdown}
        initialScrollRatio={0}
      />,
    );
    flushAnimationFrames();
    const article = container.querySelector<HTMLElement>(".markdown-scroll-viewport")!;
    expect(article.scrollTop).toBe(0);
  });

  it("progress bar survives a cancelled rAF when the scroll effect re-runs", () => {
    const onScrollRatioChange = vi.fn();
    const { container, rerender } = render(
      <MarkdownViewer
        title="第一课"
        sourcePath="lesson-1.md"
        sourceType="course"
        content={markdown}
        onScrollRatioChange={onScrollRatioChange}
      />,
    );

    // The parent passes an inline arrow, so any App re-render changes the
    // onScrollRatioChange reference and re-runs the scroll effect. If a
    // progress rAF is still pending, the cleanup cancels it — and the ref must
    // reset to 0, otherwise every later scroll short-circuits and the progress
    // bar never updates again for this document ("first open is broken").
    const article = container.querySelector<HTMLElement>(".markdown-scroll-viewport")!;
    const fill = container.querySelector<HTMLElement>(".reader-progress-fill")!;
    const flushWhilePending = () => {
      for (let pass = 0; pass < 10 && rafQueue.size > 0; pass += 1) {
        const current = [...rafQueue.entries()];
        rafQueue = new Map();
        current.forEach(([, callback]) => callback(performance.now()));
      }
    };
    act(() => {
      rerender(
        <MarkdownViewer
          title="第一课"
          sourcePath="lesson-1.md"
          sourceType="course"
          content={markdown}
          onScrollRatioChange={vi.fn()}
        />,
      );
    });
    flushWhilePending();

    // Scroll afterwards — the fill must update even though the earlier
    // rAF was cancelled mid-flight.
    act(() => {
      article.scrollTop = 300;
      article.dispatchEvent(new Event("scroll"));
    });
    flushWhilePending();

    expect(fill.style.opacity).toBe("1");
    expect(fill.style.transform).toBe("scaleX(0.5)");
  });
});
