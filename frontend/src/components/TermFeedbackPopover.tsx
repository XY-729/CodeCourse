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
    left: Math.max(12, Math.min(position.x, window.innerWidth - 272)),
    top: Math.max(12, Math.min(position.y, window.innerHeight - 220)),
    zIndex: 1000,
    pointerEvents: "auto",
  };

  return (
    <div ref={popoverRef} style={popoverStyle} className="term-feedback-popover">
      <div className="term-feedback-header">
        <strong>{conceptName}</strong>
        <button
          type="button"
          onClick={onClose}
          className="icon-button"
          aria-label="关闭"
        >
          ×
        </button>
      </div>

      {definition && (
        <p className="term-feedback-definition">{definition}</p>
      )}

      {status === "done" && (
        <p className="term-feedback-status success">已记录</p>
      )}
      {status === "error" && (
        <p className="term-feedback-status error">{errorMsg}</p>
      )}

      <div className="term-feedback-actions">
        {manualStatus !== "known" && (
          <button
            type="button"
            disabled={status === "loading"}
            onClick={handleMarkKnown}
            className="term-feedback-action"
          >
            ✓ 我认识
          </button>
        )}
        {manualStatus !== "unknown" && (
          <button
            type="button"
            disabled={status === "loading"}
            onClick={handleMarkUnknown}
            className="term-feedback-action"
          >
            ? 我不认识
          </button>
        )}
        {manualStatus !== null && (
          <button
            type="button"
            disabled={status === "loading"}
            onClick={handleClearOverride}
            className="term-feedback-action warning"
          >
            ↺ 清除判断
          </button>
        )}
      </div>

      {manualStatus === "known" && (
        <p className="term-feedback-current success">当前：已标记为认识</p>
      )}
      {manualStatus === "unknown" && (
        <p className="term-feedback-current error">当前：已标记为不认识</p>
      )}
    </div>
  );
}
