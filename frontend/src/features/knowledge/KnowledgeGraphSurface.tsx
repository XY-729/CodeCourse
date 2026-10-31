import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ArrowUpRight, ChevronRight, Focus, GitBranch, Globe2, Link2, Network, Pencil, Play, RotateCcw, Search, Settings, Square, Trash2, X } from "lucide-react";
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "../../api/client";
import type { ViewMode } from "./knowledgeGraphRuntime";
import { DEFAULT_GRAPH_SETTINGS, type GraphSettings } from "./knowledgeGraphSettings";
import { getKnowledgeGraphIndex } from "./knowledgeGraphModel";

export type GraphContextMenu = { x: number; y: number; nodeId?: number; edgeId?: number };

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
  settings: GraphSettings;
  onSettingsChange: (settings: GraphSettings) => void;
  focusDepth: number;
  onFocusDepth: (depth: number) => void;
  onLocalGraph: () => void;
  onFit: () => void;
  onOpenSelected: () => void;
  contextMenu: GraphContextMenu | null;
  onCloseContextMenu: () => void;
  onAnimate?: () => void;
  animating?: boolean;
  visibleNodeCount?: number;
};

const TYPE_NAMES: Record<string, string> = {
  term: "知识点", concept: "知识点", qa: "回答", course: "课件", file: "文件", manual: "手动节点",
};

function GraphSlider({ label, value, min, max, step = 0.01, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void;
}) {
  return <label className="graph-slider-row">
    <span className="graph-setting-caption"><span>{label}</span><output>{step >= 1 ? value.toFixed(0) : value.toFixed(2)}</output></span>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
  </label>;
}

function GraphSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="graph-setting-row"><span>{label}</span><input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function GraphSection({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return <details className="graph-settings-section" open={open}>
    <summary><ChevronRight size={13} aria-hidden="true" /><span>{title}</span></summary>
    <div className="graph-settings-section-body">{children}</div>
  </details>;
}

export default function KnowledgeGraphSurface({
  compact, graph, viewMode, connectMode, selectedNode, selectedEdge, searchOpen, searchQuery, message,
  viewerRef, containerRef, labelLayerRef, searchInputRef, onPointerInside, onOverview, onArrange,
  onToggleConnect, onRename, onDelete, onSearchQuery, onCloseSearch, onSelectSearchNode, onRetry,
  settings, onSettingsChange, focusDepth, onFocusDepth, onLocalGraph, onFit, onOpenSelected,
  contextMenu, onCloseContextMenu, onAnimate, animating = false, visibleNodeCount,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseMenuRef = useRef(onCloseContextMenu);
  onCloseMenuRef.current = onCloseContextMenu;

  useLayoutEffect(() => {
    if (!contextMenu) return;
    const placeMenu = () => {
      const bounds = viewerRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!bounds || !menu) return;
      setMenuPosition({
        x: Math.max(6, Math.min(contextMenu.x, bounds.width - menu.width - 6)),
        y: Math.max(6, Math.min(contextMenu.y, bounds.height - menu.height - 6)),
      });
    };
    placeMenu();
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(placeMenu);
    if (viewerRef.current) resizeObserver?.observe(viewerRef.current);
    return () => {
      resizeObserver?.disconnect();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [contextMenu, viewerRef]);

  useEffect(() => {
    if (!contextMenu) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) onCloseMenuRef.current();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [contextMenu]);

  const matches = searchQuery.trim()
    ? graph.nodes.filter((node) => node.title.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase())).slice(0, 8)
    : [];
  const { degreeById } = getKnowledgeGraphIndex(graph);
  const hasFilterMatches = visibleNodeCount != null ? visibleNodeCount > 0 : graph.nodes.some((node) => !settings.hiddenTypes.includes(node.node_type)
    && (settings.showOrphans || (degreeById.get(node.id) ?? 0) > 0)
    && (!searchQuery.trim() || node.title.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase())));
  const nodeTypes = [...new Set(graph.nodes.map((node) => node.node_type))].sort();
  const hasContent = Boolean(selectedNode && (
    (selectedNode.ref_type === "qa" && selectedNode.ref_id != null)
    || (["course", "file"].includes(selectedNode.ref_type ?? "") && selectedNode.ref_path)
  ));
  const changeForce = (key: keyof GraphSettings["forces"], value: number) => {
    onSettingsChange({ ...settings, forces: { ...settings.forces, [key]: value } });
  };
  const menuAction = (action: () => void) => { onCloseContextMenu(); action(); };
  const closeTransient = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f") {
      setSettingsOpen(false);
      return;
    }
    if (event.key !== "Escape" || (!contextMenu && !settingsOpen)) return;
    event.preventDefault();
    event.stopPropagation();
    if (contextMenu) onCloseContextMenu();
    else { setSettingsOpen(false); settingsButtonRef.current?.focus(); }
  };
  const navigateMenu = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) return;
    if (event.key === "Tab") { onCloseContextMenu(); return; }
    event.preventDefault();
    event.stopPropagation();
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div ref={viewerRef} className={`knowledge-viewer obsidian-graph ${compact ? "compact" : ""}`}
      tabIndex={0} aria-label={viewMode === "focus" ? "局部知识网络" : "知识网络"}
      onPointerEnter={() => onPointerInside(true)} onPointerLeave={() => onPointerInside(false)} onKeyDown={closeTransient}>
      <div className="knowledge-body">
        <div className="knowledge-canvas-shell">
          <div ref={containerRef} className="knowledge-canvas" />
          <div ref={labelLayerRef} className="knowledge-label-layer" aria-hidden="true" />
          {searchOpen ? <div className="knowledge-search graph-search-overlay" role="search">
            <input ref={searchInputRef} value={searchQuery} onChange={(event) => onSearchQuery(event.target.value)} placeholder="搜索节点" aria-label="搜索知识网络节点" />
            <button className="graph-icon-button" onClick={onCloseSearch} aria-label="关闭搜索"><X size={15} /></button>
            {matches.length ? <div className="knowledge-search-results">
              {matches.map((node) => <button key={node.id} onClick={() => onSelectSearchNode(node)}>{node.title}</button>)}
            </div> : searchQuery.trim() ? <span className="graph-search-empty">没有匹配的节点</span> : null}
          </div> : null}
          {graph.nodes.length === 0 ? <div className="knowledge-empty-overlay">
            {message ? <><strong>加载失败</strong><span>{message}</span><button className="secondary-button compact" onClick={onRetry}>重试</button></>
              : <><Network size={27} strokeWidth={1.2} aria-hidden="true" /><strong>还没有知识节点</strong><span>在助手面板中提问后，知识点和它们的联系会出现在这里。</span></>}
          </div> : null}
          {graph.nodes.length > 0 && !hasFilterMatches ? <div className="knowledge-empty-overlay graph-filter-empty" role="status">
            <Search size={24} strokeWidth={1.2} aria-hidden="true" />
            <strong>没有匹配的节点</strong><span>调整搜索内容或节点筛选条件。</span>
            <button className="graph-setting-action" onClick={() => {
              onSearchQuery(""); onSettingsChange({ ...settings, showOrphans: true, hiddenTypes: [] });
            }}>清除筛选</button>
            {viewMode === "focus" ? <button className="graph-setting-action" onClick={onOverview}>返回全图</button> : null}
          </div> : null}
        </div>
      </div>

      <div className="knowledge-graph-toolbar" role="toolbar" aria-label="知识网络工具">
        {viewMode === "focus" ? <span className="graph-local-title" title={selectedNode?.title}>局部关系图</span> : null}
        <button className={`graph-icon-button ${viewMode === "overview" ? "is-active" : ""}`} title="全览" aria-label="全览" onClick={onOverview}><Globe2 size={16} /></button>
        <button className={`graph-icon-button ${viewMode === "focus" ? "is-active" : ""}`} title="查看局部关系图" aria-label="查看局部关系图" disabled={!selectedNode && viewMode !== "focus"} onClick={onLocalGraph}><GitBranch size={16} /></button>
        <button className="graph-icon-button" title="适应画布" aria-label="适应画布" onClick={onFit} disabled={!graph.nodes.length}><Focus size={16} /></button>
        <button ref={settingsButtonRef} className={`graph-icon-button ${settingsOpen ? "is-active" : ""}`} title={settingsOpen ? "关闭图谱设置" : "打开图谱设置"}
          aria-label={settingsOpen ? "关闭图谱设置" : "打开图谱设置"} aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}><Settings size={16} /></button>
      </div>

      {settingsOpen ? <aside className="knowledge-graph-settings" aria-label="图谱设置">
        <div className="graph-settings-heading"><span>图谱设置</span><button className="graph-icon-button" title="恢复默认设置" aria-label="恢复默认设置" onClick={() => {
          onSettingsChange({ ...DEFAULT_GRAPH_SETTINGS, hiddenTypes: [], forces: { ...DEFAULT_GRAPH_SETTINGS.forces } }); onSearchQuery("");
        }}><RotateCcw size={14} /></button></div>
        <GraphSection title="筛选" open>
          <div className="graph-filter-search"><Search size={13} aria-hidden="true" /><input aria-label="筛选节点" placeholder="搜索节点…" value={searchQuery} onChange={(event) => onSearchQuery(event.target.value)} />
            {searchQuery ? <button className="graph-icon-button" aria-label="清除筛选" onClick={() => onSearchQuery("")}><X size={12} /></button> : null}</div>
          {viewMode === "focus" ? <GraphSlider label="局部图深度" value={focusDepth} min={1} max={5} step={1} onChange={onFocusDepth} /> : null}
          <GraphSwitch label="显示孤立节点" checked={settings.showOrphans} onChange={(showOrphans) => onSettingsChange({ ...settings, showOrphans })} />
          {nodeTypes.map((type) => <GraphSwitch key={type} label={TYPE_NAMES[type] ?? type} checked={!settings.hiddenTypes.includes(type)} onChange={(shown) => {
            onSettingsChange({ ...settings, hiddenTypes: shown ? settings.hiddenTypes.filter((hidden) => hidden !== type) : [...settings.hiddenTypes, type] });
          }} />)}
        </GraphSection>
        <GraphSection title="分组">
          <p className="graph-settings-note">按连接数量区分颜色</p>
          <div className="graph-color-groups">{["无连接", "1 个连接", "2 个连接", "3 个连接", "4 个连接", "5 个及以上连接"].map((label, index) => <div className="graph-color-group" key={label}>
            <i className={`graph-color-swatch graph-color-${index}`} aria-hidden="true" /><span>{label}</span>
          </div>)}</div>
        </GraphSection>
        <GraphSection title="显示">
          <GraphSwitch label="显示箭头" checked={settings.arrows} onChange={(arrows) => onSettingsChange({ ...settings, arrows })} />
          <GraphSlider label="文字渐隐阈值" value={settings.textFade} min={0} max={1} onChange={(textFade) => onSettingsChange({ ...settings, textFade })} />
          <GraphSlider label="节点大小" value={settings.nodeSize} min={0.5} max={3} step={0.1} onChange={(nodeSize) => onSettingsChange({ ...settings, nodeSize })} />
          <GraphSlider label="连线粗细" value={settings.linkWidth} min={0.2} max={3} step={0.1} onChange={(linkWidth) => onSettingsChange({ ...settings, linkWidth })} />
          {onAnimate ? <button className="graph-setting-action" onClick={onAnimate}>{animating ? <Square size={13} /> : <Play size={13} />}<span>{animating ? "停止播放" : "播放时间动画"}</span></button> : null}
        </GraphSection>
        <GraphSection title="作用力">
          <GraphSlider label="中心力" value={settings.forces.center} min={0} max={1} onChange={(value) => changeForce("center", value)} />
          <GraphSlider label="排斥力" value={settings.forces.repel} min={0} max={20} step={0.1} onChange={(value) => changeForce("repel", value)} />
          <GraphSlider label="连线引力" value={settings.forces.link} min={0} max={1} onChange={(value) => changeForce("link", value)} />
          <GraphSlider label="连线距离" value={settings.forces.distance} min={30} max={200} step={1} onChange={(value) => changeForce("distance", value)} />
          <button className="graph-setting-action" onClick={onArrange} disabled={graph.nodes.length < 2}><RotateCcw size={13} /><span>重新布局</span></button>
        </GraphSection>
      </aside> : null}

      {connectMode ? <div className="knowledge-graph-connect-hint" role="status"><Link2 size={13} /><span>{message || "选择两个节点建立连接"}</span><button className="graph-icon-button" aria-label="取消连线" onClick={onToggleConnect}><X size={14} /></button></div>
        : message && graph.nodes.length > 0 ? <div className="knowledge-graph-status" role="status">{message}</div> : null}

      {contextMenu ? <div ref={menuRef} className="knowledge-graph-context-menu" role="menu" aria-label="知识网络操作" style={{ left: menuPosition.x, top: menuPosition.y }} onKeyDown={navigateMenu} onContextMenu={(event) => event.preventDefault()}>
        {selectedNode ? <><div className="graph-menu-title">{selectedNode.title}</div>
          <button role="menuitem" disabled={!hasContent} onClick={() => menuAction(onOpenSelected)}><ArrowUpRight size={14} /><span>打开</span></button>
          <button role="menuitem" onClick={() => menuAction(onLocalGraph)}><GitBranch size={14} /><span>查看局部关系图</span></button>
          {viewMode === "focus" ? <button role="menuitem" onClick={() => menuAction(onOverview)}><Globe2 size={14} /><span>返回全图</span></button> : null}
          <button role="menuitem" onClick={() => menuAction(onToggleConnect)}><Link2 size={14} /><span>{connectMode ? "取消连线" : "开始连线"}</span></button>
          <div role="separator" />
          <button role="menuitem" onClick={() => menuAction(onRename)}><Pencil size={14} /><span>重命名</span></button>
          <button role="menuitem" className="is-danger" onClick={() => menuAction(onDelete)}><Trash2 size={14} /><span>删除节点</span></button>
        </> : selectedEdge ? <button role="menuitem" className="is-danger" onClick={() => menuAction(onDelete)}><Trash2 size={14} /><span>删除关系</span></button>
          : <><button role="menuitem" onClick={() => menuAction(onOverview)}><Globe2 size={14} /><span>返回全图</span></button>
            <button role="menuitem" onClick={() => menuAction(onFit)}><Focus size={14} /><span>适应画布</span></button>
            <button role="menuitem" onClick={() => menuAction(onArrange)} disabled={graph.nodes.length < 2}><RotateCcw size={14} /><span>重新布局</span></button></>}
      </div> : null}
    </div>
  );
}
