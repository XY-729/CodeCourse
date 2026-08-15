import { describe, expect, it } from "vitest";
import { applySplitRatios, createGroup, splitGroup, updateGroup } from "./layout";
import type { GroupNode, LayoutNode, OpenItem } from "./layout";

function makeItem(id: string): OpenItem {
  return { id, type: "course", path: `/x/${id}.md`, title: id, content: `content ${id}` };
}

function makeGroup(id: string, itemId: string): GroupNode {
  const item = makeItem(itemId);
  return { type: "group", group: { id, items: [item], activeItemId: item.id } };
}

function nestedLayout(): LayoutNode {
  const inner = splitGroup(
    makeGroup("group-2", "b"),
    "group-2",
    "column",
    "after",
    makeGroup("group-3", "c"),
    "split-inner",
  );
  return {
    type: "split",
    id: "split-root",
    direction: "row",
    ratio: 0.5,
    first: makeGroup("group-1", "a"),
    second: inner,
  };
}

describe("applySplitRatios", () => {
  it("applies ratios for the splits present in the map", () => {
    const layout = nestedLayout();
    const ratios = new Map<string, number>([
      ["split-root", 0.7],
      ["split-inner", 0.25],
    ]);
    const next = applySplitRatios(layout, ratios);
    expect(next.type).toBe("split");
    if (next.type !== "split") return;
    expect(next.ratio).toBe(0.7);
    const inner = next.second;
    expect(inner.type).toBe("split");
    if (inner.type !== "split") return;
    expect(inner.ratio).toBe(0.25);
  });

  it("preserves every other part of the layout (tabs, content, active ids, groups)", () => {
    const layout = nestedLayout();
    const ratios = new Map<string, number>([["split-root", 0.6]]);
    const next = applySplitRatios(layout, ratios);
    if (next.type !== "split") throw new Error("expected split");
    const leftGroup = next.first;
    expect(leftGroup.type).toBe("group");
    if (leftGroup.type !== "group") return;
    expect(leftGroup.group.items[0]).toEqual(makeItem("a"));
    expect(leftGroup.group.activeItemId).toBe("a");
    // the inner split (not in the map) keeps its ratio
    const inner = next.second;
    expect(inner.type).toBe("split");
    if (inner.type !== "split") return;
    expect(inner.ratio).toBe(0.5);
  });

  it("leaves a plain group layout untouched", () => {
    const group = updateGroup(createGroup("group-1"), "group-1", (g) => ({ ...g, items: [makeItem("a")], activeItemId: "a" }));
    const next = applySplitRatios(group, new Map([["split-root", 0.9]]));
    expect(next).toBe(group);
  });
});
