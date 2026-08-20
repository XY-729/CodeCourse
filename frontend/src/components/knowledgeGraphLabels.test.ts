import { describe, expect, it } from "vitest";
import type { Core } from "cytoscape";
import type { KnowledgeGraph } from "../api/client";
import { positionLabelOverlay, updateLabelVisibility } from "./knowledgeGraphLabels";

function graphWithOverlappingNodes(count: number): KnowledgeGraph {
  return {
    nodes: Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      project_id: 1,
      node_type: "concept",
      title: `节点 ${index + 1}`,
      ref_type: null,
      ref_id: null,
      ref_path: null,
      summary: null,
      x: 40,
      y: 40,
      created_at: "",
      updated_at: "",
    })),
    edges: [],
  };
}

function fakeCore(graph: KnowledgeGraph): Core {
  const nodes = new Map(graph.nodes.map((node) => [node.id, {
    empty: () => false,
    hasClass: () => false,
    renderedPosition: () => ({ x: 40, y: 40 }),
    renderedOuterHeight: () => 52,
  }]));
  return {
    width: () => 100,
    height: () => 100,
    getElementById: (id: string) => nodes.get(Number(id.slice(1))),
  } as unknown as Core;
}

describe("knowledge graph labels", () => {
  it("keeps every visible node name even when labels overlap", () => {
    const graph = graphWithOverlappingNodes(16);
    const labels = new Map(graph.nodes.map((node) => {
      const label = document.createElement("div");
      label.textContent = node.title;
      label.dataset.visible = "false";
      return [node.id, label];
    }));

    updateLabelVisibility(fakeCore(graph), graph, labels, {
      viewMode: "overview",
      focusedNodeId: null,
      focusDepth: 1,
      selectedNodeId: null,
      hoveredNodeId: null,
      searchQuery: "",
    });

    expect([...labels.values()].every((label) => label.dataset.visible === "true")).toBe(true);
  });

  it("restores labels hidden by focus mode when returning to overview", () => {
    const graph = graphWithOverlappingNodes(4);
    const labels = new Map(graph.nodes.map((node) => {
      const label = document.createElement("div");
      label.textContent = node.title;
      label.dataset.visible = "false";
      label.dataset.inViewport = "false";
      return [node.id, label];
    }));

    updateLabelVisibility(fakeCore(graph), graph, labels, {
      viewMode: "overview",
      focusedNodeId: null,
      focusDepth: 1,
      selectedNodeId: null,
      hoveredNodeId: null,
      searchQuery: "",
    });

    expect([...labels.values()].every((label) => label.dataset.visible === "true")).toBe(true);
    expect([...labels.values()].every((label) => label.dataset.inViewport === "true")).toBe(true);
  });

  it("does not let a transient hidden class overwrite logical label visibility", () => {
    let graphHidden = true;
    const node = {
      empty: () => false,
      hasClass: (name: string) => name === "graph-hidden" && graphHidden,
      renderedPosition: () => ({ x: 40, y: 40 }),
      renderedOuterHeight: () => 52,
    };
    const cy = {
      width: () => 100,
      height: () => 100,
      getElementById: () => node,
    } as unknown as Core;
    const label = document.createElement("div");
    label.dataset.visible = "true";
    label.dataset.inViewport = "true";
    const labels = new Map([[1, label]]);

    positionLabelOverlay(cy, graphWithOverlappingNodes(1), labels);
    expect(label.dataset.visible).toBe("true");
    expect(label.dataset.inViewport).toBe("false");

    graphHidden = false;
    positionLabelOverlay(cy, graphWithOverlappingNodes(1), labels);
    expect(label.dataset.visible).toBe("true");
    expect(label.dataset.inViewport).toBe("true");
  });
});
