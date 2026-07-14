import { useEffect, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { BookOpen, Bot, ChevronDown, Download, FolderTree, MoreHorizontal, PanelLeft, Save, Sparkles, Star, X } from "lucide-react";
import {
  askQuestion,
  buildProjectIndex,
  createEmptyCourseFile,
  createLearningPlan,
  createHighlight,
  deleteLearningAnchor,
  dismissDocumentTerm,
  getQARecord,
  getQASessionTree,
  getLearningAnchor,
  deleteProject,
  generateFileLesson,
  generateOutlineLesson,
  generateOutline,
  getCourseContent,
  getCourseFiles,
  getGenerationTask,
  getLLMSettings,
  getProject,
  getProjectFile,
  getProjectIndexStatus,
  getTree,
  importProject,
  listGenerationTasks,
  listHighlights,
  listKnowledgeLinks,
  listDocumentTerms,
  listProjects,
  listQARecords,
  regenerateProject,
  markDocumentTermKnown,
  saveLearningAnchor,
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
  DocumentTerm,
  LearningAnchor,
  KnowledgeLink,
  ProjectIndexStatus,
  QARecord,
  TreeNode,
} from "./api/client";
import AppDialog from "./components/AppDialog";
import type { AppDialogState, ChoiceDialogOption } from "./components/AppDialog";
import CodeViewer, { ViewerRange, ViewerSelection } from "./components/CodeViewer";
import ContextMenu from "./components/ContextMenu";
import ExplainPanel, { AssistantContextSummary, SelectionSummary } from "./components/ExplainPanel";
import KnowledgeGraphViewer from "./components/KnowledgeGraphViewer";
import LLMSettingsDialog from "./components/LLMSettingsDialog";
import MarkdownViewer from "./components/MarkdownViewer";
import PromptEditor from "./components/PromptEditor";
import Sidebar, { type NavigationView } from "./components/Sidebar";
import type { Annotation, AnnotationColor, AnnotationStyle } from "./types";

type ScopeType = LearningScope["type"];
type OpenItemType = "file" | "course" | "qa" | "knowledge_graph";
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

type DialogResolver = (value: string | boolean | null) => void;

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
  const type = task.task_type === "file_lesson" ? "文件课件" : task.task_type === "outline_lesson" ? "项目课件" : "项目总纲";
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
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [navigationView, setNavigationView] = useState<NavigationView>("courses");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [llmSettings, setLLMSettings] = useState<LLMSettings | null>(null);
  const [scopeType, setScopeType] = useState<ScopeType>("full_project");
  const [scopePathsText, setScopePathsText] = useState("");
  const [selectedScopeFiles, setSelectedScopeFiles] = useState<string[]>([]);
  const [generationInstructions, setGenerationInstructions] = useState("");
  const [activeTask, setActiveTask] = useState<GenerationTask | null>(null);
  const [indexStatus, setIndexStatus] = useState<ProjectIndexStatus | null>(null);
  const [indexBuilding, setIndexBuilding] = useState(false);
  const [taskMessage, setTaskMessage] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [explainWidth, setExplainWidth] = useState(360);
  const [sidebarProjectHeight, setSidebarProjectHeight] = useState(150);
  const [sidebarCourseHeight, setSidebarCourseHeight] = useState(240);
  const [qaAskHeight, setQAAskHeight] = useState(340);
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
  const [qaUpperTab, setQAUpperTab] = useState<"assistant" | "history" | "knowledge">("assistant");
  const [selectedQA, setSelectedQA] = useState<QARecord | null>(null);
  const [qaSessionId, setQASessionId] = useState<number | null>(null);
  const [qaSessionTree, setQASessionTree] = useState<QARecord[]>([]);
  const [documentTerms, setDocumentTerms] = useState<DocumentTerm[]>([]);
  const [documentTermsBySource, setDocumentTermsBySource] = useState<Record<string, DocumentTerm[]>>({});
  const [learningAnchor, setLearningAnchor] = useState<LearningAnchor | null>(null);
  const [qaPanelError, setQAPanelError] = useState("");
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const [knowledgeLinks, setKnowledgeLinks] = useState<KnowledgeLink[]>([]);
  const [knowledgeRefreshKey, setKnowledgeRefreshKey] = useState(0);
  const [qaHighlightDraft, setQAHighlightDraft] = useState<{ sourcePath: string; selectedText: string } | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    sourceType: "file" | "course" | "selection" | "qa";
    sourcePath: string;
    selectedText: string;
    existingStyle: AnnotationStyle;
  } | null>(null);
  const [editingCourseItemId, setEditingCourseItemId] = useState<string | null>(null);
  const [appDialog, setAppDialog] = useState<AppDialogState | null>(null);
  const [appDialogValue, setAppDialogValue] = useState("");

  const idCounter = useRef(1);
  const dialogResolverRef = useRef<DialogResolver | null>(null);
  const canGenerateFileLesson = Boolean(project && fileContent);
  const isLearningPlanProject = project?.project_type === "learning_plan";
  const isTaskRunning = activeTask ? !TERMINAL_TASK_STATUSES.has(activeTask.status) : false;
  const showBusy = loading || isTaskRunning || qaLoading;

  useEffect(() => {
    loadProjects();
    loadLLMSettings();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      if (appDialog) {
        closeAppDialog(null);
        return;
      }
      setMoreMenuOpen(false);
      setGenerationOpen(false);
      setAssistantOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [appDialog]);

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

  useEffect(() => {
    if (!project || !selectedQA) {
      setQASessionTree([]);
      setDocumentTerms([]);
      setLearningAnchor(null);
      return;
    }
    let cancelled = false;
    const sourcePath = selectedQA.output_path || String(selectedQA.id);
    Promise.all([
      selectedQA.session_id ? getQASessionTree(project.id, selectedQA.session_id) : Promise.resolve([selectedQA]),
      listDocumentTerms(project.id, "qa", sourcePath),
      getLearningAnchor(project.id, selectedQA.id).catch(() => null),
    ]).then(([tree, terms, anchor]) => {
      if (cancelled) return;
      setQASessionTree(tree);
      setDocumentTerms(terms);
      setLearningAnchor(anchor);
      setDocumentTermsBySource((current) => ({ ...current, [`qa:${sourcePath}`]: terms }));
    }).catch((caught) => {
      if (!cancelled) setQAPanelError(caught instanceof Error ? caught.message : "加载问答分支失败");
    });
    return () => { cancelled = true; };
  }, [project?.id, selectedQA?.id, selectedQA?.updated_at]);

  function nextId(prefix: string) {
    idCounter.current += 1;
    return `${prefix}-${idCounter.current}`;
  }

  function openAppDialog(state: AppDialogState): Promise<string | boolean | null> {
    setAppDialog(state);
    setAppDialogValue(
      state.kind === "input"
        ? state.initialValue ?? ""
        : state.kind === "choice"
          ? state.initialValue ?? state.options[0]?.value ?? ""
          : "",
    );
    return new Promise((resolve) => {
      dialogResolverRef.current = resolve;
    });
  }

  async function confirmAction(title: string, message: string, options?: { confirmText?: string; danger?: boolean }) {
    const result = await openAppDialog({
      kind: "confirm",
      title,
      message,
      confirmText: options?.confirmText,
      danger: options?.danger,
    });
    return result === true;
  }

  async function requestText(options: {
    title: string;
    message?: string;
    label?: string;
    initialValue?: string;
    placeholder?: string;
    confirmText?: string;
  }) {
    const result = await openAppDialog({ kind: "input", ...options });
    return typeof result === "string" ? result : null;
  }

  async function requestChoice(title: string, message: string, options: ChoiceDialogOption[]) {
    const result = await openAppDialog({
      kind: "choice",
      title,
      message,
      options,
      initialValue: options[0]?.value,
    });
    return typeof result === "string" ? result : null;
  }

  function closeAppDialog(value: string | boolean | null) {
    const resolver = dialogResolverRef.current;
    dialogResolverRef.current = null;
    setAppDialog(null);
    setAppDialogValue("");
    resolver?.(value);
  }

  function handleAppDialogConfirm() {
    if (!appDialog) {
      return;
    }
    if (appDialog.kind === "confirm") {
      closeAppDialog(true);
      return;
    }
    closeAppDialog(appDialogValue.trim());
  }

  function openExternal(url: string) {
    if (typeof window !== "undefined" && window.codecourseDesktop?.openExternal) {
      window.codecourseDesktop.openExternal(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
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

  async function refreshKnowledgeLinks(projectId = project?.id) {
    if (!projectId) {
      setKnowledgeLinks([]);
      return;
    }
    try {
      setKnowledgeLinks(await listKnowledgeLinks(projectId));
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "加载知识链接失败");
    }
  }

  async function refreshDocumentTerms(sourceType: "course" | "qa", sourcePath: string, projectId = project?.id) {
    if (!projectId || !sourcePath) return [];
    try {
      const terms = await listDocumentTerms(projectId, sourceType, sourcePath);
      setDocumentTermsBySource((current) => ({ ...current, [`${sourceType}:${sourcePath}`]: terms }));
      if (sourceType === "qa" && selectedQA && (selectedQA.output_path || String(selectedQA.id)) === sourcePath) {
        setDocumentTerms(terms);
      }
      return terms;
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "加载陌生术语失败");
      return [];
    }
  }

  async function refreshIndexStatus(projectId = project?.id) {
    if (!projectId) {
      setIndexStatus(null);
      setIndexBuilding(false);
      return;
    }
    try {
      const status = await getProjectIndexStatus(projectId);
      setIndexStatus(status);
      setIndexBuilding(status.status === "building");
    } catch {
      setIndexStatus(null);
      setIndexBuilding(false);
    }
  }

  async function trackIndexBuild(projectId: number) {
    setIndexBuilding(true);
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      const status = await getProjectIndexStatus(projectId);
      setIndexStatus(status);
      if (status.status !== "building") {
        setIndexBuilding(false);
        return;
      }
    }
    setIndexBuilding(false);
  }

  function applyActiveItem(item: OpenItem) {
    if (item.type === "file") {
      setFileContent({ path: item.path, content: item.content, language: item.language ?? "plaintext" });
      setSelectedCourse(null);
    } else if (item.type === "course") {
      setSelectedCourse(item.path);
      setFileContent(null);
      void refreshDocumentTerms(item.qaRecordId ? "qa" : "course", item.path);
    } else if (item.type === "knowledge_graph") {
      setFileContent(null);
      setSelectedCourse(null);
    } else {
      setFileContent(null);
      setSelectedCourse(null);
      const record = qaHistory.find((entry) => entry.id === item.qaRecordId);
      if (record) {
        setSelectedQA(record);
        setQASessionId(record.session_id ?? null);
        void refreshDocumentTerms("qa", item.path);
      }
    }
  }

  function getActiveOpenItem(): OpenItem | null {
    const group = findGroup(layout, activeGroupId);
    return group?.items.find((item) => item.id === group.activeItemId) ?? null;
  }

  function buildAssistantContextSummary(): AssistantContextSummary | null {
    if (!project) {
      return null;
    }
    const activeItem = getActiveOpenItem();
    if (!activeItem) {
      return {
        label: "项目",
        sourceType: "selection",
        sourcePath: project.name,
        preview: "将使用项目结构说明和学习总纲作为上下文。",
      };
    }
    if (activeItem.type === "file") {
      return {
        label: "当前文件",
        sourceType: "file",
        sourcePath: activeItem.path,
        preview: `语言：${activeItem.language ?? "plaintext"}。可直接询问这个文件的职责、入口、调用关系或修改风险。`,
      };
    }
    if (activeItem.qaRecordId || activeItem.type === "qa") {
      return {
        label: "当前回答",
        sourceType: "qa",
        sourcePath: activeItem.path,
        preview: `将使用回答内容摘要作为上下文：${activeItem.title}`,
      };
    }
    if (activeItem.type === "knowledge_graph") {
      return {
        label: "项目",
        sourceType: "selection",
        sourcePath: project.name,
        preview: "当前正在查看知识网络，将使用项目结构说明和学习总纲作为上下文。",
      };
    }
    return {
      label: "当前课件",
      sourceType: "course",
      sourcePath: activeItem.path,
      preview: `将使用课件内容摘要作为上下文：${activeItem.title}`,
    };
  }

  function buildAskPayloadContext(): Pick<Parameters<typeof askQuestion>[1], "source_type" | "source_path" | "selected_text"> {
    if (selection) {
      return {
        source_type: selection.sourceType,
        source_path: selection.sourcePath,
        selected_text: selection.selectedText,
      };
    }
    const activeItem = getActiveOpenItem();
    if (activeItem?.type === "file") {
      return {
        source_type: "file",
        source_path: activeItem.path,
        selected_text: "",
      };
    }
    if (activeItem?.qaRecordId || activeItem?.type === "qa") {
      return {
        source_type: "qa",
        source_path: activeItem.path,
        selected_text: "",
      };
    }
    if (activeItem?.type === "course") {
      return {
        source_type: "course",
        source_path: activeItem.path,
        selected_text: "",
      };
    }
    return {
      source_type: "selection",
      source_path: null,
      selected_text: "",
    };
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
      void refreshDocumentTerms("course", payload.filename, project.id);
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
    if (payload.kind === "knowledge_graph" || payload.kind === "knowledge") {
      return {
        id: "knowledge:graph",
        type: "knowledge_graph",
        path: "knowledge://graph",
        title: "知识网络",
        content: "",
      };
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
    void refreshDocumentTerms("course", filename, projectId);
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
    void refreshDocumentTerms("qa", relPath, project.id);
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

  function openKnowledgeGraphInActiveGroup() {
    if (!project) {
      return;
    }
    openItemInGroup(activeGroupId, {
      id: "knowledge:graph",
      type: "knowledge_graph",
      path: "knowledge://graph",
      title: "知识网络",
      content: "",
    });
  }

  async function openQAById(qaId: number) {
    if (!project) {
      return;
    }
    const record = qaHistory.find((entry) => entry.id === qaId) ?? await getQARecord(project.id, qaId);
    await openQAInActiveGroup(record);
  }

  async function handleOpenKnowledgeLink(term: string, links: KnowledgeLink[]) {
    if (!links.length) {
      return;
    }
    let selected = links[0];
    if (links.length > 1) {
      const choice = await requestChoice(
        term,
        "这个词条有多个回答，请选择要打开的回答。",
        links.map((link, index) => ({
          value: String(index),
          label: `回答 #${link.qa_record_id}`,
          description: `关联记录 ${link.qa_record_id}`,
        })),
      );
      if (choice === null) {
        return;
      }
      const index = Number(choice);
      if (!Number.isInteger(index) || index < 0 || index >= links.length) {
        return;
      }
      selected = links[index];
    }
    await openQAById(selected.qa_record_id);
  }

  async function openProject(nextProject: Project) {
    setError("");
    setLoading(true);
    try {
      const freshProject = await getProject(nextProject.id);
      setProject(freshProject);
      const [nextTree, nextCourses, tasks, settings, nextIndexStatus] = await Promise.all([
        getTree(freshProject.id),
        getCourseFiles(freshProject.id),
        listGenerationTasks(freshProject.id),
        getLLMSettings().catch(() => null),
        getProjectIndexStatus(freshProject.id).catch(() => null),
      ]);
      const initialLayout = createInitialLayout();
      setTree(nextTree);
      setCourses(nextCourses);
      setLLMSettings(settings);
      setActiveTask(tasks[0] ?? null);
      setIndexStatus(nextIndexStatus);
      setIndexBuilding(nextIndexStatus?.status === "building");
      setTaskMessage(tasks[0] ? `最近任务：${taskLabel(tasks[0])}` : "待生成");
      setScopeType(freshProject.project_type === "learning_plan" ? "learning_plan" : "full_project");
      setSelectedScopeFiles([]);
      setScopePathsText("");
      setFileContent(null);
      setSelectedCourse(null);
      setSelection(null);
      setQAQuestion("");
      setSelectedQA(null);
      setQASessionId(null);
      setQASessionTree([]);
      setDocumentTerms([]);
      setDocumentTermsBySource({});
      setLearningAnchor(null);
      setQAUpperTab("assistant");
      setQAPanelError("");
      setHighlights([]);
      setKnowledgeLinks([]);
      setAnnotations([]);
      setSelectionAnchor(null);
      setContextMenu(null);
      setLayout(initialLayout);
      setActiveGroupId(ROOT_GROUP_ID);
      await refreshQAHistory(freshProject.id);
      await refreshHighlights(freshProject.id);
      await refreshKnowledgeLinks(freshProject.id);
      const firstCourse = nextCourses.find((file) => file.filename === "outline.md") ?? nextCourses[0];
      if (firstCourse) {
        const content = await getCourseContent(freshProject.id, firstCourse.filename);
        void refreshDocumentTerms("course", firstCourse.filename, freshProject.id);
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
    const name = await requestText({
      title: "新建学习计划",
      label: "学习计划名称",
      placeholder: "新的学习计划",
      confirmText: "创建",
    });
    if (!name?.trim()) {
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

  async function handleImportRequest() {
    const url = await requestText({
      title: "导入 GitHub 项目",
      message: "输入公开仓库的 HTTPS 或 SSH 地址。",
      label: "仓库地址",
      placeholder: "git@github.com:owner/repository.git",
      confirmText: "导入",
    });
    if (url?.trim()) {
      await handleImport(url.trim());
    }
  }

  async function handleCreateCourse() {
    if (!project) {
      return;
    }
    const title = await requestText({
      title: "新建文档",
      label: "文档标题",
      placeholder: "输入文档标题",
      confirmText: "创建",
    });
    if (!title?.trim()) {
      return;
    }
    setError("");
    try {
      const created = await createEmptyCourseFile(project.id, title.trim());
      await refreshCourses(project.id);
      await openCourseInActiveGroup(project.id, created.filename);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建文档失败");
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
      const preferred = nextTask.task_type === "file_lesson" || nextTask.task_type === "outline_lesson"
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
    const ok = await confirmAction("生成 AI 总纲", "将调用模型 API 生成项目总纲，可能消耗 token。是否继续？", {
      confirmText: "生成",
    });
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
    const ok = await confirmAction(`生成${label}`, `将调用模型 API 为 ${fileContent.path} 生成${label}，可能消耗 token。是否继续？`, {
      confirmText: "生成",
    });
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

  async function handleGenerateOutlineLesson(lessonNumber: number, title: string) {
    if (!project || isTaskRunning) {
      return;
    }
    const ok = await confirmAction(
      `生成第 ${lessonNumber} 课`,
      `将调用模型 API 生成“${title}”的详细课件，并使用已构建的项目索引作为代码上下文，可能消耗较多 token。是否继续？`,
      { confirmText: "生成" },
    );
    if (!ok) {
      return;
    }
    setError("");
    try {
      const task = await generateOutlineLesson(project.id, lessonNumber, title, generationInstructions);
      await trackTask(task);
      setKnowledgeRefreshKey((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建课件任务失败");
    }
  }

  async function handleBuildIndex() {
    if (!project || project.project_type === "learning_plan") {
      return;
    }
    setIndexBuilding(true);
    setError("");
    try {
      const status = await buildProjectIndex(project.id);
      setIndexStatus(status);
      await trackIndexBuild(project.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "构建索引失败");
      setIndexBuilding(false);
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
    const ok = await confirmAction("删除项目", `删除本地导入项目 ${nextProject.name}？`, {
      confirmText: "删除",
      danger: true,
    });
    if (!ok) {
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
        setQASessionId(null);
        setIndexStatus(null);
        setSelectedScopeFiles([]);
        setSelectionAnchor(null);
        setContextMenu(null);
        setQAHistory([]);
        setHighlights([]);
        setKnowledgeLinks([]);
        setKnowledgeRefreshKey((value) => value + 1);
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
    if (nextText.trim()) {
      setAssistantOpen(true);
    }
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
    const ok = await confirmAction("AI 助手询问", `将调用模型 API 使用 ${llmSettings.model} 回答当前问题，可能消耗 token。是否继续？`, {
      confirmText: "询问",
    });
    if (!ok) {
      return;
    }
    setQALoading(true);
    setQAPanelError("");
    try {
      const context = buildAskPayloadContext();
      const record = await askQuestion(project.id, {
        source_type: context.source_type,
        source_path: context.source_path,
        selected_text: context.selected_text,
        question: qaQuestion,
        provider: llmSettings.provider,
        base_url: llmSettings.base_url,
        model: llmSettings.model,
        session_id: qaSessionId,
        parent_qa_id: selectedQA?.id ?? null,
        relation_type: "follow_up",
        selection_range: selectionAnchor?.range
          ? {
              start_line: selectionAnchor.range.startLineNumber,
              start_column: selectionAnchor.range.startColumn,
              end_line: selectionAnchor.range.endLineNumber,
              end_column: selectionAnchor.range.endColumn,
            }
          : null,
      });
      setSelectedQA(record);
      setQASessionId(record.session_id ?? qaSessionId);
      setQAUpperTab("assistant");
      setQAHistory((items) => [record, ...items.filter((item) => item.id !== record.id)]);
      setQAQuestion("");
      await Promise.all([
        refreshCourses(project.id),
        refreshQAHistory(project.id),
        refreshKnowledgeLinks(project.id),
      ]);
      setKnowledgeRefreshKey((value) => value + 1);
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "生成回答失败");
    } finally {
      setQALoading(false);
    }
  }

  function handleNewConversation() {
    setSelectedQA(null);
    setQASessionId(null);
    setQASessionTree([]);
    setDocumentTerms([]);
    setLearningAnchor(null);
    setQAQuestion("");
    setQAUpperTab("assistant");
  }

  async function handleGenerateTerm(term: DocumentTerm) {
    if (!project) return;
    if (term.status === "linked" && term.qa_record_id) {
      const record = qaHistory.find((entry) => entry.id === term.qa_record_id) ?? await getQARecord(project.id, term.qa_record_id);
      setSelectedQA(record);
      setQASessionId(record.session_id ?? null);
      setQAUpperTab("assistant");
      setAssistantOpen(true);
      return;
    }
    if (!llmSettings?.enabled || !llmSettings.has_api_key) {
      setQAPanelError("请先配置模型 API。 ");
      setSettingsOpen(true);
      return;
    }
    const parent = term.source_type === "qa"
      ? qaHistory.find((record) => (record.output_path || String(record.id)) === term.source_path) ?? selectedQA
      : null;
    const ok = await confirmAction(
      "生成术语解释",
      `将调用 ${llmSettings.model}，结合当前项目解释“${term.term_text}”，并把回答连接到${parent ? `“${qaTitle(parent)}”` : "当前课件"}。是否继续？`,
      { confirmText: "生成解释" },
    );
    if (!ok) return;
    setQALoading(true);
    setQAPanelError("");
    try {
      const record = await askQuestion(project.id, {
        source_type: term.source_type,
        source_path: term.source_path,
        selected_text: term.term_text,
        question: `请结合当前项目，用适合初学者的方式解释“${term.term_text}”：它是什么、为什么会出现在这里，以及接下来应该看哪里。`,
        provider: llmSettings.provider,
        base_url: llmSettings.base_url,
        model: llmSettings.model,
        session_id: parent?.session_id ?? qaSessionId,
        parent_qa_id: parent?.id ?? null,
        relation_type: "term_explanation",
        term_candidate_id: term.id,
      });
      setSelectedQA(record);
      setQASessionId(record.session_id ?? null);
      setQAHistory((items) => [record, ...items.filter((item) => item.id !== record.id)]);
      setQAUpperTab("assistant");
      setAssistantOpen(true);
      await Promise.all([
        refreshCourses(project.id),
        refreshQAHistory(project.id),
        refreshKnowledgeLinks(project.id),
        refreshDocumentTerms(term.source_type, term.source_path, project.id),
      ]);
      setKnowledgeRefreshKey((value) => value + 1);
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "生成术语解释失败");
    } finally {
      setQALoading(false);
    }
  }

  async function handleTermAction(term: DocumentTerm) {
    if (!project) return;
    const action = await requestChoice("处理陌生术语", `“${term.term_text}”不需要继续提示时，可以标记为已认识或仅忽略这次识别。`, [
      { value: "known", label: "我认识", description: "记为已掌握，后续不再作为陌生术语强调" },
      { value: "dismiss", label: "忽略", description: "隐藏当前候选，不生成解释" },
    ]);
    if (!action) return;
    try {
      const updated = action === "known"
        ? await markDocumentTermKnown(project.id, term.id)
        : await dismissDocumentTerm(project.id, term.id);
      const key = `${term.source_type}:${term.source_path}`;
      setDocumentTermsBySource((current) => ({
        ...current,
        [key]: (current[key] ?? []).map((item) => item.id === updated.id ? updated : item),
      }));
      setDocumentTerms((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "更新术语状态失败");
    }
  }

  async function handleSaveUnderstanding(record: QARecord, summary: string) {
    if (!project) return;
    try {
      const anchor = await saveLearningAnchor(project.id, record.id, summary, record.selected_text || record.display_title);
      setLearningAnchor(anchor);
      setKnowledgeRefreshKey((value) => value + 1);
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "保存理解失败");
    }
  }

  async function handleDeleteUnderstanding(record: QARecord) {
    if (!project) return;
    const ok = await confirmAction("删除个人理解", "删除这条由你编写的学习总结？", { confirmText: "删除", danger: true });
    if (!ok) return;
    try {
      await deleteLearningAnchor(project.id, record.id);
      setLearningAnchor(null);
      setKnowledgeRefreshKey((value) => value + 1);
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "删除理解失败");
    }
  }

  function handleSelectionTextChange(value: string) {
    const nextText = value.slice(0, 20000);
    if (!nextText.trim()) {
      handleDismissSelection();
      return;
    }
    const fallback = selectionAnchor ?? selection;
    setSelection((current) => ({
      sourceType: current?.sourceType ?? fallback?.sourceType ?? "selection",
      sourcePath: current?.sourcePath ?? fallback?.sourcePath ?? null,
      selectedText: nextText,
      language: current?.language ?? fallback?.language,
    }));
    setSelectionAnchor((current) => {
      const base = current ?? fallback;
      if (!base) {
        return {
          sourceType: "selection",
          sourcePath: null,
          selectedText: nextText,
        };
      }
      return {
        ...base,
        selectedText: nextText,
      };
    });
    setContextMenu((current) => (current ? { ...current, selectedText: nextText } : current));
  }

  function handleClearSelection() {
    handleSelectionTextChange("");
  }

  function handleDismissSelection() {
    setSelection(null);
    setSelectionAnchor(null);
    setContextMenu(null);
    window.getSelection()?.removeAllRanges();
  }

  async function handleRenameQA(record: QARecord) {
    if (!project) {
      return;
    }
    const nextTitle = await requestText({
      title: "重命名历史记录",
      label: "标题",
      initialValue: record.display_title || record.question,
      confirmText: "保存",
    });
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
    sourceType: "file" | "course" | "selection" | "qa",
    x: number,
    y: number,
    sourcePath: string | null,
    selectedText: string,
  ) {
    const path = sourcePath ?? "";
    const text = selectedText.slice(0, 20000);
    setAssistantOpen(true);
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

  function handleMarkdownContextMenuOpen(event: MouseEvent, sourcePath: string, selectedText: string, sourceType: "course" | "qa" = "course") {
    event.preventDefault();
    event.stopPropagation();
    handleContextMenuOpen(sourceType, event.clientX, event.clientY, sourcePath, selectedText);
  }

  function handleContextMenuClose() {
    setContextMenu(null);
  }

  function handleContextAsk() {
    setQAQuestion("");
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
    const ok = await confirmAction("删除问答记录", `删除问答记录 "${qaTitle(record)}"？此操作不可撤销。`, {
      confirmText: "删除",
      danger: true,
    });
    if (!ok) {
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
      await refreshKnowledgeLinks(project.id);
      setKnowledgeRefreshKey((value) => value + 1);
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "删除失败");
    }
  }

  async function handleDeleteCourse(file: CourseFile) {
    if (!project) {
      return;
    }
    const ok = await confirmAction("删除课件", `删除课件 "${file.title}"？此操作不可撤销。`, {
      confirmText: "删除",
      danger: true,
    });
    if (!ok) {
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
                sourceType={activeItem.qaRecordId ? "qa" : "course"}
                content={activeItem.content}
                highlights={highlights.filter((highlight) => highlight.source_type === (activeItem.qaRecordId ? "qa" : "course") && highlight.source_path === activeItem.path)}
                knowledgeLinks={knowledgeLinks.filter((link) => link.source_type === "course" && link.source_path === activeItem.path)}
                documentTerms={documentTermsBySource[`${activeItem.qaRecordId ? "qa" : "course"}:${activeItem.path}`] ?? []}
                annotations={annotations.filter((ann) => ann.courseFile === activeItem.path)}
                tempSelectedText={
                  selectionAnchor?.sourceType === (activeItem.qaRecordId ? "qa" : "course") && selectionAnchor.sourcePath === activeItem.path
                    ? selectionAnchor.selectedText
                    : null
                }
                onSelectionChange={handleSelection}
                onContextMenu={(event, text, sourcePath) => handleMarkdownContextMenuOpen(event, sourcePath, text, activeItem.qaRecordId ? "qa" : "course")}
                onOpenKnowledgeLink={handleOpenKnowledgeLink}
                onGenerateTerm={handleGenerateTerm}
                onTermAction={handleTermAction}
                onGenerateLesson={activeItem.path === "outline.md" ? handleGenerateOutlineLesson : undefined}
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
          {activeItem?.type === "knowledge_graph" && project ? (
            <KnowledgeGraphViewer
              projectId={project.id}
              refreshKey={knowledgeRefreshKey}
              onRequestText={requestText}
              onConfirm={confirmAction}
              onOpenQA={(qaId) => {
                openQAById(qaId).catch((caught) => setError(caught instanceof Error ? caught.message : "打开回答失败"));
              }}
              onOpenCourse={(path) => {
                openCourseInActiveGroup(project.id, path).catch((caught) => setError(caught instanceof Error ? caught.message : "打开课件失败"));
              }}
              onOpenFile={(path) => {
                openFileInActiveGroup(project.id, path).catch((caught) => setError(caught instanceof Error ? caught.message : "打开文件失败"));
              }}
            />
          ) : null}
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
        <div className="topbar-workspace-actions">
          <button
            className="project-switch"
            onClick={() => {
              setNavigationView("projects");
              setNavigationOpen(true);
            }}
            title="切换项目"
          >
            <span>{project?.name ?? "选择项目"}</span>
            <ChevronDown size={15} />
          </button>
          <button className="primary-button topbar-import" onClick={handleImportRequest} disabled={loading}>
            <Download size={15} />
            导入仓库
          </button>
          <div className="more-menu-wrap">
            <button
              type="button"
              className="icon-button header-icon-button"
              onClick={() => setMoreMenuOpen((open) => !open)}
              title="更多工具"
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
            >
              <MoreHorizontal size={18} />
            </button>
          </div>
        </div>
      </header>
      {moreMenuOpen ? (
        <div className="more-menu-layer" onMouseDown={() => setMoreMenuOpen(false)}>
          <div className="more-menu topbar-more-menu" role="menu" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => { setSettingsOpen(true); setMoreMenuOpen(false); }}>
              <Bot size={15} />
              模型 API
            </button>
            <button type="button" role="menuitem" onClick={() => { setPromptEditorOpen(true); setMoreMenuOpen(false); }}>
              <Sparkles size={15} />
              提示词
            </button>
          </div>
        </div>
      ) : null}
      {error ? <div className="error-bar">{error}</div> : null}
      {showBusy ? <div className="busy-bar">{qaLoading ? "正在生成回答..." : loading ? "正在处理..." : "正在生成课程内容..."}</div> : null}
      <main
        className={`workbench ${navigationOpen ? "navigation-open" : ""}`}
        style={{ gridTemplateColumns: navigationOpen ? `48px ${sidebarWidth}px 6px minmax(0, 1fr)` : "48px minmax(0, 1fr)" }}
      >
        <nav className="activity-rail" aria-label="学习导航">
          <button className={navigationOpen && navigationView === "courses" ? "active" : ""} onClick={() => { setNavigationView("courses"); setNavigationOpen(navigationView !== "courses" || !navigationOpen); }} title="课程"><BookOpen size={18} /></button>
          <button className={navigationOpen && navigationView === "files" ? "active" : ""} onClick={() => { setNavigationView("files"); setNavigationOpen(navigationView !== "files" || !navigationOpen); }} title="源码"><FolderTree size={18} /></button>
          <button className={navigationOpen && navigationView === "projects" ? "active" : ""} onClick={() => { setNavigationView("projects"); setNavigationOpen(navigationView !== "projects" || !navigationOpen); }} title="项目"><PanelLeft size={18} /></button>
          <span className="activity-rail-spacer" />
          <button className={assistantOpen ? "active" : ""} onClick={() => setAssistantOpen((open) => !open)} title="AI 助手"><Bot size={18} /></button>
        </nav>
        {navigationOpen ? (
          <>
            <Sidebar
              view={navigationView}
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
              onSelectProject={openProject}
              onCreateLearningPlan={handleCreateLearningPlan}
              onRegenerateProject={handleRegenerate}
              onDeleteProject={handleDelete}
              onSelectFile={handleSelectFile}
              onOpenFile={handleOpenFile}
              onSelectCourse={handleSelectCourse}
              onCreateCourse={handleCreateCourse}
              onDeleteCourse={handleDeleteCourse}
            />
          </>
        ) : null}
        {navigationOpen ? <div
          className="resize-handle navigation-resizer"
          onMouseDown={(event) => setDragState({ kind: "sidebar-width", startX: event.clientX, startWidth: sidebarWidth })}
          title="拖拽调整左栏宽度"
        /> : null}
        <section className="center-pane">
          <div className="context-toolbar">
            <div className="context-toolbar-title">
              <span>{project ? (selectedCourse ? "课程阅读" : fileContent ? "源码阅读" : "学习工作台") : "开始学习"}</span>
              {taskMessage ? <small className={activeTask?.status === "failed" ? "failed" : ""}>{taskMessage}</small> : null}
            </div>
            <div className="context-toolbar-actions">
              {project ? <button className="secondary-button compact" onClick={() => setGenerationOpen(true)} disabled={isTaskRunning}><Sparkles size={14} />生成</button> : null}
              <button className="icon-button" onClick={() => setAssistantOpen(true)} title="打开 AI 助手"><Bot size={17} /></button>
            </div>
          </div>
          <div className="generation-bar legacy-generation-bar">
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
              <button
                className="secondary-button"
                onClick={handleBuildIndex}
                disabled={!project || isLearningPlanProject || indexBuilding}
              >
                {indexBuilding || indexStatus?.status === "building" ? "索引中..." : "构建索引"}
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
              {project && !isLearningPlanProject ? ` · 索引：${indexStatus?.status ?? "未构建"} (${indexStatus?.chunk_count ?? 0})` : ""}
            </div>
          </div>
          {project ? (
            <div className="reader-workspace">{renderLayoutNode(layout)}</div>
          ) : (
            <section className="learning-empty-state">
              <div className="learning-empty-mark"><BookOpen size={24} /></div>
              <h1>从一个项目开始学习</h1>
              <p>导入 GitHub 仓库，或先创建一个自定义学习计划。</p>
              <div>
                <button className="primary-button" onClick={handleImportRequest}><Download size={15} />导入仓库</button>
                <button className="secondary-button" onClick={handleCreateLearningPlan}>新建学习计划</button>
              </div>
            </section>
          )}
        </section>
        <div
          className="resize-handle assistant-resizer"
          onMouseDown={(event) => setDragState({ kind: "explain-width", startX: event.clientX, startWidth: explainWidth })}
          title="拖拽调整右栏宽度"
        />
        <div className={`assistant-drawer ${assistantOpen ? "open" : ""}`} style={{ width: `${explainWidth}px` }}>
        <ExplainPanel
          selection={selection}
          contextSummary={buildAssistantContextSummary()}
          question={qaQuestion}
          loading={qaLoading}
          history={qaHistory}
          sessionTree={qaSessionTree}
          historyQuery={qaHistoryQuery}
          favoriteOnly={qaFavoriteOnly}
          selectedRecord={selectedQA}
          learningAnchor={learningAnchor}
          documentTerms={documentTerms}
          settings={llmSettings}
          panelError={qaPanelError}
          askHeight={qaAskHeight}
          upperTab={qaUpperTab}
          onUpperTabChange={setQAUpperTab}
          knowledgeDisabled={!project}
          knowledgeContent={project ? (
            <KnowledgeGraphViewer
              projectId={project.id}
              refreshKey={knowledgeRefreshKey}
              compact
              onRequestText={requestText}
              onConfirm={confirmAction}
              onOpenQA={(qaId) => {
                openQAById(qaId).catch((caught) => setError(caught instanceof Error ? caught.message : "打开回答失败"));
              }}
              onOpenCourse={(path) => {
                openCourseInActiveGroup(project.id, path).catch((caught) => setError(caught instanceof Error ? caught.message : "打开课件失败"));
              }}
              onOpenFile={(path) => {
                openFileInActiveGroup(project.id, path).catch((caught) => setError(caught instanceof Error ? caught.message : "打开文件失败"));
              }}
            />
          ) : null}
          onAskResizeStart={(event: MouseEvent<HTMLDivElement>) => setDragState({ kind: "qa-ask", startY: event.clientY, startHeight: qaAskHeight })}
          onQuestionChange={setQAQuestion}
          onSelectionTextChange={handleSelectionTextChange}
          onClearSelection={handleClearSelection}
          onAsk={handleAsk}
          onNewConversation={handleNewConversation}
          onHistoryQueryChange={setQAHistoryQuery}
          onFavoriteOnlyChange={setQAFavoriteOnly}
          onSelectRecord={(record) => {
            setSelectedQA(record);
            setQASessionId(record.session_id ?? null);
          }}
          onOpenRecord={(record) => openQAInActiveGroup(record)}
          onDeleteRecord={handleDeleteQA}
          onRenameRecord={handleRenameQA}
          onToggleFavorite={handleToggleFavorite}
          onSaveUnderstanding={handleSaveUnderstanding}
          onDeleteUnderstanding={handleDeleteUnderstanding}
          onGenerateTerm={handleGenerateTerm}
          onTermAction={handleTermAction}
          onSelectionChange={handleSelection}
          onOpenSettings={() => setSettingsOpen(true)}
          onClose={() => setAssistantOpen(false)}
        />
        </div>
      </main>
      {generationOpen ? (
        <div className="tool-drawer-backdrop" onMouseDown={() => setGenerationOpen(false)}>
          <section className="generation-drawer" onMouseDown={(event) => event.stopPropagation()} aria-label="生成课程">
            <header className="drawer-header">
              <div><strong>生成学习内容</strong><small>仅在你确认后调用模型 API</small></div>
              <button className="icon-button" onClick={() => setGenerationOpen(false)} title="关闭"><X size={17} /></button>
            </header>
            <div className="generation-drawer-body">
              <label className="field-label">
                <span>学习范围</span>
                <select
                  value={isLearningPlanProject ? "learning_plan" : scopeType}
                  onChange={(event) => {
                    const nextScope = event.target.value as ScopeType;
                    setScopeType(nextScope);
                    if (nextScope !== "files") {
                      setSelectedScopeFiles([]);
                    } else {
                      setNavigationView("files");
                      setNavigationOpen(true);
                    }
                  }}
                  disabled={!project || isTaskRunning || isLearningPlanProject}
                >
                  <option value="full_project">全项目</option>
                  <option value="files">指定文件</option>
                  <option value="learning_plan">学习计划</option>
                </select>
              </label>
              <div className="scope-helper">
                {isLearningPlanProject || scopeType === "learning_plan"
                  ? "根据下面的学习要求生成总纲。"
                  : scopeType === "files"
                    ? selectedScopeFiles.length ? `已选择 ${selectedScopeFiles.length} 个文件。` : "请从左侧“源码”中选择文件。"
                    : "模型将结合项目结构、README 和关键文件生成学习总纲。"}
              </div>
              <label className="field-label">
                <span>生成要求</span>
                <textarea value={generationInstructions} onChange={(event) => setGenerationInstructions(event.target.value)} placeholder="例如：面向初学者，优先解释后端请求流程" disabled={!project || isTaskRunning} />
              </label>
              <div className="generation-drawer-actions">
                <button className="primary-button" onClick={handleGenerateOutline} disabled={!project || isTaskRunning}><Sparkles size={15} />生成 AI 总纲</button>
                {fileContent ? (
                  <>
                    <button className="secondary-button" onClick={() => handleGenerateFileLesson("brief")} disabled={!canGenerateFileLesson || isTaskRunning}>粗略介绍</button>
                    <button className="secondary-button" onClick={() => handleGenerateFileLesson("detailed")} disabled={!canGenerateFileLesson || isTaskRunning}>详细分析</button>
                  </>
                ) : null}
              </div>
              <div className={`drawer-task-status ${activeTask?.status === "failed" ? "failed" : ""}`}>{taskMessage || "准备好后即可生成"}</div>
            </div>
          </section>
        </div>
      ) : null}
      <LLMSettingsDialog
        open={settingsOpen}
        onConfirm={confirmAction}
        onOpenExternal={openExternal}
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
          onCopySelection={handleContextCopy}
          onClearSelection={handleDismissSelection}
          onSetColor={handleSetColor}
          onToggleBold={handleToggleBold}
          onToggleUnderline={handleToggleUnderline}
        />
      ) : null}
      <AppDialog
        state={appDialog}
        value={appDialogValue}
        onValueChange={setAppDialogValue}
        onCancel={() => closeAppDialog(null)}
        onConfirm={handleAppDialogConfirm}
      />
    </div>
  );
}
