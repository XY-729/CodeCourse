import { useEffect, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { Save, Star, X } from "lucide-react";
import {
  askQuestion,
  createLearningPlan,
  createHighlight,
  deleteProject,
  generateFileLesson,
  generateOutline,
  getCourseContent,
  getCourseFiles,
  getGenerationTask,
  getLLMSettings,
  getProject,
  getProjectFile,
  getTree,
  importProject,
  listGenerationTasks,
  listHighlights,
  listProjects,
  listQARecords,
  regenerateProject,
  setQAFavorite,
  updateQARecord,
  deleteQARecord,
  deleteCourseFile,
} from "./api/client";
import type {
  CourseFile,
  FileContent,
  GenerationTask,
  LearningScope,
  LLMSettings,
  Project,
  HighlightRecord,
  QARecord,
  TreeNode,
} from "./api/client";
import CodeViewer, { ViewerRange, ViewerSelection } from "./components/CodeViewer";
import ContextMenu from "./components/ContextMenu";
import ExplainPanel, { SelectionSummary } from "./components/ExplainPanel";
import LLMSettingsDialog from "./components/LLMSettingsDialog";
import MarkdownViewer from "./components/MarkdownViewer";
import PromptEditor from "./components/PromptEditor";
import RepositoryForm from "./components/RepositoryForm";
import Sidebar from "./components/Sidebar";
import type { Annotation, AnnotationColor, AnnotationStyle } from "./types";

type ScopeType = LearningScope["type"];
type OpenItemType = "file" | "course" | "qa";
type SplitDirection = "row" | "column";
type DropZone = "center" | "left" | "right" | "top" | "bottom";

type OpenItem = {
  id: string;
  type: OpenItemType;
  path: string;
  title: string;
  content: string;
  language?: string;
  qaRecordId?: number;
  favorite?: boolean;
  dirty?: boolean;
};

type EditorGroup = {
  id: string;
  items: OpenItem[];
  activeItemId: string | null;
};

type GroupNode = {
  type: "group";
  group: EditorGroup;
};

type SplitNode = {
  type: "split";
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
};

type LayoutNode = GroupNode | SplitNode;

type DragState =
  | { kind: "sidebar-width"; startX: number; startWidth: number }
  | { kind: "explain-width"; startX: number; startWidth: number }
  | { kind: "sidebar-project"; startY: number; startHeight: number }
  | { kind: "sidebar-course"; startY: number; startHeight: number }
  | { kind: "qa-ask"; startY: number; startHeight: number }
  | { kind: "split"; splitId: string; direction: SplitDirection; startX: number; startY: number; startRatio: number; size: number };

type DropPayload = {
  kind?: string;
  path?: string;
  filename?: string;
  qaId?: number;
};

type SelectionAnchor = SelectionSummary & {
  range?: ViewerRange;
};

const TERMINAL_TASK_STATUSES = new Set(["completed", "failed"]);
const MAX_GROUPS = 9;
const ROOT_GROUP_ID = "group-1";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseScopePaths(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parentDir(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function taskLabel(task: GenerationTask): string {
  const type = task.task_type === "file_lesson" ? "文件课件" : "项目总纲";
  return `${type} / ${task.status}`;
}

function qaTitle(record: QARecord): string {
  return record.display_title?.trim() || `回答 #${record.id}`;
}

function createGroup(id: string): GroupNode {
  return { type: "group", group: { id, items: [], activeItemId: null } };
}

function createInitialLayout(): LayoutNode {
  return createGroup(ROOT_GROUP_ID);
}

function countGroups(node: LayoutNode): number {
  if (node.type === "group") {
    return 1;
  }
  return countGroups(node.first) + countGroups(node.second);
}

function findGroup(node: LayoutNode, groupId: string): EditorGroup | null {
  if (node.type === "group") {
    return node.group.id === groupId ? node.group : null;
  }
  return findGroup(node.first, groupId) ?? findGroup(node.second, groupId);
}

function hasGroup(node: LayoutNode, groupId: string): boolean {
  return Boolean(findGroup(node, groupId));
}

function firstGroupId(node: LayoutNode): string {
  if (node.type === "group") {
    return node.group.id;
  }
  return firstGroupId(node.first);
}

function updateGroup(node: LayoutNode, groupId: string, updater: (group: EditorGroup) => EditorGroup): LayoutNode {
  if (node.type === "group") {
    return node.group.id === groupId ? { ...node, group: updater(node.group) } : node;
  }
  return {
    ...node,
    first: updateGroup(node.first, groupId, updater),
    second: updateGroup(node.second, groupId, updater),
  };
}

function updateEveryGroup(node: LayoutNode, updater: (group: EditorGroup) => EditorGroup): LayoutNode {
  if (node.type === "group") {
    return { ...node, group: updater(node.group) };
  }
  return {
    ...node,
    first: updateEveryGroup(node.first, updater),
    second: updateEveryGroup(node.second, updater),
  };
}

function updateSplitRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === "group") {
    return node;
  }
  if (node.id === splitId) {
    return { ...node, ratio: clamp(ratio, 0.03, 0.97) };
  }
  return {
    ...node,
    first: updateSplitRatio(node.first, splitId, ratio),
    second: updateSplitRatio(node.second, splitId, ratio),
  };
}

function collapseSplit(node: LayoutNode, splitId: string, removeSide: "first" | "second"): LayoutNode {
  if (node.type === "group") {
    return node;
  }
  if (node.id === splitId) {
    return removeSide === "first" ? node.second : node.first;
  }
  return {
    ...node,
    first: collapseSplit(node.first, splitId, removeSide),
    second: collapseSplit(node.second, splitId, removeSide),
  };
}

function splitGroup(
  node: LayoutNode,
  groupId: string,
  direction: SplitDirection,
  placement: "before" | "after",
  newGroup: GroupNode,
  splitId: string,
): LayoutNode {
  if (node.type === "group") {
    if (node.group.id !== groupId) {
      return node;
    }
    return placement === "before"
      ? { type: "split", id: splitId, direction, ratio: 0.5, first: newGroup, second: node }
      : { type: "split", id: splitId, direction, ratio: 0.5, first: node, second: newGroup };
  }
  return {
    ...node,
    first: splitGroup(node.first, groupId, direction, placement, newGroup, splitId),
    second: splitGroup(node.second, groupId, direction, placement, newGroup, splitId),
  };
}

function openItem(group: EditorGroup, item: OpenItem): EditorGroup {
  const existing = group.items.filter((entry) => entry.id !== item.id);
  return { ...group, items: [...existing, item], activeItemId: item.id };
}

function closeItem(group: EditorGroup, itemId: string): EditorGroup {
  const nextItems = group.items.filter((item) => item.id !== itemId);
  const nextActive = group.activeItemId === itemId ? nextItems[nextItems.length - 1]?.id ?? null : group.activeItemId;
  return { ...group, items: nextItems, activeItemId: nextActive };
}

function detectDropZone(event: DragEvent<HTMLElement>): DropZone {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  const edge = 0.2;
  if (y <= edge) {
    return "top";
  }
  if (y >= 1 - edge) {
    return "bottom";
  }
  if (x <= edge) {
    return "left";
  }
  if (x >= 1 - edge) {
    return "right";
  }
  return "center";
}

function splitMeta(zone: DropZone): { direction: SplitDirection; placement: "before" | "after" } | null {
  if (zone === "left") {
    return { direction: "row", placement: "before" };
  }
  if (zone === "right") {
    return { direction: "row", placement: "after" };
  }
  if (zone === "top") {
    return { direction: "column", placement: "before" };
  }
  if (zone === "bottom") {
    return { direction: "column", placement: "after" };
  }
  return null;
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [courses, setCourses] = useState<CourseFile[]>([]);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyProjectId, setBusyProjectId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [llmSettings, setLLMSettings] = useState<LLMSettings | null>(null);
  const [scopeType, setScopeType] = useState<ScopeType>("full_project");
  const [scopePathsText, setScopePathsText] = useState("");
  const [selectedScopeFiles, setSelectedScopeFiles] = useState<string[]>([]);
  const [generationInstructions, setGenerationInstructions] = useState("");
  const [activeTask, setActiveTask] = useState<GenerationTask | null>(null);
  const [taskMessage, setTaskMessage] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [explainWidth, setExplainWidth] = useState(360);
  const [sidebarProjectHeight, setSidebarProjectHeight] = useState(150);
  const [sidebarCourseHeight, setSidebarCourseHeight] = useState(240);
  const [qaAskHeight, setQAAskHeight] = useState(560);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [layout, setLayout] = useState<LayoutNode>(() => createInitialLayout());
  const [activeGroupId, setActiveGroupId] = useState(ROOT_GROUP_ID);
  const [dropPreview, setDropPreview] = useState<{ groupId: string; zone: DropZone } | null>(null);

  const [selection, setSelection] = useState<SelectionSummary | null>(null);
  const [qaQuestion, setQAQuestion] = useState("");
  const [qaLoading, setQALoading] = useState(false);
  const [qaHistory, setQAHistory] = useState<QARecord[]>([]);
  const [qaHistoryQuery, setQAHistoryQuery] = useState("");
  const [qaFavoriteOnly, setQAFavoriteOnly] = useState(false);
  const [selectedQA, setSelectedQA] = useState<QARecord | null>(null);
  const [qaPanelError, setQAPanelError] = useState("");
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const [qaHighlightDraft, setQAHighlightDraft] = useState<{ sourcePath: string; selectedText: string } | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    sourceType: "file" | "course" | "selection";
    sourcePath: string;
    selectedText: string;
    existingStyle: AnnotationStyle;
  } | null>(null);
  const [editingCourseItemId, setEditingCourseItemId] = useState<string | null>(null);

  const idCounter = useRef(1);
  const canGenerateFileLesson = Boolean(project && fileContent);
  const isLearningPlanProject = project?.project_type === "learning_plan";
  const isTaskRunning = activeTask ? !TERMINAL_TASK_STATUSES.has(activeTask.status) : false;
  const showBusy = loading || isTaskRunning || qaLoading;

  useEffect(() => {
    loadProjects();
    loadLLMSettings();
  }, []);

  useEffect(() => {
    if (!dragState) {
      return;
    }
    const currentDrag = dragState;
    function onMouseMove(event: globalThis.MouseEvent) {
      if (currentDrag.kind === "sidebar-width") {
        setSidebarWidth(clamp(currentDrag.startWidth + event.clientX - currentDrag.startX, 220, 520));
      } else if (currentDrag.kind === "explain-width") {
        setExplainWidth(clamp(currentDrag.startWidth - (event.clientX - currentDrag.startX), 300, 620));
      } else if (currentDrag.kind === "sidebar-project") {
        setSidebarProjectHeight(clamp(currentDrag.startHeight + event.clientY - currentDrag.startY, 96, 320));
      } else if (currentDrag.kind === "sidebar-course") {
        setSidebarCourseHeight(clamp(currentDrag.startHeight - (event.clientY - currentDrag.startY), 120, 420));
      } else if (currentDrag.kind === "qa-ask") {
        setQAAskHeight(clamp(currentDrag.startHeight + currentDrag.startY - event.clientY, 230, 720));
      } else if (currentDrag.kind === "split") {
        const delta = currentDrag.direction === "row" ? event.clientX - currentDrag.startX : event.clientY - currentDrag.startY;
        const nextRatio = currentDrag.startRatio + delta / Math.max(1, currentDrag.size);
        setLayout((prev) => updateSplitRatio(prev, currentDrag.splitId, nextRatio));
      }
    }
    function onMouseUp(event: globalThis.MouseEvent) {
      if (currentDrag.kind === "split") {
        const delta = currentDrag.direction === "row" ? event.clientX - currentDrag.startX : event.clientY - currentDrag.startY;
        const finalRatio = currentDrag.startRatio + delta / Math.max(1, currentDrag.size);
        if (finalRatio < 0.08 || finalRatio > 0.92) {
          collapseSplitById(currentDrag.splitId, finalRatio < 0.08 ? "first" : "second");
        }
      }
      setDragState(null);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    document.body.classList.add(currentDrag.kind === "split" && currentDrag.direction === "row" ? "resizing-x" : currentDrag.kind.includes("width") ? "resizing-x" : "resizing-y");
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.classList.remove("resizing-x", "resizing-y");
    };
  }, [dragState]);

  useEffect(() => {
    if (!project) {
      return;
    }
    const timer = window.setTimeout(() => {
      refreshQAHistory(project.id);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [project?.id, qaHistoryQuery, qaFavoriteOnly]);

  function nextId(prefix: string) {
    idCounter.current += 1;
    return `${prefix}-${idCounter.current}`;
  }

  function collapseSplitById(splitId: string, removeSide: "first" | "second") {
    setLayout((prev) => {
      if (countGroups(prev) <= 1) {
        return prev;
      }
      const next = collapseSplit(prev, splitId, removeSide);
      if (!hasGroup(next, activeGroupId)) {
        setActiveGroupId(firstGroupId(next));
      }
      return next;
    });
  }

  async function loadLLMSettings() {
    try {
      setLLMSettings(await getLLMSettings());
    } catch {
      setLLMSettings(null);
    }
  }

  function buildScope(): LearningScope {
    if (isLearningPlanProject || scopeType === "learning_plan") {
      return { type: "learning_plan", paths: [] };
    }
    if (scopeType === "full_project") {
      return { type: "full_project", paths: [] };
    }
    return { type: "files", paths: selectedScopeFiles };
  }

  async function loadProjects() {
    try {
      const nextProjects = await listProjects();
      setProjects(nextProjects);
      if (!project && nextProjects.length > 0) {
        await openProject(nextProjects[0]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载项目列表失败");
    }
  }

  async function refreshCourses(projectId: number): Promise<CourseFile[]> {
    const nextCourses = await getCourseFiles(projectId);
    setCourses(nextCourses);
    return nextCourses;
  }

  async function refreshQAHistory(projectId = project?.id) {
    if (!projectId) {
      return;
    }
    try {
      const records = await listQARecords(projectId, qaHistoryQuery, qaFavoriteOnly ? true : undefined);
      setQAHistory(records);
      setQAPanelError("");
      if (selectedQA && !records.some((record) => record.id === selectedQA.id)) {
        setSelectedQA(null);
      }
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "加载历史失败");
    }
  }

  async function refreshHighlights(projectId = project?.id) {
    if (!projectId) {
      setHighlights([]);
      return;
    }
    try {
      setHighlights(await listHighlights(projectId));
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "加载标记失败");
    }
  }

  function applyActiveItem(item: OpenItem) {
    if (item.type === "file") {
      setFileContent({ path: item.path, content: item.content, language: item.language ?? "plaintext" });
      setSelectedCourse(null);
    } else if (item.type === "course") {
      setSelectedCourse(item.path);
      setFileContent(null);
    } else {
      setFileContent(null);
      setSelectedCourse(null);
      const record = qaHistory.find((entry) => entry.id === item.qaRecordId);
      if (record) {
        setSelectedQA(record);
      }
    }
  }

  function openItemInGroup(groupId: string, item: OpenItem) {
    setLayout((prev) => updateGroup(prev, groupId, (group) => openItem(group, item)));
    setActiveGroupId(groupId);
    applyActiveItem(item);
  }

  function splitGroupWithItem(groupId: string, zone: DropZone, item: OpenItem) {
    const meta = splitMeta(zone);
    if (!meta || countGroups(layout) >= MAX_GROUPS) {
      if (meta) {
        setTaskMessage(`最多支持 ${MAX_GROUPS} 个工作区，已在当前工作区打开`);
      }
      openItemInGroup(groupId, item);
      return;
    }
    const newGroupId = nextId("group");
    const newGroup = createGroup(newGroupId);
    newGroup.group = openItem(newGroup.group, item);
    setLayout((prev) => splitGroup(prev, groupId, meta.direction, meta.placement, newGroup, nextId("split")));
    setActiveGroupId(newGroupId);
    applyActiveItem(item);
  }

  function closeItemInGroup(groupId: string, itemId: string) {
    setLayout((prev) => updateGroup(prev, groupId, (group) => closeItem(group, itemId)));
  }

  function activateItem(groupId: string, item: OpenItem) {
    setLayout((prev) => updateGroup(prev, groupId, (group) => ({ ...group, activeItemId: item.id })));
    setActiveGroupId(groupId);
    applyActiveItem(item);
  }

  function updateOpenQARecord(record: QARecord) {
    setLayout((prev) =>
      updateEveryGroup(prev, (group) => ({
        ...group,
        items: group.items.map((item) =>
          item.qaRecordId === record.id ? { ...item, title: qaTitle(record), favorite: record.favorite } : item,
        ),
      })),
    );
  }

  async function buildOpenItem(payload: DropPayload): Promise<OpenItem | null> {
    if (!project) {
      return null;
    }
    if (payload.kind === "file" && payload.path) {
      const content = await getProjectFile(project.id, payload.path);
      return {
        id: `file:${payload.path}`,
        type: "file",
        path: payload.path,
        title: payload.path.split("/").pop() ?? payload.path,
        content: content.content,
        language: content.language,
      };
    }
    if (payload.kind === "course" && payload.filename) {
      const content = await getCourseContent(project.id, payload.filename);
      return {
        id: `course:${payload.filename}`,
        type: "course",
        path: payload.filename,
        title: courses.find((file) => file.filename === payload.filename)?.title ?? payload.filename,
        content: content.content,
      };
    }
    if (payload.kind === "qa" && payload.qaId) {
      const record = qaHistory.find((entry) => entry.id === payload.qaId);
      if (!record) {
        return null;
      }
      const relPath = _normalizeOutputPath(record.output_path, record.id, project.id);
      try {
        const result = await getCourseContent(project.id, relPath);
        return {
          id: `course:${relPath}`,
          type: "course",
          path: relPath,
          title: qaTitle(record),
          content: result.content,
          qaRecordId: record.id,
          favorite: record.favorite,
        };
      } catch {
        return {
          id: `qa:${record.id}`,
          type: "qa",
          path: relPath,
          title: qaTitle(record),
          content: record.answer_md,
          qaRecordId: record.id,
          favorite: record.favorite,
          dirty: false,
        };
      }
    }
    return null;
  }

  async function openFileInActiveGroup(projectId: number, path: string) {
    const content = await getProjectFile(projectId, path);
    setFileContent(content);
    setSelectedCourse(null);
    openItemInGroup(activeGroupId, {
      id: `file:${path}`,
      type: "file",
      path,
      title: path.split("/").pop() ?? path,
      content: content.content,
      language: content.language,
    });
  }

  async function openCourseInActiveGroup(projectId: number, filename: string) {
    const content = await getCourseContent(projectId, filename);
    setSelectedCourse(filename);
    setFileContent(null);
    openItemInGroup(activeGroupId, {
      id: `course:${filename}`,
      type: "course",
      path: filename,
      title: courses.find((file) => file.filename === filename)?.title ?? filename,
      content: content.content,
    });
  }

  function _normalizeOutputPath(outputPath: string | null | undefined, recordId: number, projectId: number): string {
    if (!outputPath) {
      return `qa/${recordId}`;
    }
    // If it's already a relative path, use as-is
    if (!outputPath.startsWith('/') && !outputPath.includes('\\')) {
      return outputPath;
    }
    // Old absolute path: extract everything after "generated/{projectId}/"
    const marker = `generated/${projectId}/`;
    const idx = outputPath.indexOf(marker);
    if (idx !== -1) {
      return outputPath.slice(idx + marker.length);
    }
    // Fallback: try to extract relative path from any "generated/" prefix
    const genIdx = outputPath.lastIndexOf('generated/');
    if (genIdx !== -1) {
      // Skip past "generated/{id}/"
      const after = outputPath.slice(genIdx + 'generated/'.length);
      const slashIdx = after.indexOf('/');
      return slashIdx !== -1 ? after.slice(slashIdx + 1) : after;
    }
    return `qa/${recordId}`;
  }

  async function openQAInActiveGroup(record: QARecord) {
    if (!project) {
      return;
    }
    setSelectedQA(record);
    const relPath = _normalizeOutputPath(record.output_path, record.id, project.id);
    try {
      const result = await getCourseContent(project.id, relPath);
      setSelectedCourse(relPath);
      setFileContent(null);
      openItemInGroup(activeGroupId, {
        id: `course:${relPath}`,
        type: "course",
        path: relPath,
        title: qaTitle(record),
        content: result.content,
        qaRecordId: record.id,
        favorite: record.favorite,
      });
    } catch {
      openItemInGroup(activeGroupId, {
        id: `qa:${record.id}`,
        type: "qa",
        path: relPath,
        title: qaTitle(record),
        content: record.answer_md,
        qaRecordId: record.id,
        favorite: record.favorite,
        dirty: false,
      });
    }
  }

  async function openProject(nextProject: Project) {
    setError("");
    setLoading(true);
    try {
      const freshProject = await getProject(nextProject.id);
      setProject(freshProject);
      const [nextTree, nextCourses, tasks, settings] = await Promise.all([
        getTree(freshProject.id),
        getCourseFiles(freshProject.id),
        listGenerationTasks(freshProject.id),
        getLLMSettings().catch(() => null),
      ]);
      const initialLayout = createInitialLayout();
      setTree(nextTree);
      setCourses(nextCourses);
      setLLMSettings(settings);
      setActiveTask(tasks[0] ?? null);
      setTaskMessage(tasks[0] ? `最近任务：${taskLabel(tasks[0])}` : "待生成");
      setScopeType(freshProject.project_type === "learning_plan" ? "learning_plan" : "full_project");
      setSelectedScopeFiles([]);
      setScopePathsText("");
      setFileContent(null);
      setSelectedCourse(null);
      setSelection(null);
      setQAQuestion("");
      setSelectedQA(null);
      setQAPanelError("");
      setHighlights([]);
      setAnnotations([]);
      setSelectionAnchor(null);
      setContextMenu(null);
      setLayout(initialLayout);
      setActiveGroupId(ROOT_GROUP_ID);
      await refreshQAHistory(freshProject.id);
      await refreshHighlights(freshProject.id);
      const firstCourse = nextCourses.find((file) => file.filename === "outline.md") ?? nextCourses[0];
      if (firstCourse) {
        const content = await getCourseContent(freshProject.id, firstCourse.filename);
        setSelectedCourse(firstCourse.filename);
        setLayout(
          updateGroup(initialLayout, ROOT_GROUP_ID, (group) =>
            openItem(group, {
              id: `course:${firstCourse.filename}`,
              type: "course",
              path: firstCourse.filename,
              title: firstCourse.title,
              content: content.content,
            }),
          ),
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "打开项目失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport(url: string) {
    setLoading(true);
    setError("");
    setTaskMessage("正在导入项目");
    try {
      const imported = await importProject(url);
      await loadProjects();
      await openProject(imported);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateLearningPlan() {
    const name = window.prompt("学习计划名称", "新的学习计划");
    if (name === null || !name.trim()) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const created = await createLearningPlan(name.trim());
      await loadProjects();
      await openProject(created);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建学习计划失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectFile(path: string) {
    if (!project) {
      return;
    }
    if (scopeType === "files") {
      setSelectedScopeFiles((items) => (items.includes(path) ? items.filter((item) => item !== path) : [...items, path]));
      setScopePathsText("");
      return;
    }
    setError("");
    try {
      await openFileInActiveGroup(project.id, path);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取文件失败");
    }
  }

  async function handleOpenFile(path: string) {
    if (!project) {
      return;
    }
    setError("");
    try {
      await openFileInActiveGroup(project.id, path);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取文件失败");
    }
  }

  async function handleSelectCourse(filename: string) {
    if (!project) {
      return;
    }
    setError("");
    try {
      await openCourseInActiveGroup(project.id, filename);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取课程失败");
    }
  }

  async function trackTask(initialTask: GenerationTask) {
    if (!project) {
      return;
    }
    setActiveTask(initialTask);
    setTaskMessage(`任务已创建：${taskLabel(initialTask)}`);
    let nextTask = initialTask;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (TERMINAL_TASK_STATUSES.has(nextTask.status)) {
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      nextTask = await getGenerationTask(project.id, initialTask.id);
      setActiveTask(nextTask);
      setTaskMessage(`正在生成：${taskLabel(nextTask)}`);
    }
    const nextCourses = await refreshCourses(project.id);
    const freshProject = await getProject(project.id);
    setProject(freshProject);
    setProjects((items) => items.map((item) => (item.id === freshProject.id ? freshProject : item)));
    if (nextTask.status === "completed") {
      setTaskMessage("生成完成");
      const preferred = nextTask.task_type === "file_lesson"
        ? nextCourses.find((item) => item.filename === nextTask.output_path?.split("/").slice(-2).join("/"))
        : nextCourses.find((item) => item.filename === "outline.md");
      if (preferred) {
        await openCourseInActiveGroup(project.id, preferred.filename);
      }
    } else if (nextTask.status === "failed") {
      setTaskMessage(`生成失败：${nextTask.error_message ?? "未知错误"}`);
    }
  }

  async function handleGenerateOutline() {
    if (!project) {
      return;
    }
    if ((isLearningPlanProject || scopeType === "learning_plan") && !generationInstructions.trim()) {
      setError("请先在生成要求中写明学习目标或知识点。");
      return;
    }
    if (!isLearningPlanProject && scopeType === "files" && selectedScopeFiles.length === 0) {
      setError("请先在文件树中选择至少一个文件。");
      return;
    }
    const ok = window.confirm("将调用模型 API 生成项目总纲，可能消耗 token。是否继续？");
    if (!ok) {
      return;
    }
    setError("");
    try {
      const task = await generateOutline(project.id, buildScope(), generationInstructions);
      await trackTask(task);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建总纲任务失败");
    }
  }

  async function handleGenerateFileLesson(nextMode: "brief" | "detailed") {
    if (!project || !fileContent) {
      return;
    }
    const label = nextMode === "brief" ? "粗略介绍" : "详细分析";
    const ok = window.confirm(`将调用模型 API 为 ${fileContent.path} 生成${label}，可能消耗 token。是否继续？`);
    if (!ok) {
      return;
    }
    setError("");
    try {
      const task = await generateFileLesson(project.id, fileContent.path, nextMode, generationInstructions);
      await trackTask(task);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建文件课件任务失败");
    }
  }

  async function handleRegenerate(nextProject: Project) {
    setBusyProjectId(nextProject.id);
    setError("");
    try {
      await regenerateProject(nextProject.id);
      await loadProjects();
      if (project?.id === nextProject.id) {
        await openProject(nextProject);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重置待生成内容失败");
    } finally {
      setBusyProjectId(null);
    }
  }

  async function handleDelete(nextProject: Project) {
    if (!window.confirm(`删除本地导入项目 ${nextProject.name}？`)) {
      return;
    }
    setBusyProjectId(nextProject.id);
    setError("");
    try {
      await deleteProject(nextProject.id);
      const remaining = await listProjects();
      setProjects(remaining);
      if (project?.id === nextProject.id) {
        setProject(null);
        setTree(null);
        setCourses([]);
        setFileContent(null);
        setSelectedCourse(null);
        setLayout(createInitialLayout());
        setActiveGroupId(ROOT_GROUP_ID);
        setSelection(null);
        setSelectedScopeFiles([]);
        setSelectionAnchor(null);
        setContextMenu(null);
        setQAHistory([]);
        setHighlights([]);
        setTaskMessage("");
        if (remaining.length > 0) {
          await openProject(remaining[0]);
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除项目失败");
    } finally {
      setBusyProjectId(null);
    }
  }

  function handleSelection(nextSelection: ViewerSelection) {
    const nextText = nextSelection.selectedText.slice(0, 20000);
    setSelection({
      sourceType: nextSelection.sourceType,
      sourcePath: nextSelection.sourcePath,
      selectedText: nextText,
      language: nextSelection.language,
    });
    setSelectionAnchor({
      sourceType: nextSelection.sourceType,
      sourcePath: nextSelection.sourcePath,
      selectedText: nextText,
      language: nextSelection.language,
      range: nextSelection.range,
    });
  }

  async function handleAsk() {
    if (!project || !qaQuestion.trim() || !llmSettings?.enabled || !llmSettings.has_api_key) {
      return;
    }
    const ok = window.confirm(`将调用模型 API 使用 ${llmSettings.model} 回答当前选区问题，可能消耗 token。是否继续？`);
    if (!ok) {
      return;
    }
    setQALoading(true);
    setQAPanelError("");
    try {
      const record = await askQuestion(project.id, {
        source_type: selection?.sourceType ?? "selection",
        source_path: selection?.sourcePath ?? null,
        selected_text: selection?.selectedText ?? "",
        question: qaQuestion,
        provider: llmSettings.provider,
        base_url: llmSettings.base_url,
        model: llmSettings.model,
      });
      setSelectedQA(record);
      setQAHistory((items) => [record, ...items.filter((item) => item.id !== record.id)]);
      setQAQuestion("");
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "生成回答失败");
    } finally {
      setQALoading(false);
    }
  }

  function handleSelectionTextChange(value: string) {
    setSelection((current) => ({
      sourceType: current?.sourceType ?? "selection",
      sourcePath: current?.sourcePath ?? null,
      selectedText: value,
      language: current?.language,
    }));
  }

  function handleClearSelection() {
    handleSelectionTextChange("");
  }

  function handleDismissSelection() {
    setSelection(null);
    setSelectionAnchor(null);
    setContextMenu(null);
  }

  async function handleRenameQA(record: QARecord) {
    if (!project) {
      return;
    }
    const nextTitle = window.prompt("重命名历史记录", record.display_title || record.question);
    if (nextTitle === null) {
      return;
    }
    try {
      const updated = await updateQARecord(project.id, record.id, { display_title: nextTitle.trim() });
      setSelectedQA(updated);
      setQAHistory((items) => items.map((entry) => (entry.id === updated.id ? updated : entry)));
      updateOpenQARecord(updated);
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "重命名失败");
    }
  }

  async function handleCreateHighlight(sourceType: "course" | "qa", sourcePath: string, selectedText: string) {
    if (!project || !selectedText.trim()) {
      return;
    }
    try {
      const record = await createHighlight(project.id, {
        source_type: sourceType,
        source_path: sourcePath,
        selected_text: selectedText.trim(),
        color: "#fff59d",
      });
      setHighlights((items) => [...items, record]);
      setQAPanelError("");
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "标记失败");
    }
  }

  function findAnnotation(courseFile: string, selectedText: string): Annotation | undefined {
    // TODO: use positional matching (offsets) to handle duplicate text precisely
    return annotations.find((ann) => ann.courseFile === courseFile && ann.selectedText === selectedText);
  }

  function handleContextMenuOpen(
    sourceType: "file" | "course" | "selection",
    x: number,
    y: number,
    sourcePath: string | null,
    selectedText: string,
  ) {
    const path = sourcePath ?? "";
    const text = selectedText.slice(0, 20000);
    setSelection({
      sourceType,
      sourcePath: path || null,
      selectedText: text,
    });
    setSelectionAnchor({
      sourceType,
      sourcePath: path || null,
      selectedText: text,
      range: selectionAnchor?.sourcePath === path ? selectionAnchor.range : undefined,
    });
    const existing = sourceType === "file" ? undefined : findAnnotation(path, text);
    setContextMenu({
      x,
      y,
      sourceType,
      sourcePath: path,
      selectedText: text,
      existingStyle: existing?.style ?? {},
    });
  }

  function handleMarkdownContextMenuOpen(event: MouseEvent, sourcePath: string, selectedText: string) {
    event.preventDefault();
    event.stopPropagation();
    handleContextMenuOpen("course", event.clientX, event.clientY, sourcePath, selectedText);
  }

  function handleContextMenuClose() {
    setContextMenu(null);
  }

  function handleContextAsk() {
    setQAQuestion("");
    setContextMenu(null);
  }

  function handleContextExplain() {
    const text = selection?.selectedText || contextMenu?.selectedText || "";
    if (text.trim()) {
      setQAQuestion(`请解释这段内容：\n\n${text}`);
    }
    setContextMenu(null);
  }

  async function handleContextCopy() {
    const text = selection?.selectedText || contextMenu?.selectedText || "";
    if (text.trim()) {
      await navigator.clipboard?.writeText(text);
    }
    setContextMenu(null);
  }

  /** Upsert or delete an annotation for the current context-menu selection. */
  function upsertAnnotation(updater: (prev: AnnotationStyle) => AnnotationStyle) {
    if (!contextMenu) {
      return;
    }
    const existing = findAnnotation(contextMenu.sourcePath, contextMenu.selectedText);
    const newStyle = updater(existing?.style ?? {});
    const hasStyle = newStyle.color || newStyle.bold || newStyle.underline;

    setAnnotations((prev) => {
      const rest = prev.filter((ann) => ann !== existing);
      if (!hasStyle) {
        // All styles cleared — delete the annotation
        return rest;
      }
      const ann: Annotation = existing
        ? { ...existing, style: newStyle }
        : {
            id: nextId("annot"),
            courseFile: contextMenu.sourcePath,
            selectedText: contextMenu.selectedText,
            style: newStyle,
            createdAt: new Date().toISOString(),
          };
      return [...rest, ann];
    });
  }

  function handleSetColor(color: AnnotationColor | null) {
    upsertAnnotation((prev) => ({ ...prev, color: color ?? undefined }));
  }

  function handleToggleBold() {
    upsertAnnotation((prev) => ({ ...prev, bold: !prev.bold }));
  }

  function handleToggleUnderline() {
    upsertAnnotation((prev) => ({ ...prev, underline: !prev.underline }));
  }

  async function handleDeleteQA(record: QARecord) {
    if (!project) {
      return;
    }
    if (!window.confirm(`删除问答记录 "${qaTitle(record)}"？此操作不可撤销。`)) {
      return;
    }
    try {
      await deleteQARecord(project.id, record.id);
      setQAHistory((items) => items.filter((item) => item.id !== record.id));
      if (selectedQA?.id === record.id) {
        setSelectedQA(null);
      }
      setLayout((prev) =>
        updateEveryGroup(prev, (group) => ({
          ...group,
          items: group.items.filter((item) => item.qaRecordId !== record.id),
          activeItemId: group.items.find((item) => item.qaRecordId === record.id && item.id === group.activeItemId)
            ? group.items.filter((i) => i.id !== group.activeItemId).pop()?.id ?? null
            : group.activeItemId,
        })),
      );
      await refreshCourses(project.id);
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "删除失败");
    }
  }

  async function handleDeleteCourse(file: CourseFile) {
    if (!project) {
      return;
    }
    if (!window.confirm(`删除课件 "${file.title}"？此操作不可撤销。`)) {
      return;
    }
    try {
      await deleteCourseFile(project.id, file.filename);
      // Also delete any QA record pointing to this file
      const matchingRecords = qaHistory.filter((r) => r.output_path === file.filename);
      for (const record of matchingRecords) {
        try {
          await deleteQARecord(project.id, record.id);
        } catch { /* file may already be gone */ }
      }
      if (matchingRecords.length > 0) {
        setQAHistory((items) => items.filter((item) => !matchingRecords.includes(item)));
        if (selectedQA && matchingRecords.some((r) => r.id === selectedQA.id)) {
          setSelectedQA(null);
        }
      }
      await refreshCourses(project.id);
      const itemId = `course:${file.filename}`;
      setLayout((prev) =>
        updateEveryGroup(prev, (group) => ({
          ...group,
          items: group.items.filter((item) => item.id !== itemId),
          activeItemId: group.activeItemId === itemId
            ? group.items.filter((i) => i.id !== itemId).pop()?.id ?? null
            : group.activeItemId,
        })),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除课件失败");
    }
  }

  async function handleSaveQAItem(groupId: string, item: OpenItem) {
    if (!project || !item.qaRecordId) {
      return;
    }
    setError("");
    try {
      const record = await updateQARecord(project.id, item.qaRecordId, { answer_md: item.content });
      setSelectedQA(record);
      setQAHistory((items) => items.map((entry) => (entry.id === record.id ? record : entry)));
      setLayout((prev) =>
        updateGroup(prev, groupId, (group) => ({
          ...group,
          items: group.items.map((entry) =>
            entry.id === item.id ? { ...entry, content: record.answer_md, favorite: record.favorite, dirty: false } : entry,
          ),
        })),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存回答失败");
    }
  }

  async function handleToggleFavorite(recordOrItem: QARecord | OpenItem) {
    if (!project) {
      return;
    }
    const id = "source_type" in recordOrItem ? recordOrItem.id : recordOrItem.qaRecordId;
    const favorite = "source_type" in recordOrItem ? recordOrItem.favorite : Boolean(recordOrItem.favorite);
    if (!id) {
      return;
    }
    try {
      const updated = await setQAFavorite(project.id, id, !favorite);
      setSelectedQA(updated);
      setQAHistory((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      updateOpenQARecord(updated);
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "切换收藏失败");
    }
  }

  async function handleGroupDrop(event: DragEvent<HTMLElement>, groupId: string) {
    event.preventDefault();
    event.stopPropagation();
    if (!project) {
      return;
    }
    const raw = event.dataTransfer.getData("application/codecourse-item");
    if (!raw) {
      return;
    }
    const zone = dropPreview?.groupId === groupId ? dropPreview.zone : detectDropZone(event);
    setDropPreview(null);
    try {
      const item = await buildOpenItem(JSON.parse(raw) as DropPayload);
      if (!item) {
        return;
      }
      if (zone === "center") {
        openItemInGroup(groupId, item);
      } else {
        splitGroupWithItem(groupId, zone, item);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "拖拽打开失败");
    }
  }

  function updateQAItemContent(groupId: string, itemId: string, content: string) {
    setLayout((prev) =>
      updateGroup(prev, groupId, (group) => ({
        ...group,
        items: group.items.map((item) => (item.id === itemId ? { ...item, content, dirty: true } : item)),
      })),
    );
  }

  function renderGroup(group: EditorGroup) {
    const activeItem = group.items.find((item) => item.id === group.activeItemId) ?? null;
    const previewZone = dropPreview?.groupId === group.id ? dropPreview.zone : null;
    const activeQAHighlights =
      activeItem?.type === "qa" ? highlights.filter((highlight) => highlight.source_type === "qa" && highlight.source_path === activeItem.path) : [];

    return (
      <section
        key={group.id}
        className={`reader-pane ${activeGroupId === group.id ? "active" : ""}`}
        onClick={() => setActiveGroupId(group.id)}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDropPreview({ groupId: group.id, zone: detectDropZone(event) });
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropPreview((prev) => (prev?.groupId === group.id ? null : prev));
          }
        }}
        onDrop={(event) => handleGroupDrop(event, group.id)}
      >
        <div className="pane-tabs">
          <span className="pane-name">工作区</span>
          {group.items.map((item) => (
            <button
              key={item.id}
              className={`pane-tab ${item.id === group.activeItemId ? "active" : ""}`}
              onClick={() => activateItem(group.id, item)}
              title={item.path}
            >
              <span>{item.dirty ? `${item.title} *` : item.title}</span>
              <X
                size={13}
                onClick={(event) => {
                  event.stopPropagation();
                  closeItemInGroup(group.id, item.id);
                }}
              />
            </button>
          ))}
        </div>
        <div className="pane-body">
          {activeItem?.type === "file" ? (
            <CodeViewer
              path={activeItem.path}
              language={activeItem.language ?? "plaintext"}
              content={activeItem.content}
              selectedRange={
                selectionAnchor?.sourceType === "file" && selectionAnchor.sourcePath === activeItem.path
                  ? selectionAnchor.range ?? null
                  : null
              }
              onSelectionChange={handleSelection}
              onContextMenu={(payload) => handleContextMenuOpen("file", payload.clientX, payload.clientY, payload.sourcePath, payload.selectedText)}
            />
          ) : null}
          {activeItem?.type === "course" ? (
            editingCourseItemId === activeItem.id ? (
              <div className="viewer qa-editor-view">
                <div className="viewer-header">
                  <span>{activeItem.title} - 编辑 Markdown</span>
                  <div className="viewer-actions">
                    <button
                      className="secondary-button compact"
                      onClick={async () => {
                        if (!project) return; let rid = activeItem.qaRecordId; if (!rid) { const found = qaHistory.find((x) => x.output_path === activeItem.path); rid = found?.id; } if (!rid) return;
                        try {
                          const record = qaHistory.find((r) => r.id === rid);
                          if (!record) return;
                          const updated = await updateQARecord(project.id, rid!, { answer_md: activeItem.content });
                          setQAHistory((items) => items.map((item) => (item.id === updated.id ? updated : item)));
                          if (selectedQA?.id === updated.id) setSelectedQA(updated);
                          try {
                            const fresh = await getCourseContent(project.id, activeItem.path);
                            setLayout((prev) =>
                              updateGroup(prev, group.id, (g) => ({
                                ...g,
                                items: g.items.map((item) =>
                                  item.id === activeItem.id ? { ...item, content: fresh.content, dirty: false } : item,
                                ),
                              })),
                            );
                          } catch {}
                          setEditingCourseItemId(null);
                        } catch (caught) {
                          setError(caught instanceof Error ? caught.message : "保存失败");
                        }
                      }}
                    >
                      <Save size={14} />
                      保存
                    </button>
                    <button
                      className="secondary-button compact"
                      onClick={() => setEditingCourseItemId(null)}
                    >
                      取消
                    </button>
                  </div>
                </div>
                <textarea
                  className="qa-workspace-editor"
                  value={activeItem.content}
                  onChange={(event) => {
                    const newContent = event.target.value;
                    setLayout((prev) =>
                      updateGroup(prev, group.id, (g) => ({
                        ...g,
                        items: g.items.map((item) =>
                          item.id === activeItem.id ? { ...item, content: newContent, dirty: true } : item,
                        ),
                      })),
                    );
                  }}
                />
              </div>
            ) : (
              <MarkdownViewer
                title={activeItem.title}
                sourcePath={activeItem.path}
                content={activeItem.content}
                highlights={highlights.filter((highlight) => highlight.source_type === "course" && highlight.source_path === activeItem.path)}
                annotations={annotations.filter((ann) => ann.courseFile === activeItem.path)}
                tempSelectedText={
                  selectionAnchor?.sourceType === "course" && selectionAnchor.sourcePath === activeItem.path
                    ? selectionAnchor.selectedText
                    : null
                }
                onSelectionChange={handleSelection}
                onContextMenu={(event, text, sourcePath) => handleMarkdownContextMenuOpen(event, sourcePath, text)}
                headerActions={(activeItem.qaRecordId || activeItem.path.startsWith("selection_answers/") || activeItem.path.startsWith("qa/")) ? (
                  <button
                    className="secondary-button compact"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingCourseItemId(activeItem.id);
                    }}
                  >
                    编辑
                  </button>
                ) : null}
              />
            )
          ) : null}
          {activeItem?.type === "qa" ? (
            <div className="viewer qa-editor-view">
              <div className="viewer-header">
                <span>{activeItem.dirty ? `${activeItem.title} *` : activeItem.title}</span>
                <div className="viewer-actions">
                  <button className="icon-button" onClick={() => handleToggleFavorite(activeItem)} title="收藏/取消收藏">
                    <Star size={14} className={activeItem.favorite ? "starred" : ""} />
                  </button>
                  <button
                    className="secondary-button compact"
                    onClick={() => qaHighlightDraft && handleCreateHighlight("qa", qaHighlightDraft.sourcePath, qaHighlightDraft.selectedText)}
                    disabled={!qaHighlightDraft || qaHighlightDraft.sourcePath !== activeItem.path}
                  >
                    标记
                  </button>
                  <button className="secondary-button compact" onClick={() => handleSaveQAItem(group.id, activeItem)} disabled={!activeItem.dirty}>
                    <Save size={14} />
                    保存
                  </button>
                </div>
              </div>
              <textarea
                className="qa-workspace-editor"
                value={activeItem.content}
                onChange={(event) => updateQAItemContent(group.id, activeItem.id, event.target.value)}
                onSelect={(event) => {
                  const target = event.currentTarget;
                  const text = target.value.slice(target.selectionStart, target.selectionEnd).trim();
                  if (text) {
                    setQAHighlightDraft({ sourcePath: activeItem.path, selectedText: text });
                    const nextSelection = {
                      sourceType: "selection",
                      sourcePath: activeItem.path,
                      selectedText: text,
                    } as SelectionSummary;
                    setSelection(nextSelection);
                    setSelectionAnchor(nextSelection);
                  }
                }}
                onContextMenu={(event) => {
                  const target = event.currentTarget;
                  const text = target.value.slice(target.selectionStart, target.selectionEnd).trim() || qaHighlightDraft?.selectedText || "";
                  if (!text) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  handleContextMenuOpen("selection", event.clientX, event.clientY, activeItem.path, text);
                }}
              />
              {activeQAHighlights.length ? (
                <div className="qa-highlight-list">
                  {activeQAHighlights.map((highlight) => (
                    <mark key={highlight.id} className="reader-highlight" style={{ backgroundColor: highlight.color }}>
                      {highlight.selected_text}
                    </mark>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {!activeItem ? <div className="empty-state">点击或拖拽文件/课件到这里阅读</div> : null}
        </div>
        {previewZone ? <div className={`drop-preview ${previewZone}`} /> : null}
      </section>
    );
  }

  function renderLayoutNode(node: LayoutNode) {
    if (node.type === "group") {
      return renderGroup(node.group);
    }
    return (
      <div key={node.id} className={`split-node ${node.direction}`}>
        <div className="split-child" style={{ flex: `${node.ratio} 1 0` }}>
          {renderLayoutNode(node.first)}
        </div>
        <div
          className={`split-resizer ${node.direction}`}
          onDoubleClick={() => collapseSplitById(node.id, node.ratio < 0.5 ? "first" : "second")}
          onMouseDown={(event) => {
            const rect = event.currentTarget.parentElement?.getBoundingClientRect();
            if (!rect) {
              return;
            }
            setDragState({
              kind: "split",
              splitId: node.id,
              direction: node.direction,
              startX: event.clientX,
              startY: event.clientY,
              startRatio: node.ratio,
              size: node.direction === "row" ? rect.width : rect.height,
            });
          }}
        />
        <div className="split-child" style={{ flex: `${1 - node.ratio} 1 0` }}>
          {renderLayoutNode(node.second)}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img
            src="/logo.jpg"
            alt="CodeCourse logo"
            className="brand-logo"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
          <div className="brand-text">
            <strong>GitHub 项目学习器</strong>
            <span>{project ? project.name : "MVP"}</span>
          </div>
        </div>
        <RepositoryForm loading={loading} onSubmit={handleImport} />
        <button className="topbar-action" onClick={() => setSettingsOpen(true)} title="配置模型 API">
          模型 API
        </button>
      </header>
      {error ? <div className="error-bar">{error}</div> : null}
      {showBusy ? <div className="busy-bar">{qaLoading ? "正在生成回答..." : loading ? "正在处理..." : "正在生成课程内容..."}</div> : null}
      <main
        className="workbench"
        style={{ gridTemplateColumns: `${sidebarWidth}px 6px minmax(0, 1fr) 6px ${explainWidth}px` }}
      >
        <Sidebar
          projects={projects}
          currentProjectId={project?.id ?? null}
          tree={tree}
          courses={courses}
          selectedPath={fileContent?.path ?? null}
          selectedScopePaths={selectedScopeFiles}
          selectedCourse={selectedCourse}
          projectType={project?.project_type ?? "repository"}
          fileSelectionMode={!isLearningPlanProject && scopeType === "files"}
          busyProjectId={busyProjectId}
          projectHeight={sidebarProjectHeight}
          courseHeight={sidebarCourseHeight}
          onResizeProjectStart={(event) => setDragState({ kind: "sidebar-project", startY: event.clientY, startHeight: sidebarProjectHeight })}
          onResizeCourseStart={(event) => setDragState({ kind: "sidebar-course", startY: event.clientY, startHeight: sidebarCourseHeight })}
          onSelectProject={openProject}
          onCreateLearningPlan={handleCreateLearningPlan}
          onRegenerateProject={handleRegenerate}
          onDeleteProject={handleDelete}
          onSelectFile={handleSelectFile}
          onOpenFile={handleOpenFile}
          onSelectCourse={handleSelectCourse}
          onDeleteCourse={handleDeleteCourse}
        />
        <div
          className="resize-handle"
          onMouseDown={(event) => setDragState({ kind: "sidebar-width", startX: event.clientX, startWidth: sidebarWidth })}
          title="拖拽调整左栏宽度"
        />
        <section className="center-pane">
          <div className="generation-bar">
            <div className="scope-controls">
              <select
                value={isLearningPlanProject ? "learning_plan" : scopeType}
                onChange={(event) => {
                  const nextScope = event.target.value as ScopeType;
                  setScopeType(nextScope);
                  if (nextScope !== "files") {
                    setSelectedScopeFiles([]);
                  }
                }}
                disabled={!project || isTaskRunning || isLearningPlanProject}
              >
                <option value="full_project">全项目</option>
                <option value="files">指定文件</option>
                <option value="learning_plan">学习计划</option>
              </select>
              <div className="scope-file-summary">
                {isLearningPlanProject || scopeType === "learning_plan"
                  ? "根据生成要求生成学习计划"
                  : scopeType === "files"
                    ? selectedScopeFiles.length
                      ? `已选 ${selectedScopeFiles.length} 个：${selectedScopeFiles.map((path) => path.split("/").pop() ?? path).join("、")}`
                      : "请在文件树中选择文件"
                    : "使用整个项目生成总纲"}
              </div>
              <button onClick={handleGenerateOutline} disabled={!project || isTaskRunning}>
                生成 AI 总纲
              </button>
              <button className="secondary-button" onClick={() => setPromptEditorOpen(true)}>
                提示词
              </button>
            </div>
            <textarea
              className="generation-instructions"
              value={generationInstructions}
              onChange={(event) => setGenerationInstructions(event.target.value)}
              placeholder="生成要求"
              disabled={!project || isTaskRunning}
            />
            <div className="lesson-actions">
              <button onClick={() => handleGenerateFileLesson("brief")} disabled={!canGenerateFileLesson || isTaskRunning}>
                生成粗略介绍
              </button>
              <button onClick={() => handleGenerateFileLesson("detailed")} disabled={!canGenerateFileLesson || isTaskRunning}>
                生成详细分析
              </button>
            </div>
            <div className={`task-status ${activeTask?.status === "failed" ? "failed" : ""}`}>
              {taskMessage || "待生成"}
            </div>
          </div>
          <div className="reader-workspace">{renderLayoutNode(layout)}</div>
        </section>
        <div
          className="resize-handle"
          onMouseDown={(event) => setDragState({ kind: "explain-width", startX: event.clientX, startWidth: explainWidth })}
          title="拖拽调整右栏宽度"
        />
        <ExplainPanel
          selection={selection}
          question={qaQuestion}
          loading={qaLoading}
          history={qaHistory}
          historyQuery={qaHistoryQuery}
          favoriteOnly={qaFavoriteOnly}
          selectedRecord={selectedQA}
          settings={llmSettings}
          panelError={qaPanelError}
          askHeight={qaAskHeight}
          onAskResizeStart={(event: MouseEvent<HTMLDivElement>) => setDragState({ kind: "qa-ask", startY: event.clientY, startHeight: qaAskHeight })}
          onQuestionChange={setQAQuestion}
          onSelectionTextChange={handleSelectionTextChange}
          onClearSelection={handleClearSelection}
          onDismissSelection={handleDismissSelection}
          onAsk={handleAsk}
          onHistoryQueryChange={setQAHistoryQuery}
          onFavoriteOnlyChange={setQAFavoriteOnly}
          onSelectRecord={setSelectedQA}
          onOpenRecord={(record) => openQAInActiveGroup(record)}
          onDeleteRecord={handleDeleteQA}
          onRenameRecord={handleRenameQA}
          onToggleFavorite={handleToggleFavorite}
          onOpenSettings={() => setSettingsOpen(true)}
          onExplain={() => {
            if (!selection?.selectedText?.trim()) return;
            setQAQuestion(`请解释这段内容：\n\n${selection.selectedText}`);
          }}
        />
      </main>
      <LLMSettingsDialog
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          loadLLMSettings();
        }}
      />
      {promptEditorOpen ? (
        <PromptEditor onClose={() => setPromptEditorOpen(false)} />
      ) : null}
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          sourceType={contextMenu.sourceType}
          currentStyle={contextMenu.existingStyle}
          onClose={handleContextMenuClose}
          onAskSelection={handleContextAsk}
          onExplainSelection={handleContextExplain}
          onCopySelection={handleContextCopy}
          onClearSelection={handleDismissSelection}
          onSetColor={handleSetColor}
          onToggleBold={handleToggleBold}
          onToggleUnderline={handleToggleUnderline}
        />
      ) : null}
    </div>
  );
}
