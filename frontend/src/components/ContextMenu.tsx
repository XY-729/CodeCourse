import { useEffect } from "react";
import type { AnnotationColor, AnnotationStyle } from "../types";
import { ALL_COLORS, COLOR_LABELS, COLOR_VALUES } from "../types";

type Props = {
  x: number;
  y: number;
  currentStyle: AnnotationStyle;
  onClose: () => void;
  onSetColor: (color: AnnotationColor | null) => void;
  onToggleBold: () => void;
  onToggleUnderline: () => void;
};

export default function ContextMenu({ x, y, currentStyle, onClose, onSetColor, onToggleBold, onToggleUnderline }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - 220);
  const activeColor = currentStyle.color ?? null;

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
          <button
            className={`toolbar-toggle-btn${currentStyle.bold ? " active" : ""}`}
            onClick={() => {
              onToggleBold();
            }}
          >
            <strong>B</strong> 加粗
          </button>
          <button
            className={`toolbar-toggle-btn${currentStyle.underline ? " active" : ""}`}
            onClick={() => {
              onToggleUnderline();
            }}
          >
            <u>U</u> 下划线
          </button>
        </div>
      </div>
    </>
  );
}
