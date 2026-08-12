import { ChevronRight, File, Folder, Star } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState, type CSSProperties, type UIEvent } from "react";
import type { TreeNode } from "../api/client";
import { isAndroidRuntime } from "../platform/runtime";
import { setCodeCourseDragImage } from "../utils/dragImage";

type Props = {
  node: TreeNode;
  selectedPath: string | null;
  selectedScopePaths?: string[];
  fileSelectionMode?: boolean;
  onSelect: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onDragItem?: (kind: "file", path: string) => void;
};

type VisibleNode = { node: TreeNode; depth: number };

const ROW_HEIGHT = 34;
const VIRTUAL_THRESHOLD = 200;
const OVERSCAN = 8;

function flattenVisible(node: TreeNode, openPaths: Set<string>, depth = 0, output: VisibleNode[] = []): VisibleNode[] {
  output.push({ node, depth });
  if (node.type !== "file" && openPaths.has(node.path)) {
    for (const child of node.children) flattenVisible(child, openPaths, depth + 1, output);
  }
  return output;
}

type RowProps = Props & {
  depth: number;
  open: boolean;
  scopeSelected: boolean;
  style?: CSSProperties;
  onToggle: (path: string) => void;
};

const FileTreeRow = memo(function FileTreeRow({
  node, depth, open, selectedPath, scopeSelected, fileSelectionMode = false,
  onSelect, onOpenFile, onDragItem, onToggle, style,
}: RowProps) {
  const isFile = node.type === "file";
  const selected = isFile && selectedPath === node.path;
  return (
    <div className="tree-item tree-item-flat" style={style}>
      <button
        className={`tree-row ${selected ? "selected" : ""} ${scopeSelected ? "scope-selected" : ""}`}
        style={{ paddingInlineStart: `${8 + depth * 16}px` }}
        onClick={(event) => {
          if (isFile && fileSelectionMode && event.detail > 1) return;
          if (isFile) onSelect(node.path); else onToggle(node.path);
        }}
        onDoubleClick={(event) => {
          if (!isFile || !fileSelectionMode) return;
          event.stopPropagation();
          onOpenFile?.(node.path);
        }}
        aria-expanded={!isFile ? open : undefined}
        title={isFile ? `${node.path}${fileSelectionMode ? " - 点击选择，双击打开" : " - 可拖拽到中间工作区"}` : node.path || node.name}
        draggable={isFile}
        onDragStart={(event) => {
          if (!isFile) return;
          event.dataTransfer.setData("application/codecourse-item", JSON.stringify({ kind: "file", path: node.path }));
          event.dataTransfer.effectAllowed = "copy";
          setCodeCourseDragImage(event.dataTransfer, node.name);
          onDragItem?.("file", node.path);
        }}
      >
        <ChevronRight size={14} className={open && !isFile ? "chevron open" : "chevron"} />
        {isFile ? <File size={14} /> : <Folder size={14} />}
        <span>{node.name}</span>
        {node.is_key_file ? <Star size={12} className="key-file" /> : null}
      </button>
    </div>
  );
});

export default function FileTree(props: Props) {
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => new Set([props.node.path]));
  const [viewport, setViewport] = useState({ top: 0, height: 560 });
  const frameRef = useRef(0);
  const selectedScope = useMemo(() => new Set(props.selectedScopePaths ?? []), [props.selectedScopePaths]);
  const visible = useMemo(() => flattenVisible(props.node, openPaths), [props.node, openPaths]);
  const virtual = isAndroidRuntime() && visible.length > VIRTUAL_THRESHOLD;
  const start = virtual ? Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN) : 0;
  const end = virtual ? Math.min(visible.length, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN) : visible.length;

  const toggle = useCallback((path: string) => {
    setOpenPaths((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  function onScroll(event: UIEvent<HTMLDivElement>) {
    if (!virtual || frameRef.current) return;
    const target = event.currentTarget;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      setViewport({ top: target.scrollTop, height: target.clientHeight });
    });
  }

  const rows = visible.slice(start, end).map(({ node, depth }, index) => (
    <FileTreeRow
      {...props}
      key={node.path || node.name}
      node={node}
      depth={depth}
      open={node.type !== "file" && openPaths.has(node.path)}
      scopeSelected={node.type === "file" && selectedScope.has(node.path)}
      onToggle={toggle}
      style={virtual ? { position: "absolute", insetInline: 0, top: (start + index) * ROW_HEIGHT, height: ROW_HEIGHT } : undefined}
    />
  ));

  return virtual ? (
    <div className="file-tree-virtual" onScroll={onScroll}>
      <div style={{ position: "relative", height: visible.length * ROW_HEIGHT }}>{rows}</div>
    </div>
  ) : <div className="file-tree-flat">{rows}</div>;
}
