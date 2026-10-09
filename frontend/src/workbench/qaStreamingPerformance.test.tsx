import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { updateLayoutItem, type LayoutNode } from "./layout";
import { useWorkbenchPersistence } from "./useWorkbenchPersistence";
import MarkdownViewer from "../features/reader/MarkdownViewer";
import { markDesktopPerformance } from "../performance/desktopPerformance";

vi.mock("../performance/desktopPerformance", () => ({ markDesktopPerformance: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const preview = {
  id: "preview", type: "course" as const, title: "问题", path: "preview", content: "",
  qaPreview: { key: "draft", label: "等待模型", status: "streaming" as const, startedAt: 0 },
};
const layout: LayoutNode = {
  type: "split", id: "split", direction: "row", ratio: 0.5,
  first: { type: "group", group: { id: "first", items: [preview], activeItemId: preview.id } },
  second: { type: "group", group: { id: "second", items: [], activeItemId: null } },
};

it("updates only the preview group and preserves unrelated editor identities", () => {
  const next = updateLayoutItem(layout, "preview", item => ({ ...item, content: "首段正文" }));
  expect(next.type).toBe("split");
  if (next.type !== "split" || layout.type !== "split") throw Error("expected split");
  expect(next.second).toBe(layout.second);
  expect(next.first).not.toBe(layout.first);
  expect(updateLayoutItem(next, "preview", item => item)).toBe(next);
});

it("does not rewrite the stored workspace for each body increment", () => {
  const save = vi.spyOn(Storage.prototype, "setItem");
  const options = { projectId: 1, restoringProjectId: null, loading: false, mobile: false, layout: layout as LayoutNode,
    activeGroupId: "first", navigationView: "courses" as const, navigationOpen: true, sidebarWidth: 250,
    closedItemsRef: { current: [] } };
  const { rerender } = renderHook(props => useWorkbenchPersistence(props), { initialProps: options });
  expect(save).toHaveBeenCalledTimes(1);
  rerender({ ...options, layout: updateLayoutItem(layout, "preview", item => ({ ...item, content: "实时正文" })) });
  expect(save).toHaveBeenCalledTimes(1);
  rerender({ ...options, sidebarWidth: 270 });
  expect(save).toHaveBeenCalledTimes(2);
});

it("keeps existing paragraphs mounted while appending streamed content", () => {
  const { container, rerender } = render(<MarkdownViewer title="问答" content="首段。" streaming />);
  const paragraph = container.querySelector("article p");
  rerender(<MarkdownViewer title="问答" content={"首段。\n\n第二段。"} streaming />);
  expect(container.querySelector("article p")).toBe(paragraph);
});

it("records the first commit even if delta and completion arrive in the same batch", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const timing = { requestId: "same-batch", startedAt: 1, firstDeltaAt: 2 };
  render(<MarkdownViewer title="问答" content="一次完成的正文。" streaming={false} streamTiming={timing} />);
  expect(markDesktopPerformance).toHaveBeenCalledWith("qa-first-commit", expect.objectContaining({ request_id: "same-batch" }));
  act(() => { for (let count = 0; frames.length && count < 20; count++) frames.shift()!(performance.now()); });
  expect(markDesktopPerformance).toHaveBeenCalledWith("qa-first-paint", expect.objectContaining({ request_id: "same-batch", paint_proxy: "double_raf" }));
});
