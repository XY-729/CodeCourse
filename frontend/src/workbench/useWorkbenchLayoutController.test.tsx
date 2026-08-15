import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createGroup, splitGroup, updateGroup } from "./layout";
import { useWorkbenchLayoutController } from "./useWorkbenchLayoutController";

describe("workbench layout controller", () => {
  it("keeps layout history isolated from document state", () => {
    const { result } = renderHook(() => useWorkbenchLayoutController());
    act(() => {
      result.current.commitLayoutChange((layout) => splitGroup(layout, "group-1", "row", "after", createGroup("group-2"), "split-1"));
    });
    expect(result.current.layout.type).toBe("split");
    act(() => { result.current.undoLayout(); });
    expect(result.current.layout.type).toBe("group");
  });

  it("merges unique tabs into the selected group", () => {
    const { result } = renderHook(() => useWorkbenchLayoutController());
    const item = { id: "file:a", type: "file" as const, path: "a", title: "a", content: "" };
    act(() => {
      result.current.commitLayoutChange((layout) => splitGroup(
        updateGroup(layout, "group-1", (group) => ({ ...group, items: [item], activeItemId: item.id })),
        "group-1", "row", "after", createGroup("group-2"), "split-1",
      ));
    });
    act(() => { result.current.mergeGroups("group-1"); });
    expect(result.current.layout.type).toBe("group");
    if (result.current.layout.type === "group") expect(result.current.layout.group.items).toHaveLength(1);
  });
});
