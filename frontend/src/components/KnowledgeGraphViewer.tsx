import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { Core, NodeSingular } from "cytoscape";
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

function toElements(graph: KnowledgeGraph) {
  return [
    ...graph.nodes.map((node) => ({
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
      },
      position: node.x != null && node.y != null ? { x: node.x, y: node.y } : undefined,
    })),
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

export default function KnowledgeGraphViewer({ projectId, refreshKey = 0, onOpenQA, onOpenCourse, onOpenFile }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const lastTapRef = useRef<{ id: string; at: number } | null>(null);
  const [graph, setGraph] = useState<KnowledgeGraph>({ nodes: [], edges: [] });
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<KnowledgeEdge | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [relationType, setRelationType] = useState<RelationType>("related_to");
  const [connectSourceId, setConnectSourceId] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  async function reload() {
    const next = await getKnowledgeGraph(projectId);
    setGraph(next);
  }

  useEffect(() => {
    reload().catch((error) => setMessage(error instanceof Error ? error.message : "加载知识网络失败"));
  }, [projectId, refreshKey]);

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
            "font-size": 12,
            "text-valign": "bottom",
            "text-halign": "center",
            "text-margin-y": 8,
            "border-width": 2,
            "border-color": "#ffffff",
            width: 34,
            height: 34,
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
            color: "#607086",
            "text-background-color": "#ffffff",
            "text-background-opacity": 0.8,
            "text-background-padding": "2px",
          },
        },
        {
          selector: "edge:selected",
          style: {
            "line-color": "#25766c",
            "target-arrow-color": "#25766c",
            width: 3,
          },
        },
      ],
      layout: graph.nodes.some((node) => node.x != null && node.y != null)
        ? { name: "preset", fit: true, padding: 40 }
        : { name: "cose", fit: true, padding: 40, animate: false },
      wheelSensitivity: 0.2,
    });
    cyRef.current = cy;

    cy.on("tap", "node", async (event) => {
      const node = event.target as NodeSingular;
      const nodeId = Number(node.data("nodeId"));
      const found = graph.nodes.find((item) => item.id === nodeId) ?? null;
      setSelectedNode(found);
      setSelectedEdge(null);

      if (connectMode) {
        if (!connectSourceId) {
          setConnectSourceId(nodeId);
          setMessage("请选择目标节点");
        } else if (connectSourceId !== nodeId) {
          await createKnowledgeEdge(projectId, {
            source_node_id: connectSourceId,
            target_node_id: nodeId,
            relation_type: relationType,
            label: RELATION_LABELS[relationType],
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
      if (!last || last.id !== node.id() || now - last.at > 360 || !found) {
        return;
      }
      if (found.ref_type === "qa" && found.ref_id) {
        onOpenQA(found.ref_id);
      } else if (found.ref_type === "course" && found.ref_path) {
        onOpenCourse(found.ref_path);
      } else if (found.ref_type === "file" && found.ref_path) {
        onOpenFile(found.ref_path);
      }
    });

    cy.on("tap", "edge", (event) => {
      const edgeId = Number(event.target.data("edgeId"));
      setSelectedEdge(graph.edges.find((item) => item.id === edgeId) ?? null);
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
  }, [graph, projectId, connectMode, connectSourceId, relationType, onOpenQA, onOpenCourse, onOpenFile]);

  async function handleCreateNode() {
    const title = window.prompt("节点名称", "");
    if (!title?.trim()) return;
    await createKnowledgeNode(projectId, { node_type: "manual", title: title.trim() });
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

  return (
    <div className="knowledge-viewer">
      <div className="viewer-header">
        <span>知识网络</span>
        <div className="viewer-actions">
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
          <strong>Cytoscape</strong>
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
            <span>单击节点查看详情，双击打开对应回答、课件或代码。</span>
          )}
          {message ? <small>{message}</small> : null}
        </aside>
      </div>
    </div>
  );
}
