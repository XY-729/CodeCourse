/**
 * Minimal term feedback popover for the personalized learning vertical slice.
 *
 * Supports: view term name, "I know this", "I don't know this", "Clear my judgment".
 * All operations are idempotent (duplicate clicks = no-op).
 */
import { useState, useEffect, useRef, type CSSProperties } from "react";
import type { PersonalizationMastery, PersonalizationMarkResult } from "../api/client";
import {
  markConceptKnown,
  markConceptUnknown,
  clearConceptOverride,
} from "../api/client";

// ---- Output callbacks (decoupled from rendering) ----

export interface TermFeedbackCallbacks {
  /** Called after a mark-known/unknown/clear operation completes, with the updated mastery */
  onMasteryChanged?: (conceptId: string, mastery: PersonalizationMastery) => void;
}

// ---- Props ----

interface Props {
  /** The concept to show feedback for */
  conceptId: string;
  conceptName: string;
  definition?: string;
  /** Current mastery state (may be null if not yet loaded) */
  mastery?: PersonalizationMastery | null;
  /** Project ID for API calls */
  projectId: number;
  /** Position (relative to the clicked term) */
  position: { x: number; y: number };
  callbacks?: TermFeedbackCallbacks;
  onClose: () => void;
}

export default function TermFeedbackPopover({
  conceptId,
  conceptName,
  definition,
  mastery,
  projectId,
  position,
  callbacks,
  onClose,
}: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  // Auto-dismiss on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid capturing the triggering click
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // Auto-dismiss on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const manualStatus = mastery?.manualStatus ?? null;

  async function handleMarkKnown() {
    setStatus("loading");
    setErrorMsg("");
    const key = `mark-known:${projectId}:${conceptId}:${Date.now()}`;
    try {
      const result: PersonalizationMarkResult = await markConceptKnown(projectId, conceptId, key);
      callbacks?.onMasteryChanged?.(conceptId, result.mastery);
      setStatus("done");
      setTimeout(onClose, 600);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function handleMarkUnknown() {
    setStatus("loading");
    setErrorMsg("");
    const key = `mark-unknown:${projectId}:${conceptId}:${Date.now()}`;
    try {
      const result: PersonalizationMarkResult = await markConceptUnknown(projectId, conceptId, key);
      callbacks?.onMasteryChanged?.(conceptId, result.mastery);
      setStatus("done");
      setTimeout(onClose, 600);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function handleClearOverride() {
    setStatus("loading");
    setErrorMsg("");
    const key = `clear-override:${projectId}:${conceptId}:${Date.now()}`;
    try {
      const result: PersonalizationMarkResult = await clearConceptOverride(projectId, conceptId, key);
      callbacks?.onMasteryChanged?.(conceptId, result.mastery);
      setStatus("done");
      setTimeout(onClose, 600);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "操作失败");
    }
  }

  const popoverStyle: CSSProperties = {
    position: "fixed",
    left: Math.min(position.x, window.innerWidth - 280),
    top: Math.min(position.y, window.innerHeight - 200),
    width: 260,
    zIndex: 1000,
    background: "var(--apple-bg-elevated, #fff)",
    border: "1px solid var(--apple-border, #ddd)",
    borderRadius: 10,
    boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
    padding: 14,
    fontSize: 13,
    fontFamily: "system-ui, sans-serif",
    pointerEvents: "auto",
  };

  return (
    <div ref={popoverRef} style={popoverStyle} className="term-feedback-popover">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>{conceptName}</strong>
        <button
          type="button"
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "2px 6px", color: "#999" }}
          aria-label="关闭"
        >
          ×
        </button>
      </div>

      {definition && (
        <p style={{ margin: "0 0 8px 0", color: "#666", fontSize: 12, lineHeight: 1.5 }}>{definition}</p>
      )}

      {status === "done" && (
        <p style={{ margin: "0 0 8px 0", color: "#4caf50", fontSize: 12 }}>已记录</p>
      )}
      {status === "error" && (
        <p style={{ margin: "0 0 8px 0", color: "#f44336", fontSize: 12 }}>{errorMsg}</p>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {manualStatus !== "known" && (
          <button
            type="button"
            disabled={status === "loading"}
            onClick={handleMarkKnown}
            style={actionButtonStyle}
          >
            ✓ 我认识
          </button>
        )}
        {manualStatus !== "unknown" && (
          <button
            type="button"
            disabled={status === "loading"}
            onClick={handleMarkUnknown}
            style={actionButtonStyle}
          >
            ? 我不认识
          </button>
        )}
        {manualStatus !== null && (
          <button
            type="button"
            disabled={status === "loading"}
            onClick={handleClearOverride}
            style={{ ...actionButtonStyle, color: "#ff9800", borderColor: "#ff9800" }}
          >
            ↺ 清除判断
          </button>
        )}
      </div>

      {manualStatus === "known" && (
        <p style={{ margin: "6px 0 0 0", fontSize: 11, color: "#4caf50" }}>当前：已标记为认识</p>
      )}
      {manualStatus === "unknown" && (
        <p style={{ margin: "6px 0 0 0", fontSize: 11, color: "#f44336" }}>当前：已标记为不认识</p>
      )}
    </div>
  );
}

const actionButtonStyle: CSSProperties = {
  flex: 1,
  minWidth: 70,
  padding: "4px 8px",
  fontSize: 12,
  cursor: "pointer",
  background: "var(--apple-bg, #fff)",
  border: "1px solid var(--apple-border, #ccc)",
  borderRadius: 6,
  color: "var(--apple-text, #333)",
};
