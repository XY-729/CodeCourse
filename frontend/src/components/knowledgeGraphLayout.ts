import type { KnowledgeGraph } from "../api/client";

export type KnowledgeGraphLayoutRequest = {
  requestId: number;
  graph: KnowledgeGraph;
};

export type KnowledgeGraphLayoutResult = {
  requestId: number;
  positions: Array<{ id: number; x: number; y: number }>;
};

function connectedComponents(graph: KnowledgeGraph): number[][] {
  const adjacent = new Map(graph.nodes.map((node) => [node.id, new Set<number>()]));
  for (const edge of graph.edges) {
    adjacent.get(edge.source_node_id)?.add(edge.target_node_id);
    adjacent.get(edge.target_node_id)?.add(edge.source_node_id);
  }
  const remaining = new Set(adjacent.keys());
  const components: number[][] = [];
  while (remaining.size) {
    const root = remaining.values().next().value as number;
    const queue = [root];
    const component: number[] = [];
    remaining.delete(root);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      for (const next of adjacent.get(current) ?? []) {
        if (!remaining.delete(next)) continue;
        queue.push(next);
      }
    }
    components.push(component);
  }
  return components.sort((left, right) => right.length - left.length || left[0] - right[0]);
}
export function computeTreeForestPositions(graph: KnowledgeGraph): KnowledgeGraphLayoutResult["positions"] {
  const incoming = new Map(graph.nodes.map((node) => [node.id, [] as number[]]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as number[]]));
  const degree = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    outgoing.get(edge.source_node_id)?.push(edge.target_node_id);
    incoming.get(edge.target_node_id)?.push(edge.source_node_id);
    degree.set(edge.source_node_id, (degree.get(edge.source_node_id) ?? 0) + 1);
    degree.set(edge.target_node_id, (degree.get(edge.target_node_id) ?? 0) + 1);
  }
  const positions: KnowledgeGraphLayoutResult["positions"] = [];
  let componentLeft = 0;
  for (const component of connectedComponents(graph)) {
    const ids = new Set(component);
    const roots = component
      .filter((id) => !(incoming.get(id) ?? []).some((parent) => ids.has(parent)))
      .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a - b);
    if (!roots.length) roots.push([...component].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a - b)[0]);

    const visited = new Set<number>();
    const levels: number[][] = [];
    let frontier = roots;
    while (frontier.length) {
      const level = frontier.filter((id) => !visited.has(id));
      if (!level.length) break;
      level.forEach((id) => visited.add(id));
      levels.push(level);
      frontier = level.flatMap((id) => outgoing.get(id) ?? []).filter((id) => ids.has(id) && !visited.has(id));
    }
    for (const orphan of component.filter((id) => !visited.has(id))) {
      const level = levels.length > 1 ? 1 : 0;
      (levels[level] ??= []).push(orphan);
    }

    const widest = Math.max(1, ...levels.map((level) => level.length));
    const componentWidth = Math.max(260, widest * 190);
    levels.forEach((level, depth) => {
      const gap = componentWidth / Math.max(1, level.length);
      level.forEach((id, index) => {
        positions.push({
          id,
          x: componentLeft + gap * (index + 0.5),
          y: depth * 180,
        });
      });
    });
    componentLeft += componentWidth + 260;
  }

  if (positions.length) {
    const minX = Math.min(...positions.map((position) => position.x));
    const maxX = Math.max(...positions.map((position) => position.x));
    const center = (minX + maxX) / 2;
    positions.forEach((position) => { position.x -= center; });
  }
  return positions;
}
