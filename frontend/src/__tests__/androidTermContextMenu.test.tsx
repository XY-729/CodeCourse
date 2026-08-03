import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import MarkdownViewer from "../components/MarkdownViewer";
import type { DocumentTerm } from "../api/client";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: vi.fn(() => "android"),
    isNativePlatform: vi.fn(() => true),
  },
  registerPlugin: vi.fn(() => ({})),
}));

const originalUserAgent = window.navigator.userAgent;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const term = (id: number, text: string, status: "candidate" | "linked" | "known" = "candidate"): DocumentTerm => ({
  id,
  project_id: 1,
  source_type: "course",
  source_path: "lesson-1.md",
  term_text: text,
  detection_source: "model",
  confidence: 0.8,
  status,
  link_origin: "manual",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

beforeEach(() => {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value:
      "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A) AppleWebKit/537.36 Version/4.0 Chrome/130 Mobile Safari/537.36 wv",
  });
  document.documentElement.classList.add("platform-android");
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

describe("Android term context menu", () => {
  const onGenerateTerm = vi.fn();

  it("triggers onTermAction with coordinates on right-click of a candidate term", () => {
    const onTermAction = vi.fn();
    const { container } = render(
      <MarkdownViewer
        title="第一课"
        sourcePath="lesson-1.md"
        sourceType="course"
        content="文中出现 socket 一词。"
        documentTerms={[term(1, "socket")]}
        onGenerateTerm={onGenerateTerm}
        onTermAction={onTermAction}
      />,
    );

    const span = container.querySelector<HTMLElement>('span[data-term-id="1"]');
    expect(span).not.toBeNull();

    fireEvent.contextMenu(span!, { clientX: 120, clientY: 340 });

    expect(onTermAction).toHaveBeenCalledTimes(1);
    expect(onTermAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, term_text: "socket" }),
      { x: 120, y: 340 },
    );
  });

  it("does not open the action menu for linked terms", () => {
    const onTermAction = vi.fn();
    const { container } = render(
      <MarkdownViewer
        title="第一课"
        sourcePath="lesson-1.md"
        sourceType="course"
        content="文中出现 socket 一词。"
        documentTerms={[term(1, "socket", "linked")]}
        onGenerateTerm={onGenerateTerm}
        onTermAction={onTermAction}
      />,
    );

    const span = container.querySelector<HTMLElement>('span[data-term-id="1"]');
    expect(span).not.toBeNull();
    fireEvent.contextMenu(span!, { clientX: 10, clientY: 10 });

    expect(onTermAction).not.toHaveBeenCalled();
  });

  it("prevents the native context menu from appearing", () => {
    const { container } = render(
      <MarkdownViewer
        title="第一课"
        sourcePath="lesson-1.md"
        sourceType="course"
        content="文中出现 socket 一词。"
        documentTerms={[term(1, "socket")]}
        onGenerateTerm={onGenerateTerm}
      />,
    );

    const span = container.querySelector<HTMLElement>('span[data-term-id="1"]')!;
    let observed = false;
    container.addEventListener("contextmenu", (event) => { observed = event.defaultPrevented; });
    fireEvent.contextMenu(span, { clientX: 10, clientY: 10 });
    expect(observed).toBe(true);
  });
});
