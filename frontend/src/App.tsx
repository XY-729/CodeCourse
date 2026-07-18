import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { BookOpen, Bot, ChevronDown, Download, FileArchive, FolderTree, Moon, MoreHorizontal, PanelLeft, RefreshCw, RotateCcw, Save, Search, Sparkles, Star, Sun, X } from "lucide-react";
import {
  askQuestionStream,
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
  getLearningStates,
  getProject,
  getProjectFile,
  getProjectIndexStatus,
  getTree,
  importProject,
  importProjectArchive,
  listGenerationTasks,
  listHighlights,
  listKnowledgeLinks,
  listDocumentTerms,
  listProjects,
  listQARecords,
  resetLearningStates,
  regenerateProject,
  markDocumentTermKnown,
  saveLearningAnchor,
  setQAFavorite,
  updateQARecord,
  updateLearningState,
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
  LearningState,
  LearningStateUpdate,
  KnowledgeLink,
  ProjectIndexStatus,
  QARecord,
  QAAskPayload,
  RetrievalSource,
  TreeNode,
} from "./api/client";
import AppDialog from "./components/AppDialog";
import type { AppDialogState, ChoiceDialogOption } from "./components/AppDialog";
import CodeViewer, { ViewerRange, ViewerSelection } from "./components/CodeViewer";
import ContextMenu from "./components/ContextMenu";
import CommandPalette, { type CommandPaletteItem } from "./components/CommandPalette";
import ExplainPanel, { AssistantContextSummary, SelectionSummary } from "./components/ExplainPanel";
import LLMSettingsDialog from "./components/LLMSettingsDialog";
import MarkdownViewer from "./components/MarkdownViewer";
import PromptEditor from "./components/PromptEditor";
import ReaderLearningToolbar from "./components/ReaderLearningToolbar";
import SelectionQuickBar from "./components/SelectionQuickBar";
import Sidebar, { type NavigationView } from "./components/Sidebar";
import DesktopToolbar, { type GenerationIntent } from "./components/DesktopToolbar";
import GenerationSheet from "./components/GenerationSheet";
import TaskFeedback from "./components/TaskFeedback";
import type { Annotation, AnnotationColor, AnnotationStyle } from "./types";
import { CodeCourseNative, isAndroidRuntime } from "./platform/runtime";

const KnowledgeGraphViewer = lazy(() => import("./components/KnowledgeGraphViewer"));

type ScopeType = LearningScope["type"];
type ThemeMode = "light" | "dark";
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
  initialLine?: number;
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

type QAGenerationState = {
  label: string;
  partial: string;
};

type StoredWorkbench = {
  version: number;
  layout: LayoutNode;
  activeGroupId: string;
  navigationView: NavigationView;
  navigationOpen: boolean;
  sidebarWidth: number;
};

const TERMINAL_TASK_STATUSES = new Set(["completed", "failed"]);
const MAX_GROUPS = 9;
const ROOT_GROUP_ID = "group-1";
const ASSISTANT_WIDTH_STORAGE_KEY = "codecourse.assistantWidth";
const THEME_STORAGE_KEY = "codecourse.theme";
const WORKBENCH_STORAGE_VERSION = 1;
const MIN_READER_WIDTH = 520;

function getInitialTheme(): ThemeMode {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

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
  const type = task.task_type === "file_lesson" ? "文件课件" : task.task_type === "outline_lesson" ? "按课课件" : "项目总纲";
  return `${type} / ${task.status}`;
}

function isLessonPath(path: string): boolean {
  return /^lessons\/lesson_\d+\.md$/i.test(path);
}

function flattenTree(node: TreeNode | null): TreeNode[] {
  if (!node) return [];
  return [node, ...node.children.flatMap((child) => flattenTree(child))];
}

function stripLayoutContent(node: LayoutNode): LayoutNode {
  if (node.type === "group") {
    return {
      ...node,
      group: {
        ...node.group,
        items: node.group.items.map((item) => ({ ...item, content: "", dirty: false })),
      },
    };
  }
  return { ...node, first: stripLayoutContent(node.first), second: stripLayoutContent(node.second) };
}

function workbenchStorageKey(projectId: number) {
  return `codecourse.workbench.v${WORKBENCH_STORAGE_VERSION}.${projectId}`;
}

function taskStatusMessage(task: GenerationTask): string {
  if (task.stage_label) {
    const progress = task.progress_total > 0 ? ` (${task.progress_current}/${task.progress_total})` : "";
    return `${task.stage_label}${progress}`;
  }
  return taskLabel(task);
}

function indexStatusMessage(status: ProjectIndexStatus | null): string {
  if (!status) return "索引未构建";
  if (status.text_status === "building") return "正在构建基础索引";
  if (status.structural_status === "building") return "基础索引完成，正在分析调用关系";
  if (status.structural_status === "completed") {
    const graphSize = status.node_count ? ` · ${status.node_count} 个结构节点` : "";
    return `结构索引已完成${graphSize}`;
  }
  if (status.text_status === "completed" && status.structural_status && status.structural_status !== "not_built") {
    return "基础索引已完成 · 结构分析不可用";
  }
  if (status.status === "failed") return "索引失败";
  return `${status.status} · ${status.chunk_count} 个文本片段`;
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

function countLayoutItems(node: LayoutNode): number {
  if (node.type === "group") return node.group.items.length;
  return countLayoutItems(node.first) + countLayoutItems(node.second);
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
  const [navigationOpen, setNavigationOpen] = useState(() => !isAndroidRuntime());
  const [navigationView, setNavigationView] = useState<NavigationView>("courses");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [generationIntent, setGenerationIntent] = useState<GenerationIntent>("outline");
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
  const [sidebarWidth, setSidebarWidth] = useState(264);
  const [explainWidth, setExplainWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem(ASSISTANT_WIDTH_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? clamp(stored, 340, 520) : 400;
  });
  const [sidebarProjectHeight, setSidebarProjectHeight] = useState(150);
  const [sidebarCourseHeight, setSidebarCourseHeight] = useState(240);
  const [qaAskHeight, setQAAskHeight] = useState(340);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [layout, setLayout] = useState<LayoutNode>(() => createInitialLayout());
  const [activeGroupId, setActiveGroupId] = useState(ROOT_GROUP_ID);
  const [dropPreview, setDropPreview] = useState<{ groupId: string; zone: DropZone } | null>(null);

  const [selection, setSelection] = useState<SelectionSummary | null>(null);
  const [qaQuestion, setQAQuestion] = useState("");
  const [qaGenerations, setQAGenerations] = useState<Record<string, QAGenerationState>>({});
  const [qaDraftId, setQADraftId] = useState(1);
  const [qaHistory, setQAHistory] = useState<QARecord[]>([]);
  const [qaHistoryQuery, setQAHistoryQuery] = useState("");
  const [qaFavoriteOnly, setQAFavoriteOnly] = useState(false);
  const [qaUpperTab, setQAUpperTab] = useState<"history" | "knowledge">("history");
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
  const [learningStates, setLearningStates] = useState<LearningState[]>([]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [toast, setToast] = useState("");
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
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme);

  const idCounter = useRef(1);
  const dialogResolverRef = useRef<DialogResolver | null>(null);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const learningStatesRef = useRef<LearningState[]>([]);
  const learningSaveTimers = useRef<Map<string, number>>(new Map());
  const pendingLearningUpdates = useRef<Map<string, LearningStateUpdate>>(new Map());
  const mobileRuntime = isAndroidRuntime();
  const canGenerateFileLesson = Boolean(project && fileContent);
  const isLearningPlanProject = project?.project_type === "learning_plan";
  const isTaskRunning = activeTask ? !TERMINAL_TASK_STATUSES.has(activeTask.status) : false;
  const activeQAKey = qaSessionId ? `session:${qaSessionId}` : `draft:${qaDraftId}`;
  const activeQAGeneration = qaGenerations[activeQAKey] ?? null;
  const qaLoading = Boolean(activeQAGeneration);
  const anyQALoading = Object.keys(qaGenerations).length > 0;
  const showBusy = loading || isTaskRunning || anyQALoading;

  useEffect(() => {
    learningStatesRef.current = learningStates;
  }, [learningStates]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!project || loading) return;
    const stored: StoredWorkbench = {
      version: WORKBENCH_STORAGE_VERSION,
      layout: stripLayoutContent(layout),
      activeGroupId,
      navigationView,
      navigationOpen,
      sidebarWidth,
    };
    try {
      window.localStorage.setItem(workbenchStorageKey(project.id), JSON.stringify(stored));
    } catch {
      // A full storage area must not interrupt reading; recent position still lives in SQLite.
    }
  }, [activeGroupId, layout, loading, navigationOpen, navigationView, project?.id, sidebarWidth]);

  useEffect(() => {
    loadProjects();
    loadLLMSettings();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(ASSISTANT_WIDTH_STORAGE_KEY, String(Math.round(explainWidth)));
  }, [explainWidth]);

  useEffect(() => {
    if (mobileRuntime || !assistantOpen || !navigationOpen) {
      return;
    }
    function keepReaderReadable() {
      const reserved = sidebarWidth + 5 + explainWidth + 5;
      if (window.innerWidth - reserved < MIN_READER_WIDTH) {
        setNavigationOpen(false);
      }
    }
    keepReaderReadable();
    window.addEventListener("resize", keepReaderReadable);
    return () => window.removeEventListener("resize", keepReaderReadable);
  }, [assistantOpen, explainWidth, mobileRuntime, navigationOpen, sidebarWidth]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }
      if (event.key !== "Escape") {
        return;
      }
      if (commandPaletteOpen) {
        setCommandPaletteOpen(false);
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
  }, [appDialog, commandPaletteOpen]);

  useEffect(() => {
    if (!mobileRuntime) {
      return;
    }

    let disposed = false;
    let removeListener: (() => void) | undefined;
    void import("@capacitor/app").then(async ({ App: NativeApp }) => {
      const listener = await NativeApp.addListener("backButton", () => {
        if (appDialog) {
          closeAppDialog(null);
        } else if (settingsOpen) {
          setSettingsOpen(false);
        } else if (promptEditorOpen) {
          setPromptEditorOpen(false);
        } else if (generationOpen) {
          setGenerationOpen(false);
        } else if (moreMenuOpen) {
          setMoreMenuOpen(false);
        } else if (assistantOpen) {
          setAssistantOpen(false);
        } else if (navigationOpen) {
          setNavigationOpen(false);
        } else {
          void NativeApp.exitApp();
        }
      });
      if (disposed) {
        await listener.remove();
      } else {
        removeListener = () => void listener.remove();
      }
    });

    return () => {
      disposed = true;
      removeListener?.();
    };
  }, [appDialog, assistantOpen, generationOpen, mobileRuntime, moreMenuOpen, navigationOpen, promptEditorOpen, settingsOpen]);

  useEffect(() => {
    if (!dragState) {
      return;
    }
    const currentDrag = dragState;
    function onMouseMove(event: globalThis.MouseEvent) {
      if (currentDrag.kind === "sidebar-width") {
        setSidebarWidth(clamp(currentDrag.startWidth + event.clientX - currentDrag.startX, 240, 360));
      } else if (currentDrag.kind === "explain-width") {
        setExplainWidth(clamp(currentDrag.startWidth - (event.clientX - currentDrag.startX), 340, 520));
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
    if (mobileRuntime) {
      void CodeCourseNative.openExternal({ url }).catch(() => setError("无法打开外部链接。"));
      return;
    }
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

  function learningStateKey(sourceType: LearningState["source_type"], sourcePath: string) {
    return `${sourceType}:${sourcePath}`;
  }

  function findLearningState(sourceType: LearningState["source_type"], sourcePath: string) {
    return learningStatesRef.current.find((entry) => entry.source_type === sourceType && entry.source_path === sourcePath);
  }

  async function persistLearningUpdate(projectId: number, key: string, payload: LearningStateUpdate) {
    try {
      const saved = await updateLearningState(projectId, payload);
      setLearningStates((current) => [...current.filter((entry) => learningStateKey(entry.source_type, entry.source_path) !== key), saved]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存学习位置失败");
    } finally {
      pendingLearningUpdates.current.delete(key);
      learningSaveTimers.current.delete(key);
    }
  }

  function queueLearningUpdate(
    sourceType: LearningState["source_type"],
    sourcePath: string,
    positionKind: LearningState["position_kind"],
    positionValue: number,
    status?: LearningState["status"],
    immediate = false,
  ) {
    if (!project || !sourcePath) return;
    const key = learningStateKey(sourceType, sourcePath);
    const existing = findLearningState(sourceType, sourcePath);
    const payload: LearningStateUpdate = {
      source_type: sourceType,
      source_path: sourcePath,
      status: status ?? existing?.status ?? "in_progress",
      position_kind: positionKind,
      position_value: positionKind === "scroll_ratio" ? clamp(positionValue, 0, 1) : Math.max(1, Math.round(positionValue)),
    };
    pendingLearningUpdates.current.set(key, payload);
    const timer = learningSaveTimers.current.get(key);
    if (timer) window.clearTimeout(timer);
    if (immediate) {
      void persistLearningUpdate(project.id, key, payload);
      return;
    }
    learningSaveTimers.current.set(key, window.setTimeout(() => {
      const latest = pendingLearningUpdates.current.get(key);
      if (latest) void persistLearningUpdate(project.id, key, latest);
    }, 800));
  }

  function touchOpenItem(item: OpenItem) {
    if (item.type === "file") {
      const state = findLearningState("file", item.path);
      queueLearningUpdate("file", item.path, "line", state?.position_value ?? 1, state?.status);
    } else if (item.type === "course") {
      const sourceType = item.qaRecordId ? "qa" : "course";
      const state = findLearningState(sourceType, item.path);
      queueLearningUpdate(sourceType, item.path, "scroll_ratio", state?.position_value ?? 0, state?.status);
    } else if (item.type === "qa") {
      const state = findLearningState("qa", item.path);
      queueLearningUpdate("qa", item.path, "scroll_ratio", state?.position_value ?? 0, state?.status);
    }
  }

  async function toggleLessonComplete(filename: string) {
    if (!project) return;
    const existing = findLearningState("course", filename);
    const nextStatus = existing?.status === "completed" ? "in_progress" : "completed";
    const key = learningStateKey("course", filename);
    await persistLearningUpdate(project.id, key, {
      source_type: "course",
      source_path: filename,
      status: nextStatus,
      position_kind: "scroll_ratio",
      position_value: existing?.position_value ?? 0,
    });
    setTaskMessage(nextStatus === "completed" ? "本课已完成" : "已恢复为学习中");
    setToast(nextStatus === "completed" ? "已标记完成" : "已恢复为学习中");
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

  function buildAskPayloadContext(): Pick<QAAskPayload, "source_type" | "source_path" | "selected_text"> {
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
    touchOpenItem(item);
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
    touchOpenItem(item);
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

  async function hydrateStoredItem(item: OpenItem, projectId: number, availableCourses: CourseFile[]): Promise<OpenItem | null> {
    try {
      if (item.type === "file") {
        const file = await getProjectFile(projectId, item.path);
        return { ...item, content: file.content, language: file.language, dirty: false };
      }
      if (item.type === "course") {
        const course = await getCourseContent(projectId, item.path);
        let title = availableCourses.find((entry) => entry.filename === item.path)?.title ?? item.title;
        if (item.qaRecordId) {
          const record = await getQARecord(projectId, item.qaRecordId).catch(() => null);
          if (record) title = qaTitle(record);
        }
        return { ...item, title, content: course.content, dirty: false };
      }
      if (item.type === "qa" && item.qaRecordId) {
        const record = await getQARecord(projectId, item.qaRecordId);
        return { ...item, title: qaTitle(record), content: record.answer_md, favorite: record.favorite, dirty: false };
      }
      if (item.type === "knowledge_graph") return { ...item, content: "" };
    } catch {
      return null;
    }
    return null;
  }

  async function hydrateStoredLayout(node: LayoutNode, projectId: number, availableCourses: CourseFile[]): Promise<LayoutNode> {
    if (node.type === "group") {
      const hydrated = await Promise.all(node.group.items.map((item) => hydrateStoredItem(item, projectId, availableCourses)));
      const items = hydrated.filter((item): item is OpenItem => Boolean(item));
      const activeItemId = items.some((item) => item.id === node.group.activeItemId) ? node.group.activeItemId : items.at(-1)?.id ?? null;
      return { ...node, group: { ...node.group, items, activeItemId } };
    }
    const [first, second] = await Promise.all([
      hydrateStoredLayout(node.first, projectId, availableCourses),
      hydrateStoredLayout(node.second, projectId, availableCourses),
    ]);
    return { ...node, first, second };
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

  async function openFileInActiveGroup(projectId: number, path: string, initialLine?: number) {
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
      initialLine,
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
      const [nextTree, nextCourses, tasks, settings, nextIndexStatus, nextLearningStates, nextQARecords] = await Promise.all([
        getTree(freshProject.id),
        getCourseFiles(freshProject.id),
        listGenerationTasks(freshProject.id),
        getLLMSettings().catch(() => null),
        getProjectIndexStatus(freshProject.id).catch(() => null),
        getLearningStates(freshProject.id).catch(() => []),
        listQARecords(freshProject.id).catch(() => []),
      ]);
      const initialLayout = createInitialLayout();
      setTree(nextTree);
      setCourses(nextCourses);
      setLLMSettings(settings);
      setActiveTask(tasks[0] ?? null);
      setIndexStatus(nextIndexStatus);
      setLearningStates(nextLearningStates);
      learningStatesRef.current = nextLearningStates;
      setQAHistory(nextQARecords);
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
      setQAUpperTab("history");
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
      try {
        const rawWorkbench = window.localStorage.getItem(workbenchStorageKey(freshProject.id));
        const stored = rawWorkbench ? JSON.parse(rawWorkbench) as StoredWorkbench : null;
        if (stored?.version === WORKBENCH_STORAGE_VERSION && stored.layout) {
          const restoredLayout = await hydrateStoredLayout(stored.layout, freshProject.id, nextCourses);
          if (countLayoutItems(restoredLayout) > 0) {
            const restoredGroupId = hasGroup(restoredLayout, stored.activeGroupId) ? stored.activeGroupId : firstGroupId(restoredLayout);
            const restoredGroup = findGroup(restoredLayout, restoredGroupId);
            const restoredItem = restoredGroup?.items.find((item) => item.id === restoredGroup.activeItemId) ?? null;
            setLayout(restoredLayout);
            setActiveGroupId(restoredGroupId);
            setNavigationView(stored.navigationView ?? "courses");
            setNavigationOpen(Boolean(stored.navigationOpen));
            setSidebarWidth(clamp(stored.sidebarWidth || 264, 240, 360));
            if (restoredItem?.type === "file") {
              setFileContent({ path: restoredItem.path, content: restoredItem.content, language: restoredItem.language ?? "plaintext" });
            } else if (restoredItem?.type === "course") {
              setSelectedCourse(restoredItem.path);
              void refreshDocumentTerms(restoredItem.qaRecordId ? "qa" : "course", restoredItem.path, freshProject.id);
            }
            return;
          }
        }
      } catch {
        window.localStorage.removeItem(workbenchStorageKey(freshProject.id));
      }
      const recent = [...nextLearningStates].sort((a, b) => b.last_opened_at.localeCompare(a.last_opened_at))[0];
      const recentCourse = recent?.source_type === "course" ? nextCourses.find((file) => file.filename === recent.source_path) : null;
      const firstCourse = recentCourse ?? nextCourses.find((file) => file.filename === "outline.md") ?? nextCourses.find((file) => isLessonPath(file.filename)) ?? nextCourses[0];
      if (recent?.source_type === "qa") {
        const record = nextQARecords.find((entry) => _normalizeOutputPath(entry.output_path, entry.id, freshProject.id) === recent.source_path);
        if (record) {
          const relPath = _normalizeOutputPath(record.output_path, record.id, freshProject.id);
          const course = await getCourseContent(freshProject.id, relPath).catch(() => null);
          setSelectedQA(record);
          setQASessionId(record.session_id ?? null);
          setLayout(updateGroup(initialLayout, ROOT_GROUP_ID, (group) => openItem(group, course ? {
            id: `course:${relPath}`,
            type: "course",
            path: relPath,
            title: qaTitle(record),
            content: course.content,
            qaRecordId: record.id,
            favorite: record.favorite,
          } : {
            id: `qa:${record.id}`,
            type: "qa",
            path: relPath,
            title: qaTitle(record),
            content: record.answer_md,
            qaRecordId: record.id,
            favorite: record.favorite,
          })));
          return;
        }
      }
      if (recent?.source_type === "file") {
        try {
          const content = await getProjectFile(freshProject.id, recent.source_path);
          setFileContent(content);
          setLayout(updateGroup(initialLayout, ROOT_GROUP_ID, (group) => openItem(group, {
            id: `file:${recent.source_path}`,
            type: "file",
            path: recent.source_path,
            title: recent.source_path.split("/").pop() ?? recent.source_path,
            content: content.content,
            language: content.language,
          })));
          return;
        } catch {
          // A deleted recent file is ignored and the course fallback is opened below.
        }
      }
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

  async function handleImportArchive(file: File) {
    setLoading(true);
    setError("");
    setTaskMessage("正在导入本地项目");
    try {
      const imported = await importProjectArchive(file);
      await loadProjects();
      await openProject(imported);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入失败");
    } finally {
      setLoading(false);
      if (archiveInputRef.current) archiveInputRef.current.value = "";
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
    setTaskMessage(initialTask.stage_label ? taskStatusMessage(initialTask) : `任务已创建：${taskLabel(initialTask)}`);
    let nextTask = initialTask;
    const trackingDeadline = Date.now() + 60 * 60 * 1000;
    while (Date.now() < trackingDeadline) {
      if (TERMINAL_TASK_STATUSES.has(nextTask.status)) {
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      nextTask = await getGenerationTask(project.id, initialTask.id);
      setActiveTask(nextTask);
      setTaskMessage(taskStatusMessage(nextTask));
    }
    if (!TERMINAL_TASK_STATUSES.has(nextTask.status)) {
      setTaskMessage("任务仍在后端生成，可稍后在任务状态中查看结果");
      return;
    }
    const nextCourses = await refreshCourses(project.id);
    const freshProject = await getProject(project.id);
    setProject(freshProject);
    setProjects((items) => items.map((item) => (item.id === freshProject.id ? freshProject : item)));
    if (nextTask.status === "completed") {
      setTaskMessage("生成完成");
      setToast("内容已生成");
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
      isLearningPlanProject
        ? `将分章节生成“${title}”的详细课件。本次操作最多调用 12 次模型 API，可能消耗较多 token；一次确认将授权完成整节课的规划、分章生成与遗漏补全。是否继续？`
        : `将调用模型 API 生成“${title}”的详细课件，并使用已构建的项目索引作为代码上下文，可能消耗较多 token。是否继续？`,
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
      window.localStorage.removeItem(workbenchStorageKey(nextProject.id));
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
        setLearningStates([]);
        learningStatesRef.current = [];
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

  async function runStreamingQuestion(payload: QAAskPayload, generationKey: string): Promise<QARecord> {
    setQAGenerations((current) => ({
      ...current,
      [generationKey]: { label: "检索上下文", partial: "" },
    }));
    try {
      return await askQuestionStream(project!.id, payload, {
        onStage: (_stage, label) => {
          setQAGenerations((current) => current[generationKey]
            ? { ...current, [generationKey]: { ...current[generationKey], label } }
            : current);
        },
        onDelta: (text) => {
          setQAGenerations((current) => current[generationKey]
            ? { ...current, [generationKey]: { ...current[generationKey], partial: current[generationKey].partial + text } }
            : current);
        },
      });
    } finally {
      setQAGenerations((current) => {
        const next = { ...current };
        delete next[generationKey];
        return next;
      });
    }
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
    setQAPanelError("");
    const generationKey = activeQAKey;
    try {
      const context = buildAskPayloadContext();
      const record = await runStreamingQuestion({
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
      }, generationKey);
      setSelectedQA(record);
      setQASessionId(record.session_id ?? qaSessionId);
      setQAUpperTab("history");
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
    }
  }

  function handleNewConversation() {
    setSelectedQA(null);
    setQASessionId(null);
    setQASessionTree([]);
    setDocumentTerms([]);
    setLearningAnchor(null);
    setQAQuestion("");
    setQAUpperTab("history");
    setQADraftId((value) => value + 1);
  }

  async function handleGenerateTerm(term: DocumentTerm) {
    if (!project) return;
    if (term.status === "linked" && term.qa_record_id) {
      const record = qaHistory.find((entry) => entry.id === term.qa_record_id) ?? await getQARecord(project.id, term.qa_record_id);
      setSelectedQA(record);
      setQASessionId(record.session_id ?? null);
      setQAUpperTab("history");
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
    setQAPanelError("");
    const generationKey = parent?.session_id ? `session:${parent.session_id}` : activeQAKey;
    try {
      const record = await runStreamingQuestion({
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
      }, generationKey);
      setSelectedQA(record);
      setQASessionId(record.session_id ?? null);
      setQAHistory((items) => [record, ...items.filter((item) => item.id !== record.id)]);
      setQAUpperTab("history");
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
    const lessonFiles = courses.filter((file) => isLessonPath(file.filename)).sort((a, b) => a.filename.localeCompare(b.filename));
    const lessonIndex = activeItem?.type === "course" ? lessonFiles.findIndex((file) => file.filename === activeItem.path) : -1;
    const activeLearningType: LearningState["source_type"] | null = activeItem?.type === "file" ? "file" : activeItem?.type === "qa" || activeItem?.qaRecordId ? "qa" : activeItem?.type === "course" ? "course" : null;
    const activeLearningState = activeItem && activeLearningType ? findLearningState(activeLearningType, activeItem.path) : undefined;
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
          {activeItem?.type === "course" && lessonIndex >= 0 ? (
            <ReaderLearningToolbar
              title={activeItem.title}
              index={lessonIndex}
              total={lessonFiles.length}
              completed={activeLearningState?.status === "completed"}
              onPrevious={lessonIndex > 0 ? () => void openCourseInActiveGroup(project!.id, lessonFiles[lessonIndex - 1].filename) : undefined}
              onNext={lessonIndex < lessonFiles.length - 1 ? () => void openCourseInActiveGroup(project!.id, lessonFiles[lessonIndex + 1].filename) : undefined}
              onToggleComplete={() => void toggleLessonComplete(activeItem.path)}
            />
          ) : null}
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
              initialLine={activeItem.initialLine ?? (activeLearningState?.position_kind === "line" ? activeLearningState.position_value : 1)}
              onVisibleLineChange={(line) => queueLearningUpdate("file", activeItem.path, "line", line)}
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
                initialScrollRatio={activeLearningState?.position_kind === "scroll_ratio" ? activeLearningState.position_value : 0}
                onScrollRatioChange={(ratio) => queueLearningUpdate(activeItem.qaRecordId ? "qa" : "course", activeItem.path, "scroll_ratio", ratio)}
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
            <Suspense fallback={<div className="viewer-loading">正在加载知识网络…</div>}><KnowledgeGraphViewer
              projectId={project.id}
              refreshKey={knowledgeRefreshKey}
              onRequestText={requestText}
              onConfirm={confirmAction}
              onContentChanged={async () => {
                await refreshCourses(project.id);
                await refreshQAHistory(project.id);
                setKnowledgeRefreshKey((value) => value + 1);
              }}
              onOpenQA={(qaId) => {
                openQAById(qaId).catch((caught) => setError(caught instanceof Error ? caught.message : "打开回答失败"));
              }}
              onOpenCourse={(path) => {
                openCourseInActiveGroup(project.id, path).catch((caught) => setError(caught instanceof Error ? caught.message : "打开课件失败"));
              }}
              onOpenFile={(path) => {
                openFileInActiveGroup(project.id, path).catch((caught) => setError(caught instanceof Error ? caught.message : "打开文件失败"));
              }}
            /></Suspense>
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

  async function handleResetLearningProgress() {
    if (!project) return;
    const confirmed = await confirmAction("重置学习进度", "将清除课程完成状态和阅读位置。课程文件不会被删除。", { confirmText: "重置", danger: true });
    if (!confirmed) return;
    await resetLearningStates(project.id);
    setLearningStates([]);
    learningStatesRef.current = [];
    setTaskMessage("学习进度已重置");
    setToast("学习进度已重置");
  }

  function commandPaletteItems(): CommandPaletteItem[] {
    const items: CommandPaletteItem[] = [
      { id: "command:assistant", label: "打开 AI 助手", description: "结合当前项目或文档提问", section: "命令", keywords: "ai 问答 提问", run: () => setAssistantOpen(true) },
      { id: "command:generate", label: "生成学习内容", description: "打开总纲与课件生成抽屉", section: "命令", keywords: "生成 总纲 课件", run: () => { setGenerationIntent("outline"); setGenerationOpen(true); } },
      { id: "command:courses", label: "打开课程导航", section: "命令", keywords: "课程 左栏", run: () => { setNavigationView("courses"); setNavigationOpen(true); } },
      { id: "command:files", label: "打开源码导航", section: "命令", keywords: "文件 源码", run: () => { setNavigationView("files"); setNavigationOpen(true); } },
      { id: "command:settings", label: "模型 API 设置", section: "命令", keywords: "deepseek key 模型", run: () => setSettingsOpen(true) },
      { id: "command:prompts", label: "提示词编辑", section: "命令", keywords: "prompt 模板", run: () => setPromptEditorOpen(true) },
      { id: "command:index", label: "构建项目索引", section: "命令", keywords: "rag 搜索 索引", run: () => void handleBuildIndex() },
      { id: "command:reset-progress", label: "重置学习进度", section: "命令", keywords: "清除 完成 阅读位置", run: () => void handleResetLearningProgress() },
    ];
    for (const course of courses) {
      items.push({ id: `course:${course.filename}`, label: course.title, description: course.filename, section: "课程", keywords: course.filename, run: () => project && void openCourseInActiveGroup(project.id, course.filename) });
    }
    for (const node of flattenTree(tree).filter((entry) => entry.type === "file")) {
      items.push({ id: `file:${node.path}`, label: node.name, description: node.path, section: "源码", keywords: node.path, run: () => project && void openFileInActiveGroup(project.id, node.path) });
    }
    for (const record of qaHistory) {
      items.push({ id: `qa:${record.id}`, label: qaTitle(record), description: record.question, section: "回答", keywords: `${record.source_path ?? ""} ${record.answer_md.slice(0, 160)}`, run: () => void openQAInActiveGroup(record) });
    }
    for (const entry of projects) {
      items.push({ id: `project:${entry.id}`, label: entry.name, description: entry.project_type === "learning_plan" ? "学习计划" : entry.url, section: "项目", keywords: entry.url, run: () => void openProject(entry) });
    }
    return items;
  }

  const activeOpenItem = getActiveOpenItem();
  const activeLessonMatch = activeOpenItem?.type === "course" ? activeOpenItem.path.match(/^lessons\/lesson_(\d+)\.md$/i) : null;
  const activeLessonNumber = activeLessonMatch ? Number(activeLessonMatch[1]) : null;
  const activeLessonTitle = activeOpenItem && activeLessonNumber
    ? courses.find((item) => item.filename === activeOpenItem.path)?.title ?? activeOpenItem.title
    : "";
  const lessonFilesForProgress = courses.filter((item) => isLessonPath(item.filename));
  const completedLessonCount = lessonFilesForProgress.filter((item) =>
    learningStates.some((state) => state.source_type === "course" && state.source_path === item.filename && state.status === "completed"),
  ).length;
  const progressLabel = lessonFilesForProgress.length ? `${completedLessonCount}/${lessonFilesForProgress.length} 课已完成` : undefined;
  const activeDocumentTitle = activeOpenItem?.title ?? (project ? "学习工作台" : "CodeCourse");

  function openGeneration(intent: GenerationIntent) {
    setGenerationIntent(intent);
    setGenerationOpen(true);
  }

  function runSelectedGeneration() {
    if (generationIntent === "outline") {
      void handleGenerateOutline();
    } else if (generationIntent === "lesson" && activeLessonNumber) {
      void handleGenerateOutlineLesson(activeLessonNumber, activeLessonTitle);
    } else if (generationIntent === "brief" || generationIntent === "detailed") {
      void handleGenerateFileLesson(generationIntent);
    }
  }

  return (
    <div className="app-shell">
      <input ref={archiveInputRef} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImportArchive(file); }} />
      {!mobileRuntime ? (
        <DesktopToolbar
          project={project}
          projects={projects}
          activeTitle={activeDocumentTitle}
          progressLabel={progressLabel}
          navigationOpen={navigationOpen}
          assistantOpen={assistantOpen}
          busyProjectId={busyProjectId}
          loading={loading || isTaskRunning}
          canGenerateLesson={Boolean(activeLessonNumber)}
          canGenerateFile={canGenerateFileLesson}
          indexLabel={indexBuilding || indexStatus?.status === "building" ? "正在构建索引" : "构建项目索引"}
          indexDisabled={!project || isLearningPlanProject || indexBuilding}
          themeMode={themeMode}
          onToggleNavigation={() => {
            if (navigationView === "projects") setNavigationView("courses");
            setNavigationOpen((open) => !open);
          }}
          onSelectProject={openProject}
          onImport={handleImportRequest}
          onCreateLearningPlan={handleCreateLearningPlan}
          onRegenerateProject={handleRegenerate}
          onDeleteProject={handleDelete}
          onOpenGeneration={openGeneration}
          onToggleAssistant={() => { setQAUpperTab("history"); setAssistantOpen((open) => !open); }}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenPrompts={() => setPromptEditorOpen(true)}
          onBuildIndex={() => void handleBuildIndex()}
          onToggleTheme={() => setThemeMode((current) => current === "dark" ? "light" : "dark")}
        />
      ) : (
        <header className="topbar mobile-topbar">
          <div className="brand">
            <img src="/logo.png" alt="CodeCourse logo" className="brand-logo" />
            <div className="brand-text"><strong>CodeCourse</strong><span>{project?.name ?? "学习工作台"}</span></div>
          </div>
          <div className="topbar-workspace-actions">
            <button className="project-switch" onClick={() => { setNavigationView("projects"); setNavigationOpen(true); }}>
              <span>{project?.name ?? "选择项目"}</span><ChevronDown size={15} />
            </button>
            <button className="icon-button header-icon-button mobile-topbar-action" onClick={() => setCommandPaletteOpen(true)} title="搜索" aria-label="搜索"><Search size={18} /></button>
            <button className="icon-button header-icon-button mobile-topbar-action" onClick={() => { setGenerationIntent(activeLessonNumber ? "lesson" : "outline"); setGenerationOpen(true); }} disabled={!project} title="生成学习内容" aria-label="生成学习内容"><Sparkles size={18} /></button>
            <button className="icon-button header-icon-button mobile-topbar-action" onClick={() => setMoreMenuOpen((open) => !open)} title="更多" aria-label="更多"><MoreHorizontal size={18} /></button>
          </div>
        </header>
      )}
      {mobileRuntime && moreMenuOpen ? (
        <div className="more-menu-layer" onMouseDown={() => setMoreMenuOpen(false)}>
          <div className="more-menu topbar-more-menu" role="menu" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => { handleImportRequest(); setMoreMenuOpen(false); }}>
              <Download size={15} />
              导入 GitHub 仓库
            </button>
            <button type="button" role="menuitem" onClick={() => { archiveInputRef.current?.click(); setMoreMenuOpen(false); }}>
              <FileArchive size={15} />
              导入本地 ZIP
            </button>
            <div className="more-menu-divider" />
            <button type="button" role="menuitem" onClick={() => { setSettingsOpen(true); setMoreMenuOpen(false); }}>
              <Bot size={15} />
              模型 API
            </button>
            <button type="button" role="menuitem" onClick={() => { setPromptEditorOpen(true); setMoreMenuOpen(false); }}>
              <Sparkles size={15} />
              提示词编辑
            </button>
            <button type="button" role="menuitem" disabled={!project || isLearningPlanProject || indexBuilding} onClick={() => { void handleBuildIndex(); setMoreMenuOpen(false); }}>
              <RefreshCw size={15} />
              {indexBuilding || indexStatus?.status === "building" ? "正在构建索引" : "重新构建索引"}
            </button>
            <button type="button" role="menuitem" disabled={!project || learningStates.length === 0} onClick={() => { void handleResetLearningProgress(); setMoreMenuOpen(false); }}>
              <RotateCcw size={15} />
              重置学习进度
            </button>
            <button type="button" role="menuitem" onClick={() => { setThemeMode((current) => current === "dark" ? "light" : "dark"); setMoreMenuOpen(false); }}>
              {themeMode === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              {themeMode === "dark" ? "切换到亮色" : "切换到暗色"}
            </button>
          </div>
        </div>
      ) : null}
      {!mobileRuntime ? (
        <TaskFeedback
          error={error}
          busy={showBusy}
          label={anyQALoading ? (activeQAGeneration?.label || "正在生成回答") : loading ? "正在处理" : activeTask ? taskStatusMessage(activeTask) : ""}
          progressCurrent={activeTask?.progress_current}
          progressTotal={activeTask?.progress_total}
          toast={toast}
          onDismissError={() => setError("")}
        />
      ) : (
        <>{error ? <div className="error-bar">{error}</div> : null}{showBusy ? <div className="busy-bar">{taskMessage || "正在处理…"}</div> : null}</>
      )}
      <main
        className={`workbench ${navigationOpen ? "navigation-open" : ""} ${assistantOpen ? "assistant-open" : ""} ${dragState?.kind === "explain-width" ? "assistant-resizing" : ""}`}
        style={{
          gridTemplateColumns: [
            ...(mobileRuntime ? ["48px"] : []),
            ...(navigationOpen ? [`${sidebarWidth}px`, "5px"] : []),
            "minmax(0, 1fr)",
            ...(assistantOpen ? ["5px", `${explainWidth}px`] : []),
          ].join(" "),
        }}
      >
        {mobileRuntime ? <nav className="activity-rail" aria-label="学习导航">
          <button className={navigationOpen && navigationView === "courses" ? "active" : ""} onClick={() => { setNavigationView("courses"); setNavigationOpen(navigationView !== "courses" || !navigationOpen); }} title="课程"><BookOpen size={18} /><span>课程</span></button>
          <button className={navigationOpen && navigationView === "files" ? "active" : ""} onClick={() => { setNavigationView("files"); setNavigationOpen(navigationView !== "files" || !navigationOpen); }} title="源码"><FolderTree size={18} /><span>源码</span></button>
          <button className={`desktop-project-nav ${navigationOpen && navigationView === "projects" ? "active" : ""}`} onClick={() => { setNavigationView("projects"); setNavigationOpen(navigationView !== "projects" || !navigationOpen); }} title="项目"><PanelLeft size={18} /><span>项目</span></button>
          <span className="activity-rail-spacer" />
          <button className={assistantOpen && qaUpperTab !== "knowledge" ? "active" : ""} onClick={() => { setQAUpperTab("history"); setAssistantOpen((open) => qaUpperTab === "knowledge" ? true : !open); }} title="AI 助手"><Bot size={18} /><span>助手</span></button>
          <button className={`mobile-only ${assistantOpen && qaUpperTab === "knowledge" ? "active" : ""}`} onClick={() => { setQAUpperTab("knowledge"); setAssistantOpen(true); }} title="知识网络"><Sparkles size={18} /><span>网络</span></button>
        </nav> : null}
        {navigationOpen ? (
          <>
            <Sidebar
              view={mobileRuntime ? navigationView : navigationView === "files" ? "files" : "courses"}
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
              learningStates={learningStates}
              onContinueLearning={(filename) => void openCourseInActiveGroup(project!.id, filename)}
              onViewChange={mobileRuntime ? undefined : (view) => setNavigationView(view)}
            />
          </>
        ) : null}
        {navigationOpen ? <div
          className="resize-handle navigation-resizer"
          onMouseDown={(event) => setDragState({ kind: "sidebar-width", startX: event.clientX, startWidth: sidebarWidth })}
          title="拖拽调整左栏宽度"
        /> : null}
        <section className="center-pane">
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
          className={`resize-handle assistant-resizer ${assistantOpen ? "visible" : ""}`}
          onMouseDown={(event) => setDragState({ kind: "explain-width", startX: event.clientX, startWidth: explainWidth })}
          title="拖拽调整右栏宽度"
        />
        <div className={`assistant-drawer ${assistantOpen ? "open" : ""}`}>
        <ExplainPanel
          selection={selection}
          contextSummary={buildAssistantContextSummary()}
          question={qaQuestion}
          loading={qaLoading}
          loadingLabel={activeQAGeneration?.label}
          history={qaHistory}
          historyQuery={qaHistoryQuery}
          favoriteOnly={qaFavoriteOnly}
          selectedRecord={selectedQA}
          settings={llmSettings}
          panelError={qaPanelError}
          askHeight={qaAskHeight}
          upperTab={qaUpperTab}
          onUpperTabChange={setQAUpperTab}
          knowledgeDisabled={!project}
          knowledgeContent={project ? (
            <Suspense fallback={<div className="viewer-loading">正在加载知识网络…</div>}><KnowledgeGraphViewer
              projectId={project.id}
              refreshKey={knowledgeRefreshKey}
              compact
              onRequestText={requestText}
              onConfirm={confirmAction}
              onContentChanged={async () => {
                await refreshCourses(project.id);
                await refreshQAHistory(project.id);
                setKnowledgeRefreshKey((value) => value + 1);
              }}
              onOpenQA={(qaId) => {
                openQAById(qaId).catch((caught) => setError(caught instanceof Error ? caught.message : "打开回答失败"));
              }}
              onOpenCourse={(path) => {
                openCourseInActiveGroup(project.id, path).catch((caught) => setError(caught instanceof Error ? caught.message : "打开课件失败"));
              }}
              onOpenFile={(path) => {
                openFileInActiveGroup(project.id, path).catch((caught) => setError(caught instanceof Error ? caught.message : "打开文件失败"));
              }}
            /></Suspense>
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
          onOpenSettings={() => setSettingsOpen(true)}
          onClose={() => setAssistantOpen(false)}
        />
        </div>
      </main>
      {!mobileRuntime ? (
        <GenerationSheet
          open={generationOpen}
          intent={generationIntent}
          project={project}
          scope={scopeType}
          selectedFileCount={selectedScopeFiles.length}
          instructions={generationInstructions}
          running={isTaskRunning}
          activeTask={activeTask}
          taskMessage={taskMessage}
          onClose={() => setGenerationOpen(false)}
          onScopeChange={(nextScope) => {
            setScopeType(nextScope);
            if (nextScope !== "files") {
              setSelectedScopeFiles([]);
            } else {
              setNavigationView("files");
              setNavigationOpen(true);
            }
          }}
          onInstructionsChange={setGenerationInstructions}
          onOpenPrompts={() => setPromptEditorOpen(true)}
          onGenerate={runSelectedGeneration}
        />
      ) : generationOpen ? (
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
                {activeLessonNumber ? (
                  <button className="primary-button" onClick={() => handleGenerateOutlineLesson(activeLessonNumber, activeLessonTitle)} disabled={!project || isTaskRunning}>
                    <BookOpen size={15} />生成当前课件
                  </button>
                ) : null}
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
      {selectionAnchor?.selectedText && !contextMenu ? (
        <SelectionQuickBar
          canHighlight={selectionAnchor.sourceType === "course" || selectionAnchor.sourceType === "qa"}
          onAsk={() => {
            setSelection({ ...selectionAnchor });
            setQAUpperTab("history");
            setAssistantOpen(true);
          }}
          onHighlight={() => {
            if (selectionAnchor.sourceType === "course" || selectionAnchor.sourceType === "qa") {
              void handleCreateHighlight(selectionAnchor.sourceType, selectionAnchor.sourcePath ?? "", selectionAnchor.selectedText);
            }
          }}
          onCopy={() => void navigator.clipboard.writeText(selectionAnchor.selectedText)}
          onClose={handleDismissSelection}
        />
      ) : null}
      <CommandPalette open={commandPaletteOpen} items={commandPaletteItems()} onClose={() => setCommandPaletteOpen(false)} />
      {mobileRuntime && toast ? <div className="app-toast" role="status">{toast}</div> : null}
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
