import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGroup, splitGroup, type LayoutNode } from "./layout";
import type { SplitResizeStart } from "./WorkbenchLayoutTree";
import { useWorkbenchResizeController } from "./useWorkbenchResizeController";

function pointerEvent(type: string, pointerId: number, clientX: number, clientY = 100) {
  const event = new MouseEvent(type, { clientX, clientY });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    getCoalescedEvents: { value: () => [] },
  });
  return event;
}

function splitDrag(layout: LayoutNode) {
  const rootElement = document.createElement("div");
  rootElement.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}),
  });
  const splitElement = document.createElement("div");
  const handleElement = document.createElement("div");
  handleElement.hasPointerCapture = vi.fn(() => false);
  handleElement.releasePointerCapture = vi.fn();
  const pane = document.createElement("section");
  pane.className = "reader-pane cc-frozen cc-frozen-row-start";
  pane.style.setProperty("--drag-pane-width", "497px");
  pane.style.setProperty("--drag-pane-height", "600px");
  const indicator = document.createElement("div");
  document.body.append(indicator);
  const state: SplitResizeStart = {
    kind: "split",
    splitId: "split-1",
    direction: "row",
    pointerId: 7,
    handleElement,
    startX: 500,
    startY: 100,
    startBoundary: 497,
    minBoundary: 8,
    maxBoundary: 986,
    rootBounds: { left: 0, top: 0, right: 1000, bottom: 600 },
    rootElement,
    splitElements: new Map([["split-1", splitElement]]),
    frozenPanes: [{
      element: pane,
      wasFrozen: false,
      anchorClasses: [],
      width: "",
      height: "",
      layer: "",
    }],
    indicator,
    layoutSnapshot: layout,
    boundaries: new Map([["split-1", {
      bounds: { left: 0, top: 0, right: 1000, bottom: 600 },
      position: 497,
      dividerSize: 6,
    }]]),
  };
  return { state, splitElement, pane, indicator };
}

describe("useWorkbenchResizeController", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    };
    window.cancelAnimationFrame = vi.fn();
  });

  it("restores and clamps the saved inspector width", () => {
    window.localStorage.setItem("codecourse.assistantWidth", "900");
    const { result } = renderHook(() => useWorkbenchResizeController({
      mobile: false,
      commitLayoutChange: vi.fn(),
    }));
    expect(result.current.assistantWidth).toBe(520);
  });

  it("commits a sidebar resize only when the pointer is released", () => {
    const { result } = renderHook(() => useWorkbenchResizeController({
      mobile: false,
      commitLayoutChange: vi.fn(),
    }));
    act(() => result.current.setDragState({ kind: "sidebar-width", startX: 100, startWidth: 264 }));
    act(() => window.dispatchEvent(new MouseEvent("mousemove", { clientX: 140 })));
    expect(result.current.sidebarWidth).toBe(264);
    act(() => window.dispatchEvent(new MouseEvent("mouseup", { clientX: 140 })));
    expect(result.current.sidebarWidth).toBe(304);
  });

  it("coalesces pointer moves and clamps an extreme split drag without collapsing a group", () => {
    const frames: FrameRequestCallback[] = [];
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    let committed = splitGroup(createGroup("group-1"), "group-1", "row", "after", createGroup("group-2"), "split-1");
    const commitLayoutChange = vi.fn((updater: (current: LayoutNode) => LayoutNode) => {
      committed = updater(committed);
    });
    const drag = splitDrag(committed);
    const { result } = renderHook(() => useWorkbenchResizeController({ mobile: false, commitLayoutChange }));

    act(() => result.current.setDragState(drag.state));
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", 7, 200));
      window.dispatchEvent(pointerEvent("pointermove", 7, -1000));
    });
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    act(() => frames.shift()?.(performance.now()));
    expect(Number(drag.splitElement.style.getPropertyValue("--split-ratio"))).toBeCloseTo(8 / 994, 6);

    act(() => window.dispatchEvent(pointerEvent("pointerup", 7, -1000)));
    expect(commitLayoutChange).toHaveBeenCalledTimes(1);
    expect(committed.type).toBe("split");
    if (committed.type === "split") expect(committed.ratio).toBeCloseTo(8 / 994, 6);
    expect(result.current.dragState).toBeNull();
    expect(drag.splitElement.style.getPropertyValue("--split-ratio")).toBe("");
    expect(drag.pane.classList.contains("cc-frozen")).toBe(true);
    expect(drag.indicator.isConnected).toBe(false);
  });

  it("restores the pre-drag sheet state when pointer capture is cancelled", () => {
    const layout = splitGroup(createGroup("group-1"), "group-1", "row", "after", createGroup("group-2"), "split-1");
    const commitLayoutChange = vi.fn();
    const drag = splitDrag(layout);
    const { result } = renderHook(() => useWorkbenchResizeController({ mobile: false, commitLayoutChange }));

    act(() => result.current.setDragState(drag.state));
    act(() => window.dispatchEvent(pointerEvent("pointercancel", 7, 400)));

    expect(commitLayoutChange).not.toHaveBeenCalled();
    expect(result.current.dragState).toBeNull();
    expect(drag.pane.classList.contains("cc-frozen")).toBe(false);
    expect(drag.pane.style.getPropertyValue("--drag-pane-width")).toBe("");
    expect(drag.indicator.isConnected).toBe(false);
  });
});
