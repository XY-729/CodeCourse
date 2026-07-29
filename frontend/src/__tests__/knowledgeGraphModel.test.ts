import { describe, expect, it } from "vitest";
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "../api/client";
import {
  diffKnowledgeGraphs,
  getKnowledgeGraphIndex,
  getKnowledgeNeighborhood,
  knowledgeGraphSignature,
} from "../components/knowledgeGraphModel";

function node(id: number, title = `node-${id}`): KnowledgeNode {
  return {
    id,
    project_id: 1,
    node_type: "term",
    title,
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:00Z",
  };
}

function edge(id: number, source: number, target: number): KnowledgeEdge {
  return {
    id,
    project_id: 1,
    source_node_id: source,
    target_node_id: target,
    relation_type: "related_to",
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:00Z",
  };
}

describe("knowledge graph model", () => {
  it("uses a stable signature for equivalent unordered API responses", () => {
    const first: KnowledgeGraph = {
      nodes: [node(1), node(2)],
      edges: [edge(10, 1, 2)],
    };
    const second: KnowledgeGraph = {
      nodes: [node(2), node(1)],
      edges: [edge(10, 1, 2)],
    };

    expect(knowledgeGraphSignature(first)).toBe(knowledgeGraphSignature(second));
    expect(diffKnowledgeGraphs(first, second).contentChanged).toBe(false);
  });

  it("does not classify a title-only refresh as a topology change", () => {
    const before: KnowledgeGraph = {
      nodes: [node(1, "旧标题"), node(2)],
      edges: [edge(10, 1, 2)],
    };
    const after: KnowledgeGraph = {
      nodes: [node(1, "新标题"), node(2)],
      edges: [edge(10, 1, 2)],
    };
    const delta = diffKnowledgeGraphs(before, after);

    expect(delta.updatedNodeIds).toEqual(new Set([1]));
    expect(delta.topologyChanged).toBe(false);
    expect(delta.contentChanged).toBe(true);
  });

  it("indexes degrees and resolves one-hop and two-hop neighborhoods", () => {
    const graph: KnowledgeGraph = {
      nodes: [node(1), node(2), node(3), node(4)],
      edges: [edge(10, 1, 2), edge(11, 2, 3), edge(12, 3, 4)],
    };
    const index = getKnowledgeGraphIndex(graph);

    expect(index.degreeById.get(2)).toBe(2);
    expect(getKnowledgeNeighborhood(graph, 1, 1).nodeIds).toEqual(new Set([1, 2]));
    expect(getKnowledgeNeighborhood(graph, 1, 2).nodeIds).toEqual(new Set([1, 2, 3]));
    expect(getKnowledgeNeighborhood(graph, 1, 2).edgeIds).toEqual(new Set([10, 11]));
  });

  it("detects endpoint changes as topology updates", () => {
    const before: KnowledgeGraph = {
      nodes: [node(1), node(2), node(3)],
      edges: [edge(10, 1, 2)],
    };
    const after: KnowledgeGraph = {
      nodes: [node(1), node(2), node(3)],
      edges: [edge(10, 1, 3)],
    };

    const delta = diffKnowledgeGraphs(before, after);
    expect(delta.updatedEdgeIds).toEqual(new Set([10]));
    expect(delta.topologyChanged).toBe(true);
  });
});
