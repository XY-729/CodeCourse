import { ChevronRight, File, Folder, Star } from "lucide-react";
import { useState } from "react";
import type { TreeNode } from "../api/client";

type Props = {
  node: TreeNode;
  selectedPath: string | null;
  selectedScopePaths?: string[];
  fileSelectionMode?: boolean;
  onSelect: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onDragItem?: (kind: "file", path: string) => void;
};

function TreeItem({
  node,
  selectedPath,
  selectedScopePaths = [],
  fileSelectionMode = false,
  onSelect,
  onOpenFile,
  onDragItem,
}: Props) {
  const [open, setOpen] = useState(node.path === "");
  const isFile = node.type === "file";
  const selected = isFile && selectedPath === node.path;
  const scopeSelected = isFile && selectedScopePaths.includes(node.path);

  function click(detail: number) {
    if (isFile && fileSelectionMode && detail > 1) {
      return;
    }
    if (isFile) {
      onSelect(node.path);
      return;
    }
    setOpen(!open);
  }

  return (
    <div className="tree-item">
      <button
        className={`tree-row ${selected ? "selected" : ""} ${scopeSelected ? "scope-selected" : ""}`}
        onClick={(event) => click(event.detail)}
        onDoubleClick={(event) => {
          if (!isFile || !fileSelectionMode) {
            return;
          }
          event.stopPropagation();
          onOpenFile?.(node.path);
        }}
        title={isFile ? `${node.path}${fileSelectionMode ? " - 点击选择，双击打开" : " - 可拖拽到中间工作区"}` : node.path || node.name}
        draggable={isFile}
        onDragStart={(event) => {
          if (!isFile) {
            return;
          }
          event.dataTransfer.setData("application/codecourse-item", JSON.stringify({ kind: "file", path: node.path }));
          event.dataTransfer.effectAllowed = "copy";
          onDragItem?.("file", node.path);
        }}
      >
        <ChevronRight size={14} className={open && !isFile ? "chevron open" : "chevron"} />
        {isFile ? <File size={14} /> : <Folder size={14} />}
        <span>{node.name}</span>
        {node.is_key_file ? <Star size={12} className="key-file" /> : null}
      </button>
      {!isFile && open ? (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeItem
              key={child.path || child.name}
              node={child}
              selectedPath={selectedPath}
              selectedScopePaths={selectedScopePaths}
              fileSelectionMode={fileSelectionMode}
              onSelect={onSelect}
              onOpenFile={onOpenFile}
              onDragItem={onDragItem}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function FileTree(props: Props) {
  return <TreeItem {...props} />;
}
