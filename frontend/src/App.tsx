import { useEffect, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { Save, Star, X } from "lucide-react";
import {
  askQuestion,
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
import CodeViewer, { ViewerSelection } from "./components/CodeViewer";
import ExplainPanel, { SelectionSummary } from "./components/ExplainPanel";
import LLMSettingsDialog from "./components/LLMSettingsDialog";
import MarkdownViewer from "./components/MarkdownViewer";
import RepositoryForm from "./components/RepositoryForm";
import Sidebar from "./components/Sidebar";

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
  const [llmSettings, setLLMSettings] = useState<LLMSettings | null>(null);
  const [scopeType, setScopeType] = useState<ScopeType>("full_project");
  const [scopePathsText, setScopePathsText] = useState("");
  const [generationInstructions, setGenerationInstructions] = useState("");
  const [activeTask, setActiveTask] = useState<GenerationTask | null>(null);
  const [taskMessage, setTaskMessage] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [explainWidth, setExplainWidth] = useState(360);
  const [sidebarProjectHeight, setSidebarProjectHeight] = useState(150);
  const [sidebarCourseHeight, setSidebarCourseHeight] = useState(240);
  const [qaAskHeight, setQAAskHeight] = useState(390);
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

  const idCounter = useRef(1);
  const canGenerateFileLesson = Boolean(project && fileContent);
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
        setQAAskHeight(clamp(currentDrag.startHeight + event.clientY - currentDrag.startY, 230, 560));
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
    if (scopeType === "full_project") {
      return { type: "full_project", paths: [] };
    }
    const typedPaths = parseScopePaths(scopePathsText);
    if (typedPaths.length > 0) {
      return { type: scopeType, paths: typedPaths };
    }
    if (scopeType === "files" && fileContent?.path) {
      return { type: scopeType, paths: [fileContent.path] };
    }
    if (scopeType === "directories" && fileContent?.path) {
      const dir = parentDir(fileContent.path);
      return { type: scopeType, paths: dir ? [dir] : [] };
    }
    return { type: scopeType, paths: [] };
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
      return {
        id: `qa:${record.id}`,
        type: "qa",
        path: record.output_path ?? `qa/${record.id}`,
        title: qaTitle(record),
        content: record.answer_md,
        qaRecordId: record.id,
        favorite: record.favorite,
        dirty: false,
      };
    }
    return null;
  }

  async function openFileInActiveGroup(projectId: number, path: string) {
    const content = await getProjectFile(projectId, path);
    setFileContent(content);
    setSelectedCourse(null);
    if (scopeType === "files") {
      setScopePathsText(path);
    } else if (scopeType === "directories") {
      setScopePathsText(parentDir(path));
    }
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

  function openQAInActiveGroup(record: QARecord) {
    setSelectedQA(record);
    openItemInGroup(activeGroupId, {
      id: `qa:${record.id}`,
      type: "qa",
      path: record.output_path ?? `qa/${record.id}`,
      title: qaTitle(record),
      content: record.answer_md,
      qaRecordId: record.id,
      favorite: record.favorite,
      dirty: false,
    });
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
      setFileContent(null);
      setSelectedCourse(null);
      setSelection(null);
      setQAQuestion("");
      setSelectedQA(null);
      setQAPanelError("");
      setHighlights([]);
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

  async function handleSelectFile(path: string) {
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
    setSelection({
      sourceType: nextSelection.sourceType,
      sourcePath: nextSelection.sourcePath,
      selectedText: nextSelection.selectedText.slice(0, 20000),
      language: nextSelection.language,
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
              onSelectionChange={handleSelection}
            />
          ) : null}
          {activeItem?.type === "course" ? (
            <MarkdownViewer
              title={activeItem.title}
              sourcePath={activeItem.path}
              content={activeItem.content}
              highlights={highlights.filter((highlight) => highlight.source_type === "course" && highlight.source_path === activeItem.path)}
              onSelectionChange={handleSelection}
              onCreateHighlight={(text) => handleCreateHighlight("course", activeItem.path, text)}
            />
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
                    setSelection({
                      sourceType: "selection",
                      sourcePath: activeItem.path,
                      selectedText: text,
                    });
                  }
                }}
              />
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
          selectedCourse={selectedCourse}
          busyProjectId={busyProjectId}
          projectHeight={sidebarProjectHeight}
          courseHeight={sidebarCourseHeight}
          onResizeProjectStart={(event) => setDragState({ kind: "sidebar-project", startY: event.clientY, startHeight: sidebarProjectHeight })}
          onResizeCourseStart={(event) => setDragState({ kind: "sidebar-course", startY: event.clientY, startHeight: sidebarCourseHeight })}
          onSelectProject={openProject}
          onRegenerateProject={handleRegenerate}
          onDeleteProject={handleDelete}
          onSelectFile={handleSelectFile}
          onSelectCourse={handleSelectCourse}
        />
        <div
          className="resize-handle"
          onMouseDown={(event) => setDragState({ kind: "sidebar-width", startX: event.clientX, startWidth: sidebarWidth })}
          title="拖拽调整左栏宽度"
        />
        <section className="center-pane">
          <div className="generation-bar">
            <div className="scope-controls">
              <select value={scopeType} onChange={(event) => setScopeType(event.target.value as ScopeType)} disabled={!project || isTaskRunning}>
                <option value="full_project">全项目</option>
                <option value="directories">指定目录</option>
                <option value="files">指定文件</option>
              </select>
              <input
                value={scopePathsText}
                onChange={(event) => setScopePathsText(event.target.value)}
                placeholder="目录或文件路径"
                disabled={!project || scopeType === "full_project" || isTaskRunning}
              />
              <button onClick={handleGenerateOutline} disabled={!project || isTaskRunning}>
                生成 AI 总纲
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
          onAsk={handleAsk}
          onHistoryQueryChange={setQAHistoryQuery}
          onFavoriteOnlyChange={setQAFavoriteOnly}
          onSelectRecord={setSelectedQA}
          onOpenRecord={(record) => openQAInActiveGroup(record)}
          onRenameRecord={handleRenameQA}
          onToggleFavorite={handleToggleFavorite}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </main>
      <LLMSettingsDialog
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          loadLLMSettings();
        }}
      />
    </div>
  );
}
