import type { ReactNode } from "react";
import {
  MIN_SPLIT_TRACK_SIZE,
  adjacentLeafBounds,
  findSplitNode,
  splitChildBounds,
  type EditorGroup,
  type LayoutBounds,
  type LayoutNode,
  type SplitBoundarySnapshot,
  type SplitDirection,
} from "./layout";
import { freezeWorkspaceDocuments, type FrozenPaneState } from "./workspaceFreeze";

export type SplitResizeStart = {
  kind: "split";
  splitId: string;
  direction: SplitDirection;
  pointerId: number;
  handleElement: HTMLDivElement;
  startX: number;
  startY: number;
  startBoundary: number;
  minBoundary: number;
  maxBoundary: number;
  rootBounds: LayoutBounds;
  rootElement: HTMLDivElement;
  splitElements: Map<string, HTMLDivElement>;
  frozenPanes: FrozenPaneState[];
  indicator: HTMLDivElement;
  layoutSnapshot: LayoutNode;
  boundaries: Map<string, SplitBoundarySnapshot>;
};

type Props = {
  layout: LayoutNode;
  mobile: boolean;
  renderGroup: (group: EditorGroup) => ReactNode;
  onCollapseSplit: (splitId: string, removeSide: "first" | "second") => void;
  onStartResize: (state: SplitResizeStart) => void;
};

function startSplitResize(
  event: React.PointerEvent<HTMLDivElement>,
  node: Extract<LayoutNode, { type: "split" }>,
  layout: LayoutNode,
  onStartResize: (state: SplitResizeStart) => void,
) {
  if (event.button !== 0) return;
  event.preventDefault();
  const element = event.currentTarget.parentElement as HTMLDivElement | null;
  const rootElement = element?.closest(".reader-workspace") as HTMLDivElement | null;
  const rootRect = rootElement?.getBoundingClientRect();
  if (!element || !rootElement || !rootRect) return;

  const rootBounds: LayoutBounds = {
    left: rootRect.left,
    top: rootRect.top,
    right: rootRect.right,
    bottom: rootRect.bottom,
  };
  const splitElements = new Map<string, HTMLDivElement>();
  rootElement.querySelectorAll<HTMLDivElement>(".split-node[data-split-id]").forEach((splitElement) => {
    const splitId = splitElement.dataset.splitId;
    if (splitId) splitElements.set(splitId, splitElement);
  });
  const boundaries = new Map<string, SplitBoundarySnapshot>();
  splitElements.forEach((splitElement, splitId) => {
    const splitRect = splitElement.getBoundingClientRect();
    const handle = Array.from(splitElement.children).find((child) => child.classList.contains("split-resizer"));
    if (!(handle instanceof HTMLElement)) return;
    const handleRect = handle.getBoundingClientRect();
    const direction = splitElement.classList.contains("column") ? "column" : "row";
    boundaries.set(splitId, {
      bounds: {
        left: splitRect.left,
        top: splitRect.top,
        right: splitRect.right,
        bottom: splitRect.bottom,
      },
      position: direction === "row" ? handleRect.left : handleRect.top,
      dividerSize: direction === "row" ? handleRect.width : handleRect.height,
    });
  });

  const targetNode = findSplitNode(layout, node.id);
  const targetSnapshot = boundaries.get(node.id);
  if (!targetNode || !targetSnapshot) return;
  const frozenPanes = freezeWorkspaceDocuments(rootElement, element, node.direction);

  const [firstBounds, secondBounds] = splitChildBounds(
    targetSnapshot.bounds,
    node.direction,
    targetSnapshot.position,
    targetSnapshot.dividerSize,
  );
  const previousPane = adjacentLeafBounds(targetNode.first, firstBounds, node.direction, "second", boundaries);
  const nextPane = adjacentLeafBounds(targetNode.second, secondBounds, node.direction, "first", boundaries);
  const rawMin = node.direction === "row" ? previousPane.left : previousPane.top;
  const rawMax = (node.direction === "row" ? nextPane.right : nextPane.bottom) - targetSnapshot.dividerSize;
  const safeInset = Math.min(MIN_SPLIT_TRACK_SIZE, Math.max(0, (rawMax - rawMin) / 2));
  const handleRect = event.currentTarget.getBoundingClientRect();

  const indicator = document.createElement("div");
  indicator.className = `split-drag-indicator ${node.direction}`;
  indicator.setAttribute("aria-hidden", "true");
  if (node.direction === "row") {
    indicator.style.left = `${handleRect.left + handleRect.width / 2 - 1.5}px`;
    indicator.style.top = `${targetSnapshot.bounds.top}px`;
    indicator.style.height = `${targetSnapshot.bounds.bottom - targetSnapshot.bounds.top}px`;
  } else {
    indicator.style.left = `${targetSnapshot.bounds.left}px`;
    indicator.style.top = `${handleRect.top + handleRect.height / 2 - 1.5}px`;
    indicator.style.width = `${targetSnapshot.bounds.right - targetSnapshot.bounds.left}px`;
  }
  document.body.appendChild(indicator);
  event.currentTarget.setPointerCapture?.(event.pointerId);
  onStartResize({
    kind: "split",
    splitId: node.id,
    direction: node.direction,
    pointerId: event.pointerId,
    handleElement: event.currentTarget,
    startX: event.clientX,
    startY: event.clientY,
    startBoundary: targetSnapshot.position,
    minBoundary: rawMin + safeInset,
    maxBoundary: Math.max(rawMin + safeInset, rawMax - safeInset),
    rootBounds,
    rootElement,
    splitElements,
    frozenPanes,
    indicator,
    layoutSnapshot: layout,
    boundaries,
  });
}

export default function WorkbenchLayoutTree({
  layout,
  mobile,
  renderGroup,
  onCollapseSplit,
  onStartResize,
}: Props) {
  const renderNode = (node: LayoutNode): ReactNode => {
    if (node.type === "group") return renderGroup(node.group);
    return (
      <div key={node.id} className={`split-node ${node.direction}`} data-split-id={node.id}>
        <div className="split-child first" style={{ flex: `var(--split-ratio, ${node.ratio}) 1 0` }}>
          {renderNode(node.first)}
        </div>
        {!mobile ? (
          <div
            className={`split-resizer ${node.direction}`}
            onDoubleClick={() => onCollapseSplit(node.id, node.ratio < 0.5 ? "first" : "second")}
            onPointerDown={(event) => startSplitResize(event, node, layout, onStartResize)}
          />
        ) : null}
        <div className="split-child second" style={{ flex: `calc(1 - var(--split-ratio, ${node.ratio})) 1 0` }}>
          {renderNode(node.second)}
        </div>
      </div>
    );
  };

  return <>{renderNode(layout)}</>;
}
