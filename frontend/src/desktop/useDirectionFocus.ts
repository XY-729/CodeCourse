import { useLayoutEffect, useRef } from "react";

const focusable = 'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])';

/** Own only the active desktop modal; a nested picker returns focus to ASK. */
export function useDirectionFocus(enabled: boolean, selector: string | null, onClose: () => void) {
  const close = useRef(onClose);
  const lastTrigger = useRef<HTMLElement | null>(null);
  close.current = onClose;
  useLayoutEffect(() => {
    if (!enabled) return;
    // Remember the trigger before a child dialog's autoFocus runs.
    const pointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(focusable) : null;
      if (target) lastTrigger.current = target;
    };
    const focus = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && !target.closest('.direction-overlays')) lastTrigger.current = target;
    };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('focusin', focus, true);
    return () => { document.removeEventListener('pointerdown', pointer, true); document.removeEventListener('focusin', focus, true); };
  }, [enabled]);
  useLayoutEffect(() => {
    if (!enabled || !selector) return;
    const previous = lastTrigger.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    let surface: HTMLElement | null = null;
    const candidates = () => Array.from(surface?.querySelectorAll<HTMLElement>(focusable) ?? [])
      .filter(element => element.getClientRects().length > 0 && !element.closest('[hidden],[inert]'));
    const acquire = () => {
      if (surface?.isConnected) return;
      surface = document.querySelector<HTMLElement>(selector);
      if (!surface) return;
      surface.setAttribute('role', 'dialog');
      surface.setAttribute('aria-modal', 'true');
      surface.tabIndex = -1;
      if (!surface.contains(document.activeElement)) (candidates()[0] ?? surface).focus({ preventScroll: true });
    };
    acquire();
    // Lazy-loaded dialogs can arrive after the open flag; never focus behind them.
    const observer = new MutationObserver(acquire);
    observer.observe(document.querySelector('.direction-app') ?? document.body, { childList: true, subtree: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); close.current();
      } else if (event.key === 'Tab') {
        const items = candidates();
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
          event.preventDefault();
          (items[event.shiftKey ? items.length - 1 : 0] ?? surface)?.focus();
        }
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => {
      observer.disconnect(); window.removeEventListener('keydown', keydown, true);
      if (previous?.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
    };
  }, [enabled, selector]);
}
