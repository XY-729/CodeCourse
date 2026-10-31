import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { Core, EdgeSingular, NodeSingular } from "cytoscape";
import {
  createKnowledgeEdge, deleteKnowledgeEdge, deleteKnowledgeNode,
  getKnowledgeGraph, updateKnowledgeNode,
} from "../../api/client";
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "../../api/client";
import { reconcileLabelElements, updateLabelVisibility } from "./knowledgeGraphLabels";
import { getKnowledgeGraphIndex, getKnowledgeNeighborhood, knowledgeGraphSignature } from "./knowledgeGraphModel";
import { currentDarkMode, reconcileGraphElements, toElements, type ViewMode } from "./knowledgeGraphRuntime";
import { knowledgeGraphStyles } from "./knowledgeGraphStyles";
import { createBackgroundKnowledgeGraphSimulation as createKnowledgeGraphSimulation } from "./knowledgeGraphSimulationBackground";
import { readGraphSettings, writeGraphSettings, type GraphSettings } from "./knowledgeGraphSettings";
import KnowledgeGraphSurface from "./KnowledgeGraphSurface";

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

const EMPTY_GRAPH: KnowledgeGraph = { nodes: [], edges: [] };
type ContextMenu = { x: number; y: number; nodeId?: number; edgeId?: number };

export default function KnowledgeGraphViewer({ projectId, refreshKey = 0, compact = false, onRequestText, onConfirm,
  onOpenQA, onOpenCourse, onOpenFile, onContentChanged, onGraphChanged, focusRef }: Props) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const labelLayerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const simulationRef = useRef<ReturnType<typeof createKnowledgeGraphSimulation> | null>(null);
  const labelsRef = useRef(new Map<number, HTMLDivElement>());
  const renderedRef = useRef<KnowledgeGraph>(EMPTY_GRAPH);
  const frameRef = useRef<number | null>(null);
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportTouchedRef = useRef(false);
  const requestRef = useRef(0);
  const pointerInsideRef = useRef(false);
  const connectSourceRef = useRef<number | null>(null);
  const hoverRef = useRef<number | null>(null);
  const focusRefKeyRef = useRef<string | null>(null);
  const callbacksRef = useRef({ onOpenQA, onOpenCourse, onOpenFile, onGraphChanged });
  callbacksRef.current = { onOpenQA, onOpenCourse, onOpenFile, onGraphChanged };
  const [graph, setGraph] = useState<KnowledgeGraph>(EMPTY_GRAPH);
  const [loadedProject, setLoadedProject] = useState<number | null>(null);
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<KnowledgeEdge | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [focusedNodeId, setFocusedNodeId] = useState<number | null>(null);
  const [focusDepth, setFocusDepth] = useState(1);
  const [settings, setSettings] = useState<GraphSettings>(readGraphSettings);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [connectMode, setConnectMode] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [message, setMessage] = useState("");
  const [darkMode, setDarkMode] = useState(currentDarkMode);
  const [replayCount, setReplayCount] = useState<number | null>(null);
  const [visibleNodeCount, setVisibleNodeCount] = useState(0);
  const latest = useRef({ graph, selectedNode, viewMode, focusedNodeId, focusDepth, settings, searchQuery, connectMode, projectId, replayCount });
  latest.current = { graph, selectedNode, viewMode, focusedNodeId, focusDepth, settings, searchQuery, connectMode, projectId, replayCount };

  function report(error: unknown) {
    if (latest.current.projectId !== projectId) return;
    setMessage(error instanceof Error ? error.message : "操作失败，请重试");
  }

  async function reload() {
    if (latest.current.projectId !== projectId) return;
    const request = ++requestRef.current;
    try {
      const next = await getKnowledgeGraph(projectId);
      if (request !== requestRef.current || latest.current.projectId !== projectId) return;
      setGraph((previous) => knowledgeGraphSignature(previous) === knowledgeGraphSignature(next) ? previous : next);
      setLoadedProject(projectId);
      setMessage("");
    } catch (error) {
      if (request === requestRef.current) report(error);
    }
  }

  async function changed() {
    if (latest.current.projectId !== projectId) return;
    await callbacksRef.current.onGraphChanged?.();
    await reload();
  }

  function openNode(node: KnowledgeNode | null) {
    if (!node) return;
    if (node.ref_type === "qa" && node.ref_id) callbacksRef.current.onOpenQA(node.ref_id);
    else if (node.ref_type === "course" && node.ref_path) callbacksRef.current.onOpenCourse(node.ref_path);
    else if (node.ref_type === "file" && node.ref_path) callbacksRef.current.onOpenFile(node.ref_path);
    else setMessage(node.summary || node.title);
  }

  function fit(animate = true) {
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return;
    const visible = cy.nodes().filter((node) => !node.hasClass("graph-hidden"));
    if (!visible.length) return;
    const padding = Math.min(64, Math.min(cy.width(), cy.height()) * 0.12);
    const center = visible.boundingBox({ includeLabels: false, includeOverlays: false });
    const zoom = Math.min(1.5, Math.max(cy.minZoom(), Math.min(
      (cy.width() - padding * 2) / Math.max(1, center.w), (cy.height() - padding * 2) / Math.max(1, center.h))));
    const pan = { x: cy.width() / 2 - (center.x1 + center.x2) * zoom / 2,
      y: cy.height() / 2 - (center.y1 + center.y2) * zoom / 2 };
    cy.stop();
    if (animate) cy.animate({ zoom, pan }, { duration: 250 });
    else cy.viewport({ zoom, pan });
  }

  function scheduleLabels() {
    if (frameRef.current != null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const cy = cyRef.current;
      if (!cy || cy.destroyed()) return;
      const state = latest.current;
      updateLabelVisibility(cy, state.graph, labelsRef.current, {
        viewMode: state.viewMode, focusedNodeId: state.focusedNodeId, focusDepth: state.focusDepth,
        selectedNodeId: state.selectedNode?.id ?? null, hoveredNodeId: hoverRef.current,
        searchQuery: state.searchQuery, textFade: state.settings.textFade,
      });
    });
  }

  function setHover(nodeId: number | null) {
    const cy = cyRef.current;
    hoverRef.current = nodeId;
    if (!cy || cy.destroyed()) return;
    const neighborhood = nodeId == null ? null : getKnowledgeNeighborhood(latest.current.graph, nodeId);
    cy.batch(() => {
      cy.elements().removeClass("hover-related hover-dim");
      if (neighborhood) {
        cy.elements().addClass("hover-dim");
        for (const id of neighborhood.nodeIds) cy.getElementById("n" + id).removeClass("hover-dim").addClass("hover-related");
        for (const id of neighborhood.edgeIds) cy.getElementById("e" + id).removeClass("hover-dim").addClass("hover-related");
      }
    });
    scheduleLabels();
  }

  function overview() {
    latest.current.viewMode = "overview";
    latest.current.focusedNodeId = null;
    setViewMode("overview");
    setFocusedNodeId(null);
    setContextMenu(null);
    setHover(null);
    setMessage("");
  }

  function localGraph() {
    const node = latest.current.selectedNode;
    if (!node) return;
    setFocusedNodeId(node.id);
    setViewMode("focus");
    setContextMenu(null);
  }

  useEffect(() => {
    requestRef.current += 1;
    setGraph(EMPTY_GRAPH);
    setLoadedProject(null);
    setSelectedNode(null);
    setSelectedEdge(null);
    setViewMode("overview");
    setFocusedNodeId(null);
    setSearchQuery("");
    setSearchOpen(false);
    setConnectMode(false);
    setReplayCount(null);
    setContextMenu(null);
    connectSourceRef.current = null;
    focusRefKeyRef.current = null;
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => { window.clearTimeout(timer); requestRef.current += 1; };
  }, [projectId]);

  useEffect(() => {
    if (loadedProject !== projectId) return;
    const timer = window.setTimeout(() => { void reload(); }, 60);
    return () => window.clearTimeout(timer);
  }, [refreshKey]);

  useEffect(() => {
    const observer = new MutationObserver(() => setDarkMode(currentDarkMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cy = cytoscape({ container, elements: [], style: knowledgeGraphStyles,
      layout: { name: "preset", fit: false }, minZoom: 0.05, maxZoom: 4,
      wheelSensitivity: 0.2, boxSelectionEnabled: false, autounselectify: true });
    cyRef.current = cy;
    renderedRef.current = EMPTY_GRAPH;
    viewportTouchedRef.current = false;
    labelsRef.current.clear();
    labelLayerRef.current?.replaceChildren();
    cy.on("render pan zoom", scheduleLabels);
    cy.on("mousedown touchstart", () => { viewportTouchedRef.current = true; setContextMenu(null); });
    cy.on("pan zoom", (event) => { if (event.originalEvent) viewportTouchedRef.current = true; });
    cy.on("mouseover", "node", (event) => setHover(Number(event.target.data("nodeId"))));
    cy.on("mouseout", "node", () => setHover(null));
    cy.on("tap", "node", (event) => {
      const nodeId = Number(event.target.data("nodeId"));
      const node = latest.current.graph.nodes.find((item) => item.id === nodeId) ?? null;
      setSelectedNode(node);
      setSelectedEdge(null);
      latest.current.selectedNode = node;
      if (latest.current.connectMode) {
        const source = connectSourceRef.current;
        if (source == null) {
          connectSourceRef.current = nodeId;
          setMessage("请选择目标节点");
        } else if (source !== nodeId) {
          setConnectMode(false);
          latest.current.connectMode = false;
          connectSourceRef.current = null;
          void createKnowledgeEdge(projectId, { source_node_id: source, target_node_id: nodeId,
            relation_type: "explains", label: "解释" }).then(changed).catch(report);
        }
      } else openNode(node);
      scheduleLabels();
    });
    cy.on("tap", "edge", (event) => {
      setSelectedEdge(latest.current.graph.edges.find((item) => item.id === Number(event.target.data("edgeId"))) ?? null);
      setSelectedNode(null);
      latest.current.selectedNode = null;
      scheduleLabels();
    });
    cy.on("tap", (event) => {
      if (event.target !== cy) return;
      setSelectedNode(null);
      setSelectedEdge(null);
      setContextMenu(null);
      setMessage("");
    });
    cy.on("cxttap", (event) => {
      event.originalEvent?.preventDefault();
      const target = event.target;
      const isNode = target !== cy && target.isNode();
      const isEdge = target !== cy && target.isEdge();
      const nodeId = isNode ? Number(target.data("nodeId")) : undefined;
      const edgeId = isEdge ? Number(target.data("edgeId")) : undefined;
      const node = latest.current.graph.nodes.find((item) => item.id === nodeId) ?? null;
      setSelectedNode(node);
      latest.current.selectedNode = node;
      setSelectedEdge(latest.current.graph.edges.find((item) => item.id === edgeId) ?? null);
      const point = event.renderedPosition ?? { x: cy.width() / 2, y: cy.height() / 2 };
      const canvasRect = container.getBoundingClientRect();
      const viewerRect = viewerRef.current?.getBoundingClientRect() ?? canvasRect;
      setContextMenu({ x: point.x + canvasRect.left - viewerRect.left,
        y: point.y + canvasRect.top - viewerRect.top, nodeId, edgeId });
    });
    cy.on("grab drag", "node", (event) => {
      const node = event.target as NodeSingular;
      const position = node.position();
      simulationRef.current?.pin(Number(node.data("nodeId")), position.x, position.y);
    });
    cy.on("free", "node", (event) => {
      simulationRef.current?.release(Number(event.target.data("nodeId")));
    });
    const resize = () => {
      if (cy.destroyed() || document.body.classList.contains("resizing-x") || document.body.classList.contains("resizing-y")) return;
      cy.resize();
      scheduleLabels();
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(container);
    window.addEventListener("codecourse:resize-end", resize);
    const visibility = () => {
      if (document.hidden) simulationRef.current?.stop();
      else simulationRef.current?.reheat();
    };
    document.addEventListener("visibilitychange", visibility);
    container.addEventListener("contextmenu", preventContextMenu);
    return () => {
      observer?.disconnect();
      window.removeEventListener("codecourse:resize-end", resize);
      document.removeEventListener("visibilitychange", visibility);
      container.removeEventListener("contextmenu", preventContextMenu);
      simulationRef.current?.destroy();
      simulationRef.current = null;
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
      if (fitTimerRef.current != null) clearTimeout(fitTimerRef.current);
      frameRef.current = null;
      fitTimerRef.current = null;
      labelsRef.current.clear();
      labelLayerRef.current?.replaceChildren();
      cy.destroy();
      if (cyRef.current === cy) cyRef.current = null;
    };
  }, [projectId, compact]);

  useEffect(() => {
    const cy = cyRef.current;
    const layer = labelLayerRef.current;
    if (!cy || !layer || loadedProject !== projectId) return;
    const previous = renderedRef.current;
    const first = !previous.nodes.length && graph.nodes.length > 0;
    const delta = reconcileGraphElements(cy, previous, graph, containerRef.current, darkMode);
    renderedRef.current = graph;
    reconcileLabelElements(graph, layer, labelsRef.current);
    // An edge refresh also changes the degree (and therefore color) of existing nodes.
    const definitions = toElements(graph, containerRef.current, darkMode);
    cy.batch(() => {
      for (const definition of definitions) {
        if (definition.data) cy.getElementById(String(definition.data.id)).data(definition.data);
      }
      if (first) {
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        cy.nodes().forEach((node, index) => {
          const radius = settings.forces.distance * 0.5 * Math.sqrt(index);
          node.position({ x: Math.cos(index * goldenAngle) * radius, y: Math.sin(index * goldenAngle) * radius });
        });
      }
    });
    setSelectedNode((previousNode) => previousNode ? graph.nodes.find((node) => node.id === previousNode.id) ?? null : null);
    setSelectedEdge((previousEdge) => previousEdge ? graph.edges.find((edge) => edge.id === previousEdge.id) ?? null : null);
    if (focusedNodeId && !graph.nodes.some((node) => node.id === focusedNodeId)) overview();
    if (first || delta.contentChanged) synchronizeSimulation();
    applyAppearance();
    if (first) {
      fit(false);
      fitTimerRef.current = setTimeout(() => { if (!viewportTouchedRef.current) fit(true); }, 900);
    }
    scheduleLabels();
  }, [graph, loadedProject, darkMode, projectId, compact]);

  function applyAppearance() {
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return;
    const state = latest.current;
    const index = getKnowledgeGraphIndex(state.graph);
    const query = state.searchQuery.trim().toLocaleLowerCase();
    const replayIds = state.replayCount == null ? null : new Set([...state.graph.nodes]
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)
      .slice(0, state.replayCount).map((node) => node.id));
    const neighborhood = state.viewMode === "focus" && state.focusedNodeId != null
      ? getKnowledgeNeighborhood(state.graph, state.focusedNodeId, state.focusDepth).nodeIds : null;
    const visible = new Set<number>();
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const id = Number(node.data("nodeId"));
        const content = index.nodeById.get(id);
        const show = content && (!neighborhood || neighborhood.has(id))
          && (!replayIds || replayIds.has(id))
          && !state.settings.hiddenTypes.includes(content.node_type)
          && (state.settings.showOrphans || (index.degreeById.get(id) ?? 0) > 0)
          && (!query || content.title.toLocaleLowerCase().includes(query));
        node.toggleClass("graph-hidden", !show);
        node.toggleClass("focus-root", state.viewMode === "focus" && id === state.focusedNodeId);
        node.toggleClass("selected-node", id === state.selectedNode?.id);
        const size = Number(node.data("size")) * state.settings.nodeSize;
        node.style({ width: size, height: size });
        if (show) visible.add(id);
      });
      cy.edges().forEach((edge) => {
        const show = visible.has(Number(edge.source().data("nodeId"))) && visible.has(Number(edge.target().data("nodeId")));
        edge.toggleClass("graph-hidden", !show);
        edge.style({ width: state.settings.linkWidth, "target-arrow-shape": state.settings.arrows ? "triangle" : "none" });
      });
    });
    setVisibleNodeCount(visible.size);
    scheduleLabels();
  }

  function synchronizeSimulation() {
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return;
    applyAppearance();
    const nodes = cy.nodes().filter((node) => !node.hasClass("graph-hidden"))
      .map((element) => { const node = element as NodeSingular; return { id: Number(node.data("nodeId")), ...node.position() }; });
    const links = cy.edges().filter((edge) => !edge.hasClass("graph-hidden"))
      .map((element) => { const edge = element as EdgeSingular; return { source: Number(edge.source().data("nodeId")), target: Number(edge.target().data("nodeId")) }; });
    if (simulationRef.current) simulationRef.current.update(nodes, links);
    else simulationRef.current = createKnowledgeGraphSimulation({ nodes, links, forces: latest.current.settings.forces,
      onTick: (positions) => {
        if (cy.destroyed()) return;
        cy.batch(() => {
          for (const position of positions) {
            const node = cy.getElementById("n" + position.id);
            if (!node.empty() && !node.grabbed()) {
              const previous = node.position();
              if (Math.abs(previous.x - position.x) > 0.01 || Math.abs(previous.y - position.y) > 0.01)
                node.position({ x: position.x, y: position.y });
            }
          }
        });
        scheduleLabels();
      }, onEnd: () => { if (!viewportTouchedRef.current) fit(true); } });
  }

  useEffect(() => {
    applyAppearance();
    synchronizeSimulation();
    if (loadedProject === projectId && viewMode === "focus") fit(true);
  }, [viewMode, focusedNodeId, focusDepth, settings.hiddenTypes, settings.showOrphans, searchQuery, replayCount]);

  useEffect(() => {
    if (replayCount == null) return;
    const timer = window.setInterval(() => setReplayCount((count) => count == null || count >= latest.current.graph.nodes.length
      ? null : count + Math.max(1, Math.ceil(latest.current.graph.nodes.length / 70))), 80);
    return () => window.clearInterval(timer);
  }, [replayCount != null]);

  useEffect(() => {
    writeGraphSettings(settings);
    applyAppearance();
    simulationRef.current?.setForces(settings.forces);
  }, [settings]);

  useEffect(() => { applyAppearance(); }, [selectedNode?.id]);

  useEffect(() => {
    if (loadedProject !== projectId) return;
    const key = focusRef ? focusRef.ref_type + ":" + (focusRef.ref_id ?? focusRef.ref_path ?? "") : null;
    if (key === focusRefKeyRef.current) return;
    focusRefKeyRef.current = key;
    // Follow a changed document in local mode; entering local mode explicitly
    // must not be overwritten by the document that was already open.
    if (!focusRef || viewMode !== "focus") return;
    const match = graph.nodes.find((node) => (node.ref_type === focusRef.ref_type || node.node_type === focusRef.ref_type)
      && (focusRef.ref_id != null ? node.ref_id === focusRef.ref_id : node.ref_path === focusRef.ref_path));
    if (match) setFocusedNodeId(match.id);
  }, [focusRef, graph, viewMode, loadedProject, projectId]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!pointerInsideRef.current && !viewerRef.current?.contains(target)) return;
      const typing = target?.matches("input,textarea,select") || target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
      } else if (event.key === "Escape") {
        setContextMenu(null); setSearchOpen(false); setSearchQuery(""); setConnectMode(false); setMessage("");
      } else if (!typing) {
        const cy = cyRef.current;
        if (!cy) return;
        const amount = event.shiftKey ? 100 : 35;
        const move: Record<string, { x: number; y: number }> = {
          ArrowLeft: { x: amount, y: 0 }, ArrowRight: { x: -amount, y: 0 },
          ArrowUp: { x: 0, y: amount }, ArrowDown: { x: 0, y: -amount },
        };
        if (event.key === "+" || event.key === "=" || event.key === "-") {
          event.preventDefault(); viewportTouchedRef.current = true;
          cy.zoom({ level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * (event.key === "-" ? 0.8 : 1.25))),
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
        } else if (move[event.key]) {
          event.preventDefault(); viewportTouchedRef.current = true; cy.panBy(move[event.key]);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  async function rename() {
    if (!selectedNode) return;
    const title = await onRequestText?.({ title: "重命名节点", label: "节点名称", initialValue: selectedNode.title, confirmText: "保存" });
    if (latest.current.projectId !== projectId) return;
    if (!title?.trim()) return;
    const updated = await updateKnowledgeNode(projectId, selectedNode.id, { title: title.trim() });
    if (latest.current.projectId !== projectId) return;
    setSelectedNode(updated);
    await changed();
  }

  async function removeSelected() {
    if (selectedNode) {
      if (onConfirm && !await onConfirm("删除节点", "删除节点「" + selectedNode.title + "」？", { confirmText: "删除", danger: true })) return;
      if (latest.current.projectId !== projectId) return;
      await deleteKnowledgeNode(projectId, selectedNode.id);
      if (latest.current.projectId !== projectId) return;
      if (selectedNode.id === focusedNodeId) overview();
      setSelectedNode(null);
      await changed();
      await onContentChanged?.();
    } else if (selectedEdge) {
      if (onConfirm && !await onConfirm("删除关系", "删除当前关系？", { confirmText: "删除", danger: true })) return;
      if (latest.current.projectId !== projectId) return;
      await deleteKnowledgeEdge(projectId, selectedEdge.id);
      if (latest.current.projectId !== projectId) return;
      setSelectedEdge(null);
      await changed();
    }
  }

  return <KnowledgeGraphSurface compact={compact} graph={graph} viewMode={viewMode} connectMode={connectMode}
    selectedNode={selectedNode} selectedEdge={selectedEdge} searchOpen={searchOpen} searchQuery={searchQuery} message={message}
    viewerRef={viewerRef} containerRef={containerRef} labelLayerRef={labelLayerRef} searchInputRef={searchInputRef}
    settings={settings} onSettingsChange={setSettings} focusDepth={focusDepth} onFocusDepth={setFocusDepth} visibleNodeCount={visibleNodeCount}
    onAnimate={() => setReplayCount((count) => count == null ? 1 : null)} animating={replayCount != null}
    contextMenu={contextMenu} onCloseContextMenu={() => setContextMenu(null)} onLocalGraph={localGraph}
    onFit={() => fit()} onOpenSelected={() => openNode(selectedNode)}
    onPointerInside={(inside) => { pointerInsideRef.current = inside; }} onOverview={overview}
    onArrange={() => { simulationRef.current?.reheat(); }}
    onToggleConnect={() => {
      connectSourceRef.current = selectedNode?.id ?? null;
      setConnectMode((value) => !value); setMessage(connectMode ? "" : selectedNode ? "请选择目标节点" : "请选择源节点");
    }}
    onRename={() => { void rename().catch(report); }} onDelete={() => { void removeSelected().catch(report); }}
    onSearchQuery={setSearchQuery} onCloseSearch={() => { setSearchOpen(false); setSearchQuery(""); }}
    onSelectSearchNode={(node) => { setSelectedNode(node); openNode(node); setSearchOpen(false); }}
    onRetry={() => { void reload(); }} />;
}

function preventContextMenu(event: MouseEvent) { event.preventDefault(); }
