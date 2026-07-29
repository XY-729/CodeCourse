import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Android text selection toolbar contract", () => {
  it("does not render the web selection quick bar on Android", () => {
    const appSource = readSource("src/App.tsx");

    expect(appSource).toContain("!mobileRuntime && selectionAnchor?.selectedText");
  });

  it("marks only unfamiliar term candidates for the native known action", () => {
    const viewerSource = readSource("src/components/MarkdownViewer.tsx");

    expect(viewerSource).toContain(
      'data-codecourse-unfamiliar-term={term.status === "candidate" ? "true" : undefined}',
    );
  });

  it("removes Share and conditionally exposes the native known action", () => {
    const webViewSource = readSource(
      "../android/app/src/main/java/com/codecourse/app/CodeCourseWebView.java",
    );

    expect(webViewSource).toContain("menu.removeItem(android.R.id.shareText)");
    expect(webViewSource).toContain(
      "e.closest('[data-codecourse-unfamiliar-term=\\\"true\\\"]')",
    );
    expect(webViewSource).toContain("knownItem.setVisible(showKnownAction)");
    expect(webViewSource).toContain("askItem.setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)");
  });
});
