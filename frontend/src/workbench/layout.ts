// Production layout utilities used by App.tsx and tests.
// Do NOT copy these implementations — import from this module.

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
  initialLine?: number;
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

export type SplitNode = {
  type: "split";
  id: string;
  direction: "row" | "column";
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
};

export type LayoutNode = GroupNode | SplitNode;

export const ROOT_GROUP_ID = "group-1";

/** Strip large content from items before persisting to storage. */
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

/** Merge all groups from a layout tree into a single group. */
export function normalizeToSingleGroup(node: LayoutNode, preferredActiveItemId?: string | null): GroupNode {
  const items: OpenItem[] = [];
  const seen = new Set<string>();
  function collect(n: LayoutNode) {
    if (n.type === "group") {
      for (const item of n.group.items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
        }
      }
    } else {
      collect(n.first);
      collect(n.second);
    }
  }
  collect(node);

  let activeItemId: string | null = null;
  if (preferredActiveItemId && items.some((item) => item.id === preferredActiveItemId)) {
    activeItemId = preferredActiveItemId;
  }
  if (!activeItemId && items.length > 0) {
    activeItemId = items[0].id;
  }

  return { type: "group", group: { id: ROOT_GROUP_ID, items, activeItemId } };
}

/** Determine the preferred active item from a hydrated item list. */
export function resolvePreferredActiveItem(
  items: OpenItem[],
  preferredActiveItemId?: string | null,
): string | null {
  if (preferredActiveItemId && items.some((item) => item.id === preferredActiveItemId)) {
    return preferredActiveItemId;
  }
  if (items.length > 0) {
    return items[0].id;
  }
  return null;
}
