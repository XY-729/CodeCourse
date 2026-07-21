import { Fragment, useEffect, useRef } from "react";
import GestureDrawer, { type GestureDrawerOptions, type GesturePath } from "../gestures/GestureDrawer";
import { recognizeGesture, type GestureShape } from "../gestures/GestureRecognizer";

export const GESTURE_COMPLETE_EVENT = "codecourse:gesture-complete";

type Props = GestureDrawerOptions & {
  onGestureEnd?: (path: GesturePath) => void;
};

/** Bridges global right-button pointer events to the gesture-agnostic drawer. */
export default function GestureLayer({ lineWidth = 4, opacity = 0.68, color, onGestureEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hintRef = useRef<HTMLDivElement | null>(null);
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
    let suppressContextMenuPropagation = false;
    let suppressTimer: number | null = null;
    let progressFrame: number | null = null;

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
    const pathLength = (path: GesturePath) => {
      let traveled = 0;
      for (let index = 1; index < path.points.length; index += 1) {
        const previous = path.points[index - 1];
        const point = path.points[index];
        traveled += Math.hypot(point.x - previous.x, point.y - previous.y);
      }
      return traveled;
    };
    const hintLabel = (gesture: GestureShape) => {
      const labels: Record<Exclude<GestureShape, "invalid">, string> = {
        left: "← 松开：返回工作区",
        right: "→ 松开：下一个文档",
        up: "↑ 松开：恢复关闭的文档",
        down: "↓ 松开：关闭当前文档",
        "up-left": "↑← 松开：打开源码",
        "up-right": "↑→ 松开：打开搜索",
        "down-left": "↓← 松开：打开 AI 助手",
        "down-right": "↓→ 松开：打开课程目录",
      };
      return gesture === "invalid" ? "继续绘制，松开取消" : labels[gesture];
    };
    const updateLiveHint = (path: GesturePath, initial = false) => {
      const hint = hintRef.current;
      const point = path.points[path.points.length - 1];
      if (!hint || !point) return;

      const traveled = pathLength(path);
      hint.textContent = initial || traveled < 24
        ? "右键拖动：绘制快捷手势"
        : hintLabel(recognizeGesture(path));
      hint.style.left = `${Math.min(Math.max(12, point.x + 16), Math.max(12, window.innerWidth - 250))}px`;
      hint.style.top = `${Math.min(Math.max(12, point.y - 44), Math.max(12, window.innerHeight - 48))}px`;
      hint.hidden = false;
    };
    const hideLiveHint = () => {
      if (hintRef.current) hintRef.current.hidden = true;
    };
    const emitProgress = () => {
      if (progressFrame !== null) return;
      progressFrame = window.requestAnimationFrame(() => {
        progressFrame = null;
        updateLiveHint(drawer.getCurrentPath());
      });
    };
    const finish = () => {
      if (!drawer.isDrawing) return;
      if (progressFrame !== null) {
        window.cancelAnimationFrame(progressFrame);
        progressFrame = null;
      }
      const path = drawer.end();
      let traveled = 0;
      for (let index = 1; index < path.points.length; index += 1) {
        const previous = path.points[index - 1];
        const point = path.points[index];
        traveled += Math.hypot(point.x - previous.x, point.y - previous.y);
      }
      suppressContextMenuPropagation = traveled >= 12;
      activePointerId = null;
      document.documentElement.classList.remove("gesture-drawing");
      hideLiveHint();

      // Drawing stays gesture-agnostic; consumers decide how to recognize the path.
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
      updateLiveHint(drawer.getCurrentPath(), true);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId || !drawer.isDrawing) return;
      if ((event.buttons & 2) === 0) {
        finish();
        return;
      }

      const samples = event.getCoalescedEvents?.() ?? [event];
      for (const sample of samples) drawer.move(sample.clientX, sample.clientY);
      emitProgress();
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
      if (suppressContextMenuPropagation) {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      suppressContextMenu = false;
      suppressContextMenuPropagation = false;
      clearSuppressTimer();
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
      if (progressFrame !== null) window.cancelAnimationFrame(progressFrame);
      hideLiveHint();
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

  return (
    <Fragment>
      <canvas ref={canvasRef} className="gesture-drawer-canvas" aria-hidden="true" />
      <div
        ref={hintRef}
        className="gesture-hint gesture-hint-live gesture-live-hint"
        role="status"
        aria-live="polite"
        hidden
      />
    </Fragment>
  );
}
