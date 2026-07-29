import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { PointerEvent, ReactNode } from "react";
import {
  animateSpringY,
  cancelSpring,
  project,
  readTranslateY,
  rubberband,
  sheetBackdropProgress,
  sheetOpenProgress,
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
};

export type FluidBottomSheetHandle = {
  dismiss: (velocity?: number) => void;
};

const FluidBottomSheet = forwardRef<FluidBottomSheetHandle, Props>(function FluidBottomSheet(
  { children, className = "", label, onDismiss },
  forwardedRef,
) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const draggedRef = useRef(false);
  const dismissingRef = useRef(false);
  const onDismissRef = useRef(onDismiss);
  const entryStartRef = useRef(1);
  const entryFramesRef = useRef<number[]>([]);
  const gestureRef = useRef<{
    pointerId: number;
    startClientY: number;
    startPresentationY: number;
    dragging: boolean;
    samples: Sample[];
  } | null>(null);

  onDismissRef.current = onDismiss;

  function cancelEntryFrames() {
    for (const frame of entryFramesRef.current) {
      window.cancelAnimationFrame(frame);
    }
    entryFramesRef.current = [];
  }

  function updateBackdrop(sheet: HTMLElement, position: number) {
    const layer = sheet.parentElement;
    if (!layer) return;
    const openProgress = sheetOpenProgress(position, entryStartRef.current);
    const effect = sheetBackdropProgress(position, entryStartRef.current);
    sheet.dataset.openProgress = openProgress.toFixed(4);
    sheet.dataset.backdropProgress = effect.toFixed(4);
    layer.style.setProperty("--sheet-scrim-alpha", String(effect * 0.24));
    layer.style.setProperty("--sheet-backdrop-blur", `${effect * 10}px`);
  }

  function dismiss(velocity = 0) {
    const sheet = sheetRef.current;
    if (!sheet || dismissingRef.current) return;
    cancelEntryFrames();
    dismissingRef.current = true;
    sheet.dataset.motionPhase = "exiting";
    const target = Math.max(entryStartRef.current, sheet.getBoundingClientRect().height - 2);
    animateSpringY(sheet, target, {
      damping: velocity > 0 ? 0.88 : 1,
      response: 0.3,
      velocity,
      onUpdate: (position) => updateBackdrop(sheet, position),
      onComplete: () => onDismissRef.current(),
    });
  }

  useImperativeHandle(forwardedRef, () => ({ dismiss }), []);

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    const start = Math.max(sheet.getBoundingClientRect().height - 2, 2);
    entryStartRef.current = start;
    sheet.dataset.entryStartY = String(start);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      sheet.style.transform = "translate3d(0, 0, 0)";
      sheet.dataset.motionPhase = "open";
      updateBackdrop(sheet, 0);
      return;
    }

    // Commit a real closed presentation before starting the spring. Two RAFs
    // guarantee Android WebView paints one frame with only the sheet's top
    // border visible at the bottom edge.
    sheet.dataset.motionPhase = "primed";
    sheet.style.transform = `translate3d(0, ${start}px, 0)`;
    updateBackdrop(sheet, start);
    const firstFrame = window.requestAnimationFrame(() => {
      const secondFrame = window.requestAnimationFrame(() => {
        sheet.dataset.motionPhase = "entering";
        animateSpringY(sheet, 0, {
          damping: 1,
          response: 0.32,
          onUpdate: (position) => updateBackdrop(sheet, position),
          onComplete: () => {
            sheet.dataset.motionPhase = "open";
          },
        });
      });
      entryFramesRef.current = [secondFrame];
    });
    entryFramesRef.current = [firstFrame];
    return () => {
      cancelEntryFrames();
      cancelSpring(sheet);
    };
  }, []);

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    const sheet = sheetRef.current;
    if (!sheet || event.button !== 0) return;

    cancelEntryFrames();
    cancelSpring(sheet);
    draggedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    const presentationY = readTranslateY(sheet);
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
    sheet.style.transform = `translate3d(0, ${next}px, 0)`;
    updateBackdrop(sheet, next);

    gesture.samples.push({ position: next, time: event.timeStamp });
    const cutoff = event.timeStamp - 120;
    gesture.samples = gesture.samples.filter((sample) => sample.time >= cutoff).slice(-6);
  }

  function finishGesture(event: PointerEvent<HTMLButtonElement>) {
    const sheet = sheetRef.current;
    const gesture = gestureRef.current;
    if (!sheet || !gesture || gesture.pointerId !== event.pointerId) return;

    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!gesture.dragging) return;
    event.preventDefault();
    draggedRef.current = true;

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
