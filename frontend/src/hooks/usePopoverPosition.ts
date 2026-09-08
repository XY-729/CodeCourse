import { useLayoutEffect, type RefObject } from 'react';

/** Clamp using the rendered size, including wrapped titles and definitions. */
export function usePopoverPosition(ref: RefObject<HTMLElement | null>, position: { x: number; y: number } | undefined, enabled = true) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !position || !element) return;
    const place = () => {
      const rect = element.getBoundingClientRect();
      const topInset = (document.querySelector('.apple-titlebar')?.getBoundingClientRect().bottom ?? 0) + 12;
      element.style.left = `${Math.max(12, Math.min(position.x, innerWidth - rect.width - 12))}px`;
      element.style.top = `${Math.max(topInset, Math.min(position.y, innerHeight - rect.height - 12))}px`;
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    observer?.observe(element);
    window.addEventListener('resize', place);
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); };
  }, [ref, position?.x, position?.y, enabled]);
}
