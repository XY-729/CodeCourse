import { useCallback, useRef, useState } from "react";
import {
  ROOT_GROUP_ID,
  collapseSplit,
  collectLayoutItems,
  countGroups,
  createInitialLayout,
  equalizeLayout,
  findGroup,
  firstGroupId,
  hasGroup,
  removeGroupFromLayout,
  type LayoutNode,
  type OpenItem,
} from "./layout";

export function useWorkbenchLayoutController() {
  const [layout, setLayout] = useState<LayoutNode>(() => createInitialLayout());
  const [activeGroupId, setActiveGroupId] = useState(ROOT_GROUP_ID);
  const [deferredEditorMounts, setDeferredEditorMounts] = useState<Set<string>>(() => new Set());
  const layoutHistoryRef = useRef<LayoutNode[]>([]);
  const closedItemsRef = useRef<Array<{ groupId: string; item: OpenItem }>>([]);
  const idCounterRef = useRef(1);

  const nextId = useCallback((prefix: string) => {
    idCounterRef.current += 1;
    return `${prefix}-${idCounterRef.current}`;
  }, []);

  const commitLayoutChange = useCallback((updater: (current: LayoutNode) => LayoutNode) => {
    setLayout((current) => {
      const next = updater(current);
      if (next === current) return current;
      layoutHistoryRef.current = [...layoutHistoryRef.current.slice(-19), current];
      return next;
    });
  }, []);

  const resetLayout = useCallback((next = createInitialLayout()) => {
    layoutHistoryRef.current = [];
    closedItemsRef.current = [];
    setLayout(next);
    setActiveGroupId(ROOT_GROUP_ID);
  }, []);

  const undoLayout = useCallback(() => {
    const previous = layoutHistoryRef.current.pop();
    if (!previous) return null;
    setLayout(previous);
    const nextGroupId = hasGroup(previous, activeGroupId) ? activeGroupId : firstGroupId(previous);
    setActiveGroupId(nextGroupId);
    const group = findGroup(previous, nextGroupId);
    return group?.items.find((entry) => entry.id === group.activeItemId) ?? null;
  }, [activeGroupId]);

  const equalize = useCallback(() => commitLayoutChange(equalizeLayout), [commitLayoutChange]);

  const closeGroup = useCallback((groupId: string) => {
    if (countGroups(layout) <= 1) return null;
    const next = removeGroupFromLayout(layout, groupId);
    if (!next) return null;
    commitLayoutChange(() => next);
    if (activeGroupId !== groupId) return null;
    const nextGroupId = firstGroupId(next);
    setActiveGroupId(nextGroupId);
    const nextGroup = findGroup(next, nextGroupId);
    return nextGroup?.items.find((item) => item.id === nextGroup.activeItemId) ?? null;
  }, [activeGroupId, commitLayoutChange, layout]);

  const mergeGroups = useCallback((groupId: string) => {
    const target = findGroup(layout, groupId);
    if (!target || countGroups(layout) <= 1) return false;
    const seen = new Set<string>();
    const items = [...target.items, ...collectLayoutItems(layout)].filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
    commitLayoutChange(() => ({
      type: "group",
      group: {
        id: groupId,
        items,
        activeItemId: target.activeItemId ?? items.at(-1)?.id ?? null,
      },
    }));
    setActiveGroupId(groupId);
    return true;
  }, [commitLayoutChange, layout]);

  const collapse = useCallback((splitId: string, removeSide: "first" | "second") => {
    commitLayoutChange((current) => {
      if (countGroups(current) <= 1) return current;
      const next = collapseSplit(current, splitId, removeSide);
      if (!hasGroup(next, activeGroupId)) setActiveGroupId(firstGroupId(next));
      return next;
    });
  }, [activeGroupId, commitLayoutChange]);

  const rememberClosedItem = useCallback((groupId: string, item: OpenItem) => {
    const withoutDuplicate = closedItemsRef.current.filter((entry) => entry.item.id !== item.id);
    closedItemsRef.current = [...withoutDuplicate, { groupId, item: { ...item } }].slice(-12);
  }, []);

  const deferEditorMount = useCallback((groupId: string, itemId: string) => {
    const mountKey = `${groupId}:${itemId}`;
    setDeferredEditorMounts((current) => new Set(current).add(mountKey));
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      setDeferredEditorMounts((current) => {
        if (!current.has(mountKey)) return current;
        const next = new Set(current);
        next.delete(mountKey);
        return next;
      });
    }));
  }, []);

  return {
    layout,
    setLayout,
    activeGroupId,
    setActiveGroupId,
    deferredEditorMounts,
    layoutHistoryRef,
    closedItemsRef,
    nextId,
    commitLayoutChange,
    resetLayout,
    undoLayout,
    equalize,
    closeGroup,
    mergeGroups,
    collapse,
    rememberClosedItem,
    deferEditorMount,
  };
}
