import type { Core } from "cytoscape";
import type { KnowledgeGraph } from "../api/client";
import { getKnowledgeNeighborhood } from "./knowledgeGraphModel";

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
    const node = cy.getElementById(`n${nodeId}`);
    const graphHidden = node.empty() || node.hasClass("graph-hidden") || node.hasClass("hover-dim");
    if (graphHidden) {
      // Logical visibility belongs to updateLabelVisibility().  A render pass
      // may run halfway through a focus/overview animation, so mutating it here
      // can otherwise turn a transient hidden class into permanent label state.
      label.dataset.inViewport = "false";
      continue;
    }
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
  _metrics: LabelMetrics = new Map(),
) {
  const query = state.searchQuery.trim().toLocaleLowerCase();
  const focusedNodeIds = state.viewMode === "focus" && state.focusedNodeId != null
    ? getKnowledgeNeighborhood(graph, state.focusedNodeId, state.focusDepth).nodeIds
    : null;

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
  }
  positionLabelOverlay(cy, graph, labels);
}
