import type { RefObject } from "react";
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "../api/client";
import { RELATION_LABELS, type ViewMode } from "./knowledgeGraphRuntime";

type Props = {
  compact: boolean;
  graph: KnowledgeGraph;
  viewMode: ViewMode;
  connectMode: boolean;
  selectedNode: KnowledgeNode | null;
  selectedEdge: KnowledgeEdge | null;
  searchOpen: boolean;
  searchQuery: string;
  message: string;
  viewerRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  labelLayerRef: RefObject<HTMLDivElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onPointerInside: (inside: boolean) => void;
  onOverview: () => void;
  onArrange: () => void;
  onToggleConnect: () => void;
  onRename: () => void;
  onDelete: () => void;
  onSearchQuery: (query: string) => void;
  onCloseSearch: () => void;
  onSelectSearchNode: (node: KnowledgeNode) => void;
  onRetry: () => void;
};

export default function KnowledgeGraphSurface({
  compact, graph, viewMode, connectMode, selectedNode, selectedEdge, searchOpen, searchQuery, message,
  viewerRef, containerRef, labelLayerRef, searchInputRef, onPointerInside, onOverview, onArrange,
  onToggleConnect, onRename, onDelete, onSearchQuery, onCloseSearch, onSelectSearchNode, onRetry,
}: Props) {
  const matches = searchQuery.trim()
    ? graph.nodes.filter((node) => node.title.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase())).slice(0, 8)
    : [];
  return (
    <div
      ref={viewerRef}
      className={`knowledge-viewer ${compact ? "compact" : ""}`}
      onPointerEnter={() => onPointerInside(true)}
      onPointerLeave={() => onPointerInside(false)}
    >
      <div className="viewer-header">
        <span>知识网络</span>
        <div className="viewer-actions">
          <button className={`secondary-button compact ${viewMode === "overview" ? "active" : ""}`} onClick={onOverview}>全览</button>
          <button className="secondary-button compact" onClick={onArrange} disabled={graph.nodes.length < 2} title="按父子关系整理为树状布局并保存节点位置">整理</button>
          <button className={`secondary-button compact ${connectMode ? "active" : ""}`} onClick={onToggleConnect}>连线</button>
          <button className="secondary-button compact" onClick={onRename} disabled={!selectedNode}>重命名</button>
          <button className="secondary-button compact danger" onClick={onDelete} disabled={!selectedNode && !selectedEdge}>删除</button>
        </div>
      </div>
      <div className="knowledge-body">
        <div className="knowledge-canvas-shell">
          <div ref={containerRef} className="knowledge-canvas" />
          <div ref={labelLayerRef} className="knowledge-label-layer" aria-hidden="true" />
          {searchOpen ? (
            <div className="knowledge-search" role="search">
              <input ref={searchInputRef} value={searchQuery} onChange={(event) => onSearchQuery(event.target.value)} placeholder="搜索节点" aria-label="搜索知识网络节点" />
              <button className="icon-button" onClick={onCloseSearch} aria-label="关闭搜索">×</button>
              {matches.length ? <div className="knowledge-search-results">
                {matches.map((node) => <button key={node.id} onClick={() => onSelectSearchNode(node)}>{node.title}</button>)}
              </div> : null}
            </div>
          ) : null}
          {graph.nodes.length === 0 ? (
            <div className="knowledge-empty-overlay">
              {message ? <><strong>加载失败</strong><span>{message}</span><button className="secondary-button compact" onClick={onRetry}>重试</button></>
                : <><strong>还没有知识节点</strong><span>AI 助手会根据你的提问自动提取和连接知识点。在助手面板中提问后，知识点会出现在这里。</span></>}
            </div>
          ) : null}
        </div>
        {selectedNode || selectedEdge || (message && graph.nodes.length > 0) ? <aside className="knowledge-inspector open">
          {selectedNode ? <><strong>{selectedNode.title}</strong><span>类型：{selectedNode.node_type}</span>{selectedNode.ref_path ? <span>路径：{selectedNode.ref_path}</span> : null}{selectedNode.summary ? <p>{selectedNode.summary}</p> : null}</>
            : selectedEdge ? <><strong>{selectedEdge.label || RELATION_LABELS[selectedEdge.relation_type] || selectedEdge.relation_type}</strong><span>关系：{selectedEdge.relation_type}</span><span>{selectedEdge.source_node_id} → {selectedEdge.target_node_id}</span></>
              : <span>单击节点聚焦一跳关系，双击打开对应回答、课件或代码。</span>}
          {message ? <small>{message}</small> : null}
        </aside> : null}
      </div>
    </div>
  );
}
