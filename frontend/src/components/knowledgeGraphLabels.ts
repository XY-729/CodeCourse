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

export function reconcileLabelElements(
  graph: KnowledgeGraph,
  layer: HTMLDivElement,
  labels: Map<number, HTMLDivElement>,
) {
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
      layer.appendChild(label);
      labels.set(node.id, label);
    }
    if (label.textContent !== node.title) label.textContent = node.title;
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
      label.hidden = true;
      continue;
    }
    const node = cy.getElementById(`n${nodeId}`);
    const graphHidden = node.empty() || node.hasClass("graph-hidden") || node.hasClass("hover-dim");
    label.hidden = graphHidden;
    if (node.empty()) continue;
    const rendered = node.renderedPosition();
    const y = rendered.y + node.renderedOuterHeight() / 2 + 7;
    const outsideViewport = rendered.x < -190
      || rendered.x > viewportWidth + 190
      || y < -48
      || y > viewportHeight + 48;
    label.hidden = graphHidden || outsideViewport;
    label.style.transform = `translate3d(${rendered.x}px, ${y}px, 0) translateX(-50%)`;
  }
}

export function updateLabelVisibility(
  cy: Core,
  graph: KnowledgeGraph,
  labels: Map<number, HTMLDivElement>,
  state: LabelOverlayState,
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
    const rect = label.getBoundingClientRect();
    const width = rect.width || Math.min(176, Math.max(48, graphNode.title.length * 7.2));
    const height = rect.height || (graphNode.title.length > 20 ? 38 : 22);
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
