import type { ReactNode } from "react";
import {
  MIN_SPLIT_TRACK_SIZE,
  adjacentLeafBounds,
  captureSplitBoundaries,
  findSplitNode,
  splitChildBounds,
  type EditorGroup,
  type LayoutBounds,
  type LayoutNode,
  type SplitBoundarySnapshot,
  type SplitDirection,
} from "./layout";

export type SplitResizeStart = {
  kind: "split";
  splitId: string;
  direction: SplitDirection;
  startX: number;
  startY: number;
  startBoundary: number;
  minBoundary: number;
  maxBoundary: number;
  rootBounds: LayoutBounds;
  rootElement: HTMLDivElement;
  splitElements: Map<string, HTMLDivElement>;
  frozenPanes: HTMLDivElement[];
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
  event: React.MouseEvent<HTMLDivElement>,
  node: Extract<LayoutNode, { type: "split" }>,
  layout: LayoutNode,
  onStartResize: (state: SplitResizeStart) => void,
) {
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
  const boundaries = captureSplitBoundaries(layout, rootBounds);
  const targetNode = findSplitNode(layout, node.id);
  const targetSnapshot = boundaries.get(node.id);
  if (!targetNode || !targetSnapshot) return;

  const splitElements = new Map<string, HTMLDivElement>();
  rootElement.querySelectorAll<HTMLDivElement>(".split-node[data-split-id]").forEach((splitElement) => {
    const splitId = splitElement.dataset.splitId;
    if (splitId) splitElements.set(splitId, splitElement);
  });
  /*
   * Freeze every document at its current layout size. During the drag the
   * frozen viewer keeps its exact width/height (no reflow); when a pane is
   * narrower than its frozen document, the document slides under the later
   * (right/bottom) pane, which covers it (layered preview).
   */
  const frozenPanes = Array.from(rootElement.querySelectorAll<HTMLDivElement>(".reader-pane"));
  frozenPanes.forEach((pane) => {
    const rect = pane.getBoundingClientRect();
    pane.style.setProperty("--drag-pane-width", `${rect.width}px`);
    pane.style.setProperty("--drag-pane-height", `${rect.height}px`);
  });

  const [firstBounds, secondBounds] = splitChildBounds(
    targetSnapshot.bounds,
    node.direction,
    targetSnapshot.position,
  );
  const previousPane = adjacentLeafBounds(targetNode.first, firstBounds, node.direction, "second", boundaries);
  const nextPane = adjacentLeafBounds(targetNode.second, secondBounds, node.direction, "first", boundaries);
  const rawMin = node.direction === "row" ? previousPane.left : previousPane.top;
  const rawMax = node.direction === "row" ? nextPane.right : nextPane.bottom;
  const safeInset = Math.min(MIN_SPLIT_TRACK_SIZE, Math.max(2, (rawMax - rawMin) / 3));

  const indicator = document.createElement("div");
  indicator.className = `split-drag-indicator ${node.direction}`;
  indicator.setAttribute("aria-hidden", "true");
  if (node.direction === "row") {
    indicator.style.left = `${targetSnapshot.position - 1}px`;
    indicator.style.top = `${targetSnapshot.bounds.top}px`;
    indicator.style.height = `${targetSnapshot.bounds.bottom - targetSnapshot.bounds.top}px`;
  } else {
    indicator.style.left = `${targetSnapshot.bounds.left}px`;
    indicator.style.top = `${targetSnapshot.position - 1}px`;
    indicator.style.width = `${targetSnapshot.bounds.right - targetSnapshot.bounds.left}px`;
  }
  document.body.appendChild(indicator);
  onStartResize({
    kind: "split",
    splitId: node.id,
    direction: node.direction,
    startX: event.clientX,
    startY: event.clientY,
    startBoundary: targetSnapshot.position,
    minBoundary: rawMin + safeInset,
    maxBoundary: rawMax - safeInset,
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
            onMouseDown={(event) => startSplitResize(event, node, layout, onStartResize)}
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
