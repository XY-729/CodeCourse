import { describe, expect, it, vi } from "vitest";
import type { Core } from "cytoscape";
import type { KnowledgeGraph } from "../api/client";
import {
  measureLabelElements,
  positionLabelOverlay,
  reconcileLabelElements,
  updateLabelVisibility,
} from "../components/knowledgeGraphLabels";

function graph(): KnowledgeGraph {
  return {
    nodes: [1, 2, 3].map((id) => ({
      id,
      project_id: 1,
      node_type: "term",
      title: `节点 ${id}`,
      created_at: "2026-07-29T00:00:00Z",
      updated_at: "2026-07-29T00:00:00Z",
    })),
    edges: [
      {
        id: 10,
        project_id: 1,
        source_node_id: 1,
        target_node_id: 2,
        relation_type: "related_to",
        created_at: "2026-07-29T00:00:00Z",
        updated_at: "2026-07-29T00:00:00Z",
      },
      {
        id: 11,
        project_id: 1,
        source_node_id: 2,
        target_node_id: 3,
        relation_type: "related_to",
        created_at: "2026-07-29T00:00:00Z",
        updated_at: "2026-07-29T00:00:00Z",
      },
    ],
  };
}

function fakeCore() {
  const nodes = new Map(
    [1, 2, 3].map((id) => [
      `n${id}`,
      {
        empty: () => false,
        hasClass: () => false,
        renderedPosition: () => ({ x: id * 100, y: id * 80 }),
        renderedOuterHeight: () => 50,
      },
    ]),
  );
  return {
    getElementById: (id: string) => nodes.get(id),
    width: () => 800,
    height: () => 600,
  } as unknown as Core;
}

describe("knowledge graph labels", () => {
  it("hides labels outside the focused neighborhood", () => {
    const layer = document.createElement("div");
    document.body.appendChild(layer);
    const labels = new Map<number, HTMLDivElement>();
    const value = graph();
    const cy = fakeCore();

    reconcileLabelElements(value, layer, labels);
    updateLabelVisibility(cy, value, labels, {
      viewMode: "focus",
      focusedNodeId: 1,
      focusDepth: 1,
      selectedNodeId: null,
      hoveredNodeId: null,
      searchQuery: "",
    });

    expect(labels.get(1)?.dataset.visible).toBe("true");
    expect(labels.get(2)?.dataset.visible).toBe("true");
    expect(labels.get(3)?.dataset.visible).toBe("false");
    layer.remove();
  });

  it("uses cached label metrics during visibility updates", () => {
    const layer = document.createElement("div");
    document.body.appendChild(layer);
    const labels = new Map<number, HTMLDivElement>();
    const metrics = new Map<number, { width: number; height: number }>();
    const value = graph();
    reconcileLabelElements(value, layer, labels);
    const rectSpy = vi.spyOn(labels.get(1)!, "getBoundingClientRect").mockReturnValue({
      width: 90, height: 24, left: 0, top: 0, right: 90, bottom: 24, x: 0, y: 0, toJSON: () => ({}),
    });
    measureLabelElements(labels, metrics, [1]);
    rectSpy.mockClear();

    updateLabelVisibility(fakeCore(), value, labels, {
      viewMode: "overview",
      focusedNodeId: null,
      focusDepth: 1,
      selectedNodeId: null,
      hoveredNodeId: null,
      searchQuery: "",
    }, metrics);

    expect(rectSpy).not.toHaveBeenCalled();
    layer.remove();
  });

  it("positions visible labels with a compositor transform", () => {
    const layer = document.createElement("div");
    const labels = new Map<number, HTMLDivElement>();
    const value = graph();
    reconcileLabelElements(value, layer, labels);

    positionLabelOverlay(fakeCore(), value, labels);

    expect(labels.get(1)?.style.transform).toContain("translate3d(100px, 112px, 0)");
    expect(labels.get(1)?.style.left).toBe("");
  });
});
