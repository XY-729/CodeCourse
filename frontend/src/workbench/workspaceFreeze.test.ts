import { describe, expect, it } from "vitest";
import {
  freezeWorkspaceDocuments,
  restoreFrozenPanes,
} from "./workspaceFreeze";

function rect(width: number, height: number): DOMRect {
  return {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
}

function workspace() {
  const root = document.createElement("div");
  const split = document.createElement("div");
  const first = document.createElement("div");
  const handle = document.createElement("div");
  const second = document.createElement("div");
  first.className = "split-child first";
  handle.className = "split-resizer";
  second.className = "split-child second";
  split.append(first, handle, second);
  root.append(split);

  const panes = [first, second].map((parent, index) => {
    const pane = document.createElement("section");
    pane.className = "reader-pane";
    const body = document.createElement("div");
    body.className = "pane-body";
    const viewer = document.createElement("div");
    viewer.className = "viewer";
    viewer.getBoundingClientRect = () => rect(index === 0 ? 420 : 560, 500);
    body.append(viewer);
    pane.append(body);
    parent.append(pane);
    return pane;
  });
  return { root, split, panes };
}

describe("workspace document freeze", () => {
  it("anchors later horizontal panes to the right with increasing layers", () => {
    const { root, split, panes } = workspace();
    freezeWorkspaceDocuments(root, split, "row");

    expect(panes[0].classList.contains("cc-frozen-row-start")).toBe(true);
    expect(panes[1].classList.contains("cc-frozen-row-end")).toBe(true);
    expect(panes[0].style.getPropertyValue("--drag-pane-width")).toBe("420px");
    expect(panes[1].style.getPropertyValue("--drag-pane-width")).toBe("560px");
    expect(panes[0].style.getPropertyValue("--drag-pane-layer")).toBe("1");
    expect(panes[1].style.getPropertyValue("--drag-pane-layer")).toBe("2");
  });

  it("uses bottom anchoring for vertical splits and restores cancelled state", () => {
    const { root, split, panes } = workspace();
    const states = freezeWorkspaceDocuments(root, split, "column");

    expect(panes[0].classList.contains("cc-frozen-column-start")).toBe(true);
    expect(panes[1].classList.contains("cc-frozen-column-end")).toBe(true);
    restoreFrozenPanes(states);
    panes.forEach((pane) => {
      expect(pane.classList.contains("cc-frozen")).toBe(false);
      expect(pane.style.getPropertyValue("--drag-pane-width")).toBe("");
      expect(pane.style.getPropertyValue("--drag-pane-layer")).toBe("");
    });
  });
});
