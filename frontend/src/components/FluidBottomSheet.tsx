import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { PointerEvent, ReactNode } from "react";
import {
  animateSpringY,
  cancelSpring,
  project,
  readTranslateY,
  rubberband,
  sheetBackdropProgress,
} from "../gestures/fluidMotion";

type Sample = {
  position: number;
  time: number;
};

type Props = {
  children: ReactNode;
  className?: string;
  label: string;
  onDismiss: () => void;
  onMotionPhaseChange?: (phase: "entering" | "open" | "exiting") => void;
};

export type FluidBottomSheetHandle = {
  dismiss: (velocity?: number) => void;
};

const FluidBottomSheet = forwardRef<FluidBottomSheetHandle, Props>(function FluidBottomSheet(
  { children, className = "", label, onDismiss, onMotionPhaseChange },
  forwardedRef,
) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const draggedRef = useRef(false);
  const dismissingRef = useRef(false);
  const onDismissRef = useRef(onDismiss);
  const entryStartRef = useRef(1);
  const measuredHeightRef = useRef(0);
  const entryFramesRef = useRef<number[]>([]);
  const dragPaintFrameRef = useRef<number | null>(null);
  const pendingDragPositionRef = useRef<number | null>(null);
  const gestureRef = useRef<{
    pointerId: number;
    startClientY: number;
    startPresentationY: number;
    dragging: boolean;
    samples: Sample[];
  } | null>(null);
  const onMotionPhaseChangeRef = useRef(onMotionPhaseChange);

  onDismissRef.current = onDismiss;
  onMotionPhaseChangeRef.current = onMotionPhaseChange;

  function cancelEntryFrames() {
    for (const frame of entryFramesRef.current) {
      window.cancelAnimationFrame(frame);
    }
    entryFramesRef.current = [];
  }

  function updateBackdrop(sheet: HTMLElement, position: number) {
    const layer = sheet.parentElement;
    if (!layer) return;
    const effect = sheetBackdropProgress(position, entryStartRef.current);
    layer.style.setProperty("--sheet-scrim-alpha", String(effect * 0.24));
    layer.style.setProperty("--sheet-scrim-opacity", String(effect));
  }

  function paintDragPosition(sheet: HTMLElement, position: number) {
    sheet.style.transform = `translate3d(0, ${position}px, 0)`;
    updateBackdrop(sheet, position);
  }

  function scheduleDragPaint(sheet: HTMLElement, position: number) {
    pendingDragPositionRef.current = position;
    if (dragPaintFrameRef.current !== null) return;
    dragPaintFrameRef.current = window.requestAnimationFrame(() => {
      dragPaintFrameRef.current = null;
      const next = pendingDragPositionRef.current;
      pendingDragPositionRef.current = null;
      if (next !== null) paintDragPosition(sheet, next);
    });
  }

  function flushDragPaint(sheet: HTMLElement) {
    if (dragPaintFrameRef.current !== null) {
      window.cancelAnimationFrame(dragPaintFrameRef.current);
      dragPaintFrameRef.current = null;
    }
    const next = pendingDragPositionRef.current;
    pendingDragPositionRef.current = null;
    if (next !== null) paintDragPosition(sheet, next);
  }

  function dismiss(velocity = 0) {
    const sheet = sheetRef.current;
    if (!sheet || dismissingRef.current) return;
    cancelEntryFrames();
    dismissingRef.current = true;
    sheet.dataset.contentSuspended = "true";
    sheet.dataset.motionPhase = "exiting";
    if (sheet.parentElement) sheet.parentElement.dataset.sheetMotionPhase = "exiting";
    onMotionPhaseChangeRef.current?.("exiting");
    const target = Math.max(entryStartRef.current, measuredHeightRef.current - 2);
    animateSpringY(sheet, target, {
      damping: velocity > 0 ? 0.88 : 1,
      response: 0.3,
      velocity,
      onUpdate: (position) => updateBackdrop(sheet, position),
      onComplete: () => {
        onDismissRef.current();
      },
    });
  }

  useImperativeHandle(forwardedRef, () => ({ dismiss }), []);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      measuredHeightRef.current = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
    });
    observer.observe(sheet);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    const start = Math.max(sheet.clientHeight - 2, 2);
    measuredHeightRef.current = sheet.clientHeight;
    entryStartRef.current = start;
    sheet.dataset.entryStartY = String(start);
    sheet.style.setProperty("--sheet-entry-y", `${start}px`);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      sheet.style.transform = "translate3d(0, 0, 0)";
      sheet.dataset.motionPhase = "open";
      if (sheet.parentElement) sheet.parentElement.dataset.sheetMotionPhase = "open";
      updateBackdrop(sheet, 0);
      onMotionPhaseChangeRef.current?.("open");
      return;
    }

    // The shell is already mounted at its closed transform. One frame starts
    // a compositor-only transition before heavy drawer content is attached.
    sheet.style.transform = `translate3d(0, ${start}px, 0)`;
    updateBackdrop(sheet, start);
    const firstFrame = window.requestAnimationFrame(() => {
      sheet.dataset.motionPhase = "entering";
      if (sheet.parentElement) sheet.parentElement.dataset.sheetMotionPhase = "entering";
      onMotionPhaseChangeRef.current?.("entering");
      sheet.style.transform = "translate3d(0, 0, 0)";
      updateBackdrop(sheet, 0);
    });
    entryFramesRef.current = [firstFrame];
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== sheet || event.propertyName !== "transform" || dismissingRef.current) return;
      sheet.dataset.motionPhase = "open";
      if (sheet.parentElement) sheet.parentElement.dataset.sheetMotionPhase = "open";
      onMotionPhaseChangeRef.current?.("open");
    };
    sheet.addEventListener("transitionend", onTransitionEnd);
    const fallback = window.setTimeout(() => {
      if (!dismissingRef.current && sheet.dataset.motionPhase !== "open") {
        sheet.dataset.motionPhase = "open";
        if (sheet.parentElement) sheet.parentElement.dataset.sheetMotionPhase = "open";
        onMotionPhaseChangeRef.current?.("open");
      }
    }, 240);
    return () => {
      cancelEntryFrames();
      window.clearTimeout(fallback);
      sheet.removeEventListener("transitionend", onTransitionEnd);
      cancelSpring(sheet);
      if (dragPaintFrameRef.current !== null) {
        window.cancelAnimationFrame(dragPaintFrameRef.current);
        dragPaintFrameRef.current = null;
      }
    };
  }, []);

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    const sheet = sheetRef.current;
    if (!sheet || dismissingRef.current || event.button !== 0) return;

    cancelEntryFrames();
    cancelSpring(sheet);
    draggedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    const presentationY = readTranslateY(sheet);
    if (sheet.parentElement) sheet.parentElement.dataset.sheetDragging = "true";
    gestureRef.current = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startPresentationY: presentationY,
      dragging: false,
      samples: [{ position: presentationY, time: event.timeStamp }],
    };
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const sheet = sheetRef.current;
    const gesture = gestureRef.current;
    if (!sheet || !gesture || gesture.pointerId !== event.pointerId) return;

    const delta = event.clientY - gesture.startClientY;
    if (!gesture.dragging && Math.abs(delta) < 10) return;
    gesture.dragging = true;

    let next = gesture.startPresentationY + delta;
    if (next < 0) {
      next = rubberband(next, Math.max(sheet.clientHeight, 1));
    }
    scheduleDragPaint(sheet, next);

    gesture.samples.push({ position: next, time: event.timeStamp });
    const cutoff = event.timeStamp - 120;
    gesture.samples = gesture.samples.filter((sample) => sample.time >= cutoff).slice(-6);
  }

  function finishGesture(event: PointerEvent<HTMLButtonElement>) {
    const sheet = sheetRef.current;
    const gesture = gestureRef.current;
    if (!sheet || !gesture || gesture.pointerId !== event.pointerId) return;

    gestureRef.current = null;
    if (sheet.parentElement) delete sheet.parentElement.dataset.sheetDragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!gesture.dragging) return;
    event.preventDefault();
    draggedRef.current = true;

    flushDragPaint(sheet);

    const samples = gesture.samples;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsed = Math.max(last.time - first.time, 1);
    const velocity = ((last.position - first.position) / elapsed) * 1000;
    const current = readTranslateY(sheet);
    const projected = current + project(velocity);
    const dismissThreshold = Math.min(sheet.clientHeight * 0.38, 260);
    const shouldDismiss = velocity > 620 || projected > dismissThreshold;

    if (shouldDismiss) {
      dismiss(velocity);
    } else {
      animateSpringY(sheet, 0, {
        damping: 1,
        response: 0.36,
        velocity,
        onUpdate: (position) => updateBackdrop(sheet, position),
        onComplete: () => {
          sheet.dataset.motionPhase = "open";
          if (sheet.parentElement) sheet.parentElement.dataset.sheetMotionPhase = "open";
        },
      });
    }
  }

  return (
    <section
      ref={sheetRef}
      className={`fluid-bottom-sheet ${className}`.trim()}
      aria-label={label}
      data-entry-edge="bottom"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="fluid-sheet-grabber"
        aria-label={`下拉关闭${label}`}
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={finishGesture}
        onClick={() => {
          if (draggedRef.current) {
            draggedRef.current = false;
            return;
          }
          dismiss();
        }}
      >
        <span aria-hidden="true" />
      </button>
      {children}
    </section>
  );
});

export default FluidBottomSheet;
