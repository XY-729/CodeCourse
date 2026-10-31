import type { Core } from "cytoscape";
import type { KnowledgeGraph } from "../../api/client";
import { getKnowledgeNeighborhood } from "./knowledgeGraphModel";

export type LabelOverlayState = {
  viewMode: "overview" | "focus";
  focusedNodeId: number | null;
  focusDepth: number;
  selectedNodeId: number | null;
  hoveredNodeId: number | null;
  searchQuery: string;
  textFade?: number;
};

export type LabelMetrics = Map<number, { width: number; height: number }>;

const visibilityCache = new WeakMap<Map<number, HTMLDivElement>, { graph: KnowledgeGraph; key: string; count: number }>();

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
  visibilityCache.delete(labels);
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
    const graphHidden = node.empty() || node.hasClass("graph-hidden");
    if (graphHidden) {
      // Logical visibility belongs to updateLabelVisibility().  A render pass
      // may run halfway through a focus/overview animation, so mutating it here
      // can otherwise turn a transient hidden class into permanent label state.
      if (label.dataset.inViewport !== "false") label.dataset.inViewport = "false";
      continue;
    }
    if (label.style.opacity === "0") continue;
    const rendered = node.renderedPosition();
    const y = rendered.y + node.renderedOuterHeight() / 2 + 3;
    const outsideViewport = rendered.x < -190
      || rendered.x > viewportWidth + 190
      || y < -48
      || y > viewportHeight + 48;
    const inViewport = outsideViewport ? "false" : "true";
    if (label.dataset.inViewport !== inViewport) label.dataset.inViewport = inViewport;
    if (outsideViewport) continue;
    const transform = `translate3d(${Math.round(rendered.x * 10) / 10}px, ${Math.round(y * 10) / 10}px, 0) translateX(-50%)`;
    if (label.style.transform !== transform) label.style.transform = transform;
  }
}

export function updateLabelVisibility(
  cy: Core,
  graph: KnowledgeGraph,
  labels: Map<number, HTMLDivElement>,
  state: LabelOverlayState,
  _metrics: LabelMetrics = new Map(),
) {
  const zoom = typeof cy.zoom === "function" ? cy.zoom() : 1;
  const key = JSON.stringify([state.viewMode, state.focusedNodeId, state.focusDepth, state.selectedNodeId, state.hoveredNodeId, state.searchQuery, state.textFade, zoom]);
  const cached = visibilityCache.get(labels);
  if (cached?.graph === graph && cached.key === key && cached.count === labels.size) {
    positionLabelOverlay(cy, graph, labels);
    return;
  }
  visibilityCache.set(labels, { graph, key, count: labels.size });
  const query = state.searchQuery.trim().toLocaleLowerCase();
  const focusedNodeExists = state.focusedNodeId != null
    && graph.nodes.some((node) => node.id === state.focusedNodeId);
  const focusedNodeIds = state.viewMode === "focus" && state.focusedNodeId != null && focusedNodeExists
    ? getKnowledgeNeighborhood(graph, state.focusedNodeId, state.focusDepth).nodeIds
    : null;
  const threshold = 0.1 + (state.textFade ?? 0) * 1.2;
  const faded = state.textFade == null ? 1 : Math.min(1, Math.max(0, (zoom - threshold) / 0.5));
  const hoverNeighborhood = state.hoveredNodeId == null ? null : getKnowledgeNeighborhood(graph, state.hoveredNodeId).nodeIds;

  for (const graphNode of graph.nodes) {
    const node = cy.getElementById(`n${graphNode.id}`);
    const label = labels.get(graphNode.id);
    if (!label) continue;
    if (
      node.empty()
      || (focusedNodeIds != null && !focusedNodeIds.has(graphNode.id))
    ) {
      if (label.dataset.visible !== "false") label.dataset.visible = "false";
      if (label.classList.contains("important")) label.classList.remove("important");
      if (label.classList.contains("matched")) label.classList.remove("matched");
      continue;
    }
    const important = graphNode.id === state.focusedNodeId
      || graphNode.id === state.selectedNodeId
      || graphNode.id === state.hoveredNodeId;
    const matched = Boolean(query && graphNode.title.toLocaleLowerCase().includes(query));
    if (label.dataset.visible !== "true") label.dataset.visible = "true";
    if (label.classList.contains("important") !== important) label.classList.toggle("important", important);
    if (label.classList.contains("matched") !== matched) label.classList.toggle("matched", matched);
    const opacity = important || matched ? 1 : hoverNeighborhood
      ? hoverNeighborhood.has(graphNode.id) ? 1 : faded * 0.12 : faded;
    if (label.style.opacity !== String(opacity)) label.style.opacity = String(opacity);
    const fontSize = Math.min(18, Math.max(9, 12 * Math.sqrt(zoom))) + "px";
    if (label.style.fontSize !== fontSize) label.style.fontSize = fontSize;
  }
  positionLabelOverlay(cy, graph, labels);
}
