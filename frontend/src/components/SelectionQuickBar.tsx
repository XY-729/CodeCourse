import { useLayoutEffect, useRef, useState } from "react";
import { Bot, Copy, Highlighter, X } from "lucide-react";
import type { ViewerAnchorRect } from "./CodeViewer";

type Props = {
  canHighlight: boolean;
  anchorRect?: ViewerAnchorRect;
  onAsk: () => void;
  onHighlight: () => void;
  onCopy: () => void;
  onClose: () => void;
};

export default function SelectionQuickBar({ canHighlight, anchorRect, onAsk, onHighlight, onCopy, onClose }: Props) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; placement: "top" | "bottom" } | null>(null);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || !anchorRect) {
      setPosition(null);
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
      setPosition({ left, top, placement });
    };
    measure();
    const startedAt = performance.now();
    let frame = 0;
    const followLayout = () => {
      measure();
      if (performance.now() - startedAt < 320) frame = window.requestAnimationFrame(followLayout);
    };
    frame = window.requestAnimationFrame(followLayout);
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
    };
  }, [anchorRect]);

  return (
    <div
      ref={barRef}
      className={`selection-quick-bar ${position ? `anchored ${position.placement}` : "fallback"}`}
      style={position ? { left: position.left, top: position.top } : undefined}
      role="toolbar"
      aria-label="选区操作"
    >
      <button onClick={onAsk}><Bot size={14} />提问</button>
      {canHighlight ? <button onClick={onHighlight}><Highlighter size={14} />高亮</button> : null}
      <button onClick={onCopy}><Copy size={14} />复制</button>
      <button className="icon-button" onClick={onClose} title="取消选区"><X size={14} /></button>
    </div>
  );
}
