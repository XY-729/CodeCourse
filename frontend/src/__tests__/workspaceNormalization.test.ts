import { describe, it, expect } from "vitest";
import { normalizeGroupIds, normalizeToSingleGroup, stripLayoutContent, resolvePreferredActiveItem } from "../workbench/layout";
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

describe("normalizeGroupIds (production import)", () => {
  // Mirrors App.tsx nextId: pre-increments the shared counter, returns
  // `${prefix}-${counter}`.
  function counter() {
    let current = 1;
    return {
      next: (prefix: string) => { current += 1; return `${prefix}-${current}`; },
      value: () => current,
    };
  }

  function collectGroupIds(node: LayoutNode): string[] {
    if (node.type === "group") return [node.group.id];
    return [...collectGroupIds(node.first), ...collectGroupIds(node.second)];
  }

  it("advances the counter past restored group ids", () => {
    // Restored layout holds "group-2", but a fresh runtime counter starts at 1.
    // Without the sync, the next split would create a duplicate "group-2".
    const node = makeSplit(makeGroup("group-1", []), makeGroup("group-2", []));
    const c = counter();
    normalizeGroupIds(node, c.next);
    // The next generated id must not collide with any restored id.
    const nextSplitId = c.next("group");
    expect(nextSplitId).not.toBe("group-1");
    expect(nextSplitId).not.toBe("group-2");
  });

  it("renames duplicate group ids to fresh ones", () => {
    // Layouts corrupted by the pre-fix bug can contain the same id twice.
    const node = makeSplit(makeGroup("group-1", []), makeGroup("group-1", []));
    const c = counter();
    const fixed = normalizeGroupIds(node, c.next);
    const ids = collectGroupIds(fixed);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("renames duplicates even with non-numeric group ids", () => {
    const node = makeSplit(makeGroup("stale", []), makeGroup("stale", []));
    const c = counter();
    const fixed = normalizeGroupIds(node, c.next);
    const ids = collectGroupIds(fixed);
    expect(ids[0]).toBe("stale");
    expect(ids[1]).toMatch(/^group-\d+$/);
    expect(ids[1]).not.toBe("stale");
  });

  it("deeply nested splits are walked and deduplicated", () => {
    const node = makeSplit(
      makeSplit(makeGroup("group-1", []), makeGroup("group-3", [])),
      makeSplit(makeGroup("group-3", []), makeGroup("group-1", [])),
    );
    const c = counter();
    const fixed = normalizeGroupIds(node, c.next);
    expect(new Set(collectGroupIds(fixed)).size).toBe(4);
  });

  it("keeps the layout shape and item data intact", () => {
    const a = createItem("a");
    const node = makeSplit(makeGroup("group-2", [a], "a"), makeGroup("group-1", []));
    const c = counter();
    const fixed = normalizeGroupIds(node, c.next);
    const aGroup = fixed.type === "split" ? fixed.first : fixed;
    if (aGroup.type === "group") {
      expect(aGroup.group.items).toHaveLength(1);
      expect(aGroup.group.items[0].id).toBe("a");
      expect(aGroup.group.activeItemId).toBe("a");
    }
  });
});
