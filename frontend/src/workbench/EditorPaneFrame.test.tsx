import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import EditorPaneFrame from "./EditorPaneFrame";
import type { EditorGroup } from "./layout";

const group: EditorGroup = {
  id: "group-1",
  activeItemId: "file:a.ts",
  items: [{
    id: "file:a.ts",
    type: "file",
    path: "a.ts",
    title: "a.ts",
    content: "",
  }],
};

describe("EditorPaneFrame", () => {
  it("renders stable desktop tabs and workspace actions", () => {
    const html = renderToStaticMarkup(
      <EditorPaneFrame
        group={group}
        active
        mobile={false}
        workspaceMenuOpen
        canUndoLayout
        canManageGroups
        onActivatePane={vi.fn()}
        onActivateItem={vi.fn()}
        onCloseItem={vi.fn()}
        onTabDragEnd={vi.fn()}
        onToggleWorkspaceMenu={vi.fn()}
        onUndoLayout={vi.fn()}
        onEqualize={vi.fn()}
        onMergeGroups={vi.fn()}
        onCloseGroup={vi.fn()}
      >
        <p>document</p>
      </EditorPaneFrame>,
    );

    expect(html).toContain('role="tab"');
    expect(html).toContain("撤销布局调整");
    expect(html).toContain("document");
  });

  it("keeps call guides movable between workspace groups", () => {
    const callGuideGroup: EditorGroup = {
      ...group,
      activeItemId: "call-guide:1",
      items: [{
        id: "call-guide:1",
        type: "call_guide",
        path: "call-guide://1",
        title: "Guide",
        content: "",
      }],
    };
    const html = renderToStaticMarkup(
      <EditorPaneFrame
        group={callGuideGroup}
        active
        mobile={false}
        workspaceMenuOpen={false}
        canUndoLayout={false}
        canManageGroups={false}
        onActivatePane={vi.fn()}
        onActivateItem={vi.fn()}
        onCloseItem={vi.fn()}
        onTabDragEnd={vi.fn()}
        onToggleWorkspaceMenu={vi.fn()}
        onUndoLayout={vi.fn()}
        onEqualize={vi.fn()}
        onMergeGroups={vi.fn()}
        onCloseGroup={vi.fn()}
      >
        <p>guide</p>
      </EditorPaneFrame>,
    );

    expect(html).toContain("draggable=\"true\"");
  });
});
