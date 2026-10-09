import { useLayoutEffect, useRef } from "react";

type Props = {
  activeKey: string | null;
  className?: string;
};

/**
 * A compositor-only selection plate. The indicator measures sibling items
 * marked with data-selection-key, then moves with transform instead of
 * animating layout properties.
 */
export default function SlidingSelectionIndicator({ activeKey, className = "" }: Props) {
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const readyRef = useRef(false);

  useLayoutEffect(() => {
    const indicator = indicatorRef.current;
    const container = indicator?.parentElement;
    if (!indicator || !container) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const item = activeKey == null ? null : Array.from(container.querySelectorAll<HTMLElement>("[data-selection-key]"))
        .find((candidate) => candidate.dataset.selectionKey === activeKey);
      if (!item) {
        indicator.dataset.visible = "false";
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      indicator.style.setProperty("--selection-x", `${itemRect.left - containerRect.left}px`);
      const width = Math.max(1, itemRect.width);
      indicator.style.setProperty("--selection-width", String(width));
      indicator.style.setProperty("--selection-width-px", `${width}px`);
      indicator.dataset.visible = "true";
      if (!readyRef.current) {
        indicator.dataset.ready = "false";
        requestAnimationFrame(() => {
          readyRef.current = true;
          indicator.dataset.ready = "true";
        });
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resizeObserver?.observe(container);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-selection-key"] });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [activeKey]);

  return <span ref={indicatorRef} className={`sliding-selection-indicator ${className}`.trim()} aria-hidden="true" />;
}
