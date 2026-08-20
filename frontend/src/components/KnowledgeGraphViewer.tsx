import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { Core, NodeSingular } from "cytoscape";
import {
  createKnowledgeEdge,
  deleteKnowledgeEdge,
  deleteKnowledgeNode,
  getKnowledgeGraph,
  updateKnowledgeNode,
} from "../api/client";
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "../api/client";
import {
  measureLabelElements,
  positionLabelOverlay,
  reconcileLabelElements,
  updateLabelVisibility,
  type LabelMetrics,
} from "./knowledgeGraphLabels";
import { knowledgeGraphSignature } from "./knowledgeGraphModel";
import {
  computeTreeForestPositions,
} from "./knowledgeGraphLayout";
import {
  startKnowledgeGraphLayoutTask,
  type KnowledgeGraphLayoutTask,
} from "./knowledgeGraphLayoutTask";
import {
  createKnowledgeGraphInteractionState,
  isKnowledgeGraphInteractionActive,
  isUserGraphViewportEvent,
  setGraphInteraction,
  setWorkbenchResize,
} from "./knowledgeGraphInteraction";
import {
  RELATION_LABELS,
  applyGraphView,
  createCompactOverviewLayout,
  currentDarkMode,
  directNeighborhood,
  fitVisible,
  reconcileGraphElements,
  toElements,
  type RelationType,
  type ViewMode,
} from "./knowledgeGraphRuntime";
import { knowledgeGraphStyles } from "./knowledgeGraphStyles";
import KnowledgeGraphSurface from "./KnowledgeGraphSurface";
import { measureDesktopInteraction } from "../performance/desktopPerformance";

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



export default function KnowledgeGraphViewer({ projectId, refreshKey = 0, compact = false, onRequestText, onConfirm, onOpenQA, onOpenCourse, onOpenFile, onContentChanged, onGraphChanged, focusRef }: Props) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const labelLayerRef = useRef<HTMLDivElement | null>(null);
  const labelElementsRef = useRef(new Map<number, HTMLDivElement>());
  const labelMetricsRef = useRef<LabelMetrics>(new Map());
  const pendingLabelMeasurementsRef = useRef(new Set<number>());
  const labelPositionFrameRef = useRef<number | null>(null);
  const labelVisibilityFrameRef = useRef<number | null>(null);
  const forceLabelVisibilityRef = useRef(false);
  const labelMeasurementFrameRef = useRef<number | null>(null);
  const scheduleLabelPositionRef = useRef<() => void>(() => undefined);
  const scheduleLabelVisibilityRef = useRef<(force?: boolean) => void>(() => undefined);
  const scheduleLabelMeasurementRef = useRef<(ids?: Iterable<number>) => void>(() => undefined);
  const viewportTimeoutRef = useRef<number | null>(null);
  const graphInteractionSettleTimeoutRef = useRef<number | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeSettleTimeoutRef = useRef<number | null>(null);
  const layoutRunningRef = useRef(false);
  const layoutRequestRef = useRef(0);
  const layoutTaskRef = useRef<KnowledgeGraphLayoutTask | null>(null);
  const hoveredNodeIdRef = useRef<number | null>(null);
  const hoverClearTimerRef = useRef<number | null>(null);
  const hoverRelatedNodeIdsRef = useRef(new Set<number>());
  const hoverRelatedEdgeIdsRef = useRef(new Set<number>());
  const hoverActiveRef = useRef(false);
  const interactionStateRef = useRef(createKnowledgeGraphInteractionState());
  const graphInteractionStartedAtRef = useRef(0);
  const selectedNodeIdRef = useRef<number | null>(null);
  const searchQueryRef = useRef("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const pointerInsideRef = useRef(false);
  const overviewPositionsRef = useRef(new Map<number, { x: number; y: number }>());
  const cyRef = useRef<Core | null>(null);
  const lastTapRef = useRef<{ id: string; at: number } | null>(null);
  const graphRef = useRef<KnowledgeGraph>({ nodes: [], edges: [] });
  const graphSignatureRef = useRef("");
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
    const signature = knowledgeGraphSignature(next);
    if (signature === graphSignatureRef.current) return;
    graphSignatureRef.current = signature;
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
    graphSignatureRef.current = "";
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
      style: knowledgeGraphStyles,
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
    const scheduleLabelVisibility = (force = false) => {
      if (force) forceLabelVisibilityRef.current = true;
      if (!labelLayer || labelVisibilityFrameRef.current != null) return;
      labelVisibilityFrameRef.current = window.requestAnimationFrame(() => {
        labelVisibilityFrameRef.current = null;
        const forceUpdate = forceLabelVisibilityRef.current;
        forceLabelVisibilityRef.current = false;
        if (cy.destroyed() || (isKnowledgeGraphInteractionActive(interactionStateRef.current) && !forceUpdate)) return;
        updateLabelVisibility(cy, graphRef.current, labelElementsRef.current, {
          viewMode: viewModeRef.current,
          focusedNodeId: focusedNodeIdRef.current,
          focusDepth: focusDepthRef.current,
          selectedNodeId: selectedNodeIdRef.current,
          hoveredNodeId: hoveredNodeIdRef.current,
          searchQuery: searchQueryRef.current,
        }, labelMetricsRef.current);
      });
    };
    const scheduleLabelMeasurements = (ids?: Iterable<number>) => {
      for (const id of ids ?? labelElementsRef.current.keys()) pendingLabelMeasurementsRef.current.add(id);
      if (!labelLayer || labelMeasurementFrameRef.current != null) return;
      labelMeasurementFrameRef.current = window.requestAnimationFrame(() => {
        labelMeasurementFrameRef.current = null;
        if (cy.destroyed()) return;
        const pending = new Set(pendingLabelMeasurementsRef.current);
        pendingLabelMeasurementsRef.current.clear();
        measureLabelElements(labelElementsRef.current, labelMetricsRef.current, pending);
        scheduleLabelVisibility();
      });
    };
    scheduleLabelPositionRef.current = scheduleLabelPositions;
    scheduleLabelVisibilityRef.current = scheduleLabelVisibility;
    scheduleLabelMeasurementRef.current = scheduleLabelMeasurements;
    cy.on("render", scheduleLabelPositions);
    const settleGraphInteraction = () => {
      if (graphInteractionSettleTimeoutRef.current != null) {
        window.clearTimeout(graphInteractionSettleTimeoutRef.current);
        graphInteractionSettleTimeoutRef.current = null;
      }
      setGraphInteraction(interactionStateRef.current, false);
      scheduleLabelPositions();
      scheduleLabelVisibility(true);
    };
    cy.on("pan zoom", (event) => {
      // Cytoscape emits pan/zoom for both touch gestures and cy.animate().  Only
      // user gestures should suspend label reconciliation; otherwise a fit
      // animation can leave the overlay locked when WebView omits *end events.
      if (!isUserGraphViewportEvent(event)) return;
      if (!interactionStateRef.current.graphInteracting) graphInteractionStartedAtRef.current = performance.now();
      setGraphInteraction(interactionStateRef.current, true);
      if (graphInteractionSettleTimeoutRef.current != null) {
        window.clearTimeout(graphInteractionSettleTimeoutRef.current);
      }
      graphInteractionSettleTimeoutRef.current = window.setTimeout(settleGraphInteraction, 180);
    });
    cy.on("panend zoomend", () => {
      if (!document.documentElement.classList.contains("platform-android")) {
        measureDesktopInteraction("knowledge-graph-viewport", graphInteractionStartedAtRef.current, {
          node_count: graphRef.current.nodes.length,
        });
      }
      settleGraphInteraction();
    });
    cy.on("mouseover", "node", (event) => {
      if (hoverClearTimerRef.current != null) {
        window.clearTimeout(hoverClearTimerRef.current);
        hoverClearTimerRef.current = null;
      }
      const nodeId = Number(event.target.data("nodeId"));
      hoveredNodeIdRef.current = nodeId;
      if (!connectModeRef.current) {
        const { nodeIds, edgeIds } = directNeighborhood(graphRef.current, nodeId, 1);
        cy.batch(() => {
          if (!hoverActiveRef.current) {
            cy.elements().addClass("hover-dim");
            hoverActiveRef.current = true;
          }
          for (const id of hoverRelatedNodeIdsRef.current) {
            if (!nodeIds.has(id)) cy.getElementById(`n${id}`).removeClass("hover-related").addClass("hover-dim");
          }
          for (const id of hoverRelatedEdgeIdsRef.current) {
            if (!edgeIds.has(id)) cy.getElementById(`e${id}`).removeClass("hover-related").addClass("hover-dim");
          }
          for (const id of nodeIds) cy.getElementById(`n${id}`).removeClass("hover-dim").addClass("hover-related");
          for (const id of edgeIds) cy.getElementById(`e${id}`).removeClass("hover-dim").addClass("hover-related");
        });
        hoverRelatedNodeIdsRef.current = nodeIds;
        hoverRelatedEdgeIdsRef.current = edgeIds;
      }
      scheduleLabelVisibility();
    });
    cy.on("mouseout", "node", () => {
      hoveredNodeIdRef.current = null;
      if (hoverClearTimerRef.current != null) window.clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = window.setTimeout(() => {
        hoverClearTimerRef.current = null;
        if (cy.destroyed() || hoveredNodeIdRef.current != null) return;
        cy.elements().removeClass("hover-dim hover-related");
        hoverRelatedNodeIdsRef.current.clear();
        hoverRelatedEdgeIdsRef.current.clear();
        hoverActiveRef.current = false;
        scheduleLabelVisibility();
      }, 36);
    });
    scheduleLabelPositions();

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const workbenchResizing = document.body.classList.contains("resizing-x")
        || document.body.classList.contains("resizing-y");
      setWorkbenchResize(interactionStateRef.current, workbenchResizing);
      if (workbenchResizing) return;
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
        scheduleLabelVisibility();
      }, 160);
    });
    resizeObserver?.observe(container);
    const settleWorkbenchResize = () => {
      if (cy.destroyed()) return;
      setWorkbenchResize(interactionStateRef.current, false);
      if (resizeFrameRef.current != null) window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        if (cy.destroyed()) return;
        cy.resize();
        scheduleLabelPositions();
        scheduleLabelVisibility();
      });
    };
    window.addEventListener("codecourse:resize-end", settleWorkbenchResize);

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
      window.removeEventListener("codecourse:resize-end", settleWorkbenchResize);
      layoutRunningRef.current = false;
      if (labelPositionFrameRef.current != null) {
        window.cancelAnimationFrame(labelPositionFrameRef.current);
        labelPositionFrameRef.current = null;
      }
      if (labelVisibilityFrameRef.current != null) {
        window.cancelAnimationFrame(labelVisibilityFrameRef.current);
        labelVisibilityFrameRef.current = null;
      }
      if (labelMeasurementFrameRef.current != null) {
        window.cancelAnimationFrame(labelMeasurementFrameRef.current);
        labelMeasurementFrameRef.current = null;
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
      if (graphInteractionSettleTimeoutRef.current != null) {
        window.clearTimeout(graphInteractionSettleTimeoutRef.current);
        graphInteractionSettleTimeoutRef.current = null;
      }
      if (hoverClearTimerRef.current != null) {
        window.clearTimeout(hoverClearTimerRef.current);
        hoverClearTimerRef.current = null;
      }
      hoverRelatedNodeIdsRef.current.clear();
      hoverRelatedEdgeIdsRef.current.clear();
      hoverActiveRef.current = false;
      layoutRequestRef.current += 1;
      layoutTaskRef.current?.cancel();
      layoutTaskRef.current = null;
      scheduleLabelPositionRef.current = () => undefined;
      scheduleLabelVisibilityRef.current = () => undefined;
      forceLabelVisibilityRef.current = false;
      scheduleLabelMeasurementRef.current = () => undefined;
      pendingLabelMeasurementsRef.current.clear();
      labelMetricsRef.current.clear();
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
    const changedLabelIds = reconcileLabelElements(graph, labelLayer, labelElementsRef.current);

    for (const removedId of delta.removedNodeIds) {
      overviewPositionsRef.current.delete(removedId);
      labelMetricsRef.current.delete(removedId);
    }
    scheduleLabelMeasurementRef.current(changedLabelIds);
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
    // A view-mode change must reconcile labels even if a resize or gesture
    // happens in the same frame. Position-only updates remain throttled.
    scheduleLabelVisibilityRef.current(true);
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
    const alreadyOverview = viewModeRef.current === "overview" && focusedNodeIdRef.current == null;
    if (cy && overviewPositionsRef.current.size) {
      cy.nodes().forEach((node) => {
        const position = overviewPositionsRef.current.get(Number(node.data("nodeId")));
        if (position) node.position(position);
      });
    }
    // Update refs synchronously so a label frame queued by the position restore
    // cannot reconcile against the stale focus state.
    viewModeRef.current = "overview";
    focusedNodeIdRef.current = null;
    setGraphInteraction(interactionStateRef.current, false);
    if (graphInteractionSettleTimeoutRef.current != null) {
      window.clearTimeout(graphInteractionSettleTimeoutRef.current);
      graphInteractionSettleTimeoutRef.current = null;
    }
    setViewMode("overview");
    setFocusedNodeId(null);
    setSelectedEdge(null);
    if (alreadyOverview && cy && graphRef.current.nodes.length > 0) {
      if (viewportTimeoutRef.current != null) {
        window.clearTimeout(viewportTimeoutRef.current);
        viewportTimeoutRef.current = null;
      }
      cy.stop();
      applyGraphView(cy, graphRef.current, "overview", null, focusDepthRef.current, {
        animate: true,
        fitViewport: true,
        scheduleViewport: scheduleViewportUpdate,
      });
    }
    scheduleLabelVisibilityRef.current(true);
    setMessage("已切换到全览");
  }

  async function handleArrangeOverview() {
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

    layoutTaskRef.current?.cancel();
    layoutTaskRef.current = null;
    const requestId = ++layoutRequestRef.current;
    const finishLayout = () => {
      if (cy.destroyed() || requestId !== layoutRequestRef.current) return;
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
    };

    if (graphRef.current.nodes.length <= 120 || typeof Worker === "undefined") {
      const layout = createCompactOverviewLayout(cy, graphRef.current);
      layout.one("layoutstop", finishLayout);
      layout.run();
      return;
    }

    setMessage("正在后台整理大型知识网络…");
    let task: KnowledgeGraphLayoutTask | null = null;
    try {
      task = startKnowledgeGraphLayoutTask(requestId, graphRef.current);
      layoutTaskRef.current = task;
      const positions = await task.promise;
      if (layoutTaskRef.current === task) layoutTaskRef.current = null;
      if (requestId !== layoutRequestRef.current || cy.destroyed()) return;
      const byId = new Map(positions.map((position) => [position.id, position]));
      cy.batch(() => {
        cy.nodes().forEach((node) => {
          const position = byId.get(Number(node.data("nodeId")));
          if (position) node.position({ x: position.x, y: position.y });
        });
      });
      finishLayout();
    } catch (error) {
      if (layoutTaskRef.current === task) layoutTaskRef.current = null;
      if (requestId !== layoutRequestRef.current) return;
      layoutRunningRef.current = false;
      const fallback = computeTreeForestPositions(graphRef.current);
      const byId = new Map(fallback.map((position) => [position.id, position]));
      cy.batch(() => {
        cy.nodes().forEach((node) => {
          const position = byId.get(Number(node.data("nodeId")));
          if (position) node.position({ x: position.x, y: position.y });
        });
      });
      setMessage(error instanceof Error ? `${error.message}，已使用本地布局` : "后台布局失败，已使用本地布局");
      finishLayout();
    }
  }

  return <KnowledgeGraphSurface
    compact={compact} graph={graph} viewMode={viewMode} connectMode={connectMode}
    selectedNode={selectedNode} selectedEdge={selectedEdge} searchOpen={searchOpen} searchQuery={searchQuery} message={message}
    viewerRef={viewerRef} containerRef={containerRef} labelLayerRef={labelLayerRef} searchInputRef={searchInputRef}
    onPointerInside={(inside) => { pointerInsideRef.current = inside; }} onOverview={handleOverview}
    onArrange={() => { void handleArrangeOverview(); }}
    onToggleConnect={() => { setRelationType("explains"); setConnectMode((value) => !value); setConnectSourceId(null); setMessage(connectMode ? "" : "请选择源节点"); }}
    onRename={() => { void handleRenameNode(); }} onDelete={() => { void handleDeleteSelected(); }}
    onSearchQuery={setSearchQuery} onCloseSearch={() => { setSearchOpen(false); setSearchQuery(""); }}
    onSelectSearchNode={(node) => { setSelectedNode(node); setSelectedEdge(null); setFocusedNodeId(node.id); setFocusDepth(1); setViewMode("focus"); setSearchOpen(false); }}
    onRetry={() => { setMessage(""); void reload(); }}
  />;
}
