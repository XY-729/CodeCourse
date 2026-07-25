import { describe, it, expect } from "vitest";

// We test the normalization logic in isolation.
// The actual function lives in App.tsx but we replicate the core logic here.

type OpenItem = {
  id: string;
  type: "course" | "file" | "qa";
  path: string;
  title: string;
  content: string;
};

type EditorGroup = {
  id: string;
  items: OpenItem[];
  activeItemId: string | null;
};

type LayoutNode =
  | { type: "group"; group: EditorGroup }
  | { type: "split"; id: string; direction: "row" | "column"; ratio: number; first: LayoutNode; second: LayoutNode };

const ROOT_GROUP_ID = "group-1";

function normalizeToSingleGroup(node: LayoutNode, preferredActiveItemId?: string | null): { type: "group"; group: EditorGroup } {
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
  // Rule 1: preferred active item
  if (preferredActiveItemId && items.some((item) => item.id === preferredActiveItemId)) {
    activeItemId = preferredActiveItemId;
  }
  // Rule 2: first valid item
  if (!activeItemId && items.length > 0) {
    activeItemId = items[0].id;
  }

  return { type: "group", group: { id: ROOT_GROUP_ID, items, activeItemId } };
}

function createItem(id: string, type: OpenItem["type"] = "course"): OpenItem {
  return { id, type, path: `/${id}.md`, title: id, content: "test" };
}

function makeSplit(
  first: LayoutNode,
  second: LayoutNode,
  ratio = 0.5,
): LayoutNode {
  return { type: "split", id: "split-1", direction: "row", ratio, first, second };
}

function makeGroup(id: string, items: OpenItem[], activeId?: string): LayoutNode {
  return { type: "group", group: { id, items, activeItemId: activeId ?? (items[0]?.id ?? null) } };
}

describe("normalizeToSingleGroup", () => {
  it("keeps single group unchanged", () => {
    const a = createItem("a");
    const layout = makeGroup("group-1", [a], "a");
    const result = normalizeToSingleGroup(layout, "a");
    expect(result.group.items).toHaveLength(1);
    expect(result.group.activeItemId).toBe("a");
  });

  it("merges two groups, preserves preferred active item from first group", () => {
    const a = createItem("a");
    const b = createItem("b");
    const layout = makeSplit(
      makeGroup("g1", [a], "a"),
      makeGroup("g2", [b], "b"),
    );
    // pref comes from g1's active
    const result = normalizeToSingleGroup(layout, "a");
    expect(result.group.items).toHaveLength(2);
    expect(result.group.activeItemId).toBe("a");
  });

  it("preserves preferred active item from second group", () => {
    const a = createItem("a");
    const b = createItem("b");
    const layout = makeSplit(
      makeGroup("g1", [a], "a"),
      makeGroup("g2", [b], "b"),
    );
    const result = normalizeToSingleGroup(layout, "b");
    expect(result.group.activeItemId).toBe("b");
  });

  it("falls back to first item when pref not found", () => {
    const a = createItem("a");
    const b = createItem("b");
    const layout = makeSplit(
      makeGroup("g1", [a], "a"),
      makeGroup("g2", [b], "b"),
    );
    const result = normalizeToSingleGroup(layout, "nonexistent");
    expect(result.group.activeItemId).toBe("a");
  });

  it("deduplicates items across groups", () => {
    const a = createItem("a");
    const layout = makeSplit(
      makeGroup("g1", [a], "a"),
      makeGroup("g2", [a], "a"),
    );
    const result = normalizeToSingleGroup(layout, "a");
    expect(result.group.items).toHaveLength(1);
  });

  it("returns null activeItemId when no items", () => {
    const layout = makeGroup("g1", []);
    const result = normalizeToSingleGroup(layout);
    expect(result.group.activeItemId).toBeNull();
  });

  it("handles deeply nested splits", () => {
    const a = createItem("a");
    const b = createItem("b");
    const c = createItem("c");
    const layout = makeSplit(
      makeSplit(makeGroup("g1", [a], "a"), makeGroup("g2", [b], "b")),
      makeGroup("g3", [c], "c"),
    );
    const result = normalizeToSingleGroup(layout, "c");
    expect(result.group.items).toHaveLength(3);
    expect(result.group.activeItemId).toBe("c");
  });

  it("always produces type=group, never split", () => {
    const a = createItem("a");
    const b = createItem("b");
    const layout = makeSplit(
      makeGroup("g1", [a], "a"),
      makeGroup("g2", [b], "b"),
    );
    const result = normalizeToSingleGroup(layout, "b");
    expect(result.type).toBe("group");
    // No split property
    expect("first" in result).toBe(false);
  });
});
