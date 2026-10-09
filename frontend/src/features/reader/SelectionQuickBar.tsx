import { useLayoutEffect, useRef } from "react";
import { Bot, Copy, Eraser, GitFork, Highlighter, Sparkles, X } from "lucide-react";
import type { ViewerAnchorRect } from "./CodeViewer";

type Props = {
  canHighlight: boolean;
  highlighted: boolean;
  anchorRect?: ViewerAnchorRect;
  onAsk: () => void;
  onExplainTerm: () => void;
  onCallGuide?: () => void;
  onToggleHighlight: () => void;
  onCopy: () => void;
  onClose: () => void;
};

export default function SelectionQuickBar({
  canHighlight,
  highlighted,
  anchorRect,
  onAsk,
  onExplainTerm,
  onCallGuide,
  onToggleHighlight,
  onCopy,
  onClose,
}: Props) {
  const barRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || !anchorRect) {
      return;
    }
    const margin = 12;
    const gap = 10;
    const liveAnchorRect = () => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(".temp-selection, .monaco-persistent-selection-inline"))
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight);
      if (candidates.length === 0) return anchorRect;
      const targetX = anchorRect.left + anchorRect.width / 2;
      const targetY = anchorRect.top + anchorRect.height / 2;
      return candidates.reduce((best, rect) => {
        const distance = Math.hypot(rect.left + rect.width / 2 - targetX, rect.top + rect.height / 2 - targetY);
        const bestDistance = Math.hypot(best.left + best.width / 2 - targetX, best.top + best.height / 2 - targetY);
        return distance < bestDistance ? rect : best;
      });
    };
    const measure = () => {
      const currentAnchor = liveAnchorRect();
      const barRect = bar.getBoundingClientRect();
      const preferredLeft = currentAnchor.left + currentAnchor.width / 2 - barRect.width / 2;
      const left = Math.min(window.innerWidth - barRect.width - margin, Math.max(margin, preferredLeft));
      const roomAbove = currentAnchor.top - gap - barRect.height;
      const placement = roomAbove >= margin ? "top" : "bottom";
      const top = placement === "top"
        ? roomAbove
        : Math.min(window.innerHeight - barRect.height - margin, currentAnchor.bottom + gap);
      bar.style.setProperty("--selection-bar-left", `${left}px`);
      bar.style.setProperty("--selection-bar-top", `${top}px`);
      bar.dataset.placement = placement;
      bar.dataset.anchored = "true";
    };
    let frame = 0;
    const scheduleMeasure = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    measure();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(bar);
    window.addEventListener("resize", scheduleMeasure);
    document.addEventListener("scroll", scheduleMeasure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      document.removeEventListener("scroll", scheduleMeasure, true);
    };
  }, [anchorRect]);

  return (
    <div
      ref={barRef}
      className="selection-quick-bar"
      role="toolbar"
      aria-label="选区操作"
    >
      <button onClick={onAsk}><Bot size={14} />提问</button>
      <button onClick={onExplainTerm}><Sparkles size={14} />解释术语</button>
      {onCallGuide ? <button onClick={onCallGuide}><GitFork size={14} />调用链</button> : null}
      {canHighlight ? (
        <button onClick={onToggleHighlight}>
          {highlighted ? <Eraser size={14} /> : <Highlighter size={14} />}
          {highlighted ? "取消高亮" : "高亮"}
        </button>
      ) : null}
      <button onClick={onCopy}><Copy size={14} />复制</button>
      <button className="icon-button" onClick={onClose} title="取消选区" aria-label="取消选区"><X size={14} /></button>
    </div>
  );
}
