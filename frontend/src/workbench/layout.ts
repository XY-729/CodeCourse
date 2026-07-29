import type { DragEvent } from "react";

export type OpenItem = {
  id: string;
  type: "file" | "course" | "qa" | "knowledge_graph";
  path: string;
  title: string;
  content: string;
  language?: string;
  qaRecordId?: number;
  favorite?: boolean;
  dirty?: boolean;
  restoreLine?: number;
  jumpRequest?: {
    id: string;
    line: number;
    align: "start" | "center";
  };
};

export type EditorGroup = {
  id: string;
  items: OpenItem[];
  activeItemId: string | null;
};

export type GroupNode = {
  type: "group";
  group: EditorGroup;
};

export type SplitDirection = "row" | "column";
export type DropZone = "center" | "left" | "right" | "top" | "bottom";

export type SplitNode = {
  type: "split";
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
};

export type LayoutNode = GroupNode | SplitNode;

export type LayoutBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type SplitBoundarySnapshot = {
  bounds: LayoutBounds;
  position: number;
};

export type DropPayload = {
  kind?: string;
  path?: string;
  filename?: string;
  qaId?: number;
  itemId?: string;
  sourceGroupId?: string;
};

export const ROOT_GROUP_ID = "group-1";
export const MAX_GROUPS = 9;
export const MIN_SPLIT_TRACK_SIZE = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function stripLayoutContent(node: LayoutNode): LayoutNode {
  if (node.type === "group") {
    return {
      ...node,
      group: {
        ...node.group,
        items: node.group.items.map((item) => ({ ...item, content: "", dirty: false })),
      },
    };
  }
  return { ...node, first: stripLayoutContent(node.first), second: stripLayoutContent(node.second) };
}

export function normalizeToSingleGroup(node: LayoutNode, preferredActiveItemId?: string | null): GroupNode {
  const items: OpenItem[] = [];
  const seen = new Set<string>();
  function collect(current: LayoutNode) {
    if (current.type === "group") {
      for (const item of current.group.items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
        }
      }
      return;
    }
    collect(current.first);
    collect(current.second);
  }
  collect(node);

  const preferred = preferredActiveItemId && items.some((item) => item.id === preferredActiveItemId)
    ? preferredActiveItemId
    : null;
  return {
    type: "group",
    group: {
      id: ROOT_GROUP_ID,
      items,
      activeItemId: preferred ?? items[0]?.id ?? null,
    },
  };
}

export function resolvePreferredActiveItem(
  items: OpenItem[],
  preferredActiveItemId?: string | null,
): string | null {
  if (
    preferredActiveItemId
    && items.some((item) => item.id === preferredActiveItemId)
  ) {
    return preferredActiveItemId;
  }
  return items[0]?.id ?? null;
}

export function createGroup(id: string): GroupNode {
  return { type: "group", group: { id, items: [], activeItemId: null } };
}

export function createInitialLayout(): LayoutNode {
  return createGroup(ROOT_GROUP_ID);
}

export function countGroups(node: LayoutNode): number {
  return node.type === "group" ? 1 : countGroups(node.first) + countGroups(node.second);
}

export function countLayoutItems(node: LayoutNode): number {
  return node.type === "group"
    ? node.group.items.length
    : countLayoutItems(node.first) + countLayoutItems(node.second);
}

export function findGroup(node: LayoutNode, groupId: string): EditorGroup | null {
  if (node.type === "group") return node.group.id === groupId ? node.group : null;
  return findGroup(node.first, groupId) ?? findGroup(node.second, groupId);
}

export function findOpenItem(node: LayoutNode, itemId: string): OpenItem | null {
  if (node.type === "group") {
    return node.group.items.find((item) => item.id === itemId) ?? null;
  }
  return findOpenItem(node.first, itemId) ?? findOpenItem(node.second, itemId);
}

export function findOpenItemByPath(node: LayoutNode, path: string): OpenItem | null {
  if (node.type === "group") {
    return node.group.items.find((item) => item.path === path) ?? null;
  }
  return findOpenItemByPath(node.first, path) ?? findOpenItemByPath(node.second, path);
}

export function findGroupIdForItem(node: LayoutNode, itemId: string): string | null {
  if (node.type === "group") {
    return node.group.items.some((item) => item.id === itemId) ? node.group.id : null;
  }
  return findGroupIdForItem(node.first, itemId) ?? findGroupIdForItem(node.second, itemId);
}

export function dropPayloadItemId(payload: DropPayload): string | null {
  if (payload.kind === "tab" && payload.itemId) return payload.itemId;
  if (payload.kind === "file" && payload.path) return `file:${payload.path}`;
  if (payload.kind === "course" && payload.filename) return `course:${payload.filename}`;
  if (payload.kind === "qa" && payload.qaId) return `qa:${payload.qaId}`;
  if (payload.kind === "knowledge_graph" || payload.kind === "knowledge") return "knowledge:graph";
  return null;
}

export function calculateSplitRatios(
  node: LayoutNode,
  bounds: LayoutBounds,
  snapshots: Map<string, SplitBoundarySnapshot>,
  targetSplitId: string,
  targetPosition: number,
  ratios: Map<string, number>,
) {
  if (node.type === "group") return;
  const span = node.direction === "row" ? bounds.right - bounds.left : bounds.bottom - bounds.top;
  const start = node.direction === "row" ? bounds.left : bounds.top;
  const storedPosition = snapshots.get(node.id)?.position ?? start + span * node.ratio;
  const requestedPosition = node.id === targetSplitId ? targetPosition : storedPosition;
  const position = clamp(requestedPosition, start + 1, start + Math.max(1, span - 1));
  ratios.set(node.id, clamp((position - start) / Math.max(1, span), 0.001, 0.999));
  const [firstBounds, secondBounds] = splitChildBounds(bounds, node.direction, position);
  calculateSplitRatios(node.first, firstBounds, snapshots, targetSplitId, targetPosition, ratios);
  calculateSplitRatios(node.second, secondBounds, snapshots, targetSplitId, targetPosition, ratios);
}

export function removeGroupFromLayout(node: LayoutNode, groupId: string): LayoutNode | null {
  if (node.type === "group") return node.group.id === groupId ? null : node;
  const first = removeGroupFromLayout(node.first, groupId);
  const second = removeGroupFromLayout(node.second, groupId);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

export function equalizeLayout(node: LayoutNode): LayoutNode {
  if (node.type === "group") return node;
  return { ...node, ratio: 0.5, first: equalizeLayout(node.first), second: equalizeLayout(node.second) };
}

export function collectLayoutItems(node: LayoutNode): OpenItem[] {
  return node.type === "group"
    ? node.group.items
    : [...collectLayoutItems(node.first), ...collectLayoutItems(node.second)];
}

export function dropPayloadCacheKey(projectId: number, payload: DropPayload): string | null {
  const itemId = dropPayloadItemId(payload);
  return itemId ? `${projectId}:${itemId}` : null;
}

export function hasGroup(node: LayoutNode, groupId: string): boolean {
  return Boolean(findGroup(node, groupId));
}

export function firstGroupId(node: LayoutNode): string {
  return node.type === "group" ? node.group.id : firstGroupId(node.first);
}

export function updateGroup(
  node: LayoutNode,
  groupId: string,
  updater: (group: EditorGroup) => EditorGroup,
): LayoutNode {
  if (node.type === "group") {
    return node.group.id === groupId ? { ...node, group: updater(node.group) } : node;
  }
  return {
    ...node,
    first: updateGroup(node.first, groupId, updater),
    second: updateGroup(node.second, groupId, updater),
  };
}

export function updateEveryGroup(
  node: LayoutNode,
  updater: (group: EditorGroup) => EditorGroup,
): LayoutNode {
  if (node.type === "group") return { ...node, group: updater(node.group) };
  return {
    ...node,
    first: updateEveryGroup(node.first, updater),
    second: updateEveryGroup(node.second, updater),
  };
}

export function splitChildBounds(
  bounds: LayoutBounds,
  direction: SplitDirection,
  position: number,
): [LayoutBounds, LayoutBounds] {
  if (direction === "row") {
    return [{ ...bounds, right: position }, { ...bounds, left: position }];
  }
  return [{ ...bounds, bottom: position }, { ...bounds, top: position }];
}

export function captureSplitBoundaries(
  node: LayoutNode,
  bounds: LayoutBounds,
  result = new Map<string, SplitBoundarySnapshot>(),
): Map<string, SplitBoundarySnapshot> {
  if (node.type === "group") return result;
  const span = node.direction === "row" ? bounds.right - bounds.left : bounds.bottom - bounds.top;
  const start = node.direction === "row" ? bounds.left : bounds.top;
  const position = start + span * node.ratio;
  result.set(node.id, { bounds, position });
  const [firstBounds, secondBounds] = splitChildBounds(bounds, node.direction, position);
  captureSplitBoundaries(node.first, firstBounds, result);
  captureSplitBoundaries(node.second, secondBounds, result);
  return result;
}

export function findSplitNode(node: LayoutNode, splitId: string): SplitNode | null {
  if (node.type === "group") return null;
  if (node.id === splitId) return node;
  return findSplitNode(node.first, splitId) ?? findSplitNode(node.second, splitId);
}

export function adjacentLeafBounds(
  node: LayoutNode,
  bounds: LayoutBounds,
  direction: SplitDirection,
  edge: "first" | "second",
  snapshots: Map<string, SplitBoundarySnapshot>,
): LayoutBounds {
  if (node.type === "group" || node.direction !== direction) return bounds;
  const snapshot = snapshots.get(node.id);
  if (!snapshot) return bounds;
  const [firstBounds, secondBounds] = splitChildBounds(bounds, direction, snapshot.position);
  return edge === "first"
    ? adjacentLeafBounds(node.first, firstBounds, direction, edge, snapshots)
    : adjacentLeafBounds(node.second, secondBounds, direction, edge, snapshots);
}

export function rebuildLayoutFromBoundaries(
  node: LayoutNode,
  bounds: LayoutBounds,
  snapshots: Map<string, SplitBoundarySnapshot>,
  targetSplitId: string,
  targetPosition: number,
  ratios: Map<string, number>,
): LayoutNode {
  if (node.type === "group") return node;
  const span = node.direction === "row" ? bounds.right - bounds.left : bounds.bottom - bounds.top;
  const start = node.direction === "row" ? bounds.left : bounds.top;
  const storedPosition = snapshots.get(node.id)?.position ?? start + span * node.ratio;
  const requestedPosition = node.id === targetSplitId ? targetPosition : storedPosition;
  const position = clamp(requestedPosition, start + 1, start + Math.max(1, span - 1));
  const ratio = clamp((position - start) / Math.max(1, span), 0.001, 0.999);
  ratios.set(node.id, ratio);
  const [firstBounds, secondBounds] = splitChildBounds(bounds, node.direction, position);
  return {
    ...node,
    ratio,
    first: rebuildLayoutFromBoundaries(node.first, firstBounds, snapshots, targetSplitId, targetPosition, ratios),
    second: rebuildLayoutFromBoundaries(node.second, secondBounds, snapshots, targetSplitId, targetPosition, ratios),
  };
}

export function collapseSplit(
  node: LayoutNode,
  splitId: string,
  removeSide: "first" | "second",
): LayoutNode {
  if (node.type === "group") return node;
  if (node.id === splitId) return removeSide === "first" ? node.second : node.first;
  return {
    ...node,
    first: collapseSplit(node.first, splitId, removeSide),
    second: collapseSplit(node.second, splitId, removeSide),
  };
}

export function splitGroup(
  node: LayoutNode,
  groupId: string,
  direction: SplitDirection,
  placement: "before" | "after",
  newGroup: GroupNode,
  splitId: string,
): LayoutNode {
  if (node.type === "group") {
    if (node.group.id !== groupId) return node;
    return placement === "before"
      ? { type: "split", id: splitId, direction, ratio: 0.5, first: newGroup, second: node }
      : { type: "split", id: splitId, direction, ratio: 0.5, first: node, second: newGroup };
  }
  return {
    ...node,
    first: splitGroup(node.first, groupId, direction, placement, newGroup, splitId),
    second: splitGroup(node.second, groupId, direction, placement, newGroup, splitId),
  };
}

export function openItem(group: EditorGroup, item: OpenItem): EditorGroup {
  const existing = group.items.filter((entry) => entry.id !== item.id);
  return { ...group, items: [...existing, item], activeItemId: item.id };
}

export function closeItem(group: EditorGroup, itemId: string): EditorGroup {
  const nextItems = group.items.filter((item) => item.id !== itemId);
  const nextActive = group.activeItemId === itemId
    ? nextItems[nextItems.length - 1]?.id ?? null
    : group.activeItemId;
  return { ...group, items: nextItems, activeItemId: nextActive };
}

export function detectDropZone(
  event: DragEvent<HTMLElement>,
  previousZone?: DropZone,
): DropZone {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  const edge = 0.2;
  const hysteresis = 0.04;

  if (previousZone === "top" && y <= edge + hysteresis) return "top";
  if (previousZone === "bottom" && y >= 1 - edge - hysteresis) return "bottom";
  if (previousZone === "left" && x <= edge + hysteresis) return "left";
  if (previousZone === "right" && x >= 1 - edge - hysteresis) return "right";
  if (
    previousZone === "center"
    && x > edge - hysteresis
    && x < 1 - edge + hysteresis
    && y > edge - hysteresis
    && y < 1 - edge + hysteresis
  ) {
    return "center";
  }
  if (y <= edge) return "top";
  if (y >= 1 - edge) return "bottom";
  if (x <= edge) return "left";
  if (x >= 1 - edge) return "right";
  return "center";
}

export function splitMeta(
  zone: DropZone,
): { direction: SplitDirection; placement: "before" | "after" } | null {
  if (zone === "left") return { direction: "row", placement: "before" };
  if (zone === "right") return { direction: "row", placement: "after" };
  if (zone === "top") return { direction: "column", placement: "before" };
  if (zone === "bottom") return { direction: "column", placement: "after" };
  return null;
}
