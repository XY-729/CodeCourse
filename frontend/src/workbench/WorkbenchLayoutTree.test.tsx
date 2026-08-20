import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WorkbenchLayoutTree from "./WorkbenchLayoutTree";
import { createGroup, splitGroup } from "./layout";

function splitLayout() {
  return splitGroup(createGroup("group-1"), "group-1", "row", "after", createGroup("group-2"), "split-1");
}

describe("WorkbenchLayoutTree", () => {
  it("renders each leaf and collapses the selected split", () => {
    const onCollapseSplit = vi.fn();
    const { container } = render(
      <div className="reader-workspace">
        <WorkbenchLayoutTree
          layout={splitLayout()}
          mobile={false}
          renderGroup={(group) => <div>{group.id}</div>}
          onCollapseSplit={onCollapseSplit}
          onStartResize={vi.fn()}
        />
      </div>,
    );
    expect(screen.getByText("group-1")).toBeTruthy();
    expect(screen.getByText("group-2")).toBeTruthy();
    fireEvent.doubleClick(container.querySelector(".split-resizer") as Element);
    expect(onCollapseSplit).toHaveBeenCalledWith("split-1", "second");
  });

  it("does not mount resize handles on Android", () => {
    const { container } = render(
      <WorkbenchLayoutTree
        layout={splitLayout()}
        mobile
        renderGroup={(group) => <div>{group.id}</div>}
        onCollapseSplit={vi.fn()}
        onStartResize={vi.fn()}
      />,
    );
    expect(container.querySelector(".split-resizer")).toBeNull();
  });

  it("captures a bounded resize state before dragging", () => {
    const onStartResize = vi.fn();
    const { container } = render(
      <div className="reader-workspace">
        <WorkbenchLayoutTree
          layout={splitLayout()}
          mobile={false}
          renderGroup={(group) => <div className="reader-pane">{group.id}</div>}
          onCollapseSplit={vi.fn()}
          onStartResize={onStartResize}
        />
      </div>,
    );
    const root = container.querySelector(".reader-workspace") as HTMLDivElement;
    root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) });
    container.querySelectorAll<HTMLElement>(".reader-pane").forEach((pane) => {
      pane.getBoundingClientRect = () => ({ left: 0, top: 0, right: 497, bottom: 600, width: 497, height: 600, x: 0, y: 0, toJSON: () => ({}) });
    });
    const split = container.querySelector(".split-node") as HTMLDivElement;
    split.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) });
    const handle = container.querySelector(".split-resizer") as HTMLDivElement;
    handle.getBoundingClientRect = () => ({ left: 497, top: 0, right: 503, bottom: 600, width: 6, height: 600, x: 497, y: 0, toJSON: () => ({}) });
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 500, clientY: 200 });
    expect(onStartResize).toHaveBeenCalledWith(expect.objectContaining({
      kind: "split",
      splitId: "split-1",
      direction: "row",
      pointerId: 7,
      startBoundary: 497,
      snapMinBoundary: 320,
      snapMaxBoundary: 674,
      collapseMinBoundary: 8,
      collapseMaxBoundary: 986,
    }));
    // Resizing must not leave document surfaces frozen at their pre-drag
    // geometry. The panes follow the split live and remain responsive after
    // release; compact tracks are handled by CSS layering instead.
    container.querySelectorAll<HTMLElement>(".reader-pane").forEach((pane) => {
      expect(pane.classList.contains("cc-frozen")).toBe(false);
      expect(pane.style.getPropertyValue("--drag-pane-width")).toBe("");
      expect(pane.style.getPropertyValue("--drag-pane-height")).toBe("");
    });
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
    document.querySelectorAll(".split-drag-indicator").forEach((node) => node.remove());
  });
});
