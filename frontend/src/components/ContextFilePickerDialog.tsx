import { Check, FolderOpen, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  files: string[];
  selected: string[];
  currentPath: string | null;
  onConfirm: (files: string[]) => void;
  onClose: () => void;
};

function fileLabel(path: string) {
  return path.split("/").pop() ?? path;
}

function directoryPrefix(path: string) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

export default function ContextFilePickerDialog({ open, files, selected, currentPath, onConfirm, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setDraft(selected);
    }
  }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((path) => {
      if (path.toLowerCase().includes(needle)) return true;
      return fileLabel(path).toLowerCase().includes(needle);
    });
  }, [files, query]);

  if (!open) return null;

  const toggle = (path: string) => {
    setDraft((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    );
  };

  return (
    <div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="app-dialog context-file-picker-dialog" role="dialog" aria-label="选择参考文件">
        <header className="context-file-picker-header">
          <div className="modal-title">
            <span><FolderOpen size={15} />选择参考文件</span>
            <button type="button" className="icon-button" onClick={onClose} aria-label="关闭" title="关闭"><X size={16} /></button>
          </div>
        </header>
        <p className="context-file-picker-hint">提问时会一并检索这些文件中的代码，实现跨文件问答。当前打开的文件已包含在内。</p>
        <div className="context-file-picker-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索文件…"
            aria-label="搜索文件"
            autoFocus
          />
        </div>
        <div className="context-file-picker-list" role="listbox" aria-label="项目文件">
          {filtered.length === 0 ? (
            <div className="context-file-picker-empty">没有匹配的文件</div>
          ) : filtered.map((path) => {
            const depth = directoryPrefix(path) ? directoryPrefix(path).split("/").length : 0;
            const checked = draft.includes(path);
            const isCurrent = currentPath != null && path === currentPath;
            return (
              <label
                key={path}
                className={`context-file-picker-item ${checked ? "selected" : ""}`}
                style={{ paddingLeft: `${12 + depth * 16}px` }}
              >
                <span className={`picker-checkbox ${checked ? "checked" : ""}`} aria-hidden="true">
                  {checked ? <Check size={12} /> : null}
                </span>
                <input type="checkbox" checked={checked} onChange={() => toggle(path)} aria-label={path} />
                <span className="picker-file-name">{fileLabel(path)}</span>
                <span className="picker-file-path">{directoryPrefix(path) || "根目录"}</span>
                {isCurrent ? <span className="picker-current-badge">当前</span> : null}
              </label>
            );
          })}
        </div>
        <div className="app-dialog-actions context-file-picker-actions">
          <span className="context-file-picker-count">已选 {draft.length} 个文件</span>
          <button type="button" className="secondary-button compact" onClick={onClose}>取消</button>
          <button type="button" className="primary-button compact" onClick={() => onConfirm(draft)}>确定</button>
        </div>
      </div>
    </div>
  );
}
