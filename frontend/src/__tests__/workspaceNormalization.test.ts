import { describe, it, expect } from "vitest";
import { normalizeToSingleGroup, stripLayoutContent, resolvePreferredActiveItem } from "../workbench/layout";
import type { LayoutNode, OpenItem } from "../workbench/layout";

function createItem(id: string): OpenItem {
  return { id, type: "course", path: `/x/${id}.md`, title: id, content: "content for " + id };
}
function makeGroup(id: string, items: OpenItem[], activeId?: string): LayoutNode {
  return { type: "group", group: { id, items, activeItemId: activeId ?? (items[0]?.id ?? null) } };
}
function makeSplit(first: LayoutNode, second: LayoutNode): LayoutNode {
  return { type: "split", id: "s1", direction: "row", ratio: 0.5, first, second };
}

describe("normalizeToSingleGroup (production import)", () => {
  it("prefers specified active item", () => {
    const a = createItem("a"); const b = createItem("b");
    const node = makeSplit(makeGroup("g1", [a], "a"), makeGroup("g2", [b], "b"));
    const r = normalizeToSingleGroup(node, "b");
    expect(r.group.activeItemId).toBe("b");
  });

  it("falls back to first item", () => {
    const a = createItem("a"); const b = createItem("b");
    const node = makeSplit(makeGroup("g1", [a], "a"), makeGroup("g2", [b], "b"));
    const r = normalizeToSingleGroup(node, "nonexistent");
    expect(r.group.activeItemId).toBe("a");
  });

  it("deduplicates", () => {
    const a = createItem("a");
    const node = makeSplit(makeGroup("g1", [a]), makeGroup("g2", [a]));
    expect(normalizeToSingleGroup(node, "a").group.items).toHaveLength(1);
  });

  it("always returns group type", () => {
    const a = createItem("a"); const b = createItem("b");
    const node = makeSplit(makeGroup("g1", [a]), makeGroup("g2", [b]));
    const r = normalizeToSingleGroup(node, "b");
    expect(r.type).toBe("group");
  });

  it("returns null active when empty", () => {
    expect(normalizeToSingleGroup(makeGroup("g1", [])).group.activeItemId).toBeNull();
  });

  it("active item from first group preserved", () => {
    const a = createItem("a"); const b = createItem("b");
    const node = makeSplit(makeGroup("g1", [a], "a"), makeGroup("g2", [b], "b"));
    const r = normalizeToSingleGroup(node, "a");
    expect(r.group.activeItemId).toBe("a");
  });

  it("deeply nested splits merged correctly", () => {
    const a = createItem("a"); const b = createItem("b"); const c = createItem("c");
    const node = makeSplit(makeSplit(makeGroup("g1", [a]), makeGroup("g2", [b])), makeGroup("g3", [c]));
    const r = normalizeToSingleGroup(node, "c");
    expect(r.group.items).toHaveLength(3);
    expect(r.group.activeItemId).toBe("c");
  });

  it("preserves items without content (stripped layout)", () => {
    const a = createItem("a");
    a.content = "";
    const node = makeGroup("g1", [a], "a");
    const r = normalizeToSingleGroup(node, "a");
    expect(r.group.items).toHaveLength(1);
    expect(r.group.items[0].id).toBe("a");
    expect(r.group.items[0].content).toBe(""); // preserved as-is, hydrated by caller
  });
});

describe("stripLayoutContent (production import)", () => {
  it("strips content from all items", () => {
    const a = createItem("a"); const b = createItem("b");
    const node = makeSplit(makeGroup("g1", [a]), makeGroup("g2", [b]));
    const stripped = stripLayoutContent(node);
    if (stripped.type === "split") {
      if (stripped.first.type === "group") expect(stripped.first.group.items[0].content).toBe("");
      if (stripped.second.type === "group") expect(stripped.second.group.items[0].content).toBe("");
    }
    // Should not affect original
    expect(a.content).toBe("content for a");
  });

  it("strips dirty flag", () => {
    const a = createItem("a"); a.dirty = true;
    const node = makeGroup("g1", [a]);
    const stripped = stripLayoutContent(node);
    expect((stripped as { type: "group"; group: { items: OpenItem[] } }).group.items[0].dirty).toBe(false);
  });
});

describe("resolvePreferredActiveItem (production import)", () => {
  it("returns preferred item when present", () => {
    const items = [createItem("a"), createItem("b")];
    expect(resolvePreferredActiveItem(items, "b")).toBe("b");
  });

  it("falls back to first item", () => {
    const items = [createItem("a"), createItem("b")];
    expect(resolvePreferredActiveItem(items, "nonexistent")).toBe("a");
  });

  it("returns null when empty", () => {
    expect(resolvePreferredActiveItem([], "x")).toBeNull();
  });
});
