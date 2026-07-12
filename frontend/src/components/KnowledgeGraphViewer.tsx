import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { Core, ElementDefinition, NodeSingular } from "cytoscape";
import {
  createKnowledgeEdge,
  createKnowledgeNode,
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
};

type RelationType = "explains" | "parent_of" | "related_to" | "references";
type ViewMode = "overview" | "focus";

const MIN_OVERVIEW_SIZE = 24;
const MAX_OVERVIEW_SIZE = 48;
const MIN_LABEL_SIZE = 10;
const MAX_LABEL_SIZE = 13;
function focusSizes(container: HTMLElement | null) {
  const w = container?.clientWidth ?? 800;
  const h = container?.clientHeight ?? 600;
  const dim = Math.min(w, h);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    root:      Math.round(clamp(dim * 0.09, 40, 72)),
    parent:    Math.round(clamp(dim * 0.06, 28, 50)),
    child:     Math.round(clamp(dim * 0.04, 18, 30)),
    rootFont:  Math.round(clamp(dim * 0.025, 14, 20)),
    parentFont: Math.round(clamp(dim * 0.018, 12, 16)),
    childFont:  Math.round(clamp(dim * 0.013, 10, 13)),
  };
}

const LAYOUT_PADDING = 110;
const FOCUS_PADDING = 190;
const ANIMATION_MS = 360;
const FOCUS_SECONDARY_FIT_DELAY_MS = 180;

const RELATION_LABELS: Record<string, string> = {
  explains: "解释",
  parent_of: "父子",
  related_to: "相关",
  references: "引用",
};

function nodeColor(type: string): string {
  if (type === "term") return "#2f7d73";
  if (type === "qa") return "#4f6fb5";
  if (type === "course") return "#8a6f2a";
  if (type === "file") return "#7c5aa6";
  return "#5b6678";
}

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

function toElements(graph: KnowledgeGraph): ElementDefinition[] {
  const degree = new Map<number, number>();
  for (const node of graph.nodes) degree.set(node.id, 0);
  for (const edge of graph.edges) {
    degree.set(edge.source_node_id, (degree.get(edge.source_node_id) || 0) + 1);
    degree.set(edge.target_node_id, (degree.get(edge.target_node_id) || 0) + 1);
  }
  const degVals = [...degree.values()];
  const maxDeg = Math.max(1, ...degVals);
  const minDeg = Math.min(...degVals);
  const degRange = maxDeg - minDeg || 1;
  function nodeSize(id: number): number {
    const t = (Math.log(1 + (degree.get(id) || 0) - minDeg)) / Math.log(1 + degRange);
    return Math.round(MIN_OVERVIEW_SIZE + t * (MAX_OVERVIEW_SIZE - MIN_OVERVIEW_SIZE));
  }
  function nodeFontSize(id: number): number {
    const t = (Math.log(1 + (degree.get(id) || 0) - minDeg)) / Math.log(1 + degRange);
    return Math.round(MIN_LABEL_SIZE + t * (MAX_LABEL_SIZE - MIN_LABEL_SIZE));
  }

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
          color: nodeColor(node.node_type),
          size: nodeSize(node.id),
          fontSize: nodeFontSize(node.id),
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

function spreadFocusNeighbors(cy: Core, graph: KnowledgeGraph, focusedNodeId: number) {
  const { nodeIds } = directNeighborhood(graph, focusedNodeId);
  const centerNode = cy.getElementById(`n${focusedNodeId}`);
  if (centerNode.empty()) return;
  const neighbors = [...nodeIds]
    .filter((id) => id !== focusedNodeId)
    .map((id) => cy.getElementById(`n${id}`))
    .filter((node) => !node.empty());
  if (neighbors.length === 0) return;

  const center = centerNode.position();
  const radius = Math.max(170, 122 + neighbors.length * 22);
  const startAngle = neighbors.length === 1 ? -0.1 : -Math.PI / 2;
  neighbors.forEach((node, index) => {
    const angle = startAngle + (Math.PI * 2 * index) / neighbors.length;
    node.stop();
    node.animate(
      {
        position: {
          x: center.x + Math.cos(angle) * radius,
          y: center.y + Math.sin(angle) * radius,
        },
      },
      { duration: ANIMATION_MS, easing: "ease-in-out-cubic" },
    );
  });
}

function scheduleLabelSafeFit(cy: Core, graph: KnowledgeGraph, mode: ViewMode, focusedNodeId: number | null) {
  window.setTimeout(() => {
    if (cy.destroyed()) return;
    cy.resize();
    fitVisible(cy, graph, mode, focusedNodeId, true);
  }, FOCUS_SECONDARY_FIT_DELAY_MS);
}

function fitVisible(cy: Core, graph: KnowledgeGraph, mode: ViewMode, focusedNodeId: number | null, animate: boolean) {
  let fitElements = cy.elements();
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
    padding = FOCUS_PADDING;
  }
  if (fitElements.length === 0) return;
  cy.stop();
  if (animate) {
    cy.animate({ fit: { eles: fitElements, padding } }, { duration: ANIMATION_MS, easing: "ease-in-out-cubic" });
  } else {
    cy.fit(fitElements, padding);
  }
}

function applyGraphView(cy: Core, graph: KnowledgeGraph, mode: ViewMode, focusedNodeId: number | null, animate = true) {
  cy.elements().removeClass("graph-hidden focus-root focus-parent focus-child focus-edge");

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
        node.style({ width: sizes.root, height: sizes.root, "font-size": sizes.rootFont });
      } else if (parentIds.has(nodeId)) {
        node.addClass("focus-parent");
        node.style({ width: sizes.parent, height: sizes.parent, "font-size": sizes.parentFont });
      } else {
        node.addClass("focus-child");
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
    spreadFocusNeighbors(cy, graph, focusedNodeId);
  }

  fitVisible(cy, graph, mode, focusedNodeId, animate);
  scheduleLabelSafeFit(cy, graph, mode, focusedNodeId);
}

function viewportCenter(cy: Core | null) {
  if (!cy) return { x: 0, y: 0 };
  const extent = cy.extent();
  return {
    x: (extent.x1 + extent.x2) / 2,
    y: (extent.y1 + extent.y2) / 2,
  };
}

export default function KnowledgeGraphViewer({ projectId, refreshKey = 0, onOpenQA, onOpenCourse, onOpenFile }: Props) {
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
      elements: toElements(graph),
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            label: "data(label)",
            color: "#1f2937",
            "font-size": "data(fontSize)",
            "text-wrap": "wrap",
            "text-max-width": "96px",
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
            "border-color": "#ffffff",
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
            label: "data(label)",
            "font-size": "10px",
            "text-rotation": "autorotate",
            "text-margin-y": -12,
            color: "#607086",
            "text-background-color": "#ffffff",
            "text-background-opacity": 0.92,
            "text-background-padding": "4px",
            "text-background-shape": "roundrectangle",
            "text-border-color": "#d5dbe3",
            "text-border-width": 1,
            "text-border-opacity": 0.85,
            "text-outline-color": "#ffffff",
            "text-outline-width": 2,
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
            "font-size": "14px",
            "text-margin-y": -18,
            color: "#174c43",
            "text-background-opacity": 0.96,
            "text-background-padding": "5px",
            "text-border-color": "#b7d7d1",
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
            "font-size": "14px",
            "text-margin-y": -18,
            color: "#174c43",
            "text-background-opacity": 0.96,
            "text-background-padding": "5px",
            "text-border-color": "#b7d7d1",
            "z-index": 12,
          },
        },
      ],
      layout: { name: "preset", fit: false },
      wheelSensitivity: 0.2,
    });
    cyRef.current = cy;

    const hasAnyPosition = graph.nodes.some((node) => node.x != null && node.y != null);
    if (!hasAnyPosition && graph.nodes.length > 1) {
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

  async function handleCreateNode() {
    const title = window.prompt("节点名称", "");
    if (!title?.trim()) return;
    const center = viewportCenter(cyRef.current);
    const angle = graph.nodes.length * 2.399963229728653;
    const radius = 70 + (graph.nodes.length % 4) * 18;
    await createKnowledgeNode(projectId, {
      node_type: "manual",
      title: title.trim(),
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
    setViewMode("overview");
    setFocusedNodeId(null);
    await reload();
  }

  async function handleRenameNode() {
    if (!selectedNode) return;
    const title = window.prompt("节点名称", selectedNode.title);
    if (!title?.trim()) return;
    const updated = await updateKnowledgeNode(projectId, selectedNode.id, { title: title.trim() });
    setSelectedNode(updated);
    await reload();
  }

  async function handleDeleteSelected() {
    if (selectedNode) {
      await deleteKnowledgeNode(projectId, selectedNode.id);
      if (focusedNodeId === selectedNode.id) {
        setViewMode("overview");
        setFocusedNodeId(null);
      }
      setSelectedNode(null);
      await reload();
      return;
    }
    if (selectedEdge) {
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

  const focusedNode = focusedNodeId ? graph.nodes.find((node) => node.id === focusedNodeId) : null;

  return (
    <div className="knowledge-viewer">
      <div className="viewer-header">
        <span>知识网络</span>
        <div className="viewer-actions">
          <button className={`secondary-button compact ${viewMode === "overview" ? "active" : ""}`} onClick={handleOverview}>全览</button>
          <button className="secondary-button compact" onClick={() => reload()}>刷新</button>
          <button className="secondary-button compact" onClick={handleCreateNode}>新建节点</button>
          <select className="compact-select" value={relationType} onChange={(event) => setRelationType(event.target.value as RelationType)}>
            <option value="explains">解释</option>
            <option value="parent_of">父子</option>
            <option value="related_to">相关</option>
            <option value="references">引用</option>
          </select>
          <button
            className={`secondary-button compact ${connectMode ? "active" : ""}`}
            onClick={() => {
              setConnectMode((value) => !value);
              setConnectSourceId(null);
              setMessage(connectMode ? "" : "请选择源节点");
            }}
          >
            连线
          </button>
          <button className="secondary-button compact" onClick={handleRenameNode} disabled={!selectedNode}>重命名</button>
          <button className="secondary-button compact danger" onClick={handleDeleteSelected} disabled={!selectedNode && !selectedEdge}>删除</button>
          <span className="knowledge-mode-pill">{viewMode === "focus" && focusedNode ? `聚焦：${focusedNode.title}` : "全览模式"}</span>
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
