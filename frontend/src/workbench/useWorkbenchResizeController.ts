import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { measureDesktopInteraction } from "../performance/desktopPerformance";
import {
  applySplitRatios,
  calculateSplitRatios,
  type LayoutNode,
} from "./layout";
import type { SplitResizeStart } from "./WorkbenchLayoutTree";
import { clearFrozenDocuments, restoreFrozenPanes } from "./workspaceFreeze";

const ASSISTANT_WIDTH_STORAGE_KEY = "codecourse.assistantWidth";

export type WorkbenchResizeState =
  | { kind: "sidebar-width"; startX: number; startWidth: number }
  | { kind: "explain-width"; startX: number; startWidth: number }
  | SplitResizeStart;

type Options = {
  mobile: boolean;
  commitLayoutChange: (updater: (current: LayoutNode) => LayoutNode) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function initialAssistantWidth() {
  const stored = Number(window.localStorage.getItem(ASSISTANT_WIDTH_STORAGE_KEY));
  return Number.isFinite(stored) && stored > 0 ? clamp(stored, 340, 520) : 400;
}

function releasePointer(drag: SplitResizeStart) {
  try {
    drag.handleElement.releasePointerCapture?.(drag.pointerId);
  } catch {
    // The browser may already have released capture after a cancelled pointer.
  }
}

export function useWorkbenchResizeController({ mobile, commitLayoutChange }: Options) {
  const [sidebarWidth, setSidebarWidth] = useState(264);
  const [assistantWidth, setAssistantWidth] = useState(initialAssistantWidth);
  const [dragState, setDragState] = useState<WorkbenchResizeState | null>(null);
  const resizeStartedAtRef = useRef(0);
  const dragStateRef = useRef<WorkbenchResizeState | null>(null);
  const rootResizeObserverRef = useRef<ResizeObserver | null>(null);
  const observedRootSizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    window.localStorage.setItem(ASSISTANT_WIDTH_STORAGE_KEY, String(Math.round(assistantWidth)));
  }, [assistantWidth]);

  function observeWorkspaceRoot(root: HTMLElement) {
    rootResizeObserverRef.current?.disconnect();
    const rect = root.getBoundingClientRect();
    observedRootSizeRef.current = { width: rect.width, height: rect.height };
    if (typeof ResizeObserver === "undefined") return;
    rootResizeObserverRef.current = new ResizeObserver(([entry]) => {
      if (!entry || dragStateRef.current?.kind === "split") return;
      const { width, height } = entry.contentRect;
      const previous = observedRootSizeRef.current;
      if (Math.abs(width - previous.width) <= 0.5 && Math.abs(height - previous.height) <= 0.5) return;
      observedRootSizeRef.current = { width, height };
      clearFrozenDocuments(root);
    });
    rootResizeObserverRef.current.observe(root);
  }

  useEffect(() => () => rootResizeObserverRef.current?.disconnect(), []);

  useEffect(() => {
    if (!dragState) {
      document.documentElement.style.removeProperty("--nav-width");
      document.documentElement.style.removeProperty("--explain-width");
      return;
    }

    if (!mobile) resizeStartedAtRef.current = performance.now();
    const currentDrag = dragState;
    let frame = 0;
    let finalized = false;
    let latestX = currentDrag.startX;
    let latestY = currentDrag.kind === "split" ? currentDrag.startY : 0;
    let latestRatios = new Map<string, number>();

    function clearLiveSplitPreview() {
      if (currentDrag.kind !== "split") return;
      currentDrag.splitElements.forEach((element) => element.style.removeProperty("--split-ratio"));
    }

    function applyDragFrame() {
      frame = 0;
      if (currentDrag.kind === "sidebar-width") {
        const width = clamp(currentDrag.startWidth + latestX - currentDrag.startX, 240, 360);
        document.documentElement.style.setProperty("--nav-width", `${width}px`);
      } else if (currentDrag.kind === "explain-width") {
        const width = clamp(currentDrag.startWidth - (latestX - currentDrag.startX), 340, 520);
        document.documentElement.style.setProperty("--explain-width", `${width}px`);
      } else {
        const delta = currentDrag.direction === "row" ? latestX - currentDrag.startX : latestY - currentDrag.startY;
        const nextBoundary = clamp(currentDrag.startBoundary + delta, currentDrag.minBoundary, currentDrag.maxBoundary);
        const offset = nextBoundary - currentDrag.startBoundary;
        latestRatios = new Map<string, number>();
        calculateSplitRatios(
          currentDrag.layoutSnapshot,
          currentDrag.rootBounds,
          currentDrag.boundaries,
          currentDrag.splitId,
          nextBoundary,
          latestRatios,
        );
        latestRatios.forEach((ratio, splitId) => {
          currentDrag.splitElements.get(splitId)?.style.setProperty("--split-ratio", String(ratio));
        });
        currentDrag.indicator.style.transform = currentDrag.direction === "row"
          ? `translate3d(${offset}px, 0, 0)`
          : `translate3d(0, ${offset}px, 0)`;
      }
    }

    function updatePointer(clientX: number, clientY: number) {
      latestX = clientX;
      latestY = clientY;
      if (!frame) frame = window.requestAnimationFrame(applyDragFrame);
    }

    function finishDrag(clientX: number, clientY: number) {
      if (finalized) return;
      finalized = true;
      latestX = clientX;
      latestY = clientY;
      if (frame) window.cancelAnimationFrame(frame);
      applyDragFrame();

      if (currentDrag.kind === "sidebar-width") {
        setSidebarWidth(clamp(currentDrag.startWidth + clientX - currentDrag.startX, 240, 360));
      } else if (currentDrag.kind === "explain-width") {
        setAssistantWidth(clamp(currentDrag.startWidth - (clientX - currentDrag.startX), 340, 520));
      } else {
        const delta = currentDrag.direction === "row" ? clientX - currentDrag.startX : clientY - currentDrag.startY;
        const finalBoundary = clamp(
          currentDrag.startBoundary + delta,
          currentDrag.minBoundary,
          currentDrag.maxBoundary,
        );
        latestRatios = new Map<string, number>();
        calculateSplitRatios(
          currentDrag.layoutSnapshot,
          currentDrag.rootBounds,
          currentDrag.boundaries,
          currentDrag.splitId,
          finalBoundary,
          latestRatios,
        );
        flushSync(() => {
          commitLayoutChange((current) => applySplitRatios(current, latestRatios));
          setDragState(null);
        });
        clearLiveSplitPreview();
        observeWorkspaceRoot(currentDrag.rootElement);
        releasePointer(currentDrag);
      }

      if (currentDrag.kind !== "split") setDragState(null);
      window.dispatchEvent(new Event("codecourse:resize-end"));
      if (!mobile) {
        measureDesktopInteraction("workspace-resize", resizeStartedAtRef.current, { resize_kind: currentDrag.kind });
      }
    }

    function cancelDrag(pointerId?: number) {
      if (finalized) return;
      if (pointerId !== undefined && currentDrag.kind === "split" && pointerId !== currentDrag.pointerId) return;
      finalized = true;
      if (frame) window.cancelAnimationFrame(frame);
      clearLiveSplitPreview();
      if (currentDrag.kind === "split") {
        restoreFrozenPanes(currentDrag.frozenPanes);
        releasePointer(currentDrag);
      }
      setDragState(null);
      window.dispatchEvent(new Event("codecourse:resize-end"));
    }

    const onMouseMove = (event: MouseEvent) => updatePointer(event.clientX, event.clientY);
    const onMouseUp = (event: MouseEvent) => finishDrag(event.clientX, event.clientY);
    const onPointerMove = (event: PointerEvent) => {
      if (currentDrag.kind === "split" && event.pointerId === currentDrag.pointerId) {
        const samples = event.getCoalescedEvents?.();
        const latest = samples?.length ? samples[samples.length - 1] : event;
        updatePointer(latest.clientX, latest.clientY);
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (currentDrag.kind === "split" && event.pointerId === currentDrag.pointerId) {
        finishDrag(event.clientX, event.clientY);
      }
    };
    const onPointerCancel = (event: PointerEvent) => cancelDrag(event.pointerId);
    const onBlur = () => cancelDrag();

    if (currentDrag.kind === "split") {
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
    } else {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("blur", onBlur);
    document.body.classList.add(currentDrag.kind === "split" && currentDrag.direction === "row" ? "resizing-x" : currentDrag.kind.includes("width") ? "resizing-x" : "resizing-y");

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onBlur);
      document.body.classList.remove("resizing-x", "resizing-y");
      if (currentDrag.kind === "split") {
        currentDrag.indicator.remove();
        if (!finalized) {
          clearLiveSplitPreview();
          restoreFrozenPanes(currentDrag.frozenPanes);
          releasePointer(currentDrag);
        }
      }
    };
  }, [commitLayoutChange, dragState, mobile]);

  useEffect(() => {
    const reanchorFrozenDocuments = () => clearFrozenDocuments();
    window.addEventListener("resize", reanchorFrozenDocuments);
    return () => window.removeEventListener("resize", reanchorFrozenDocuments);
  }, []);

  return { sidebarWidth, setSidebarWidth, assistantWidth, dragState, setDragState };
}
