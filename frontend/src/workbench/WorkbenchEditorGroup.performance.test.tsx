import type { ComponentProps, ReactNode } from "react";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkbenchEditorGroup from "./WorkbenchEditorGroup";
import EditorPaneFrame from "./EditorPaneFrame";

vi.mock("./EditorPaneFrame", () => ({
  default: vi.fn((props: { children?: ReactNode; onActivatePane: () => void }) => (
    <div>
      <button type="button" onClick={props.onActivatePane}>activate</button>
      {props.children}
    </div>
  )),
}));

type WorkbenchEditorGroupProps = ComponentProps<typeof WorkbenchEditorGroup>;

function createProps(overrides: Partial<WorkbenchEditorGroupProps> = {}): WorkbenchEditorGroupProps {
  const noop = vi.fn();
  return {
    group: { id: "group-1", items: [], activeItemId: null },
    activeGroupId: "group-1",
    mobile: true,
    projectId: 1,
    courses: [],
    editingCourseItemId: null,
    editorMountDeferred: false,
    workspaceMenuOpen: false,
    canUndoLayout: false,
    canManageGroups: false,
    mobileCodeSearchRequestId: 0,
    activeTermSourceKey: "",
    highlights: [],
    knowledgeLinks: [],
    documentTerms: [],
    visibleTermCandidateIds: new Set(),
    termDisplayTiers: new Map(),
    selectionAnchor: null,
    qaHighlightDraft: null,
    callGuides: [],
    callGuideBusyId: null,
    knowledgeRefreshKey: 0,
    knowledgeFocusRef: null,
    learningStates: [],
    isOutlineCourse: vi.fn(() => false),
    onActivatePane: noop,
    onActivateItem: noop,
    onCloseItem: noop,
    onTabDragEnd: noop,
    onToggleWorkspaceMenu: noop,
    onUndoLayout: noop,
    onEqualize: noop,
    onMergeGroups: noop,
    onCloseGroup: noop,
    onDragOver: noop,
    onDragLeave: noop,
    onDrop: noop,
    onMobileCodeSearch: noop,
    onOpenCourse: noop,
    onToggleLessonComplete: noop,
    onSetEditingCourse: noop,
    onSaveEditedCourse: noop,
    onCancelEditedCourse: noop,
    onUpdateItemContent: noop,
    onSelectionChange: noop,
    onQASelectionChange: noop,
    onCodeJumpConsumed: noop,
    onLearningPosition: noop,
    onToggleFavorite: noop,
    onCreateHighlight: noop,
    onSaveQA: noop,
    onPersonalizationChanged: noop,
    onOpenKnowledgeLink: noop,
    onOpenQAReference: noop,
    onGenerateTerm: noop,
    onTermAction: noop,
    onGenerateLesson: noop,
    onCallGuideSelection: noop,
    onOpenCallGuideSource: noop,
    onExplainCallGuide: noop,
    onRefreshCallGuide: noop,
    onDeleteCallGuide: noop,
    onRequestText: vi.fn(async () => null),
    onConfirm: vi.fn(async () => true),
    onKnowledgeContentChanged: noop,
    onKnowledgeGraphChanged: noop,
    onOpenKnowledgeQA: noop,
    onOpenKnowledgeCourse: noop,
    onOpenKnowledgeFile: noop,
    ...overrides,
  };
}

describe("WorkbenchEditorGroup render isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not repaint the reader for shell-only callback changes and still calls the latest action", () => {
    const firstAction = vi.fn();
    const latestAction = vi.fn();
    const props = createProps({ onActivatePane: firstAction });
    const { getByRole, rerender } = render(<WorkbenchEditorGroup {...props} />);

    expect(vi.mocked(EditorPaneFrame)).toHaveBeenCalledTimes(1);

    rerender(<WorkbenchEditorGroup {...props} onActivatePane={latestAction} />);

    expect(vi.mocked(EditorPaneFrame)).toHaveBeenCalledTimes(1);
    fireEvent.click(getByRole("button", { name: "activate" }));
    expect(latestAction).toHaveBeenCalledTimes(1);
    expect(firstAction).not.toHaveBeenCalled();
  });

  it("repaints when reader data changes", () => {
    const props = createProps();
    const { rerender } = render(<WorkbenchEditorGroup {...props} />);
    expect(vi.mocked(EditorPaneFrame)).toHaveBeenCalledTimes(1);

    rerender(<WorkbenchEditorGroup {...props} learningStates={[{
      id: 1,
      project_id: 1,
      source_type: "course",
      source_path: "lesson-01.md",
      status: "completed",
      position_kind: "scroll_ratio",
      position_value: 1,
      last_opened_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-20T00:00:00Z",
    }]} />);

    expect(vi.mocked(EditorPaneFrame)).toHaveBeenCalledTimes(2);
  });
});
