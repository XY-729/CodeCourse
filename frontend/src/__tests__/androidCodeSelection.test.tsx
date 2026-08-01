import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: vi.fn(() => "web"),
    isNativePlatform: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => ({})),
}));

// Simulate the packaged Android WebView so isAndroidRuntime() returns true
// for the real module (no module mocks, no forced injection).
const originalUserAgent = window.navigator.userAgent;

beforeEach(() => {
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
});

import MobileCodeViewer from "../components/MobileCodeViewer";

const sampleCode = `const a = 1;\nconst b = 2;\nfunction add(x, y) { return x + y; }\n`;

function selectLine0(container: HTMLElement) {
  const firstCode = container.querySelector('[data-line="1"] code') as HTMLElement;
  const range = document.createRange();
  range.selectNodeContents(firstCode);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function collapseSelection() {
  const selection = window.getSelection();
  selection?.removeAllRanges();
}

describe("Android code selection (native ActionMode preservation)", () => {
  it("defers reporting while a selection is active, then flushes once collapsed", () => {
    const onSelectionChange = vi.fn();
    const { container } = render(
      <MobileCodeViewer
        path="/a.ts"
        language="typescript"
        content={sampleCode}
        onSelectionChange={onSelectionChange}
      />,
    );

    act(() => {
      selectLine0(container);
      fireEvent(document, new Event("selectionchange"));
    });

    // While the selection is live the parent must NOT be notified and the
    // component must not re-render line DOM (which would kill the ActionMode).
    expect(onSelectionChange).not.toHaveBeenCalled();

    act(() => {
      collapseSelection();
      fireEvent(document, new Event("selectionchange"));
    });

    // Once the native toolbar is dismissed the deferred text is flushed once.
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const payload = onSelectionChange.mock.calls[0][0];
    expect(payload.sourceType).toBe("file");
    expect(payload.sourcePath).toBe("/a.ts");
    expect(payload.selectedText).toBe("const a = 1;");
  });

  it("reports immediately on desktop (non-Android) as before", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: originalUserAgent,
    });
    const onSelectionChange = vi.fn();
    const { container } = render(
      <MobileCodeViewer
        path="/b.ts"
        language="typescript"
        content={sampleCode}
        onSelectionChange={onSelectionChange}
      />,
    );

    act(() => {
      selectLine0(container);
      fireEvent(document, new Event("selectionchange"));
    });

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
  });
});
