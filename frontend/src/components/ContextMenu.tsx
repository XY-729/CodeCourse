import { useEffect } from "react";
import type { AnnotationType } from "../types";
import { ANNOTATION_COLORS, ANNOTATION_LABELS } from "../types";

type Props = {
  x: number;
  y: number;
  onClose: () => void;
  onAnnotation: (type: AnnotationType) => void;
  onExplain: () => void;
};

const ANNOTATION_TYPES: AnnotationType[] = ["highlight", "important", "question", "concept", "code"];

export default function ContextMenu({ x, y, onClose, onAnnotation, onExplain }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - 280);

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
        {ANNOTATION_TYPES.map((type) => (
          <button
            key={type}
            className="context-menu-item"
            onClick={() => {
              onAnnotation(type);
              onClose();
            }}
          >
            <span
              className="annotation-badge"
              style={{ backgroundColor: ANNOTATION_COLORS[type] }}
            />
            {ANNOTATION_LABELS[type]}
          </button>
        ))}
        <div className="context-menu-separator" />
        <button
          className="context-menu-item"
          onClick={() => {
            onExplain();
            onClose();
          }}
        >
          解释这段
        </button>
        <div className="context-menu-separator" />
        <button className="context-menu-item" onClick={onClose}>
          取消
        </button>
      </div>
    </>
  );
}
