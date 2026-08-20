import type { SplitDirection } from "./layout";

const ANCHOR_CLASSES = [
  "cc-frozen-row-start",
  "cc-frozen-row-end",
  "cc-frozen-column-start",
  "cc-frozen-column-end",
] as const;

export type FrozenPaneState = {
  element: HTMLElement;
  wasFrozen: boolean;
  anchorClasses: string[];
  width: string;
  height: string;
  layer: string;
};

export function clearFrozenPane(pane: HTMLElement) {
  pane.classList.remove("cc-frozen", ...ANCHOR_CLASSES);
  pane.style.removeProperty("--drag-pane-width");
  pane.style.removeProperty("--drag-pane-height");
  pane.style.removeProperty("--drag-pane-layer");
}

export function clearFrozenDocuments(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(".reader-pane.cc-frozen").forEach(clearFrozenPane);
}

export function restoreFrozenPanes(states: FrozenPaneState[]) {
  states.forEach((state) => {
    clearFrozenPane(state.element);
    if (state.wasFrozen) state.element.classList.add("cc-frozen");
    state.anchorClasses.forEach((className) => state.element.classList.add(className));
    if (state.width) state.element.style.setProperty("--drag-pane-width", state.width);
    if (state.height) state.element.style.setProperty("--drag-pane-height", state.height);
    if (state.layer) state.element.style.setProperty("--drag-pane-layer", state.layer);
  });
}

export function freezeWorkspaceDocuments(
  root: HTMLElement,
  targetSplit: HTMLElement,
  direction: SplitDirection,
): FrozenPaneState[] {
  const panes = Array.from(root.querySelectorAll<HTMLElement>(".reader-pane"));
  const directChildren = Array.from(targetSplit.children);
  const firstChild = directChildren.find((child) => child.classList.contains("first"));
  const secondChild = directChildren.find((child) => child.classList.contains("second"));

  return panes.map((pane, index) => {
    const state: FrozenPaneState = {
      element: pane,
      wasFrozen: pane.classList.contains("cc-frozen"),
      anchorClasses: ANCHOR_CLASSES.filter((className) => pane.classList.contains(className)),
      width: pane.style.getPropertyValue("--drag-pane-width"),
      height: pane.style.getPropertyValue("--drag-pane-height"),
      layer: pane.style.getPropertyValue("--drag-pane-layer"),
    };
    const viewer = pane.querySelector<HTMLElement>(".pane-body > .viewer");
    const rect = (viewer ?? pane).getBoundingClientRect();

    clearFrozenPane(pane);
    pane.classList.add("cc-frozen");
    pane.style.setProperty("--drag-pane-width", `${rect.width}px`);
    pane.style.setProperty("--drag-pane-height", `${rect.height}px`);
    pane.style.setProperty("--drag-pane-layer", String(index + 1));

    if (firstChild?.contains(pane)) {
      pane.classList.add(direction === "row" ? "cc-frozen-row-start" : "cc-frozen-column-start");
    } else if (secondChild?.contains(pane)) {
      pane.classList.add(direction === "row" ? "cc-frozen-row-end" : "cc-frozen-column-end");
    }
    return state;
  });
}
