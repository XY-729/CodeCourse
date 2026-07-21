import { useEffect, useRef } from "react";
import GestureDrawer, { type GestureDrawerOptions, type GesturePath } from "../gestures/GestureDrawer";

export const GESTURE_COMPLETE_EVENT = "codecourse:gesture-complete";

type Props = GestureDrawerOptions & {
  onGestureEnd?: (path: GesturePath) => void;
};

/** Bridges global right-button pointer events to the gesture-agnostic drawer. */
export default function GestureLayer({ lineWidth = 4, opacity = 0.68, color, onGestureEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const callbackRef = useRef(onGestureEnd);

  useEffect(() => {
    callbackRef.current = onGestureEnd;
  }, [onGestureEnd]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const resolveColor = () =>
      color || getComputedStyle(document.documentElement).getPropertyValue("--gesture-stroke").trim() || "#16826b";
    const drawer = new GestureDrawer(canvas, { lineWidth, opacity, color: resolveColor() });
    let activePointerId: number | null = null;
    let suppressContextMenu = false;
    let suppressTimer: number | null = null;

    const resize = () => drawer.resize(window.innerWidth, window.innerHeight);
    const clearSuppressTimer = () => {
      if (suppressTimer !== null) window.clearTimeout(suppressTimer);
      suppressTimer = null;
    };
    const armContextMenuSuppression = () => {
      clearSuppressTimer();
      suppressContextMenu = true;
      suppressTimer = window.setTimeout(() => {
        suppressContextMenu = false;
        suppressTimer = null;
      }, 1500);
    };
    const finish = () => {
      if (!drawer.isDrawing) return;
      const path = drawer.end();
      activePointerId = null;
      document.documentElement.classList.remove("gesture-drawing");

      // Both interfaces are intentionally generic so recognition can be added later.
      callbackRef.current?.(path);
      window.dispatchEvent(new CustomEvent<GesturePath>(GESTURE_COMPLETE_EVENT, { detail: path }));
      drawer.clear();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 2) return;
      drawer.configure({ lineWidth, opacity, color: resolveColor() });
      drawer.start(event.clientX, event.clientY);
      activePointerId = event.pointerId;
      document.documentElement.classList.add("gesture-drawing");
      armContextMenuSuppression();
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId || !drawer.isDrawing) return;
      if ((event.buttons & 2) === 0) {
        finish();
        return;
      }

      const samples = event.getCoalescedEvents?.() ?? [event];
      for (const sample of samples) drawer.move(sample.clientX, sample.clientY);
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId === activePointerId && event.button === 2) finish();
    };
    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerId === activePointerId) finish();
    };
    const handleContextMenu = (event: MouseEvent) => {
      if (!suppressContextMenu) return;
      event.preventDefault();
      suppressContextMenu = false;
      clearSuppressTimer();
      // Do not stop propagation: existing CodeCourse selection menus may still respond.
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") finish();
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("blur", finish);
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearSuppressTimer();
      drawer.clear();
      document.documentElement.classList.remove("gesture-drawing");
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", finish);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [color, lineWidth, opacity]);

  return <canvas ref={canvasRef} className="gesture-drawer-canvas" aria-hidden="true" />;
}
