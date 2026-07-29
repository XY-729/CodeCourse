import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { Core, ElementDefinition, NodeSingular } from "cytoscape";
import {
  createKnowledgeEdge,
  deleteKnowledgeEdge,
  deleteKnowledgeNode,
  getKnowledgeGraph,
  updateKnowledgeNode,
} from "../api/client";
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "../api/client";
import {
  diffKnowledgeGraphs,
  getKnowledgeGraphIndex,
  getKnowledgeNeighborhood,
} from "./knowledgeGraphModel";
import {
  positionLabelOverlay,
  reconcileLabelElements,
  updateLabelVisibility,
} from "./knowledgeGraphLabels";

type Props = {
  projectId: number;
  refreshKey?: number;
  onOpenQA: (qaId: number) => void;
  onOpenCourse: (path: string) => void;
  onOpenFile: (path: string) => void;
  onContentChanged?: () => void | Promise<void>;
  onGraphChanged?: () => void | Promise<void>;
  compact?: boolean;
  onRequestText?: (options: { title: string; label?: string; initialValue?: string; placeholder?: string; confirmText?: string }) => Promise<string | null>;
  onConfirm?: (title: string, message: string, options?: { confirmText?: string; danger?: boolean }) => Promise<boolean>;
  focusRef?: { ref_type: string; ref_path?: string; ref_id?: number } | null;
};

type RelationType = "explains" | "parent_of" | "related_to" | "references";
type ViewMode = "overview" | "focus";

type NodeVisual = { size: number; color: string; borderColor: string };

function currentDarkMode() {
  return document.documentElement.dataset.theme === "dark";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function nodeVisuals(graph: KnowledgeGraph, container: HTMLElement | null, darkMode = false): Map<number, NodeVisual> {
  const { degreeById } = getKnowledgeGraphIndex(graph);

  const minDimension = Math.min(container?.clientWidth ?? 900, container?.clientHeight ?? 680);
  const density = clamp(Math.sqrt(12 / Math.max(1, graph.nodes.length)), 0.7, 1.18);
  // 目标尺寸按当前容器计算；紧凑侧栏也保留足够大的最低节点尺寸。
  const baseSize = clamp(minDimension * 0.06 * density, 52, 76);
  const sizeSteps = [1, 1.28, 1.62, 2, 2.4, 2.82];
  const colorSteps = darkMode
    ? [
        { color: "#343438", borderColor: "#8e8e93" },
        { color: "#30a46c", borderColor: "#49c984" },
        { color: "#3378d5", borderColor: "#64a0ff" },
        { color: "#7a4fd8", borderColor: "#a980ff" },
        { color: "#d88a10", borderColor: "#ffb340" },
        { color: "#d7474f", borderColor: "#ff696f" },
      ]
    : [
        { color: "#ffffff", borderColor: "#98a5b5" },
        { color: "#3aa76d", borderColor: "#238653" },
        { color: "#3b82e6", borderColor: "#2563c9" },
        { color: "#8b5cf6", borderColor: "#7041d0" },
        { color: "#f59e0b", borderColor: "#c67b00" },
        { color: "#e54b4b", borderColor: "#b92d35" },
      ];

  return new Map(
    graph.nodes.map((node) => {
      const degree = degreeById.get(node.id) ?? 0;
      const level = Math.min(5, degree);
      const size = Math.round(baseSize * sizeSteps[level]);
      const color = colorSteps[level];
      return [node.id, { size, ...color }];
    }),
  );
}

function focusSizes(container: HTMLElement | null) {
  const w = container?.clientWidth ?? 800;
  const h = container?.clientHeight ?? 600;
  const dim = Math.min(w, h);
  return {
    root: Math.round(clamp(dim * 0.105, 76, 110)),
    parent: Math.round(clamp(dim * 0.065, 44, 68)),
    child: Math.round(clamp(dim * 0.055, 38, 58)),
  };
}

const LAYOUT_PADDING = 58;
const ANIMATION_MS = 360;

const RELATION_LABELS: Record<string, string> = {
  explains: "解释",
  parent_of: "父子",
  related_to: "相关",
  references: "引用",
};

function fallbackPosition(index: number, total: number, anchor: { x: number; y: number }) {
  const ring = Math.floor(index / 10);
  const slot = index % 10;
  const slots = Math.min(10, Math.max(1, total - ring * 10));
  const radius = 150 + ring * 105;
  const angle = (Math.PI * 2 * slot) / slots + ring * 0.38;
  return {
    x: anchor.x + Math.cos(angle) * radius,
    y: anchor.y + Math.sin(angle) * radius,
  };
}

function detectComponents(graph: KnowledgeGraph): number[][] {
  const adj = new Map<number, number[]>();
  for (const node of graph.nodes) adj.set(node.id, []);
  for (const edge of graph.edges) {
    adj.get(edge.source_node_id)?.push(edge.target_node_id);
    adj.get(edge.target_node_id)?.push(edge.source_node_id);
  }
  const visited = new Set<number>();
  const components: number[][] = [];
  for (const node of graph.nodes) {
    if (visited.has(node.id)) continue;
    const stack = [node.id];
    const comp: number[] = [];
    while (stack.length) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      comp.push(id);
      for (const neighbor of adj.get(id) || []) {
        if (!visited.has(neighbor)) stack.push(neighbor);
      }
    }
    components.push(comp);
  }
  return components;
}

function toElements(graph: KnowledgeGraph, container: HTMLElement | null, darkMode = false): ElementDefinition[] {
  const visuals = nodeVisuals(graph, container, darkMode);

  const positioned = graph.nodes.filter((node) => node.x != null && node.y != null);
  const components = detectComponents(graph);
  const anchor = positioned.length
    ? {
        x: positioned.reduce((sum, node) => sum + Number(node.x), 0) / positioned.length,
        y: positioned.reduce((sum, node) => sum + Number(node.y), 0) / positioned.length,
      }
    : { x: 0, y: 0 };

  const compCenters =
    components.length > 1 && positioned.length === 0
      ? components.map((_comp, ci) => {
          const angle = (Math.PI * 2 * ci) / components.length;
          const radius = Math.max(350, components.length * 160);
          return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
        })
      : [];

  const nodeCompIndex = new Map<number, number>();
  for (let ci = 0; ci < components.length; ci++) {
    for (const id of components[ci]) nodeCompIndex.set(id, ci);
  }

  const compMissingCounts = compCenters.length
    ? components.map((comp) => comp.filter((id) => !positioned.some((n) => n.id === id)).length)
    : [];
  const compCounters = compCenters.length ? components.map(() => 0) : [];

  let missingIndex = 0;
  const missingTotal = graph.nodes.length - positioned.length;

  return [
    ...graph.nodes.map((node) => {
      const visual = visuals.get(node.id)!;
      const hasPosition = node.x != null && node.y != null;
      let position: { x: number; y: number };
      if (hasPosition) {
        position = { x: Number(node.x), y: Number(node.y) };
      } else if (compCenters.length > 0) {
        const ci = nodeCompIndex.get(node.id) ?? 0;
        const center = compCenters[ci];
        const idx = compCounters[ci]++;
        const total = Math.max(1, compMissingCounts[ci]);
        position = fallbackPosition(idx, total, center);
      } else {
        position = fallbackPosition(missingIndex++, Math.max(1, missingTotal), anchor);
      }
      return {
        data: {
          id: `n${node.id}`,
          nodeId: node.id,
          label: node.title,
          type: node.node_type,
          refType: node.ref_type,
          refId: node.ref_id,
          refPath: node.ref_path,
          summary: node.summary,
          color: visual.color,
          borderColor: visual.borderColor,
          size: visual.size,
          accentColor: darkMode ? "#64a0ff" : "#25766c",
          focusRootColor: darkMode ? "#8fc9ff" : "#174c43",
          focusParentColor: darkMode ? "#6e8a84" : "#75998e",
        },
        position,
      };
    }),
    ...graph.edges.map((edge) => ({
      data: {
        id: `e${edge.id}`,
        edgeId: edge.id,
        source: `n${edge.source_node_id}`,
        target: `n${edge.target_node_id}`,
        label: edge.label || RELATION_LABELS[edge.relation_type] || edge.relation_type,
        relationType: edge.relation_type,
        lineColor: darkMode ? "#606067" : "#9aa7b8",
        accentColor: darkMode ? "#64a0ff" : "#25766c",
      },
    })),
  ];
}

function reconcileGraphElements(
  cy: Core,
  previous: KnowledgeGraph,
  next: KnowledgeGraph,
  container: HTMLElement | null,
  darkMode: boolean,
) {
  const delta = diffKnowledgeGraphs(previous, next);
  if (!delta.contentChanged) return delta;

  const definitions = new Map(
    toElements(next, container, darkMode).map((definition) => [String(definition.data?.id), definition]),
  );

  cy.batch(() => {
    for (const edgeId of delta.removedEdgeIds) cy.getElementById(`e${edgeId}`).remove();
    for (const nodeId of delta.removedNodeIds) cy.getElementById(`n${nodeId}`).remove();

    for (const edgeId of delta.updatedEdgeIds) {
      const oldEdge = previous.edges.find((edge) => edge.id === edgeId);
      const nextEdge = next.edges.find((edge) => edge.id === edgeId);
      if (
        oldEdge
        && nextEdge
        && (oldEdge.source_node_id !== nextEdge.source_node_id || oldEdge.target_node_id !== nextEdge.target_node_id)
      ) {
        cy.getElementById(`e${edgeId}`).remove();
      }
    }

    for (const nodeId of delta.updatedNodeIds) {
      const definition = definitions.get(`n${nodeId}`);
      const element = cy.getElementById(`n${nodeId}`);
      if (definition?.data && !element.empty()) element.data(definition.data);
    }
    for (const edgeId of delta.updatedEdgeIds) {
      const definition = definitions.get(`e${edgeId}`);
      const element = cy.getElementById(`e${edgeId}`);
      if (definition?.data && !element.empty()) element.data(definition.data);
    }

    for (const nodeId of delta.addedNodeIds) {
      const definition = definitions.get(`n${nodeId}`);
      if (definition) cy.add(definition);
    }
    for (const edgeId of new Set([...delta.addedEdgeIds, ...delta.updatedEdgeIds])) {
      if (!cy.getElementById(`e${edgeId}`).empty()) continue;
      const definition = definitions.get(`e${edgeId}`);
      if (definition) cy.add(definition);
    }
  });

  return delta;
}

function directNeighborhood(graph: KnowledgeGraph, focusedNodeId: number, depth = 1) {
  return getKnowledgeNeighborhood(graph, focusedNodeId, depth);
}

function arrangeFocusNeighborhood(cy: Core, graph: KnowledgeGraph, focusedNodeId: number, depth: number, animate: boolean) {
  const { nodeIds, levels } = directNeighborhood(graph, focusedNodeId, depth);
  const centerNode = cy.getElementById(`n${focusedNodeId}`);
  if (centerNode.empty()) return;
  const neighbors = [...nodeIds]
    .filter((id) => id !== focusedNodeId)
    .map((id) => cy.getElementById(`n${id}`))
    .filter((node) => !node.empty());
  const center = { x: 0, y: 0 };
  if (neighbors.length === 0) {
    centerNode.position(center);
    return 0;
  }
  const levelOne = neighbors.filter((node) => levels.get(Number(node.data("nodeId"))) === 1);
  const levelTwo = neighbors.filter((node) => levels.get(Number(node.data("nodeId"))) === 2);
  const rowGap = Math.max(220, 176 + levelOne.length * 24);
  const moveNode = (node: NodeSingular, position: { x: number; y: number }) => {
    node.stop();
    if (animate) {
      node.animate({ position }, { duration: ANIMATION_MS, easing: "ease-in-out-cubic" });
    } else {
      node.position(position);
    }
  };
  moveNode(centerNode, center);
  const incomingIds = new Set(graph.edges.filter((edge) => edge.target_node_id === focusedNodeId).map((edge) => edge.source_node_id));
  const outgoingIds = new Set(graph.edges.filter((edge) => edge.source_node_id === focusedNodeId).map((edge) => edge.target_node_id));
  const parents = levelOne.filter((node) => incomingIds.has(Number(node.data("nodeId"))));
  const children = levelOne.filter((node) => outgoingIds.has(Number(node.data("nodeId"))) && !incomingIds.has(Number(node.data("nodeId"))));
  const neutral = levelOne.filter((node) => !parents.includes(node) && !children.includes(node));
  const placeRow = (nodes: NodeSingular[], y: number) => {
    const gap = Math.max(168, Math.min(250, 760 / Math.max(1, nodes.length)));
    nodes.forEach((node, index) => moveNode(node, { x: (index - (nodes.length - 1) / 2) * gap, y }));
  };
  placeRow(parents, -rowGap);
  placeRow(children, rowGap);
  neutral.forEach((node, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const column = Math.floor(index / 2) + 1;
    moveNode(node, { x: side * (rowGap + column * 120), y: 0 });
  });
  const parentIds = new Set(parents.map((node) => Number(node.data("nodeId"))));
  const childIds = new Set(children.map((node) => Number(node.data("nodeId"))));
  const ancestors = levelTwo.filter((node) => {
    const id = Number(node.data("nodeId"));
    return graph.edges.some((edge) => edge.source_node_id === id && parentIds.has(edge.target_node_id));
  });
  const descendants = levelTwo.filter((node) => {
    const id = Number(node.data("nodeId"));
    return graph.edges.some((edge) => childIds.has(edge.source_node_id) && edge.target_node_id === id);
  });
  const remaining = levelTwo.filter((node) => !ancestors.includes(node) && !descendants.includes(node));
  placeRow(ancestors, -rowGap * 2);
  placeRow(descendants, rowGap * 2);
  remaining.forEach((node, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const column = Math.floor(index / 2) + 1;
    moveNode(node, { x: side * (rowGap * 1.6 + column * 120), y: rowGap * 0.65 });
  });
  return levelTwo.length ? rowGap * 2 : rowGap;
}

function focusViewport(cy: Core, focusedNodeId: number, radius: number, animate: boolean) {
  const container = cy.container();
  const width = container?.clientWidth ?? 900;
  const height = container?.clientHeight ?? 680;
  const labelMargin = 148;
  const usableWidth = Math.max(160, width - labelMargin * 2);
  const usableHeight = Math.max(160, height - labelMargin * 2);
  const zoom = clamp(Math.min(usableWidth / (radius * 2), usableHeight / (radius * 2)), 0.25, 1.5);
  const root = cy.getElementById(`n${focusedNodeId}`);
  if (root.empty()) return;
  const position = root.position();
  const pan = { x: width / 2 - position.x * zoom, y: height / 2 - position.y * zoom };
  cy.stop();
  if (animate) {
    cy.animate({ zoom, pan }, { duration: ANIMATION_MS, easing: "ease-in-out-cubic" });
  } else {
    cy.zoom(zoom);
    cy.pan(pan);
  }
}

function fitVisible(cy: Core, graph: KnowledgeGraph, mode: ViewMode, focusedNodeId: number | null, depth: number, animate: boolean) {
  let fitElements = cy.elements().filter((element) => !element.hasClass("graph-hidden"));
  let padding = LAYOUT_PADDING;
  if (mode === "focus" && focusedNodeId) {
    const { nodeIds, edgeIds } = directNeighborhood(graph, focusedNodeId, depth);
    fitElements = cy.collection();
    for (const id of nodeIds) {
      fitElements = fitElements.union(cy.getElementById(`n${id}`));
    }
    for (const id of edgeIds) {
      fitElements = fitElements.union(cy.getElementById(`e${id}`));
    }
    padding = Math.max(86, Math.min(cy.width(), cy.height()) * 0.14);
  }
  if (fitElements.length === 0) return;
  cy.stop();
  if (animate) {
    cy.animate({ fit: { eles: fitElements, padding } }, { duration: ANIMATION_MS, easing: "ease-in-out-cubic" });
  } else {
    cy.fit(fitElements, padding);
  }
}

type ApplyGraphViewOptions = {
  animate?: boolean;
  fitViewport?: boolean;
  scheduleViewport?: (callback: () => void, delay: number) => void;
};

function applyGraphView(
  cy: Core,
  graph: KnowledgeGraph,
  mode: ViewMode,
  focusedNodeId: number | null,
  depth: number,
  options: ApplyGraphViewOptions = {},
) {
  const animate = options.animate ?? true;
  const fitViewport = options.fitViewport ?? true;
  cy.elements().removeClass("graph-hidden focus-root focus-parent focus-child focus-edge hover-dim hover-related");
  const overview = nodeVisuals(graph, cy.container(), currentDarkMode());
  cy.nodes().forEach((node) => {
    const visual = overview.get(Number(node.data("nodeId")));
    if (visual) {
      node.data("displaySize", visual.size);
      node.style({ width: visual.size, height: visual.size });
    }
  });

  if (mode === "focus" && focusedNodeId) {
    const { nodeIds, edgeIds } = directNeighborhood(graph, focusedNodeId, depth);
    const parentIds = new Set<number>();
    const childIds = new Set<number>();
    for (const edge of graph.edges) {
      if (edge.source_node_id === focusedNodeId && nodeIds.has(edge.target_node_id)) {
        childIds.add(edge.target_node_id);
      } else if (edge.target_node_id === focusedNodeId && nodeIds.has(edge.source_node_id)) {
        parentIds.add(edge.source_node_id);
      }
    }
    const sizes = focusSizes(cy.container());
    cy.nodes().forEach((node) => {
      const nodeId = Number(node.data("nodeId"));
      if (!nodeIds.has(nodeId)) {
        node.addClass("graph-hidden");
      } else if (nodeId === focusedNodeId) {
        node.addClass("focus-root");
        node.data("displaySize", sizes.root);
        node.style({ width: sizes.root, height: sizes.root });
      } else if (parentIds.has(nodeId)) {
        node.addClass("focus-parent");
        node.data("displaySize", sizes.parent);
        node.style({ width: sizes.parent, height: sizes.parent });
      } else {
        node.addClass("focus-child");
        node.data("displaySize", sizes.child);
        node.style({ width: sizes.child, height: sizes.child });
      }
    });
    cy.edges().forEach((edge) => {
      const edgeId = Number(edge.data("edgeId"));
      if (edgeIds.has(edgeId)) {
        edge.addClass("focus-edge");
      } else {
        edge.addClass("graph-hidden");
      }
    });
    const focusRadius = arrangeFocusNeighborhood(cy, graph, focusedNodeId, depth, animate);
    if (fitViewport && focusRadius != null) {
      const updateViewport = () => {
        if (!cy.destroyed()) focusViewport(cy, focusedNodeId, focusRadius, animate);
      };
      if (options.scheduleViewport) options.scheduleViewport(updateViewport, animate ? ANIMATION_MS : 0);
      else updateViewport();
    }
    cy.emit("render");
    return;
  }

  if (fitViewport) fitVisible(cy, graph, mode, focusedNodeId, depth, animate);
  cy.emit("render");
}

function placeAlongArc(count: number, middle: number, spread: number) {
  if (count <= 1) return [middle];
  return Array.from({ length: count }, (_, index) => middle - spread / 2 + (spread * index) / (count - 1));
}

function resolvePositionCollisions(graph: KnowledgeGraph, positions: Map<number, { x: number; y: number }>) {
  const { degreeById } = getKnowledgeGraphIndex(graph);
  const cellSize = 196;

  // 空间哈希只比较相邻网格，避免整理大型网络时执行全量 O(n²) 碰撞检查。
  for (let iteration = 0; iteration < 36; iteration += 1) {
    const buckets = new Map<string, KnowledgeNode[]>();
    for (const node of graph.nodes) {
      const position = positions.get(node.id);
      if (!position) continue;
      const key = `${Math.floor(position.x / cellSize)}:${Math.floor(position.y / cellSize)}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(node);
      buckets.set(key, bucket);
    }
    let moved = false;
    for (const a of graph.nodes) {
      const positionA = positions.get(a.id);
      if (!positionA) continue;
      const cellX = Math.floor(positionA.x / cellSize);
      const cellY = Math.floor(positionA.y / cellSize);
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (const b of buckets.get(`${cellX + offsetX}:${cellY + offsetY}`) ?? []) {
            if (b.id <= a.id) continue;
            const positionB = positions.get(b.id);
            if (!positionB) continue;
            let dx = positionB.x - positionA.x;
            let dy = positionB.y - positionA.y;
            let distance = Math.hypot(dx, dy);
            const requiredDistance = 118
              + Math.min(70, ((degreeById.get(a.id) ?? 0) + (degreeById.get(b.id) ?? 0)) * 10);
            if (distance >= requiredDistance) continue;
            if (distance < 0.001) {
              const angle = ((a.id * 37 + b.id * 17) % 360) * (Math.PI / 180);
              dx = Math.cos(angle);
              dy = Math.sin(angle);
              distance = 1;
            }
            const push = (requiredDistance - distance) / 2;
            const massA = 1 + (degreeById.get(a.id) ?? 0) * 0.75;
            const massB = 1 + (degreeById.get(b.id) ?? 0) * 0.75;
            const unitX = dx / distance;
            const unitY = dy / distance;
            positionA.x -= unitX * push * (massB / (massA + massB));
            positionA.y -= unitY * push * (massB / (massA + massB));
            positionB.x += unitX * push * (massA / (massA + massB));
            positionB.y += unitY * push * (massA / (massA + massB));
            moved = true;
          }
        }
      }
    }
    if (!moved) break;
  }
  return positions;
}

function createHubBranchPositions(graph: KnowledgeGraph, isComponent = false) {
  const degree = new Map<number, number>();
  const adjacency = new Map<number, Set<number>>();
  const outgoing = new Map<number, number[]>();
  const incoming = new Map<number, number[]>();
  for (const node of graph.nodes) {
    degree.set(node.id, 0);
    adjacency.set(node.id, new Set());
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const edge of graph.edges) {
    degree.set(edge.source_node_id, (degree.get(edge.source_node_id) ?? 0) + 1);
    degree.set(edge.target_node_id, (degree.get(edge.target_node_id) ?? 0) + 1);
    adjacency.get(edge.source_node_id)?.add(edge.target_node_id);
    adjacency.get(edge.target_node_id)?.add(edge.source_node_id);
    outgoing.get(edge.source_node_id)?.push(edge.target_node_id);
    incoming.get(edge.target_node_id)?.push(edge.source_node_id);
  }
  if (!graph.nodes.length) return new Map<number, { x: number; y: number }>();

  if (!isComponent) {
    const components = detectComponents(graph).sort((a, b) => b.length - a.length || a[0] - b[0]);
    if (components.length > 1) {
      const combined = new Map<number, { x: number; y: number }>();
      let cursorX = 0;
      components.forEach((component, index) => {
        const ids = new Set(component);
        const part: KnowledgeGraph = {
          nodes: graph.nodes.filter((node) => ids.has(node.id)),
          edges: graph.edges.filter((edge) => ids.has(edge.source_node_id) && ids.has(edge.target_node_id)),
        };
        const local = createHubBranchPositions(part, true);
        const points = [...local.values()];
        const minX = Math.min(...points.map((point) => point.x));
        const maxX = Math.max(...points.map((point) => point.x));
        const minY = Math.min(...points.map((point) => point.y));
        const maxY = Math.max(...points.map((point) => point.y));
        const width = maxX - minX;
        const offsetY = index % 2 === 0 ? 0 : Math.max(280, maxY - minY + 180);
        local.forEach((point, nodeId) => combined.set(nodeId, { x: point.x + cursorX - minX, y: point.y + offsetY }));
        cursorX += width + 440;
      });
      return resolvePositionCollisions(graph, combined);
    }
  }

  const root = [...graph.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id - b.id)[0];
  const positions = new Map<number, { x: number; y: number }>([[root.id, { x: 0, y: 0 }]]);
  const angles = new Map<number, number>([[root.id, 0]]);
  const levels = new Map<number, number>([[root.id, 0]]);
  const queue = [root.id];
  const rootOutgoing = [...new Set(outgoing.get(root.id) ?? [])].sort((a, b) => a - b);
  const rootIncoming = [...new Set(incoming.get(root.id) ?? [])]
    .filter((id) => !rootOutgoing.includes(id))
    .sort((a, b) => a - b);
  const rootNeighbors = [...(adjacency.get(root.id) ?? [])].filter((id) => !rootOutgoing.includes(id) && !rootIncoming.includes(id));
  const rootAngles = new Map<number, number>();

  // 出边在上、右、下展开；入边在左侧展开。这样关键节点居中，知识来源和延伸分支自然分开。
  rootOutgoing.forEach((id, index) => rootAngles.set(id, placeAlongArc(rootOutgoing.length, 0, Math.PI)[index] - Math.PI / 2));
  rootIncoming.forEach((id, index) => rootAngles.set(id, placeAlongArc(rootIncoming.length, Math.PI, Math.PI / 2)[index]));
  rootNeighbors.forEach((id, index) => rootAngles.set(id, placeAlongArc(rootNeighbors.length, Math.PI * 0.75, Math.PI / 3)[index]));

  const rootRadius = Math.max(260, 186 + rootAngles.size * 26);
  for (const [id, angle] of rootAngles) {
    positions.set(id, { x: Math.cos(angle) * rootRadius, y: Math.sin(angle) * rootRadius });
    angles.set(id, angle);
    levels.set(id, 1);
    queue.push(id);
  }

  while (queue.length) {
    const parentId = queue.shift()!;
    const parentLevel = levels.get(parentId) ?? 0;
    const children = [...(adjacency.get(parentId) ?? [])]
      .filter((id) => !positions.has(id))
      .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a - b);
    if (!children.length) continue;
    const parentAngle = angles.get(parentId) ?? 0;
    const childAngles = placeAlongArc(children.length, parentAngle, Math.min(Math.PI / 2, Math.PI / (parentLevel + 1)));
    const radius = rootRadius * (parentLevel + 1);
    children.forEach((id, index) => {
      const angle = childAngles[index];
      positions.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      angles.set(id, angle);
      levels.set(id, parentLevel + 1);
      queue.push(id);
    });
  }

  return resolvePositionCollisions(graph, positions);
}

function createTreeForestPositions(graph: KnowledgeGraph) {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as number[]]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, [] as number[]]));
  const undirected = new Map(graph.nodes.map((node) => [node.id, new Set<number>()]));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source_node_id) || !nodeIds.has(edge.target_node_id)) continue;
    outgoing.get(edge.source_node_id)?.push(edge.target_node_id);
    incoming.get(edge.target_node_id)?.push(edge.source_node_id);
    undirected.get(edge.source_node_id)?.add(edge.target_node_id);
    undirected.get(edge.target_node_id)?.add(edge.source_node_id);
  }
  const rank = (id: number) => (outgoing.get(id)?.length ?? 0) * 3 + (undirected.get(id)?.size ?? 0);
  const sortNodes = (ids: Iterable<number>) => [...new Set(ids)].sort((a, b) => rank(b) - rank(a) || a - b);
  const positions = new Map<number, { x: number; y: number }>();
  const components = detectComponents(graph).sort((a, b) => b.length - a.length || a[0] - b[0]);
  const horizontalSlot = 210;
  const verticalGap = 190;
  const rootGap = 0.7;
  const componentGap = 300;
  let componentCursor = 0;

  for (const component of components) {
    const componentIds = new Set(component);
    const children = new Map(component.map((id) => [id, [] as number[]]));
    const visited = new Set<number>();
    const roots: number[] = [];
    const initialRoots = sortNodes(component.filter((id) => (
      incoming.get(id)?.filter((source) => componentIds.has(source)).length ?? 0
    ) === 0));
    if (!initialRoots.length && component.length) {
      initialRoots.push(sortNodes(component)[0]);
    }

    const growFrom = (rootId: number) => {
      if (visited.has(rootId)) return;
      roots.push(rootId);
      visited.add(rootId);
      const queue = [rootId];
      while (queue.length) {
        const parentId = queue.shift()!;
        for (const childId of sortNodes((outgoing.get(parentId) ?? []).filter((id) => componentIds.has(id)))) {
          if (visited.has(childId)) continue;
          visited.add(childId);
          children.get(parentId)?.push(childId);
          queue.push(childId);
        }
      }
    };
    initialRoots.forEach(growFrom);

    while (visited.size < component.length) {
      const remaining = component.filter((id) => !visited.has(id));
      let attached = false;
      for (const childId of sortNodes(remaining)) {
        const directedParent = sortNodes((incoming.get(childId) ?? []).filter((id) => visited.has(id)))[0];
        const adjacentParent = directedParent ?? sortNodes([...(undirected.get(childId) ?? [])].filter((id) => visited.has(id)))[0];
        if (adjacentParent == null) continue;
        visited.add(childId);
        children.get(adjacentParent)?.push(childId);
        const queue = [childId];
        while (queue.length) {
          const parentId = queue.shift()!;
          for (const nextId of sortNodes((outgoing.get(parentId) ?? []).filter((id) => componentIds.has(id)))) {
            if (visited.has(nextId)) continue;
            visited.add(nextId);
            children.get(parentId)?.push(nextId);
            queue.push(nextId);
          }
        }
        attached = true;
        break;
      }
      if (!attached) growFrom(sortNodes(remaining)[0]);
    }

    const subtreeWidth = new Map<number, number>();
    const measure = (nodeId: number): number => {
      const ownWidth = clamp((nodeById.get(nodeId)?.title.length ?? 0) / 15, 1, 1.7);
      const branch = children.get(nodeId) ?? [];
      if (!branch.length) {
        subtreeWidth.set(nodeId, ownWidth);
        return ownWidth;
      }
      const childWidth = branch.reduce((sum, id) => sum + measure(id), 0) + Math.max(0, branch.length - 1) * 0.28;
      const width = Math.max(ownWidth, childWidth);
      subtreeWidth.set(nodeId, width);
      return width;
    };
    roots.forEach(measure);

    const place = (nodeId: number, centerX: number, level: number) => {
      positions.set(nodeId, { x: centerX * horizontalSlot, y: level * verticalGap });
      const branch = children.get(nodeId) ?? [];
      if (!branch.length) return;
      const total = branch.reduce((sum, id) => sum + (subtreeWidth.get(id) ?? 1), 0) + Math.max(0, branch.length - 1) * 0.28;
      let cursor = centerX - total / 2;
      for (const childId of branch) {
        const width = subtreeWidth.get(childId) ?? 1;
        place(childId, cursor + width / 2, level + 1);
        cursor += width + 0.28;
      }
    };

    const componentWidth = roots.reduce((sum, id) => sum + (subtreeWidth.get(id) ?? 1), 0)
      + Math.max(0, roots.length - 1) * rootGap;
    let rootCursor = componentCursor / horizontalSlot;
    for (const rootId of roots) {
      const width = subtreeWidth.get(rootId) ?? 1;
      place(rootId, rootCursor + width / 2, 0);
      rootCursor += width + rootGap;
    }
    componentCursor += componentWidth * horizontalSlot + componentGap;
  }

  if (positions.size) {
    const minX = Math.min(...[...positions.values()].map((point) => point.x));
    const maxX = Math.max(...[...positions.values()].map((point) => point.x));
    const offset = (minX + maxX) / 2;
    positions.forEach((point) => { point.x -= offset; });
  }
  return positions;
}

function createCompactOverviewLayout(cy: Core, graph: KnowledgeGraph, animate = true) {
  const positions = createTreeForestPositions(graph);
  return cy.layout({
    name: "preset",
    fit: false,
    animate,
    animationDuration: animate ? 360 : 0,
    animationEasing: "ease-in-out-cubic",
    positions: (node: NodeSingular) => positions.get(Number(node.data("nodeId"))) ?? { x: 0, y: 0 },
    padding: LAYOUT_PADDING,
  } as never);
}


export default function KnowledgeGraphViewer({ projectId, refreshKey = 0, compact = false, onRequestText, onConfirm, onOpenQA, onOpenCourse, onOpenFile, onContentChanged, onGraphChanged, focusRef }: Props) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const labelLayerRef = useRef<HTMLDivElement | null>(null);
  const labelElementsRef = useRef(new Map<number, HTMLDivElement>());
  const labelPositionFrameRef = useRef<number | null>(null);
  const labelVisibilityFrameRef = useRef<number | null>(null);
  const scheduleLabelPositionRef = useRef<() => void>(() => undefined);
  const scheduleLabelVisibilityRef = useRef<() => void>(() => undefined);
  const viewportTimeoutRef = useRef<number | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeSettleTimeoutRef = useRef<number | null>(null);
  const layoutRunningRef = useRef(false);
  const hoveredNodeIdRef = useRef<number | null>(null);
  const selectedNodeIdRef = useRef<number | null>(null);
  const searchQueryRef = useRef("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const pointerInsideRef = useRef(false);
  const overviewPositionsRef = useRef(new Map<number, { x: number; y: number }>());
  const cyRef = useRef<Core | null>(null);
  const lastTapRef = useRef<{ id: string; at: number } | null>(null);
  const graphRef = useRef<KnowledgeGraph>({ nodes: [], edges: [] });
  const renderedGraphRef = useRef<KnowledgeGraph>({ nodes: [], edges: [] });
  const graphProjectIdRef = useRef<number | null>(null);
  const projectIdRef = useRef(projectId);
  const reloadRequestRef = useRef(0);
  const connectModeRef = useRef(false);
  const connectSourceIdRef = useRef<number | null>(null);
  const viewModeRef = useRef<ViewMode>("overview");
  const focusedNodeIdRef = useRef<number | null>(null);
  const focusDepthRef = useRef<1 | 2>(1);
  const onOpenQARef = useRef(onOpenQA);
  const onOpenCourseRef = useRef(onOpenCourse);
  const onOpenFileRef = useRef(onOpenFile);
  const relationTypeRef = useRef<RelationType>("related_to");
  const [graph, setGraph] = useState<KnowledgeGraph>({ nodes: [], edges: [] });
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<KnowledgeEdge | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [relationType, setRelationType] = useState<RelationType>("related_to");
  const [connectSourceId, setConnectSourceId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [focusedNodeId, setFocusedNodeId] = useState<number | null>(null);
  const [focusDepth, setFocusDepth] = useState<1 | 2>(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [message, setMessage] = useState("");
  const [darkMode, setDarkMode] = useState(currentDarkMode);

  useEffect(() => {
    const updateTheme = () => setDarkMode(currentDarkMode());
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  async function reload() {
    const requestId = ++reloadRequestRef.current;
    const requestedProjectId = projectId;
    const next = await getKnowledgeGraph(requestedProjectId);
    if (requestId !== reloadRequestRef.current || projectIdRef.current !== requestedProjectId) return;
    graphProjectIdRef.current = requestedProjectId;
    setGraph(next);
  }

  function scheduleViewportUpdate(callback: () => void, delay: number) {
    if (viewportTimeoutRef.current != null) window.clearTimeout(viewportTimeoutRef.current);
    viewportTimeoutRef.current = window.setTimeout(() => {
      viewportTimeoutRef.current = null;
      callback();
    }, Math.max(0, delay));
  }

  async function notifyGraphChanged() {
    if (onGraphChanged) await onGraphChanged();
    else await reload();
  }

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  useEffect(() => {
    projectIdRef.current = projectId;
    graphProjectIdRef.current = null;
    reloadRequestRef.current += 1;
    setGraph({ nodes: [], edges: [] });
    setSelectedNode(null);
    setSelectedEdge(null);
    setViewMode("overview");
    setFocusedNodeId(null);
  }, [projectId]);

  useEffect(() => {
    connectModeRef.current = connectMode;
    connectSourceIdRef.current = connectSourceId;
  }, [connectMode, connectSourceId]);

  useEffect(() => {
    viewModeRef.current = viewMode;
    focusedNodeIdRef.current = focusedNodeId;
    focusDepthRef.current = focusDepth;
  }, [viewMode, focusedNodeId, focusDepth]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNode?.id ?? null;
    scheduleLabelVisibilityRef.current();
  }, [selectedNode?.id]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
    scheduleLabelVisibilityRef.current();
  }, [searchQuery]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      const isActiveViewer = pointerInsideRef.current || Boolean(target && viewerRef.current?.contains(target));
      if (!isActiveViewer) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
      } else if (!isTyping && event.key === "Escape") {
        setSearchOpen(false);
        setSearchQuery("");
        setViewMode("overview");
        setFocusedNodeId(null);
      } else if (!isTyping && (event.key === "+" || event.key === "=")) {
        setFocusDepth(2);
      } else if (!isTyping && event.key === "-") {
        setFocusDepth(1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    onOpenQARef.current = onOpenQA;
  }, [onOpenQA]);

  useEffect(() => {
    onOpenCourseRef.current = onOpenCourse;
  }, [onOpenCourse]);

  useEffect(() => {
    onOpenFileRef.current = onOpenFile;
  }, [onOpenFile]);

  useEffect(() => {
    relationTypeRef.current = relationType;
  }, [relationType]);

  useEffect(() => {
    const delay = graphProjectIdRef.current === projectId ? 60 : 0;
    const timer = window.setTimeout(() => {
      reload().catch((error) => setMessage(error instanceof Error ? error.message : "加载知识网络失败"));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [projectId, refreshKey]);

  useEffect(() => {
    if (viewMode === "focus" && focusedNodeId && !graph.nodes.some((node) => node.id === focusedNodeId)) {
      setViewMode("overview");
      setFocusedNodeId(null);
    }
  }, [graph, viewMode, focusedNodeId]);

  const focusRefKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = focusRef ? `${focusRef.ref_type}:${focusRef.ref_id ?? focusRef.ref_path ?? ""}` : null;
    if (key === focusRefKeyRef.current) return;

    if (!focusRef || graph.nodes.length === 0) return;

    const match = graph.nodes.find((node) => {
      const typeMatch = node.node_type === focusRef.ref_type || node.ref_type === focusRef.ref_type;
      if (!typeMatch) return false;
      if (focusRef.ref_id != null && node.ref_id === focusRef.ref_id) return true;
      if (focusRef.ref_path != null && node.ref_path === focusRef.ref_path) return true;
      return false;
    });

    if (match) {
      focusRefKeyRef.current = key;
      const cy = cyRef.current;
      if (viewModeRef.current === "overview" && cy) {
        const positions = new Map<number, { x: number; y: number }>();
        cy.nodes().forEach((item) => { positions.set(Number(item.data("nodeId")), { ...item.position() }); });
        overviewPositionsRef.current = positions;
      }
      setViewMode("focus");
      setFocusedNodeId(match.id);
      setFocusDepth(1);
    }
  }, [focusRef, graph]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    cyRef.current?.destroy();
    const cy = cytoscape({
      container,
      elements: [],
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            label: "",
            "border-width": 2,
            "border-color": "data(borderColor)",
            width: "data(size)",
            height: "data(size)",
            opacity: 1,
            "transition-property": "opacity border-width border-color",
            "transition-duration": 220,
            "transition-timing-function": "ease-in-out-cubic",
          },
        },
        {
          selector: "node.focus-root",
          style: {
            "border-color": "data(focusRootColor)",
            "border-width": 5,
          },
        },
        {
          selector: "node.focus-parent",
          style: {
            "border-color": "data(focusParentColor)",
            "border-width": 3,
            opacity: 0.95,
          },
        },
        {
          selector: "node.focus-child",
          style: {
            opacity: 0.88,
          },
        },
        {
          selector: "node.graph-hidden",
          style: {
            opacity: 0,
            label: "",
            events: "no",
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-color": "data(focusRootColor)",
            "border-width": 4,
          },
        },
        {
          selector: "node.hover-related",
          style: { "border-color": "data(accentColor)", "border-width": 4 },
        },
        {
          selector: "node.hover-dim",
          style: { opacity: 0.2 },
        },
        {
          selector: "node.graph-hidden.hover-dim",
          style: { opacity: 0, events: "no" },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "data(lineColor)",
            "target-arrow-color": "data(lineColor)",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            label: "",
            "z-index": 8,
            opacity: 0.92,
            "transition-property": "opacity width line-color target-arrow-color font-size text-background-padding text-margin-y color",
            "transition-duration": 220,
            "transition-timing-function": "ease-in-out-cubic",
          },
        },
        {
          selector: "edge.focus-edge",
          style: {
            "line-color": "data(accentColor)",
            "target-arrow-color": "data(accentColor)",
            width: 3,
            "z-index": 12,
            opacity: 1,
          },
        },
        {
          selector: "edge.graph-hidden",
          style: {
            opacity: 0,
            label: "",
            events: "no",
          },
        },
        {
          selector: "edge:selected",
          style: {
            "line-color": "data(accentColor)",
            "target-arrow-color": "data(accentColor)",
            width: 3,
            "z-index": 12,
          },
        },
        {
          selector: "edge.hover-related",
          style: { "line-color": "data(accentColor)", "target-arrow-color": "data(accentColor)", width: 3, opacity: 1 },
        },
        {
          selector: "edge.hover-dim",
          style: { opacity: 0.12 },
        },
        {
          selector: "edge.graph-hidden.hover-dim",
          style: { opacity: 0, events: "no" },
        },
      ],
      layout: { name: "preset", fit: false },
      // 全览必须能容纳完整树；标签由独立 DOM 层保持可读，不依赖画布最小缩放。
      minZoom: compact ? 0.05 : 0.1,
      maxZoom: 3,
    });
    cyRef.current = cy;
    renderedGraphRef.current = { nodes: [], edges: [] };
    overviewPositionsRef.current.clear();

    const labelLayer = labelLayerRef.current;
    labelElementsRef.current.clear();
    labelLayer?.replaceChildren();
    const scheduleLabelPositions = () => {
      if (!labelLayer || labelPositionFrameRef.current != null) return;
      labelPositionFrameRef.current = window.requestAnimationFrame(() => {
        labelPositionFrameRef.current = null;
        if (cy.destroyed()) return;
        positionLabelOverlay(cy, graphRef.current, labelElementsRef.current);
      });
    };
    const scheduleLabelVisibility = () => {
      if (!labelLayer || labelVisibilityFrameRef.current != null) return;
      labelVisibilityFrameRef.current = window.requestAnimationFrame(() => {
        labelVisibilityFrameRef.current = null;
        if (cy.destroyed()) return;
        updateLabelVisibility(cy, graphRef.current, labelElementsRef.current, {
          viewMode: viewModeRef.current,
          focusedNodeId: focusedNodeIdRef.current,
          focusDepth: focusDepthRef.current,
          selectedNodeId: selectedNodeIdRef.current,
          hoveredNodeId: hoveredNodeIdRef.current,
          searchQuery: searchQueryRef.current,
        });
      });
    };
    scheduleLabelPositionRef.current = scheduleLabelPositions;
    scheduleLabelVisibilityRef.current = scheduleLabelVisibility;
    cy.on("render", scheduleLabelPositions);
    cy.on("panend zoomend resize", scheduleLabelVisibility);
    cy.on("mouseover", "node", (event) => {
      const nodeId = Number(event.target.data("nodeId"));
      hoveredNodeIdRef.current = nodeId;
      if (!connectModeRef.current) {
        const { nodeIds, edgeIds } = directNeighborhood(graphRef.current, nodeId, 1);
        const relatedNodes = cy.collection();
        const relatedEdges = cy.collection();
        let nextRelatedNodes = relatedNodes;
        let nextRelatedEdges = relatedEdges;
        for (const id of nodeIds) nextRelatedNodes = nextRelatedNodes.union(cy.getElementById(`n${id}`));
        for (const id of edgeIds) nextRelatedEdges = nextRelatedEdges.union(cy.getElementById(`e${id}`));
        cy.batch(() => {
          cy.elements().removeClass("hover-dim hover-related");
          cy.nodes().difference(nextRelatedNodes).addClass("hover-dim");
          cy.edges().difference(nextRelatedEdges).addClass("hover-dim");
          nextRelatedNodes.addClass("hover-related");
          nextRelatedEdges.addClass("hover-related");
        });
      }
      scheduleLabelVisibility();
    });
    cy.on("mouseout", "node", () => {
      hoveredNodeIdRef.current = null;
      cy.elements().removeClass("hover-dim hover-related");
      scheduleLabelVisibility();
    });
    scheduleLabelPositions();

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (resizeFrameRef.current != null) return;
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        if (cy.destroyed()) return;
        cy.resize();
        scheduleLabelPositions();
        scheduleLabelVisibility();
      });
      if (resizeSettleTimeoutRef.current != null) window.clearTimeout(resizeSettleTimeoutRef.current);
      resizeSettleTimeoutRef.current = window.setTimeout(() => {
        resizeSettleTimeoutRef.current = null;
        if (cy.destroyed() || layoutRunningRef.current || graphRef.current.nodes.length === 0) return;
        fitVisible(
          cy,
          graphRef.current,
          viewModeRef.current,
          focusedNodeIdRef.current,
          focusDepthRef.current,
          false,
        );
        scheduleLabelVisibility();
      }, 160);
    });
    resizeObserver?.observe(container);

    cy.on("tap", "node", async (event) => {
      const node = event.target as NodeSingular;
      const nodeId = Number(node.data("nodeId"));
      const currentGraph = graphRef.current;
      const found = currentGraph.nodes.find((item) => item.id === nodeId) ?? null;
      setSelectedNode(found);
      setSelectedEdge(null);

      if (connectModeRef.current) {
        const sourceId = connectSourceIdRef.current;
        if (!sourceId) {
          setConnectSourceId(nodeId);
          setMessage("请选择目标节点");
        } else if (sourceId !== nodeId) {
          const rel = relationTypeRef.current;
          await createKnowledgeEdge(projectId, {
            source_node_id: sourceId,
            target_node_id: nodeId,
            relation_type: rel,
            label: RELATION_LABELS[rel],
          });
          setConnectSourceId(null);
          setConnectMode(false);
          setMessage("已创建关系");
          await notifyGraphChanged();
        }
        return;
      }

      const now = Date.now();
      const last = lastTapRef.current;
      lastTapRef.current = { id: node.id(), at: now };
      if (last && last.id === node.id() && now - last.at <= 360 && found) {
        if (found.ref_type === "qa" && found.ref_id) {
          onOpenQARef.current(found.ref_id);
        } else if (found.ref_type === "course" && found.ref_path) {
          onOpenCourseRef.current(found.ref_path);
        } else if (found.ref_type === "file" && found.ref_path) {
          onOpenFileRef.current(found.ref_path);
        }
        return;
      }

      if (viewModeRef.current === "overview") {
        const positions = new Map<number, { x: number; y: number }>();
        cy.nodes().forEach((item) => { positions.set(Number(item.data("nodeId")), { ...item.position() }); });
        overviewPositionsRef.current = positions;
      }
      setViewMode("focus");
      setFocusedNodeId(nodeId);
      setFocusDepth(1);
            setMessage(found ? `已聚焦：${found.title}` : "已聚焦节点");
    });

    cy.on("tap", "edge", (event) => {
      const edgeId = Number(event.target.data("edgeId"));
      const found = graphRef.current.edges.find((item) => item.id === edgeId) ?? null;
      setSelectedEdge(found);
      setSelectedNode(null);
    });

    cy.on("dragfree", "node", (event) => {
      const node = event.target as NodeSingular;
      const nodeId = Number(node.data("nodeId"));
      const position = node.position();
      if (viewModeRef.current === "overview") {
        overviewPositionsRef.current.set(nodeId, { x: position.x, y: position.y });
        updateKnowledgeNode(projectId, nodeId, { x: position.x, y: position.y }).catch(() => undefined);
      }
      scheduleLabelVisibility();
    });

    return () => {
      resizeObserver?.disconnect();
      layoutRunningRef.current = false;
      if (labelPositionFrameRef.current != null) {
        window.cancelAnimationFrame(labelPositionFrameRef.current);
        labelPositionFrameRef.current = null;
      }
      if (labelVisibilityFrameRef.current != null) {
        window.cancelAnimationFrame(labelVisibilityFrameRef.current);
        labelVisibilityFrameRef.current = null;
      }
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      if (resizeSettleTimeoutRef.current != null) {
        window.clearTimeout(resizeSettleTimeoutRef.current);
        resizeSettleTimeoutRef.current = null;
      }
      if (viewportTimeoutRef.current != null) {
        window.clearTimeout(viewportTimeoutRef.current);
        viewportTimeoutRef.current = null;
      }
      scheduleLabelPositionRef.current = () => undefined;
      scheduleLabelVisibilityRef.current = () => undefined;
      labelLayer?.replaceChildren();
      labelElementsRef.current.clear();
      cy.destroy();
      if (cyRef.current === cy) {
        cyRef.current = null;
      }
    };
  }, [projectId, compact]);

  useEffect(() => {
    const cy = cyRef.current;
    const labelLayer = labelLayerRef.current;
    if (!cy || !labelLayer || graphProjectIdRef.current !== projectId) return;

    const previous = renderedGraphRef.current;
    const firstPopulation = previous.nodes.length === 0 && graph.nodes.length > 0;
    const delta = reconcileGraphElements(cy, previous, graph, containerRef.current, darkMode);
    renderedGraphRef.current = graph;
    reconcileLabelElements(graph, labelLayer, labelElementsRef.current);

    for (const removedId of delta.removedNodeIds) overviewPositionsRef.current.delete(removedId);
    for (const addedId of delta.addedNodeIds) {
      const node = cy.getElementById(`n${addedId}`);
      if (!node.empty()) overviewPositionsRef.current.set(addedId, { ...node.position() });
    }

    if (firstPopulation) {
      const allNodesHavePosition = graph.nodes.every((node) => node.x != null && node.y != null);
      if (!allNodesHavePosition && graph.nodes.length > 1) {
        const layout = createCompactOverviewLayout(cy, graph, false);
        layout.one("layoutstop", () => {
          if (cy.destroyed()) return;
          const positions = new Map<number, { x: number; y: number }>();
          cy.nodes().forEach((node) => {
            positions.set(Number(node.data("nodeId")), { ...node.position() });
          });
          overviewPositionsRef.current = positions;
          applyGraphView(cy, graphRef.current, viewModeRef.current, focusedNodeIdRef.current, focusDepthRef.current, {
            animate: false,
            fitViewport: true,
            scheduleViewport: scheduleViewportUpdate,
          });
          scheduleLabelVisibilityRef.current();
        });
        layout.run();
        return;
      }
      overviewPositionsRef.current = new Map(
        graph.nodes
          .filter((node) => node.x != null && node.y != null)
          .map((node) => [node.id, { x: node.x!, y: node.y! }]),
      );
      applyGraphView(cy, graph, viewModeRef.current, focusedNodeIdRef.current, focusDepthRef.current, {
        animate: false,
        fitViewport: true,
        scheduleViewport: scheduleViewportUpdate,
      });
    } else if (delta.topologyChanged) {
      applyGraphView(cy, graph, viewModeRef.current, focusedNodeIdRef.current, focusDepthRef.current, {
        animate: false,
        fitViewport: false,
        scheduleViewport: scheduleViewportUpdate,
      });
    }

    scheduleLabelPositionRef.current();
    scheduleLabelVisibilityRef.current();
  }, [graph, projectId]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || renderedGraphRef.current.nodes.length === 0) return;
    if (layoutRunningRef.current) return;
    const definitions = new Map(
      toElements(renderedGraphRef.current, containerRef.current, darkMode)
        .map((definition) => [String(definition.data?.id), definition]),
    );
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const data = definitions.get(node.id())?.data;
        if (!data) return;
        node.data("color", data.color);
        node.data("borderColor", data.borderColor);
        node.data("size", data.size);
        node.data("accentColor", data.accentColor);
        node.data("focusRootColor", data.focusRootColor);
        node.data("focusParentColor", data.focusParentColor);
      });
      cy.edges().forEach((edge) => {
        const data = definitions.get(edge.id())?.data;
        if (!data) return;
        edge.data("lineColor", data.lineColor);
        edge.data("accentColor", data.accentColor);
      });
    });
    applyGraphView(
      cy,
      renderedGraphRef.current,
      viewModeRef.current,
      focusedNodeIdRef.current,
      focusDepthRef.current,
      { animate: false, fitViewport: false },
    );
    scheduleLabelVisibilityRef.current();
  }, [darkMode]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || renderedGraphRef.current.nodes.length === 0) return;
    if (viewportTimeoutRef.current != null) {
      window.clearTimeout(viewportTimeoutRef.current);
      viewportTimeoutRef.current = null;
    }
    cy.stop();
    applyGraphView(cy, renderedGraphRef.current, viewMode, focusedNodeId, focusDepth, {
      animate: true,
      fitViewport: true,
      scheduleViewport: scheduleViewportUpdate,
    });
    scheduleLabelVisibilityRef.current();
  }, [viewMode, focusedNodeId, focusDepth]);

  useEffect(() => {
    if (selectedNode) {
      setSelectedNode(graph.nodes.find((node) => node.id === selectedNode.id) ?? null);
    }
    if (selectedEdge) {
      setSelectedEdge(graph.edges.find((edge) => edge.id === selectedEdge.id) ?? null);
    }
  }, [graph]);

  async function handleRenameNode() {
    if (!selectedNode) return;
    const title = await onRequestText?.({
      title: "重命名节点",
      label: "节点名称",
      initialValue: selectedNode.title,
      confirmText: "保存",
    });
    if (!title?.trim()) return;
    const updated = await updateKnowledgeNode(projectId, selectedNode.id, { title: title.trim() });
    setSelectedNode(updated);
    await notifyGraphChanged();
  }

  async function handleDeleteSelected() {
    if (selectedNode) {
      if (onConfirm) {
        const ok = await onConfirm("删除节点", `删除节点 "${selectedNode.title}"？`, { confirmText: "删除", danger: true });
        if (!ok) return;
      }
      await deleteKnowledgeNode(projectId, selectedNode.id);
      if (focusedNodeId === selectedNode.id) {
        setViewMode("overview");
        setFocusedNodeId(null);
      }
      setSelectedNode(null);
      await notifyGraphChanged();
      await onContentChanged?.();
      return;
    }
    if (selectedEdge) {
      if (onConfirm) {
        const ok = await onConfirm("删除关系", "删除当前选中的关系？", { confirmText: "删除", danger: true });
        if (!ok) return;
      }
      await deleteKnowledgeEdge(projectId, selectedEdge.id);
      setSelectedEdge(null);
      await notifyGraphChanged();
    }
  }

  function handleOverview() {
    const cy = cyRef.current;
    if (cy && overviewPositionsRef.current.size) {
      cy.nodes().forEach((node) => {
        const position = overviewPositionsRef.current.get(Number(node.data("nodeId")));
        if (position) node.position(position);
      });
    }
    setViewMode("overview");
    setFocusedNodeId(null);
    setSelectedEdge(null);
    setMessage("已切换到全览");
  }

  function handleArrangeOverview() {
    const cy = cyRef.current;
    setViewMode("overview");
    setFocusedNodeId(null);
    setSelectedEdge(null);

    if (!cy || graphRef.current.nodes.length === 0) {
      return;
    }

    if (viewportTimeoutRef.current != null) {
      window.clearTimeout(viewportTimeoutRef.current);
      viewportTimeoutRef.current = null;
    }
    cy.stop();
    layoutRunningRef.current = true;
    cy.elements().removeClass("graph-hidden focus-root focus-parent focus-child focus-edge");
    const layout = createCompactOverviewLayout(cy, graphRef.current);
    layout.one("layoutstop", () => {
      if (cy.destroyed()) return;
      layoutRunningRef.current = false;
      const updates: Promise<unknown>[] = [];
      cy.nodes().forEach((node) => {
        const nodeId = Number(node.data("nodeId"));
        const position = node.position();
        overviewPositionsRef.current.set(nodeId, { x: position.x, y: position.y });
        updates.push(updateKnowledgeNode(projectId, nodeId, { x: position.x, y: position.y }));
      });
      if (viewModeRef.current === "overview") {
        fitVisible(cy, graphRef.current, "overview", null, 1, true);
      } else {
        applyGraphView(
          cy,
          graphRef.current,
          viewModeRef.current,
          focusedNodeIdRef.current,
          focusDepthRef.current,
          { animate: false, fitViewport: true, scheduleViewport: scheduleViewportUpdate },
        );
      }
      scheduleLabelVisibilityRef.current();
      void Promise.allSettled(updates).then((results) => {
        const failedCount = results.filter((result) => result.status === "rejected").length;
        setMessage(failedCount > 0 ? `树状布局已生成，但有 ${failedCount} 个节点的位置保存失败` : "已整理为树状布局并保存");
      });
    });
    layout.run();
  }

  return (
    <div
      ref={viewerRef}
      className={`knowledge-viewer ${compact ? "compact" : ""}`}
      onPointerEnter={() => { pointerInsideRef.current = true; }}
      onPointerLeave={() => { pointerInsideRef.current = false; }}
    >
      <div className="viewer-header">
        <span>知识网络</span>
        <div className="viewer-actions">
          <button className={`secondary-button compact ${viewMode === "overview" ? "active" : ""}`} onClick={handleOverview}>全览</button>
          <button className="secondary-button compact" onClick={handleArrangeOverview} disabled={graph.nodes.length < 2} title="按父子关系整理为树状布局并保存节点位置">整理</button>
          <button
            className={`secondary-button compact ${connectMode ? "active" : ""}`}
            onClick={() => {
              setRelationType("explains");
              setConnectMode((value) => !value);
              setConnectSourceId(null);
              setMessage(connectMode ? "" : "请选择源节点");
            }}
          >
            连线
          </button>
          <button className="secondary-button compact" onClick={handleRenameNode} disabled={!selectedNode}>重命名</button>
          <button className="secondary-button compact danger" onClick={handleDeleteSelected} disabled={!selectedNode && !selectedEdge}>删除</button>
        </div>
      </div>
      <div className="knowledge-body">
        <div className="knowledge-canvas-shell">
          <div ref={containerRef} className="knowledge-canvas" />
          <div ref={labelLayerRef} className="knowledge-label-layer" aria-hidden="true" />
          {searchOpen ? (
            <div className="knowledge-search" role="search">
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索节点"
                aria-label="搜索知识网络节点"
              />
              <button className="icon-button" onClick={() => { setSearchOpen(false); setSearchQuery(""); }} aria-label="关闭搜索">×</button>
              {searchQuery.trim() ? (
                <div className="knowledge-search-results">
                  {graph.nodes
                    .filter((node) => node.title.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase()))
                    .slice(0, 8)
                    .map((node) => (
                      <button
                        key={node.id}
                        onClick={() => {
                          setSelectedNode(node);
                          setSelectedEdge(null);
                          setFocusedNodeId(node.id);
                          setFocusDepth(1);
                          setViewMode("focus");
                          setSearchOpen(false);
                        }}
                      >{node.title}</button>
                    ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {graph.nodes.length === 0 ? (
            <div className="knowledge-empty-overlay">
              {message ? (
                <>
                  <strong>加载失败</strong>
                  <span>{message}</span>
                  <button className="secondary-button compact" onClick={() => { setMessage(""); reload(); }}>重试</button>
                </>
              ) : (
                <>
                  <strong>还没有知识节点</strong>
                  <span>AI 助手会根据你的提问自动提取和连接知识点。在助手面板中提问后，知识点会出现在这里。</span>
                </>
              )}
            </div>
          ) : null}
        </div>
        {selectedNode || selectedEdge || (message && graph.nodes.length > 0) ? <aside className="knowledge-inspector open">
          {selectedNode ? (
            <>
              <strong>{selectedNode.title}</strong>
              <span>类型：{selectedNode.node_type}</span>
              {selectedNode.ref_path ? <span>路径：{selectedNode.ref_path}</span> : null}
              {selectedNode.summary ? <p>{selectedNode.summary}</p> : null}
            </>
          ) : selectedEdge ? (
            <>
              <strong>{selectedEdge.label || RELATION_LABELS[selectedEdge.relation_type] || selectedEdge.relation_type}</strong>
              <span>关系：{selectedEdge.relation_type}</span>
              <span>{selectedEdge.source_node_id} → {selectedEdge.target_node_id}</span>
            </>
          ) : (
            <span>单击节点聚焦一跳关系，双击打开对应回答、课件或代码。</span>
          )}
          {message ? <small>{message}</small> : null}
        </aside> : null}
      </div>
    </div>
  );
}
