import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "../api/client";
import { computeTreeForestPositions } from "../components/knowledgeGraphLayout";

function graph(size: number): KnowledgeGraph {
  return {
    nodes: Array.from({ length: size }, (_, index) => ({
      id: index + 1,
      project_id: 1,
      node_type: "term",
      title: `Node ${index + 1}`,
      created_at: "2026-08-02T00:00:00Z",
      updated_at: "2026-08-02T00:00:00Z",
    })),
    edges: Array.from({ length: Math.max(0, size - 1) }, (_, index) => ({
      id: index + 1,
      project_id: 1,
      source_node_id: Math.floor(index / 3) + 1,
      target_node_id: index + 2,
      relation_type: "parent_of",
      created_at: "2026-08-02T00:00:00Z",
      updated_at: "2026-08-02T00:00:00Z",
    })),
  };
}

describe("knowledge graph tree layout", () => {
  it("returns one finite position per node for a large graph", () => {
    const positions = computeTreeForestPositions(graph(300));
    expect(positions).toHaveLength(300);
    expect(new Set(positions.map((position) => position.id)).size).toBe(300);
    expect(positions.every((position) => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true);
  });

  it("places descendants below their root", () => {
    const positions = new Map(computeTreeForestPositions(graph(12)).map((position) => [position.id, position]));
    expect(positions.get(2)!.y).toBeGreaterThan(positions.get(1)!.y);
    expect(positions.get(5)!.y).toBeGreaterThan(positions.get(2)!.y);
  });
});
