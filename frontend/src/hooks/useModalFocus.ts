import { useEffect, type RefObject } from "react";

/** Keep keyboard navigation inside an open modal and return to its launcher. */
export function useModalFocus(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    const root = ref.current;
    if (!open || !root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () => Array.from(root.querySelectorAll<HTMLElement>("*"))
      .filter((element) => element.matches('button, input, select, textarea, a[href], [tabindex]')
        && element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden], [inert]'));
    const initial = root.querySelector<HTMLElement>('[data-modal-initial-focus]') ?? controls()[0] ?? root;
    initial.focus({ preventScroll: true });
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const elements = controls();
      const first = elements[0] ?? root!;
      const last = elements.at(-1) ?? root!;
      if (event.shiftKey && (document.activeElement === first || !root!.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !root!.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
    root.addEventListener("keydown", trap);
    return () => {
      root.removeEventListener("keydown", trap);
      if (previous?.isConnected && (root.contains(document.activeElement) || document.activeElement === document.body)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [open, ref]);
}
