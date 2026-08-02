import { useEffect } from "react";

const SURFACE_SELECTOR = [
  ".apple-toolbar",
  ".navigation-panel",
  ".assistant-drawer",
  ".continue-learning-card",
  ".assistant-answer-card",
  ".assistant-stream-card",
  ".qa-stream-card",
  ".apple-popover",
  ".apple-sheet",
  ".app-dialog",
  ".command-palette",
  ".selection-quick-bar",
].join(",");

/**
 * Paints a restrained local highlight without feeding pointer coordinates
 * through React. Only the hovered chrome surface receives CSS variables.
 */
export function useDesktopInteractionLight(enabled: boolean) {
  useEffect(() => {
    if (
      !enabled
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || window.matchMedia("(prefers-reduced-transparency: reduce)").matches
    ) return;

    let frame = 0;
    let latestEvent: PointerEvent | null = null;
    let activeSurface: HTMLElement | null = null;

    const clear = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      latestEvent = null;
      activeSurface?.removeAttribute("data-pointer-lit");
      activeSurface = null;
    };
    const paint = () => {
      frame = 0;
      const event = latestEvent;
      if (!event || document.body.classList.contains("resizing-x") || document.body.classList.contains("resizing-y")) {
        clear();
        return;
      }
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(SURFACE_SELECTOR) : null;
      if (target !== activeSurface) {
        activeSurface?.removeAttribute("data-pointer-lit");
        activeSurface = target;
      }
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--pointer-local-x", `${event.clientX - rect.left}px`);
      target.style.setProperty("--pointer-local-y", `${event.clientY - rect.top}px`);
      target.setAttribute("data-pointer-lit", "true");
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      latestEvent = event;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", clear);
    window.addEventListener("blur", clear);
    return () => {
      clear();
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", clear);
      window.removeEventListener("blur", clear);
    };
  }, [enabled]);
}
