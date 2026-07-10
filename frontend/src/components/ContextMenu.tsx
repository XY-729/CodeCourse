import { Copy, MessageSquare, Search, X } from "lucide-react";
import { useEffect } from "react";
import type { AnnotationColor, AnnotationStyle } from "../types";
import { ALL_COLORS, COLOR_LABELS, COLOR_VALUES } from "../types";

type Props = {
  x: number;
  y: number;
  sourceType: "file" | "course" | "selection";
  currentStyle: AnnotationStyle;
  onClose: () => void;
  onAskSelection: () => void;
  onExplainSelection: () => void;
  onCopySelection: () => void;
  onClearSelection: () => void;
  onSetColor: (color: AnnotationColor | null) => void;
  onToggleBold: () => void;
  onToggleUnderline: () => void;
};

export default function ContextMenu({
  x,
  y,
  sourceType,
  currentStyle,
  onClose,
  onAskSelection,
  onExplainSelection,
  onCopySelection,
  onClearSelection,
  onSetColor,
  onToggleBold,
  onToggleUnderline,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const left = Math.max(8, Math.min(x, window.innerWidth - 240));
  const top = Math.max(8, Math.min(y, window.innerHeight - 260));
  const activeColor = currentStyle.color ?? null;
  const canAnnotate = sourceType !== "file";

  return (
    <>
      <div
        className="context-menu-overlay"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="context-menu" style={{ left, top }}>
        <div className="toolbar-action-row">
          <button className="toolbar-action-btn" onClick={onAskSelection}>
            <MessageSquare size={14} />
            提问
          </button>
          <button className="toolbar-action-btn" onClick={onExplainSelection}>
            <Search size={14} />
            解释
          </button>
          <button className="toolbar-action-btn" onClick={onCopySelection}>
            <Copy size={14} />
            复制
          </button>
          <button className="toolbar-action-btn danger" onClick={onClearSelection}>
            <X size={14} />
            清除
          </button>
        </div>

        {canAnnotate ? (
          <>
            <div className="toolbar-section-label">颜色</div>
            <div className="toolbar-color-row">
              <button
                className={`toolbar-color-none${activeColor === null ? " active" : ""}`}
                onClick={() => onSetColor(null)}
                title="无色"
              >
                /
              </button>
              {ALL_COLORS.map((color) => (
                <button
                  key={color}
                  className={`toolbar-color-swatch${activeColor === color ? " active" : ""}`}
                  style={{ backgroundColor: COLOR_VALUES[color] }}
                  onClick={() => onSetColor(color)}
                  title={COLOR_LABELS[color]}
                />
              ))}
            </div>

            <div className="toolbar-section-label">样式</div>
            <div className="toolbar-toggle-row">
              <button className={`toolbar-toggle-btn${currentStyle.bold ? " active" : ""}`} onClick={onToggleBold}>
                <strong>B</strong> 加粗
              </button>
              <button className={`toolbar-toggle-btn${currentStyle.underline ? " active" : ""}`} onClick={onToggleUnderline}>
                <u>U</u> 下划线
              </button>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
