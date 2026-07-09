import { ChevronRight, File, Folder, Star } from "lucide-react";
import { useState } from "react";
import type { TreeNode } from "../api/client";

type Props = {
  node: TreeNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
};

function TreeItem({ node, selectedPath, onSelect }: Props) {
  const [open, setOpen] = useState(node.path === "");
  const isFile = node.type === "file";
  const selected = isFile && selectedPath === node.path;

  function click() {
    if (isFile) {
      onSelect(node.path);
      return;
    }
    setOpen(!open);
  }

  return (
    <div className="tree-item">
      <button className={`tree-row ${selected ? "selected" : ""}`} onClick={click} title={node.path || node.name}>
        <ChevronRight size={14} className={open && !isFile ? "chevron open" : "chevron"} />
        {isFile ? <File size={14} /> : <Folder size={14} />}
        <span>{node.name}</span>
        {node.is_key_file ? <Star size={12} className="key-file" /> : null}
      </button>
      {!isFile && open ? (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeItem key={child.path || child.name} node={child} selectedPath={selectedPath} onSelect={onSelect} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function FileTree(props: Props) {
  return <TreeItem {...props} />;
}
