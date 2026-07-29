import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "../api/client";

export type KnowledgeGraphIndex = {
  nodeById: Map<number, KnowledgeNode>;
  edgeById: Map<number, KnowledgeEdge>;
  degreeById: Map<number, number>;
  adjacentNodeIds: Map<number, Set<number>>;
  edgeIdsByNodeId: Map<number, Set<number>>;
};

export type KnowledgeNeighborhood = {
  nodeIds: Set<number>;
  edgeIds: Set<number>;
  levels: Map<number, number>;
};

export type KnowledgeGraphDelta = {
  addedNodeIds: Set<number>;
  removedNodeIds: Set<number>;
  updatedNodeIds: Set<number>;
  addedEdgeIds: Set<number>;
  removedEdgeIds: Set<number>;
  updatedEdgeIds: Set<number>;
  topologyChanged: boolean;
  contentChanged: boolean;
};

const indexCache = new WeakMap<KnowledgeGraph, KnowledgeGraphIndex>();

export function getKnowledgeGraphIndex(graph: KnowledgeGraph): KnowledgeGraphIndex {
  const cached = indexCache.get(graph);
  if (cached) return cached;

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const degreeById = new Map(graph.nodes.map((node) => [node.id, 0]));
  const adjacentNodeIds = new Map(graph.nodes.map((node) => [node.id, new Set<number>()]));
  const edgeIdsByNodeId = new Map(graph.nodes.map((node) => [node.id, new Set<number>()]));

  for (const edge of graph.edges) {
    degreeById.set(edge.source_node_id, (degreeById.get(edge.source_node_id) ?? 0) + 1);
    degreeById.set(edge.target_node_id, (degreeById.get(edge.target_node_id) ?? 0) + 1);
    adjacentNodeIds.get(edge.source_node_id)?.add(edge.target_node_id);
    adjacentNodeIds.get(edge.target_node_id)?.add(edge.source_node_id);
    edgeIdsByNodeId.get(edge.source_node_id)?.add(edge.id);
    edgeIdsByNodeId.get(edge.target_node_id)?.add(edge.id);
  }

  const index = { nodeById, edgeById, degreeById, adjacentNodeIds, edgeIdsByNodeId };
  indexCache.set(graph, index);
  return index;
}

export function getKnowledgeNeighborhood(
  graph: KnowledgeGraph,
  focusedNodeId: number,
  depth = 1,
): KnowledgeNeighborhood {
  const index = getKnowledgeGraphIndex(graph);
  const nodeIds = new Set<number>([focusedNodeId]);
  const levels = new Map<number, number>([[focusedNodeId, 0]]);
  let frontier = [focusedNodeId];

  for (let level = 1; level <= depth && frontier.length > 0; level += 1) {
    const next: number[] = [];
    for (const current of frontier) {
      for (const adjacent of index.adjacentNodeIds.get(current) ?? []) {
        if (nodeIds.has(adjacent)) continue;
        nodeIds.add(adjacent);
        levels.set(adjacent, level);
        next.push(adjacent);
      }
    }
    frontier = next;
  }

  const edgeIds = new Set<number>();
  for (const nodeId of nodeIds) {
    for (const edgeId of index.edgeIdsByNodeId.get(nodeId) ?? []) {
      const edge = index.edgeById.get(edgeId);
      if (edge && nodeIds.has(edge.source_node_id) && nodeIds.has(edge.target_node_id)) {
        edgeIds.add(edgeId);
      }
    }
  }

  return { nodeIds, edgeIds, levels };
}

function nodeContent(node: KnowledgeNode) {
  return [
    node.title,
    node.node_type,
    node.ref_type ?? null,
    node.ref_id ?? null,
    node.ref_path ?? null,
    node.summary ?? null,
    node.x ?? null,
    node.y ?? null,
  ];
}

function edgeContent(edge: KnowledgeEdge) {
  return [
    edge.source_node_id,
    edge.target_node_id,
    edge.relation_type,
    edge.label ?? null,
  ];
}

function sameContent(left: unknown[], right: unknown[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function diffKnowledgeGraphs(previous: KnowledgeGraph, next: KnowledgeGraph): KnowledgeGraphDelta {
  const previousIndex = getKnowledgeGraphIndex(previous);
  const nextIndex = getKnowledgeGraphIndex(next);
  const addedNodeIds = new Set<number>();
  const removedNodeIds = new Set<number>();
  const updatedNodeIds = new Set<number>();
  const addedEdgeIds = new Set<number>();
  const removedEdgeIds = new Set<number>();
  const updatedEdgeIds = new Set<number>();

  for (const [id, node] of nextIndex.nodeById) {
    const oldNode = previousIndex.nodeById.get(id);
    if (!oldNode) addedNodeIds.add(id);
    else if (!sameContent(nodeContent(oldNode), nodeContent(node))) updatedNodeIds.add(id);
  }
  for (const id of previousIndex.nodeById.keys()) {
    if (!nextIndex.nodeById.has(id)) removedNodeIds.add(id);
  }
  for (const [id, edge] of nextIndex.edgeById) {
    const oldEdge = previousIndex.edgeById.get(id);
    if (!oldEdge) addedEdgeIds.add(id);
    else if (!sameContent(edgeContent(oldEdge), edgeContent(edge))) updatedEdgeIds.add(id);
  }
  for (const id of previousIndex.edgeById.keys()) {
    if (!nextIndex.edgeById.has(id)) removedEdgeIds.add(id);
  }

  const topologyChanged = addedNodeIds.size > 0
    || removedNodeIds.size > 0
    || addedEdgeIds.size > 0
    || removedEdgeIds.size > 0
    || [...updatedEdgeIds].some((id) => {
      const before = previousIndex.edgeById.get(id);
      const after = nextIndex.edgeById.get(id);
      return before?.source_node_id !== after?.source_node_id
        || before?.target_node_id !== after?.target_node_id;
    });

  return {
    addedNodeIds,
    removedNodeIds,
    updatedNodeIds,
    addedEdgeIds,
    removedEdgeIds,
    updatedEdgeIds,
    topologyChanged,
    contentChanged: topologyChanged || updatedNodeIds.size > 0 || updatedEdgeIds.size > 0,
  };
}

export function knowledgeGraphSignature(graph: KnowledgeGraph): string {
  const nodes = [...graph.nodes]
    .sort((left, right) => left.id - right.id)
    .map((node) => [node.id, ...nodeContent(node)]);
  const edges = [...graph.edges]
    .sort((left, right) => left.id - right.id)
    .map((edge) => [edge.id, ...edgeContent(edge)]);
  return JSON.stringify([nodes, edges]);
}
