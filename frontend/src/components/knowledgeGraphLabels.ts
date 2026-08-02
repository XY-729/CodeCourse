import type { Core } from "cytoscape";
import type { KnowledgeGraph } from "../api/client";
import { getKnowledgeGraphIndex, getKnowledgeNeighborhood } from "./knowledgeGraphModel";

export type LabelOverlayState = {
  viewMode: "overview" | "focus";
  focusedNodeId: number | null;
  focusDepth: 1 | 2;
  selectedNodeId: number | null;
  hoveredNodeId: number | null;
  searchQuery: string;
};

export type LabelMetrics = Map<number, { width: number; height: number }>;

let labelMeasureContext: CanvasRenderingContext2D | null | undefined;

function measureLabelText(text: string): { width: number; height: number } {
  if (labelMeasureContext === undefined) {
    const canMeasure = typeof document !== "undefined"
      && !(typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent));
    const canvas = canMeasure ? document.createElement("canvas") : null;
    labelMeasureContext = canvas?.getContext("2d") ?? null;
    if (labelMeasureContext) labelMeasureContext.font = "600 13px system-ui, sans-serif";
  }
  const measuredWidth = labelMeasureContext?.measureText(text).width ?? text.length * 7.2;
  const width = Math.min(176, Math.max(48, Math.ceil(measuredWidth + 22)));
  return {
    width,
    height: measuredWidth + 22 > 176 ? 38 : 22,
  };
}

export function reconcileLabelElements(
  graph: KnowledgeGraph,
  layer: HTMLDivElement,
  labels: Map<number, HTMLDivElement>,
) {
  const changedIds = new Set<number>();
  const activeIds = new Set(graph.nodes.map((node) => node.id));
  for (const [id, label] of labels) {
    if (activeIds.has(id)) continue;
    label.remove();
    labels.delete(id);
  }
  for (const node of graph.nodes) {
    let label = labels.get(node.id);
    if (!label) {
      label = document.createElement("div");
      label.className = "knowledge-node-label";
      label.dataset.visible = "true";
      label.dataset.inViewport = "true";
      layer.appendChild(label);
      labels.set(node.id, label);
      changedIds.add(node.id);
    }
    if (label.textContent !== node.title) {
      label.textContent = node.title;
      changedIds.add(node.id);
    }
  }
  return changedIds;
}

export function measureLabelElements(
  labels: Map<number, HTMLDivElement>,
  metrics: LabelMetrics,
  ids?: Iterable<number>,
) {
  const targets = ids ? [...ids] : [...labels.keys()];
  for (const id of targets) {
    const label = labels.get(id);
    if (!label) {
      metrics.delete(id);
      continue;
    }
    metrics.set(id, measureLabelText(label.textContent ?? ""));
  }
}

export function positionLabelOverlay(
  cy: Core,
  _graph: KnowledgeGraph,
  labels: Map<number, HTMLDivElement>,
) {
  const viewportWidth = cy.width();
  const viewportHeight = cy.height();
  for (const [nodeId, label] of labels) {
    if (label.dataset.visible === "false") {
      continue;
    }
    const node = cy.getElementById(`n${nodeId}`);
    const graphHidden = node.empty() || node.hasClass("graph-hidden") || node.hasClass("hover-dim");
    if (graphHidden) {
      label.dataset.visible = "false";
      continue;
    }
    if (node.empty()) continue;
    const rendered = node.renderedPosition();
    const y = rendered.y + node.renderedOuterHeight() / 2 + 7;
    const outsideViewport = rendered.x < -190
      || rendered.x > viewportWidth + 190
      || y < -48
      || y > viewportHeight + 48;
    label.dataset.inViewport = outsideViewport ? "false" : "true";
    label.style.transform = `translate3d(${rendered.x}px, ${y}px, 0) translateX(-50%)`;
  }
}

export function updateLabelVisibility(
  cy: Core,
  graph: KnowledgeGraph,
  labels: Map<number, HTMLDivElement>,
  state: LabelOverlayState,
  metrics: LabelMetrics = new Map(),
) {
  const { degreeById } = getKnowledgeGraphIndex(graph);
  const query = state.searchQuery.trim().toLocaleLowerCase();
  const focusedNodeIds = state.viewMode === "focus" && state.focusedNodeId != null
    ? getKnowledgeNeighborhood(graph, state.focusedNodeId, state.focusDepth).nodeIds
    : null;
  const candidates: Array<{
    id: number;
    element: HTMLDivElement;
    x: number;
    y: number;
    width: number;
    height: number;
    priority: number;
  }> = [];

  for (const graphNode of graph.nodes) {
    const node = cy.getElementById(`n${graphNode.id}`);
    const label = labels.get(graphNode.id);
    if (!label) continue;
    if (
      node.empty()
      || (focusedNodeIds != null && !focusedNodeIds.has(graphNode.id))
      || node.hasClass("graph-hidden")
      || (node.hasClass("hover-dim") && graphNode.id !== state.focusedNodeId)
    ) {
      label.dataset.visible = "false";
      label.classList.remove("important", "matched");
      continue;
    }
    const rendered = node.renderedPosition();
    const y = rendered.y + node.renderedOuterHeight() / 2 + 7;
    const important = graphNode.id === state.focusedNodeId
      || graphNode.id === state.selectedNodeId
      || graphNode.id === state.hoveredNodeId;
    const matched = Boolean(query && graphNode.title.toLocaleLowerCase().includes(query));
    label.dataset.visible = "true";
    label.classList.toggle("important", important);
    label.classList.toggle("matched", matched);
    const measured = metrics.get(graphNode.id);
    const width = measured?.width ?? Math.min(176, Math.max(48, graphNode.title.length * 7.2));
    const height = measured?.height ?? (graphNode.title.length > 20 ? 38 : 22);
    candidates.push({
      id: graphNode.id,
      element: label,
      x: rendered.x,
      y,
      width,
      height,
      priority: (important ? 1000 : 0) + (matched ? 800 : 0) + (degreeById.get(graphNode.id) ?? 0) * 10,
    });
  }

  const readableLabelCapacity = Math.max(12, Math.floor((cy.width() * cy.height()) / 12_000));
  if (candidates.length > readableLabelCapacity) {
    const cellSize = 104;
    const occupied = new Map<string, typeof candidates>();
    const sorted = [...candidates].sort((left, right) => right.priority - left.priority || left.id - right.id);
    for (const candidate of sorted) {
      const minCellX = Math.floor((candidate.x - candidate.width / 2 - 6) / cellSize);
      const maxCellX = Math.floor((candidate.x + candidate.width / 2 + 6) / cellSize);
      const minCellY = Math.floor((candidate.y - candidate.height / 2 - 4) / cellSize);
      const maxCellY = Math.floor((candidate.y + candidate.height / 2 + 4) / cellSize);
      let overlaps = false;
      for (let cellX = minCellX; cellX <= maxCellX && !overlaps; cellX += 1) {
        for (let cellY = minCellY; cellY <= maxCellY && !overlaps; cellY += 1) {
          for (const item of occupied.get(`${cellX}:${cellY}`) ?? []) {
            if (
              Math.abs(item.x - candidate.x) < (item.width + candidate.width) / 2 + 6
              && Math.abs(item.y - candidate.y) < (item.height + candidate.height) / 2 + 4
            ) {
              overlaps = true;
              break;
            }
          }
        }
      }
      if (overlaps && candidate.priority < 800) {
        candidate.element.dataset.visible = "false";
        continue;
      }
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
          const key = `${cellX}:${cellY}`;
          const bucket = occupied.get(key) ?? [];
          bucket.push(candidate);
          occupied.set(key, bucket);
        }
      }
    }
  }
  positionLabelOverlay(cy, graph, labels);
}
