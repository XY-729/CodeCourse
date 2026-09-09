import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CallGuide, CourseFile } from "../api/client";
import WorkbenchEditorGroup from "./WorkbenchEditorGroup";
import type { EditorGroup, OpenItem } from "./layout";
import Sidebar from "../components/Sidebar";
import { useLearningStateController } from "../learning/useLearningStateController";
import { updateLearningState } from "../api/client";

vi.mock("../api/client", () => ({
  updateLearningState: vi.fn(),
  resetLearningStates: vi.fn(),
}));

vi.mock("../components/CodeViewer", () => ({
  default: ({ path, content }: { path: string; content: string }) => (
    <div data-testid="code-viewer">{path}:{content}</div>
  ),
}));

vi.mock("../components/TeachingRationale", () => ({
  default: () => <button type="button">教学依据</button>,
}));

vi.mock("../components/MarkdownViewer", () => ({
  default: ({ title, content }: { title: string; content: string }) => (
    <div data-testid="markdown-viewer">{title}:{content}</div>
  ),
}));

vi.mock("../components/CallGuideViewer", () => ({
  default: ({ guide }: { guide: CallGuide }) => <div data-testid="call-guide-viewer">{guide.title}</div>,
}));

vi.mock("../components/KnowledgeGraphViewer", () => ({
  default: () => <div data-testid="knowledge-graph-viewer" />,
}));

type Props = ComponentProps<typeof WorkbenchEditorGroup>;

const scrollByDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollBy");
beforeAll(() => {
  // jsdom does not implement the tab strip's browser scrolling API.
  Object.defineProperty(HTMLElement.prototype, "scrollBy", { configurable: true, value: vi.fn() });
});
afterAll(() => {
  if (scrollByDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollBy", scrollByDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollBy");
});

function groupWith(item: OpenItem): EditorGroup {
  return { id: "group-1", activeItemId: item.id, items: [item] };
}

function baseProps(group: EditorGroup, overrides: Partial<Props> = {}): Props {
  return {
    group,
    activeGroupId: group.id,
    mobile: false,
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
    onActivatePane: vi.fn(),
    onActivateItem: vi.fn(),
    onCloseItem: vi.fn(),
    onTabDragEnd: vi.fn(),
    onToggleWorkspaceMenu: vi.fn(),
    onUndoLayout: vi.fn(),
    onEqualize: vi.fn(),
    onMergeGroups: vi.fn(),
    onCloseGroup: vi.fn(),
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
    onMobileCodeSearch: vi.fn(),
    onOpenCourse: vi.fn(),
    onToggleLessonComplete: vi.fn(),
    onSetEditingCourse: vi.fn(),
    onSaveEditedCourse: vi.fn(),
    onCancelEditedCourse: vi.fn(),
    onUpdateItemContent: vi.fn(),
    onSelectionChange: vi.fn(),
    onQASelectionChange: vi.fn(),
    onCodeJumpConsumed: vi.fn(),
    onLearningPosition: vi.fn(),
    onToggleFavorite: vi.fn(),
    onCreateHighlight: vi.fn(),
    onSaveQA: vi.fn(),
    onPersonalizationChanged: vi.fn(),
    onOpenKnowledgeLink: vi.fn(),
    onOpenQAReference: vi.fn(),
    onGenerateTerm: vi.fn(),
    onTermAction: vi.fn(),
    onGenerateLesson: vi.fn(),
    onCallGuideSelection: vi.fn(),
    onOpenCallGuideSource: vi.fn(),
    onExplainCallGuide: vi.fn(),
    onRefreshCallGuide: vi.fn(),
    onDeleteCallGuide: vi.fn(),
    onRequestText: vi.fn(async () => null),
    onConfirm: vi.fn(async () => false),
    onKnowledgeContentChanged: vi.fn(),
    onKnowledgeGraphChanged: vi.fn(),
    onOpenKnowledgeQA: vi.fn(),
    onOpenKnowledgeCourse: vi.fn(),
    onOpenKnowledgeFile: vi.fn(),
    ...overrides,
  };
}

describe("WorkbenchEditorGroup", () => {
  it("renders a source file with the code viewer", () => {
    const group = groupWith({
      id: "file:src/main.ts",
      type: "file",
      path: "src/main.ts",
      title: "main.ts",
      content: "export const main = true;",
      language: "typescript",
    });

    render(<WorkbenchEditorGroup {...baseProps(group)} />);

    expect(screen.getByTestId("code-viewer").textContent).toContain("src/main.ts:export const main = true;");
  });

  it("renders a lesson with its reading toolbar", async () => {
    const item: OpenItem = {
      id: "course:lessons/lesson_01.md",
      type: "course",
      path: "lessons/lesson_01.md",
      title: "第一课",
      content: "# 第一课",
    };
    const courses: CourseFile[] = [{ filename: "lessons/lesson_01.md", title: "第一课", group: "课程" }];

    render(<WorkbenchEditorGroup {...baseProps(groupWith(item), { courses })} />);

    expect((await screen.findByTestId("markdown-viewer")).textContent).toContain("第一课:# 第一课");
    expect(screen.getByRole("button", { name: "标记完成" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "上一课" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "下一课" }).hasAttribute("disabled")).toBe(true);
  });

  it.each([false, true])("saves lesson completion and updates sidebar progress (mobile=%s)", async (mobile) => {
    const courses: CourseFile[] = [
      { filename: "outline.md", title: "总纲", group: "总纲" },
      { filename: "lessons/lesson_10.md", title: "第十课", group: "课程" },
      { filename: "lessons/lesson_02.md", title: "第二课", group: "课程" },
      { filename: "lessons/lesson_01.md", title: "第一课", group: "课程" },
    ];
    const item: OpenItem = {
      id: "course:lessons/lesson_02.md", type: "course", path: "lessons/lesson_02.md",
      title: "第二课", content: "# 第二课",
    };
    const onOpenCourse = vi.fn();
    vi.mocked(updateLearningState).mockImplementation(async (projectId, payload) => ({
      ...payload, id: 1, project_id: projectId,
      last_opened_at: "2026-09-08T10:00:00", updated_at: "2026-09-08T10:00:00",
      completed_at: payload.status === "completed" ? "2026-09-08T10:00:00" : null,
    }));
    function LearningWorkspace() {
      const learning = useLearningStateController({ projectId: 1, onError: vi.fn(), onStatus: vi.fn() });
      return <>
        <Sidebar
          view="courses" projects={[]} currentProjectId={1} tree={null} courses={courses}
          selectedPath={null} selectedScopePaths={[]} selectedCourse={item.path}
          projectType="learning_plan" fileSelectionMode={false} busyProjectId={null}
          onSelectProject={vi.fn()} onCreateLearningPlan={vi.fn()} onRegenerateProject={vi.fn()}
          onDeleteProject={vi.fn()} onSelectFile={vi.fn()} onOpenFile={vi.fn()} onSelectCourse={vi.fn()}
          learningStates={learning.states}
        />
        <WorkbenchEditorGroup {...baseProps(groupWith(item), {
          mobile, courses, onOpenCourse, learningStates: learning.states,
          onToggleLessonComplete: learning.toggleLessonComplete,
        })} />
      </>;
    }
    render(<LearningWorkspace />);
    await screen.findByTestId("markdown-viewer");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuemax")).toBe("3");
    fireEvent.click(screen.getByRole("button", { name: "上一课" }));
    expect(onOpenCourse).toHaveBeenLastCalledWith("lessons/lesson_01.md");
    fireEvent.click(screen.getByRole("button", { name: "下一课" }));
    expect(onOpenCourse).toHaveBeenLastCalledWith("lessons/lesson_10.md");
    fireEvent.click(screen.getByRole("button", { name: mobile ? "标记本课完成" : "标记完成" }));
    await waitFor(() => expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1"));
    expect(updateLearningState).toHaveBeenLastCalledWith(1, expect.objectContaining({
      source_type: "course", source_path: item.path, status: "completed",
    }));
    fireEvent.click(screen.getByRole("button", { name: mobile ? "将本课标记为未完成" : "已完成" }));
    await waitFor(() => expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0"));
  });

  it.each(["outline.md", "selection_answers/answer.md"])("does not offer lesson completion for %s", async (path) => {
    const item: OpenItem = { id: `course:${path}`, type: "course", path, title: "文档", content: "# 文档" };
    render(<WorkbenchEditorGroup {...baseProps(groupWith(item), {
      courses: [{ filename: path, title: "文档", group: "其他" }],
    })} />);
    await screen.findByTestId("markdown-viewer");
    expect(screen.queryByRole("button", { name: "标记完成" })).toBeNull();
  });

  it("keeps QA editing and selection callbacks wired", () => {
    const item: OpenItem = {
      id: "qa:7",
      type: "qa",
      path: "qa/7.md",
      title: "回答",
      content: "socket explanation",
    };
    const onUpdateItemContent = vi.fn();
    const onQASelectionChange = vi.fn();

    render(<WorkbenchEditorGroup {...baseProps(groupWith(item), { onUpdateItemContent, onQASelectionChange })} />);
    const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "updated" } });
    editor.setSelectionRange(0, 6);
    fireEvent.select(editor);

    expect(onUpdateItemContent).toHaveBeenCalledWith("group-1", "qa:7", "updated");
    expect(onQASelectionChange).toHaveBeenCalledWith(item, "socket");
  });

  it("shows a stable restore state until a call guide is hydrated", async () => {
    const item: OpenItem = {
      id: "call-guide:9",
      type: "call_guide",
      path: "call-guide://9",
      title: "run 调用链",
      content: "",
      callGuideId: 9,
    };
    const group = groupWith(item);
    const { rerender } = render(<WorkbenchEditorGroup {...baseProps(group)} />);

    expect(screen.getByText("正在恢复调用链导览…")).toBeTruthy();

    const guide: CallGuide = {
      id: 9,
      project_id: 1,
      title: "run 调用链",
      root: { symbol_name: "run", path: "main.ts", start_line: 1, end_line: 2 },
      nodes: [],
      edges: [],
      coverage: { status: "complete", callers_complete: true, callees_complete: true, engine: "test" },
      current_node_id: "root",
      visited_node_ids: [],
      stale: false,
      created_at: "",
      updated_at: "",
    };
    rerender(<WorkbenchEditorGroup {...baseProps(group, { callGuides: [guide] })} />);

    expect((await screen.findByTestId("call-guide-viewer")).textContent).toContain("run 调用链");
  });

  it("exposes mobile course save and cancel actions without desktop controls", () => {
    const item: OpenItem = {
      id: "course:lesson-02.md",
      type: "course",
      path: "lesson-02.md",
      title: "第二课",
      content: "draft",
      dirty: true,
    };
    const group = groupWith(item);
    const onSaveEditedCourse = vi.fn();
    const onCancelEditedCourse = vi.fn();
    render(<WorkbenchEditorGroup {...baseProps(group, {
      mobile: true,
      editingCourseItemId: item.id,
      onSaveEditedCourse,
      onCancelEditedCourse,
    })} />);

    fireEvent.click(screen.getByRole("button", { name: "保存当前文档" }));
    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));

    expect(onSaveEditedCourse).toHaveBeenCalledWith(group, item);
    expect(onCancelEditedCourse).toHaveBeenCalledWith(group, item);
  });
});
