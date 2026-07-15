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

type Props = {
  projectId: number;
  refreshKey?: number;
  onOpenQA: (qaId: number) => void;
  onOpenCourse: (path: string) => void;
  onOpenFile: (path: string) => void;
  onContentChanged?: () => void | Promise<void>;
  compact?: boolean;
  onRequestText?: (options: { title: string; label?: string; initialValue?: string; placeholder?: string; confirmText?: string }) => Promise<string | null>;
  onConfirm?: (title: string, message: string, options?: { confirmText?: string; danger?: boolean }) => Promise<boolean>;
};

type RelationType = "explains" | "parent_of" | "related_to" | "references";
type ViewMode = "overview" | "focus";

type NodeVisual = { size: number; fontSize: number; color: string; borderColor: string };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function nodeVisuals(graph: KnowledgeGraph, container: HTMLElement | null): Map<number, NodeVisual> {
  const metrics = new Map<number, { incoming: number; outgoing: number }>();
  for (const node of graph.nodes) {
    metrics.set(node.id, { incoming: 0, outgoing: 0 });
  }
  for (const edge of graph.edges) {
    metrics.get(edge.source_node_id)!.outgoing += 1;
    metrics.get(edge.target_node_id)!.incoming += 1;
  }

  const minDimension = Math.min(container?.clientWidth ?? 900, container?.clientHeight ?? 680);
  const density = clamp(Math.sqrt(12 / Math.max(1, graph.nodes.length)), 0.7, 1.18);
  // 目标尺寸按当前容器计算；紧凑侧栏也保留足够大的最低节点尺寸。
  const baseSize = clamp(minDimension * 0.06 * density, 52, 76);
  const sizeSteps = [1, 1.28, 1.62, 2, 2.4, 2.82];
  const colorSteps = [
    { color: "#ffffff", borderColor: "#98a5b5" },
    { color: "#3aa76d", borderColor: "#238653" },
    { color: "#3b82e6", borderColor: "#2563c9" },
    { color: "#8b5cf6", borderColor: "#7041d0" },
    { color: "#f59e0b", borderColor: "#c67b00" },
    { color: "#e54b4b", borderColor: "#b92d35" },
  ];

  return new Map(
    graph.nodes.map((node) => {
      const metric = metrics.get(node.id)!;
      const degree = metric.incoming + metric.outgoing;
      const level = Math.min(5, degree);
      const size = Math.round(baseSize * sizeSteps[level]);
      const color = colorSteps[level];
      // 标签的字号不随节点或全览缩放而缩小，保证名称始终可读。
      return [node.id, { size, fontSize: 15, ...color }];
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
    rootFont: Math.round(clamp(dim * 0.026, 16, 22)),
    parentFont: Math.round(clamp(dim * 0.019, 13, 17)),
    childFont: Math.round(clamp(dim * 0.017, 12, 15)),
  };
}

const LAYOUT_PADDING = 58;
const ANIMATION_MS = 360;
const FOCUS_SECONDARY_FIT_DELAY_MS = 180;

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

function toElements(graph: KnowledgeGraph, container: HTMLElement | null): ElementDefinition[] {
  const visuals = nodeVisuals(graph, container);

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
          fontSize: visual.fontSize,
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
      },
    })),
  ];
}

function directNeighborhood(graph: KnowledgeGraph, focusedNodeId: number) {
  const nodeIds = new Set<number>([focusedNodeId]);
  const edgeIds = new Set<number>();
  for (const edge of graph.edges) {
    if (edge.source_node_id === focusedNodeId || edge.target_node_id === focusedNodeId) {
      edgeIds.add(edge.id);
      nodeIds.add(edge.source_node_id);
      nodeIds.add(edge.target_node_id);
    }
  }
  return { nodeIds, edgeIds };
}

function arrangeFocusNeighborhood(cy: Core, graph: KnowledgeGraph, focusedNodeId: number, animate: boolean) {
  const { nodeIds } = directNeighborhood(graph, focusedNodeId);
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
  const radius = Math.max(240, 176 + neighbors.length * 34);
  const startAngle = neighbors.length === 1 ? -0.1 : -Math.PI / 2;
  const moveNode = (node: NodeSingular, position: { x: number; y: number }) => {
    node.stop();
    if (animate) {
      node.animate({ position }, { duration: ANIMATION_MS, easing: "ease-in-out-cubic" });
    } else {
      node.position(position);
    }
  };
  moveNode(centerNode, center);
  neighbors.forEach((node, index) => {
    const angle = startAngle + (Math.PI * 2 * index) / neighbors.length;
    moveNode(node, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  });
  return radius;
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
    window.setTimeout(() => !cy.destroyed() && syncFixedLabelScale(cy), ANIMATION_MS + 24);
  } else {
    cy.zoom(zoom);
    cy.pan(pan);
    syncFixedLabelScale(cy);
  }
}

function scheduleViewport(cy: Core, graph: KnowledgeGraph, mode: ViewMode, focusedNodeId: number | null, focusRadius?: number) {
  window.setTimeout(() => {
    if (cy.destroyed()) return;
    cy.resize();
    if (mode === "focus" && focusedNodeId && focusRadius) {
      focusViewport(cy, focusedNodeId, focusRadius, true);
    } else {
      fitVisible(cy, graph, mode, focusedNodeId, true);
    }
  }, FOCUS_SECONDARY_FIT_DELAY_MS);
}

function fitVisible(cy: Core, graph: KnowledgeGraph, mode: ViewMode, focusedNodeId: number | null, animate: boolean) {
  let fitElements = cy.elements().filter((element) => !element.hasClass("graph-hidden"));
  let padding = LAYOUT_PADDING;
  if (mode === "focus" && focusedNodeId) {
    const { nodeIds, edgeIds } = directNeighborhood(graph, focusedNodeId);
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
    // `fit` 动画最后一帧会写回默认缩放样式；动画结束后再次补偿，避免
    // 节点先变大、随后又缩回去。
    window.setTimeout(() => !cy.destroyed() && syncFixedLabelScale(cy), ANIMATION_MS + 24);
  } else {
    cy.fit(fitElements, padding);
    syncFixedLabelScale(cy);
  }
}

// Cytoscape 的标签会和画布一起缩放。反向补偿字号和标签宽度后，文字在
// 屏幕上保持稳定可读，而不是在全览时缩成几个像素。
function syncFixedLabelScale(cy: Core) {
  const zoom = Math.max(cy.zoom(), 0.05);
  cy.nodes().forEach((node) => {
    const screenFont = node.hasClass("focus-root") ? 18 : node.hasClass("focus-parent") ? 16 : 15;
    const screenSize = Number(node.data("displaySize") ?? node.data("size") ?? 40);
    node.style({
      width: screenSize / zoom,
      height: screenSize / zoom,
      "font-size": screenFont / zoom,
      "text-max-width": 124 / zoom,
      "text-margin-y": 10 / zoom,
      "text-background-padding": 2 / zoom,
    });
  });
}

function applyGraphView(cy: Core, graph: KnowledgeGraph, mode: ViewMode, focusedNodeId: number | null, animate = true) {
  cy.elements().removeClass("graph-hidden focus-root focus-parent focus-child focus-edge");
  const overview = nodeVisuals(graph, cy.container());
  cy.nodes().forEach((node) => {
    const visual = overview.get(Number(node.data("nodeId")));
    if (visual) {
      node.data("displaySize", visual.size);
      node.style({ width: visual.size, height: visual.size, "font-size": visual.fontSize });
    }
  });

  if (mode === "focus" && focusedNodeId) {
    const { nodeIds, edgeIds } = directNeighborhood(graph, focusedNodeId);
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
        node.style({ width: sizes.root, height: sizes.root, "font-size": sizes.rootFont });
      } else if (parentIds.has(nodeId)) {
        node.addClass("focus-parent");
        node.data("displaySize", sizes.parent);
        node.style({ width: sizes.parent, height: sizes.parent, "font-size": sizes.parentFont });
      } else {
        node.addClass("focus-child");
        node.data("displaySize", sizes.child);
        node.style({ width: sizes.child, height: sizes.child, "font-size": sizes.childFont });
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
    const focusRadius = arrangeFocusNeighborhood(cy, graph, focusedNodeId, animate);
    syncFixedLabelScale(cy);
    if (focusRadius != null) {
      window.setTimeout(() => focusViewport(cy, focusedNodeId, focusRadius, true), animate ? ANIMATION_MS : 0);
      scheduleViewport(cy, graph, mode, focusedNodeId, focusRadius);
    }
    return;
  }

  syncFixedLabelScale(cy);
  fitVisible(cy, graph, mode, focusedNodeId, animate);
  scheduleViewport(cy, graph, mode, focusedNodeId);
}

function placeAlongArc(count: number, middle: number, spread: number) {
  if (count <= 1) return [middle];
  return Array.from({ length: count }, (_, index) => middle - spread / 2 + (spread * index) / (count - 1));
}

function resolvePositionCollisions(graph: KnowledgeGraph, positions: Map<number, { x: number; y: number }>) {
  const degree = new Map<number, number>();
  for (const node of graph.nodes) degree.set(node.id, 0);
  for (const edge of graph.edges) {
    degree.set(edge.source_node_id, (degree.get(edge.source_node_id) ?? 0) + 1);
    degree.set(edge.target_node_id, (degree.get(edge.target_node_id) ?? 0) + 1);
  }

  // 保持高连接节点更稳定，迭代推离所有过近的节点，给圆点和标题都留下空间。
  for (let iteration = 0; iteration < 90; iteration += 1) {
    let moved = false;
    for (let first = 0; first < graph.nodes.length; first += 1) {
      for (let second = first + 1; second < graph.nodes.length; second += 1) {
        const a = graph.nodes[first];
        const b = graph.nodes[second];
        const positionA = positions.get(a.id);
        const positionB = positions.get(b.id);
        if (!positionA || !positionB) continue;
        let dx = positionB.x - positionA.x;
        let dy = positionB.y - positionA.y;
        let distance = Math.hypot(dx, dy);
        const requiredDistance = 118 + Math.min(70, ((degree.get(a.id) ?? 0) + (degree.get(b.id) ?? 0)) * 10);
        if (distance >= requiredDistance) continue;
        if (distance < 0.001) {
          const angle = ((a.id * 37 + b.id * 17) % 360) * (Math.PI / 180);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const push = (requiredDistance - distance) / 2;
        const massA = 1 + (degree.get(a.id) ?? 0) * 0.75;
        const massB = 1 + (degree.get(b.id) ?? 0) * 0.75;
        const unitX = dx / distance;
        const unitY = dy / distance;
        positionA.x -= unitX * push * (massB / (massA + massB));
        positionA.y -= unitY * push * (massB / (massA + massB));
        positionB.x += unitX * push * (massA / (massA + massB));
        positionB.y += unitY * push * (massA / (massA + massB));
        moved = true;
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

function createCompactOverviewLayout(cy: Core, graph: KnowledgeGraph) {
  const positions = createHubBranchPositions(graph);
  if (positions.size === graph.nodes.length && graph.nodes.length > 1) {
    // `preset` 的函数回调在不同 Cytoscape 版本中传入的 ID 形式不完全一致。
    // 使用显式坐标表并同时保留元素 ID/业务 ID，避免回退到 (0, 0) 导致节点重叠。
    const positionMap: Record<string, { x: number; y: number }> = {};
    for (const [nodeId, position] of positions) {
      positionMap[`n${nodeId}`] = position;
      positionMap[String(nodeId)] = position;
    }
    return cy.layout({
      name: "preset",
      fit: false,
      animate: true,
      animationDuration: 500,
      animationEasing: "ease-in-out-cubic",
      positions: positionMap,
      padding: LAYOUT_PADDING,
    });
  }

  return cy.layout({
    name: "cose",
    fit: false,
    animate: true,
    animationDuration: 550,
    randomize: true,
    nodeRepulsion: 6000,
    idealEdgeLength: 85,
    edgeElasticity: 100,
    gravity: 0.35,
    componentSpacing: 150,
    nestingFactor: 1.1,
    numIter: 1000,
    initialTemp: 180,
    coolingFactor: 0.95,
    minTemp: 1,
  });
}


export default function KnowledgeGraphViewer({ projectId, refreshKey = 0, compact = false, onRequestText, onConfirm, onOpenQA, onOpenCourse, onOpenFile, onContentChanged }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const lastTapRef = useRef<{ id: string; at: number } | null>(null);
  const graphRef = useRef<KnowledgeGraph>({ nodes: [], edges: [] });
  const connectModeRef = useRef(false);
  const connectSourceIdRef = useRef<number | null>(null);
  const viewModeRef = useRef<ViewMode>("overview");
  const focusedNodeIdRef = useRef<number | null>(null);
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
  const [message, setMessage] = useState("");

  async function reload() {
    const next = await getKnowledgeGraph(projectId);
    setGraph(next);
  }

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  useEffect(() => {
    connectModeRef.current = connectMode;
    connectSourceIdRef.current = connectSourceId;
  }, [connectMode, connectSourceId]);

  useEffect(() => {
    viewModeRef.current = viewMode;
    focusedNodeIdRef.current = focusedNodeId;
  }, [viewMode, focusedNodeId]);

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
    reload().catch((error) => setMessage(error instanceof Error ? error.message : "加载知识网络失败"));
  }, [projectId, refreshKey]);

  useEffect(() => {
    if (viewMode === "focus" && focusedNodeId && !graph.nodes.some((node) => node.id === focusedNodeId)) {
      setViewMode("overview");
      setFocusedNodeId(null);
    }
  }, [graph, viewMode, focusedNodeId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    cyRef.current?.destroy();
    const cy = cytoscape({
      container,
      elements: toElements(graph, container),
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            label: "data(label)",
            color: "#1f2937",
            "font-size": "data(fontSize)",
            "text-wrap": "wrap",
            "text-max-width": "116px",
            "text-valign": "bottom",
            "text-halign": "center",
            "text-margin-y": 10,
            "text-background-color": "#f8fafb",
            "text-background-opacity": 0.92,
            "text-background-padding": "2px",
            "text-background-shape": "roundrectangle",
            "text-outline-color": "#f8fafb",
            "text-outline-width": 2,
            "border-width": 2,
            "border-color": "data(borderColor)",
            width: "data(size)",
            height: "data(size)",
            opacity: 1,
            "transition-property": "width height opacity border-width font-size text-margin-y",
            "transition-duration": 220,
            "transition-timing-function": "ease-in-out-cubic",
          },
        },
        {
          selector: "node.focus-root",
          style: {
            "text-max-width": "140px",
            "border-color": "#174c43",
            "border-width": 5,
            "text-margin-y": 14,
          },
        },
        {
          selector: "node.focus-parent",
          style: {
            "text-max-width": "120px",
            "text-margin-y": 12,
            "border-color": "#75998e",
            "border-width": 3,
            opacity: 0.95,
          },
        },
        {
          selector: "node.focus-child",
          style: {
            "text-max-width": "102px",
            "text-margin-y": 10,
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
            "border-color": "#174c43",
            "border-width": 4,
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "#9aa7b8",
            "target-arrow-color": "#9aa7b8",
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
            "line-color": "#25766c",
            "target-arrow-color": "#25766c",
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
            "line-color": "#25766c",
            "target-arrow-color": "#25766c",
            width: 3,
            "z-index": 12,
          },
        },
      ],
      layout: { name: "preset", fit: false },
      wheelSensitivity: 0.2,
      // 侧栏图谱不允许 fit 动画把节点和标签缩到不可阅读的大小。
      minZoom: compact ? 0.9 : 0.55,
      maxZoom: 3,
    });
    cyRef.current = cy;
    cy.on("zoom", () => syncFixedLabelScale(cy));

    const allNodesHavePosition = graph.nodes.length > 0 && graph.nodes.every((node) => node.x != null && node.y != null);
    if (!allNodesHavePosition && graph.nodes.length > 1) {
      cy.layout({
        name: "cose",
        fit: false,
        animate: true,
        animationDuration: 560,
        randomize: true,
        nodeRepulsion: 20000,
        idealEdgeLength: 145,
        edgeElasticity: 90,
        nestingFactor: 1.2,
        gravity: 0.06,
        numIter: 1200,
        initialTemp: 220,
        coolingFactor: 0.92,
        minTemp: 1,
        avoidOverlap: true,
        componentSpacing: 300,
        padding: LAYOUT_PADDING,
      }).run();
      window.setTimeout(() => applyGraphView(cy, graphRef.current, viewModeRef.current, focusedNodeIdRef.current, true), 620);
    } else {
      cy.layout({ name: "preset", fit: false }).run();
      window.setTimeout(() => applyGraphView(cy, graphRef.current, viewModeRef.current, focusedNodeIdRef.current, false), 0);
    }

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
          await reload();
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

      setViewMode("focus");
      setFocusedNodeId(nodeId);
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
      updateKnowledgeNode(projectId, nodeId, { x: position.x, y: position.y }).catch(() => undefined);
    });

    return () => {
      cy.destroy();
      if (cyRef.current === cy) {
        cyRef.current = null;
      }
    };
  }, [graph, projectId]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    applyGraphView(cy, graph, viewMode, focusedNodeId, true);
  }, [graph, viewMode, focusedNodeId]);

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
    await reload();
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
      await reload();
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
      await reload();
    }
  }

  function handleOverview() {
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

    cy.elements().removeClass("graph-hidden focus-root focus-parent focus-child focus-edge");
    const layout = createCompactOverviewLayout(cy, graphRef.current);
    layout.one("layoutstop", () => {
      if (cy.destroyed()) return;
      fitVisible(cy, graphRef.current, "overview", null, true);
      const updates: Promise<unknown>[] = [];
      cy.nodes().forEach((node) => {
        const nodeId = Number(node.data("nodeId"));
        const position = node.position();
        updates.push(updateKnowledgeNode(projectId, nodeId, { x: position.x, y: position.y }));
      });
      void Promise.allSettled(updates).then((results) => {
        const failedCount = results.filter((result) => result.status === "rejected").length;
        setMessage(failedCount > 0 ? `布局已整理，但有 ${failedCount} 个节点的位置保存失败` : "已整理并保存全览布局");
      });
    });
    layout.run();
  }

  return (
    <div className={`knowledge-viewer ${compact ? "compact" : ""}`}>
      <div className="viewer-header">
        <span>知识网络</span>
        <div className="viewer-actions">
          <button className={`secondary-button compact ${viewMode === "overview" ? "active" : ""}`} onClick={handleOverview}>全览</button>
          <button className="secondary-button compact" onClick={handleArrangeOverview} disabled={graph.nodes.length < 2} title="重新计算紧凑布局并保存节点位置">整理</button>
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
        <div ref={containerRef} className="knowledge-canvas" />
        <aside className="knowledge-inspector">
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
        </aside>
      </div>
    </div>
  );
}
