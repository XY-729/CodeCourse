import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { FolderTree, Loader2, PanelLeft, RefreshCw, Search } from "lucide-react";
import {
  buildProjectIndex,
  createEmptyCourseFile,
  createLearningPlan,
  createHighlight,
  deleteHighlight,
  deleteLearningAnchor,
  dismissDocumentTerm,
  getQARecord,
  getQASessionTree,
  getQAContinuity,
  dismissQAContinuity,
  getLearningAnchor,
  deleteProject,
  generateFileLesson,
  generateOutlineLesson,
  generateSubOutlineLesson,
  previewOutlineLessonEvidence,
  generateOutline,
  generateOutlineStream,
  generateOutlinePreflight,
  confirmOutlineAnswers,
  generateFileLessonStream,
  GenStreamError,
  generateOutlineLessonStream,
  getCourseContent,
  getCallGuide,
  getCourseFiles,
  getLLMSettings,
  getLearningStates,
  getProject,
  getProjectFile,
  getProjectIndexStatus,
  getTree,
  importProject,
  importProjectArchive,
  importLocalProject,
  listGenerationTasks,
  listCallGuides,
  listHighlights,
  listKnowledgeLinks,
  listProjects,
  listQARecords,
  listQAThreads,
  regenerateProject,
  markDocumentTermKnown,
  markConceptKnown,
  markConceptUnknown,
  getLearnerPreferences,
  getReusableConceptExplanation,
  resolvePersonalizationTerms,
  recordTermImpressions,
  submitAnswerFeedback,
  saveLearningAnchor,
  setQAFavorite,
  updateQARecord,
  deleteQARecord,
  deleteCourseFile,
  exportDataArchive,
  importDataArchive,
  renameCourseFile,
} from "./api/client";
import { saveDataArchive } from "./dataTransfer/saveArchive";
import { titleFromMarkdown } from "./utils/titleFromMarkdown";
import {
  flattenTree,
  indexStatusMessage,
  isLessonPath,
  normalizeOutputPath as _normalizeOutputPath,
  parentDir,
  parseScopePaths,
  qaTitle,
  resetGenerationScope,
  taskStatusMessage,
} from "./app/appUtils";
import { resolveRecentProjectDocument } from "./projects/resolveRecentProjectDocument";
export { pickDefaultCourse, resetGenerationScope } from "./app/appUtils";
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
  KnowledgeLink,
  ProjectIndexStatus,
  QARecord,
  QAThreadSummary,
  TeachingHandoff,
  TeachingNextAction,
  QAAskPayload,
  RetrievalSource,
  TreeNode,
  OutlinePreflight,
  OutlineSurveyAnswer,
  CallGuide,
  CallGuideNode,
} from "./api/client";
import type { ViewerRange, ViewerSelection } from "./components/CodeViewer";
import ExplainPanel, { AssistantContextSummary, SelectionSummary } from "./components/ExplainPanel";
import MobileTopBar from "./components/MobileTopBar";
import MobileMoreMenu from "./components/MobileMoreMenu";
import type { MobileAssistantView } from "./components/MobileAssistantPanel";
import MobileWorkspaceChrome, { type MobilePrimaryDestination, type MobileWorkspaceSheetHandle, type MobileWorkspaceTab } from "./components/MobileWorkspaceChrome";
import Sidebar, { type NavigationView } from "./components/Sidebar";
import type { GenerationIntent } from "./components/DesktopToolbar";
import { isGenerationTaskRunning } from "./components/generationTaskModel";
import type { MobileGenerationView } from "./components/MobileGenerationPanel";
import TitleBar from "./components/TitleBar";
import AppOverlayLayer from "./components/AppOverlayLayer";
import AppFeedbackLayer from "./components/AppFeedbackLayer";
import { useGestureCommands } from "./gestures/useGestureCommands";
import type { UseTermDisplayParams } from "./personalization";
import { usePersonalizationController } from "./personalization/usePersonalizationController";
import { useDocumentTermsController } from "./personalization/useDocumentTermsController";
import { CodeCourseNative, isAndroidRuntime } from "./platform/runtime";
import { getCodeCourseProvider } from "./platform/provider";
import { markAndroidPerformance, scheduleAfterInteractiveFrame } from "./platform/android/performance";
import { canRetry, permissionNotice as buildPermissionNotice, type PermissionNotice, type ProviderNotice } from "./platform/android/generationState";
import { useAppDialog } from "./hooks/useAppDialog";
import { useQAAskController } from "./hooks/useQAAskController";
import { useQAGenerationController } from "./hooks/useQAGenerationController";
import { useLearningStateController } from "./learning/useLearningStateController";
import { useGenerationTaskController } from "./generation/useGenerationTaskController";
import { useGenerationTrackingController } from "./generation/useGenerationTrackingController";
import {
  callGuideOpenItem,
  useCallGuideController,
} from "./callGuides/useCallGuideController";
import { useDesktopInteractionLight } from "./hooks/useDesktopInteractionLight";
import { useDesktopImportDrop } from "./hooks/useDesktopImportDrop";
import { useCommandPaletteItems } from "./commands/useCommandPaletteItems";
import { markDesktopPerformance, measureDesktopInteraction } from "./performance/desktopPerformance";
import { useWorkbenchLayoutController } from "./workbench/useWorkbenchLayoutController";
import { useWorkbenchResizeController } from "./workbench/useWorkbenchResizeController";
import { useWorkbenchPersistence } from "./workbench/useWorkbenchPersistence";
import WorkbenchEditorGroup from "./workbench/WorkbenchEditorGroup";
import WorkbenchSurface from "./workbench/WorkbenchSurface";
import {
  androidWorkbenchStorageKey,
  hydrateStoredItem as hydratePersistedItem,
  restoreStoredWorkbench as restorePersistedWorkbench,
  workbenchStorageKey,
} from "./workbench/persistence";
import {
  MAX_GROUPS,
  ROOT_GROUP_ID,
  closeItem,
  countGroups,
  createGroup,
  createInitialLayout,
  detectDropZone,
  dropPayloadCacheKey,
  dropPayloadItemId,
  findGroup,
  findGroupIdForItem,
  findOpenItem,
  findOpenItemByPath,
  firstGroupId,
  hasGroup,
  openItem,
  splitGroup,
  normalizeGroupIds,
  splitMeta,
  updateEveryGroup,
  updateGroup,
} from "./workbench/layout";
import type {
  DropPayload,
  DropZone,
  EditorGroup,
  LayoutNode,
  OpenItem,
} from "./workbench/layout";

const KnowledgeGraphViewer = lazy(() => import("./components/KnowledgeGraphViewer"));
const MobileAssistantPanel = lazy(() => import("./components/MobileAssistantPanel"));
const MobileGenerationPanel = lazy(() => import("./components/MobileGenerationPanel"));
const MobileMePanel = lazy(() => import("./components/MobileMePanel"));
const DesktopToolbar = __ANDROID_BUILD__ ? null : lazy(() => import("./components/DesktopToolbar"));
const GestureGuide = __ANDROID_BUILD__ ? null : lazy(() => import("./components/GestureGuide"));
const GenerationSheet = __ANDROID_BUILD__ ? null : lazy(() => import("./components/GenerationSheet"));

type ScopeType = LearningScope["type"];
type ThemeMode = "light" | "dark";
type MobileSurface = "navigation" | "workspace" | "assistant" | "generation" | "more" | "command" | "settings" | "prompts" | "profile";

type SelectionAnchor = SelectionSummary & {
  range?: ViewerRange;
  anchorRect?: ViewerSelection["anchorRect"];
};

const THEME_STORAGE_KEY = "codecourse.theme";
const LAST_PROJECT_STORAGE_KEY = "codecourse.lastProjectId";
const DATA_ARCHIVE_IMPORT_NOTICE_KEY = "codecourse.dataArchiveImportNotice";
const MIN_READER_WIDTH = 520;

function getInitialTheme(): ThemeMode {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export default function App() {
  const mobileRuntime = isAndroidRuntime();
  const [project, setProject] = useState<Project | null>(null);
  const currentProjectIdRef = useRef<number | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [courses, setCourses] = useState<CourseFile[]>([]);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dataTransferBusy, setDataTransferBusy] = useState(false);
  const [restoringWorkbenchProjectId, setRestoringWorkbenchProjectId] = useState<number | null>(null);
  const [busyProjectId, setBusyProjectId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [learnerProfileOpen, setLearnerProfileOpen] = useState(false);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [promptEditorDirty, setPromptEditorDirty] = useState(false);
  const [promptEditorSaving, setPromptEditorSaving] = useState(false);
  const [settingsDialogBusy, setSettingsDialogBusy] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(() => !isAndroidRuntime());
  const [navigationClosing, setNavigationClosing] = useState(false);
  const navigationRender = navigationOpen || navigationClosing;
  const [navigationView, setNavigationView] = useState<NavigationView>("courses");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [contextFilePickerOpen, setContextFilePickerOpen] = useState(false);
  const [mobileWorkspaceTab, setMobileWorkspaceTab] = useState<MobileWorkspaceTab | null>(null);
  const [mobileCodeSearchRequestId, setMobileCodeSearchRequestId] = useState(0);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [mobileGenerationView, setMobileGenerationView] = useState<MobileGenerationView>("configure");
  const [generationIntent, setGenerationIntent] = useState<GenerationIntent>("outline");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [llmSettings, setLLMSettings] = useState<LLMSettings | null>(null);
  const [scopeType, setScopeType] = useState<ScopeType>("full_project");
  const [scopePathsText, setScopePathsText] = useState("");
  const [selectedScopeFiles, setSelectedScopeFiles] = useState<string[]>([]);
  const [generationInstructions, setGenerationInstructions] = useState("");
  const [indexStatus, setIndexStatus] = useState<ProjectIndexStatus | null>(null);
  const [indexBuilding, setIndexBuilding] = useState(false);
  const [taskMessage, setTaskMessage] = useState("");
  const {
    tasks: generationTasks,
    activeTask,
    starting: generationStarting,
    busy: generationBusy,
    replaceTasks: replaceGenerationTasks,
    upsertTask: upsertCurrentGenerationTask,
    isBusy: isGenerationBusyNow,
    acquireStart: acquireGenerationStartLock,
    releaseStart: releaseGenerationStart,
    beginTracking: beginGenerationTracking,
    endTracking: endGenerationTracking,
    reset: resetGenerationTasks,
  } = useGenerationTaskController({
    getCurrentProjectId: () => currentProjectIdRef.current,
    taskMessage: taskStatusMessage,
    onMessage: setTaskMessage,
  });
  const {
    retryingTaskId,
    clearRetryingTask,
    acquireStart: acquireGenerationStart,
    rejectProjectMutationWhileBusy: rejectProjectMutationWhileGenerationBusy,
    resumeTracking: resumeGenerationTracking,
    reloadTasks: reloadGenerationTasks,
    trackTask,
    retryTask: handleRetryTask,
  } = useGenerationTrackingController({
    project,
    getCurrentProjectId: () => currentProjectIdRef.current,
    acquireStartLock: acquireGenerationStartLock,
    releaseStartLock: releaseGenerationStart,
    isBusy: isGenerationBusyNow,
    beginTracking: beginGenerationTracking,
    endTracking: endGenerationTracking,
    replaceTasks: replaceGenerationTasks,
    upsertTask: upsertCurrentGenerationTask,
    onProjectData: (freshProject, nextCourses) => {
      setCourses(nextCourses);
      setProject(freshProject);
      setProjects((items) => items.map((item) => item.id === freshProject.id ? freshProject : item));
    },
    onOpenCourse: openCourseInActiveGroup,
    onCompleted: notifyTaskCompleted,
    onKnowledgeChanged: () => setKnowledgeRefreshKey((value) => value + 1),
    onShowMobileTasks: () => setMobileGenerationView("tasks"),
    onDismissMobileGeneration: () => {
      if (mobileRuntime && mobileWorkspaceTabRef.current === "generation") {
        mobileWorkspaceSheetRef.current?.dismiss();
      }
    },
    onMessage: setTaskMessage,
    onToast: setToast,
    onError: setError,
  });
  const {
    layout,
    setLayout,
    activeGroupId,
    setActiveGroupId,
    deferredEditorMounts,
    layoutHistoryRef,
    closedItemsRef,
    nextId,
    commitLayoutChange,
    resetLayout,
    undoLayout,
    equalize: equalizeControlledLayout,
    closeGroup: closeControlledGroup,
    mergeGroups: mergeControlledGroups,
    collapse: collapseControlledSplit,
    rememberClosedItem: rememberClosedWorkbenchItem,
    deferEditorMount: deferControlledEditorMount,
  } = useWorkbenchLayoutController();
  const {
    sidebarWidth,
    setSidebarWidth,
    assistantWidth: explainWidth,
    dragState,
    setDragState,
  } = useWorkbenchResizeController({
    mobile: mobileRuntime,
    commitLayoutChange,
    collapseSplit: collapseControlledSplit,
  });
  useWorkbenchPersistence({
    projectId: project?.id ?? null,
    restoringProjectId: restoringWorkbenchProjectId,
    loading,
    mobile: mobileRuntime,
    layout,
    activeGroupId,
    navigationView,
    navigationOpen,
    sidebarWidth,
    closedItemsRef,
  });
  const dropPreviewRef = useRef<{ groupId: string; zone: DropZone; element: HTMLDivElement } | null>(null);

  const [selection, setSelection] = useState<SelectionSummary | null>(null);
  const [qaQuestionInput, setQAQuestionInput] = useState("");
  /*
   * Bumped every time the question state is cleared programmatically. The
   * composer panels watch it so an explicit reset reaches their local draft
   * even when the underlying state value did not change (e.g. cleared to "").
   */
  const [qaResetToken, setQaResetToken] = useState(0);
  const [mobileAssistantView, setMobileAssistantView] = useState<MobileAssistantView>("ask");
  const [qaHistory, setQAHistory] = useState<QARecord[]>([]);
  const [qaThreads, setQAThreads] = useState<QAThreadSummary[]>([]);
  const [qaContinuity, setQAContinuity] = useState<TeachingHandoff | null>(null);
  const [qaHistoryQuery, setQAHistoryQuery] = useState("");
  const [qaFavoriteOnly, setQAFavoriteOnly] = useState(false);
  const [qaUpperTab, setQAUpperTab] = useState<"history" | "knowledge">("history");
  const [selectedQA, setSelectedQA] = useState<QARecord | null>(null);
  const [qaSessionId, setQASessionId] = useState<number | null>(null);
  const [qaSessionTree, setQASessionTree] = useState<QARecord[]>([]);
  const [terminologyDensity, setTerminologyDensity] = useState(0.5);
  const [termAction, setTermAction] = useState<{ term: DocumentTerm; position?: { x: number; y: number } } | null>(null);
  const [learningAnchor, setLearningAnchor] = useState<LearningAnchor | null>(null);
  const [qaPanelError, setQAPanelError] = useState("");
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const highlightsRef = useRef<HighlightRecord[]>([]);
  highlightsRef.current = highlights;
  const [knowledgeLinks, setKnowledgeLinks] = useState<KnowledgeLink[]>([]);
  const [knowledgeRefreshKey, setKnowledgeRefreshKey] = useState(0);
  const handleLearningStatus = useCallback((message: string) => {
    setTaskMessage(message);
    setToast(message);
  }, []);
  const {
    states: learningStates,
    replaceStates: setLearningStates,
    findState: findLearningState,
    queueUpdate: queueLearningUpdate,
    flushUpdate: flushPendingLearningUpdate,
    flushAll: flushAllPendingLearningUpdates,
    touchOpenItem,
    toggleLessonComplete,
    reset: resetLearningProgress,
  } = useLearningStateController({
    projectId: project?.id ?? null,
    onError: setError,
    onStatus: handleLearningStatus,
    streamingPaths: () => streamingPathsRef.current,
  });
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const {
    generations:
      qaGenerations,

    draftId:
      qaDraftId,

    startNewDraft:
      startNewQADraft,

    runStreamingQuestion,

    operationPending:
      qaOperationPending,

    beginOperation:
      beginQAOperation,

    endOperation:
      endQAOperation,

    isOperationActive:
      isQAOperationActive,

    anyLoading:
      anyQALoading,

    busy:
      qaInteractionBusy,
  } =
    useQAGenerationController(
      project?.id ?? null,
    );
  const {
    revision: personalizationRevision,
    bumpRevision: bumpPersonalizationRevision,
    surveyCandidate: dynamicSurvey,
    diagnosticItem,
    diagnosticResult,
    scheduleRefresh: schedulePersonalizationRefresh,
    answerSurvey: handleDynamicSurveyAnswer,
    dismissSurvey: handleDynamicSurveyDismiss,
    disableSurveys: handleDisableDynamicSurveys,
    submitDiagnostic: handleDiagnosticAnswer,
    dismissDiagnostic: handleDiagnosticDismiss,
    flagDiagnostic: handleDiagnosticFlag,
  } = usePersonalizationController({
    projectId: project?.id ?? null,
    onError: setQAPanelError,
    onToast: setToast,
  });
  const [permissionNotice, setPermissionNotice] = useState<PermissionNotice>(null);
  const dismissedPermissionStatusRef = useRef<string | null>(null);

  const activeTermSource = useMemo(() => {
    const item = getActiveOpenItem();
    if (!item || (item.type !== "course" && item.type !== "qa")) return null;
    return {
      sourceType: (item.qaRecordId ? "qa" : "course") as "course" | "qa",
      sourcePath: item.path,
    };
  }, [layout, activeGroupId]);

  const activeTermContent = useMemo(() => {
    const item = getActiveOpenItem();
    return item?.content ?? "";
  }, [layout, activeGroupId]);

  const {
    rawTerms: activeTermRawTerms,
    scanStatus: activeTermScanStatus,
    display: termDisplay,
    refreshDocumentTerms,
    rescanActiveDocumentTerms,
  } = useDocumentTermsController({
    projectId: project?.id ?? null,
    sourceType: activeTermSource?.sourceType ?? null,
    sourcePath: activeTermSource?.sourcePath ?? "",
    content: activeTermContent,
    terminologyDensity,
    profileRevision: personalizationRevision,
    onError: setQAPanelError,
  });
  const awaitingNotificationSettingsRef = useRef(false);
  const promptClosePendingRef = useRef(false);
  const handledCompletionNavRef = useRef(new Set<string>());
  const [gestureGuideOpen, setGestureGuideOpen] = useState(false);
  const [workspaceMenuGroupId, setWorkspaceMenuGroupId] = useState<string | null>(null);
  const [qaHighlightDraft, setQAHighlightDraft] = useState<{ sourcePath: string; selectedText: string } | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);
  const [editingCourseItemId, setEditingCourseItemId] = useState<string | null>(null);
  const [outlinePreflight, setOutlinePreflight] = useState<OutlinePreflight | null>(null);
  const [outlinePreflightLoading, setOutlinePreflightLoading] = useState(false);
  const [outlinePreflightError, setOutlinePreflightError] = useState("");
  const outlinePreflightResolveRef = useRef<((answers: OutlineSurveyAnswer[] | null) => void) | null>(null);
  const {
    dialog: appDialog,
    value: appDialogValue,
    skipChecked: appDialogSkipChecked,
    setValue: setAppDialogValue,
    setSkip: handleAppDialogSkipChange,
    close: closeAppDialog,
    submit: handleAppDialogConfirm,
    confirm: confirmAction,
    requestText,
    requestChoice,
  } = useAppDialog();
  const {
    guides: callGuides,
    busyId: callGuideBusyId,
    replace: replaceOpenCallGuide,
    remember: rememberCallGuide,
    replaceAll: replaceCallGuides,
    reset: resetCallGuides,
    open: openCallGuide,
    resolveAndOpen: resolveAndOpenCallGuide,
    selectNode: handleCallGuideSelection,
    refresh: handleRefreshCallGuide,
    remove: handleDeleteCallGuide,
  } = useCallGuideController({
    project,
    mobile: mobileRuntime,
    requestChoice,
    confirmDelete: (guide) => confirmAction(
      "删除调用链导览",
      `删除“${guide.title}”？这不会删除源码或知识网络。`,
      { confirmText: "删除", danger: true },
    ),
    onOpen: (guide) => openItemInGroup(activeGroupId, callGuideOpenItem(guide)),
    onChanged: (guide) => {
      setLayout((current) => updateEveryGroup(current, (group) => ({
        ...group,
        items: group.items.map((item) => (
          item.callGuideId === guide.id ? { ...item, title: guide.title } : item
        )),
      })));
    },
    onDeleted: (guide) => {
      setLayout((current) => updateEveryGroup(
        current,
        (group) => closeItem(group, `call-guide:${guide.id}`),
      ));
    },
    onClearSelection: () => {
      setSelection(null);
      setSelectionAnchor(null);
    },
    onError: setError,
    onToast: setToast,
    onTaskMessage: setTaskMessage,
  });
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme);

  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const dataArchiveInputRef = useRef<HTMLInputElement | null>(null);
  const mobileWorkspaceTabRef = useRef<MobileWorkspaceTab | null>(null);
  const mobileWorkspaceMotionRef = useRef<"entering" | "open" | "exiting">("open");
  const mobileWorkspaceSheetRef = useRef<MobileWorkspaceSheetHandle | null>(null);
  const recordedTermImpressionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    recordedTermImpressionsRef.current.clear();
  }, [project?.id]);

  currentProjectIdRef.current = project?.id ?? null;
  mobileWorkspaceTabRef.current = mobileWorkspaceTab;
  const streamingContentRef = useRef<Map<string, string>>(new Map());
  // Course paths with an in-flight streaming generation. While set, the
  // backend has not published the file, so learning-state saves are skipped
  // (they would 404 "Learning source not found").
  const streamingPathsRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const dropPrefetchRef = useRef<Map<string, Promise<OpenItem | null>>>(new Map());
  const activeOpenItemRef = useRef<OpenItem | null>(null);
  useDesktopInteractionLight(!mobileRuntime);
  const desktopDropActive = useDesktopImportDrop(!mobileRuntime, {
    onLocalPath: handleImportLocalPath,
    onArchive: handleImportArchive,
    onRejected: setError,
  });
  const gestureHint = useGestureCommands({
    left: () => {
      if (layoutHistoryRef.current.length === 0) return "← 没有可撤销的布局调整";
      undoWorkspaceLayout();
      return "← 已撤销工作区布局调整";
    },
    right: () => {
      const group = findGroup(layout, activeGroupId);
      if (!group || group.items.length === 0) return "没有可切换的文档";
      const activeIndex = group.items.findIndex((item) => item.id === group.activeItemId);
      const nextItem = group.items[activeIndex >= 0 ? (activeIndex + 1) % group.items.length : 0];
      activateItem(activeGroupId, nextItem);
      return group.items.length === 1 ? "→ 当前仅有一个文档" : "→ 下一个文档";
    },
    up: () => {
      const closed = closedItemsRef.current.pop();
      if (!closed) return "↑ 没有最近关闭的文档";
      const targetGroupId = findGroup(layout, closed.groupId) ? closed.groupId : activeGroupId;
      openItemInGroup(targetGroupId, closed.item);
      return `↑ 已恢复：${closed.item.title}`;
    },
    down: () => {
      const group = findGroup(layout, activeGroupId);
      const activeItem = group?.items.find((item) => item.id === group.activeItemId);
      if (!group || !activeItem) return "没有可关闭的文档";
      if (activeItem.type === "file") flushPendingLearningUpdate("file", activeItem.path);
      rememberClosedItem(activeGroupId, activeItem);
      const nextGroup = closeItem(group, activeItem.id);
      setLayout((current) => updateGroup(current, activeGroupId, () => nextGroup));
      const nextItem = nextGroup.items.find((item) => item.id === nextGroup.activeItemId);
      if (nextItem) {
        applyActiveItem(nextItem);
        touchOpenItem(nextItem);
      } else {
        setFileContent(null);
        setSelectedCourse(null);
      }
      return "↓ 关闭当前文档";
    },
    "up-left": () => {
      dismissTransientSurfaces();
      setAssistantOpen(false);
      setNavigationView("files");
      setNavigationOpen(true);
      return "↑← 打开源码";
    },
    "up-right": () => {
      dismissTransientSurfaces();
      setCommandPaletteOpen(true);
      return "↑→ 打开搜索";
    },
    "down-right": () => {
      dismissTransientSurfaces();
      setAssistantOpen(false);
      setNavigationView("courses");
      setNavigationOpen(true);
      return "↓→ 打开课程目录";
    },
    "down-left": () => {
      dismissTransientSurfaces();
      setNavigationOpen(false);
      setQAUpperTab("history");
      setAssistantOpen(true);
      return "↓← 打开 AI 助手";
    },
  });

  useEffect(() => {
    if (mobileRuntime) return;
    markDesktopPerformance("shell-visible");
  }, [mobileRuntime]);

  useEffect(() => {
    const active = getActiveOpenItem();
    if (mobileRuntime || !project || !active || active.hydrated === false) return;
    markDesktopPerformance("active-document-visible", {
      project_id: project.id,
      document_type: active.type,
    });
  }, [mobileRuntime, project?.id, layout, activeGroupId]);

  useEffect(() => {
    if (!window.codecourseDesktop?.reportDiagnostic) return;
    const reportError = (event: ErrorEvent) => {
      void window.codecourseDesktop?.reportDiagnostic?.({
        type: "error",
        message: event.message,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    };
    const reportRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? `${event.reason.name}: ${event.reason.message}` : String(event.reason);
      void window.codecourseDesktop?.reportDiagnostic?.({ type: "unhandledrejection", reason });
    };
    window.addEventListener("error", reportError);
    window.addEventListener("unhandledrejection", reportRejection);
    return () => {
      window.removeEventListener("error", reportError);
      window.removeEventListener("unhandledrejection", reportRejection);
    };
  }, []);
  const canGenerateFileLesson = Boolean(project && fileContent);
  const isLearningPlanProject = project?.project_type === "learning_plan";
  const isTaskRunning = generationTasks.some(isGenerationTaskRunning);
  const activeQAKey = qaSessionId ? `session:${qaSessionId}` : `draft:${qaDraftId}`;
  const activeQAGeneration = qaGenerations[activeQAKey] ?? null;

  /*
   * 术语解释可能使用父会话 key，
   * 不一定等于当前 activeQAKey。
   *
   * 全局互斥后同时最多只有一个，
   * 因此找不到当前 key 时直接取第一个。
   */
  const visibleQAGeneration =
    activeQAGeneration ??
    Object.values(
      qaGenerations,
    )[0] ??
    null;

  const qaBusyLabel =
    qaOperationPending &&
    !anyQALoading
      ? "正在准备"
      : visibleQAGeneration
          ?.label ||
        "正在生成回答";

  const {
    acquireOperation: acquireQAOperation,
    isBusy: isQABusyNow,
    rejectProjectMutationWhileBusy: rejectProjectMutationWhileQABusy,
    ask: handleAsk,
  } = useQAAskController({
    projectId: project?.id ?? null,
    settings: llmSettings,
    sessionId: qaSessionId,
    parentQAId: selectedQA?.id ?? null,
    selectionRange: selectionAnchor?.range,
    generationKey: activeQAKey,
    interactionBusy: qaInteractionBusy,
    beginOperation: beginQAOperation,
    endOperation: endQAOperation,
    isOperationActive: isQAOperationActive,
    runStreamingQuestion,
    buildContext: buildAskPayloadContext,
    confirm: confirmAction,
    onToast: setToast,
    onPanelError: setQAPanelError,
    onAnswerComplete: async (record, projectId) => {
      setSelectedQA(record);
      setQASessionId(record.session_id ?? qaSessionId);
      setQAUpperTab("history");
      setMobileAssistantView("ask");
      setQAHistory((items) => [record, ...items.filter((item) => item.id !== record.id)]);
      clearQAQuestionInput();
      await Promise.all([
        refreshCourses(projectId),
        refreshQAHistory(projectId),
        refreshQAContinuity(projectId),
        refreshKnowledgeLinks(projectId),
      ]);
      setKnowledgeRefreshKey((value) => value + 1);
      notifyTaskCompleted("CodeCourse 回答完成", record.display_title || "AI 助手已经完成回答。");
      schedulePersonalizationRefresh();
    },
  });

  const showBusy =
    loading ||
    dataTransferBusy ||
    generationBusy ||
    qaInteractionBusy;

  const mobileWorkspaceBusy =
    loading ||
    dataTransferBusy ||
    (
      generationBusy &&
      mobileWorkspaceTab !==
        "generation"
    ) ||
    (
      qaInteractionBusy &&
      mobileWorkspaceTab !==
        "assistant"
    );

  const mobileMeBusy =
    loading ||
    dataTransferBusy ||
    generationBusy ||
    qaInteractionBusy;

  const clearDropPreview = useCallback(() => {
    const current = dropPreviewRef.current;
    if (!current) return;
    current.element.className = "drop-preview";
    dropPreviewRef.current = null;
  }, []);

  const showDropPreview = useCallback((pane: HTMLElement, groupId: string, zone: DropZone) => {
    const current = dropPreviewRef.current;
    if (current?.groupId === groupId && current.zone === zone && current.element.isConnected) return;
    if (current) current.element.className = "drop-preview";
    const element = pane.querySelector<HTMLDivElement>(":scope > .drop-preview");
    if (!element) return;
    element.className = `drop-preview ${zone} visible`;
    dropPreviewRef.current = { groupId, zone, element };
  }, []);

  useEffect(() => {
    if (mobileRuntime) return;
    const clearTransientDrag = () => clearDropPreview();
    window.addEventListener("dragend", clearTransientDrag, true);
    window.addEventListener("drop", clearTransientDrag, true);
    window.addEventListener("pointercancel", clearTransientDrag, true);
    window.addEventListener("blur", clearTransientDrag);
    return () => {
      window.removeEventListener("dragend", clearTransientDrag, true);
      window.removeEventListener("drop", clearTransientDrag, true);
      window.removeEventListener("pointercancel", clearTransientDrag, true);
      window.removeEventListener("blur", clearTransientDrag);
    };
  }, [clearDropPreview, mobileRuntime]);


  useEffect(() => {
    document.documentElement.classList.remove("app-starting");
    markAndroidPerformance("react-shell-visible");
  }, []);

  useEffect(() => {
    if (!mobileRuntime) return;
    return scheduleAfterInteractiveFrame(() => {
      void getCodeCourseProvider().then(async (provider) => {
        markAndroidPerformance("database-ready");
        await provider.startRecovery?.();
      }).catch((error) => {
        console.warn("Android task recovery failed", error);
      });
    });
  }, [mobileRuntime]);

  // Register permission notice handler on Android provider
  useEffect(() => {
    if (!mobileRuntime) return;
    let disposed = false;
    let registeredProvider: Awaited<ReturnType<typeof getCodeCourseProvider>> | null = null;
    getCodeCourseProvider().then((provider) => {
      if (disposed) return;
      registeredProvider = provider;
      if (provider.setPermissionNoticeHandler) {
        provider.setPermissionNoticeHandler((notice: ProviderNotice) => {
          if (disposed) return;
          if (!notice) {
            setPermissionNotice(null);
            return;
          }
          setPermissionNotice(notice.notice);
        });
      }
    });
    return () => {
      disposed = true;
      registeredProvider?.setPermissionNoticeHandler?.(null);
    };
  }, [mobileRuntime]);

  useEffect(() => {
    if (!mobileRuntime) return;
    let disposed = false;
    let listener: { remove: () => Promise<void> } | null = null;
    void import("@capacitor/app").then(async ({ App: NativeApp }) => {
      listener = await NativeApp.addListener("appStateChange", ({ isActive }) => {
        if (disposed) return;
        if (!isActive) {
          flushAllPendingLearningUpdates();
          return;
        }
        void getCodeCourseProvider().then(async (provider) => {
          // Re-read the persisted task state when the app returns. Generation
          // is foreground-only, and checkpoints recover interrupted work.
          const currentProjectId = currentProjectIdRef.current;
          if (currentProjectId) {
            await reloadGenerationTasks(currentProjectId, true).catch((error) => {
              console.warn("Generation task resume sync failed", error);
            });
          }
          if (!awaitingNotificationSettingsRef.current) return;
          awaitingNotificationSettingsRef.current = false;
          provider.invalidatePermissionCache?.();
          const result = await provider.getNotificationPermissionStatus?.();
          if (!result || disposed) return;
          dismissedPermissionStatusRef.current = null;
          setPermissionNotice(buildPermissionNotice(result));
        }).catch((error) => {
          console.warn("Notification settings resume check failed", error);
        });
      });
    });
    return () => {
      disposed = true;
      void listener?.remove();
    };
  }, [mobileRuntime, project?.id]);

  // Open settings now; permission is checked only when the app resumes.
  const handleOpenNotificationSettings = useCallback(() => {
    awaitingNotificationSettingsRef.current = true;
    void CodeCourseNative.openNotificationSettings().catch(() => {
      awaitingNotificationSettingsRef.current = false;
      setToast("无法打开通知设置");
    });
  }, []);

  const handleDismissPermissionNotice = useCallback(() => {
    if (permissionNotice) {
      dismissedPermissionStatusRef.current = permissionNotice.status;
    }
    setPermissionNotice(null);
  }, [permissionNotice]);

  // Completion navigation: listen for warm-start events and consume cold-start on init
  const navigateToCompletion = useCallback(async (
    projectId: number,
    taskId: number,
    _taskType: string,
    outputPath: string,
    navigationId?: string,
  ): Promise<boolean> => {
    const navKey = navigationId || `${taskId}:${outputPath}`;
    if (handledCompletionNavRef.current.has(navKey)) return true;
    handledCompletionNavRef.current.add(navKey);

    // Load project if not already open
    if (!project || project.id !== projectId) {
      try {
        const p = await getProject(projectId);
        const opened = await openProject(p);
        if (!opened) {
          /*
           * 不确认消费通知。
           * 当前 QA 完成后仍可再次处理。
           */
          handledCompletionNavRef
            .current
            .delete(navKey);

          return false;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!/404|not found|不存在/i.test(message)) {
          handledCompletionNavRef.current.delete(navKey);
        }
        setToast("无法打开项目");
        return /404|not found|不存在/i.test(message);
      }
    }

    // Open output file
    if (outputPath) {
      try {
        const content = await getCourseContent(projectId, outputPath);
        setSelectedCourse(outputPath);
        setFileContent(null);
        setLayout((current) => {
          const targetGroupId = hasGroup(current, activeGroupId)
            ? activeGroupId
            : firstGroupId(current);
          return updateGroup(current, targetGroupId, (group) => openItem(group, {
            id: `course:${outputPath}`,
            type: "course",
            path: outputPath,
            title: outputPath.split("/").pop() ?? outputPath,
            content: content.content,
          }));
        });
        void refreshDocumentTerms("course", outputPath, projectId);
      } catch {
        setToast("生成完成，但结果文件不存在：" + outputPath);
      }
    }
    return true;
  }, [project]);

  useEffect(() => {
    if (!mobileRuntime) return;
    let disposed = false;

    // Cold start: consume pending navigation
    void CodeCourseNative.consumePendingCompletionNavigation().then((pending) => {
      if (disposed || !pending) return;
      void navigateToCompletion(
        pending.projectId,
        pending.taskId,
        pending.taskType,
        pending.outputPath,
        pending.navigationId,
      );
    }).catch(() => undefined);

    // Warm start: listen for event
    function handleCompletionNav(event: Event) {
      if (disposed) return;
      const detail = (event as CustomEvent<{
        projectId?: number; taskId?: number; taskType?: string;
        outputPath?: string; navigationId?: string;
      }>).detail;
      if (!detail || !detail.projectId || !detail.taskId) return;
      void navigateToCompletion(
        detail.projectId, detail.taskId,
        detail.taskType ?? "", detail.outputPath ?? "", detail.navigationId,
      ).then((handled) => {
        if (handled && detail.navigationId) {
          return CodeCourseNative.ackCompletionNavigation({
            navigationId: detail.navigationId,
          });
        }
        return undefined;
      }).catch(() => undefined);
    }
    window.addEventListener("codecourseCompletionNavigation", handleCompletionNav);
    return () => {
      disposed = true;
      window.removeEventListener("codecourseCompletionNavigation", handleCompletionNav);
    };
  }, [mobileRuntime, navigateToCompletion]);

  useEffect(() => {
    if (!mobileRuntime) return;
    function handleNativeSelectionAsk(event: Event) {
      const text = String((event as CustomEvent<{ text?: string }>).detail?.text ?? "").trim().slice(0, 20000);
      const item = activeOpenItemRef.current;
      if (!text || !item || !["file", "course", "qa"].includes(item.type)) return;
      const sourceType: ViewerSelection["sourceType"] = item.type === "file"
        ? "file"
        : item.type === "qa" || item.qaRecordId
          ? "qa"
          : "course";
      handleSelection({
        sourceType,
        sourcePath: item.path,
        selectedText: text,
        language: item.language,
      });
      openAssistant("history");
    }
    function handleNativeSelectionExplain(event: Event) {
      const text = String((event as CustomEvent<{ text?: string }>).detail?.text ?? "").trim().slice(0, 20000);
      const item = activeOpenItemRef.current;
      if (!text || !item || !["file", "course", "qa"].includes(item.type)) return;
      const sourceType: ViewerSelection["sourceType"] = item.type === "file"
        ? "file"
        : item.type === "qa" || item.qaRecordId
          ? "qa"
          : "course";
      const anchor: ViewerSelection = {
        sourceType,
        sourcePath: item.path,
        selectedText: text,
        language: item.language,
      };
      handleSelection(anchor);
      void handleExplainSelectedTerm(anchor);
    }
    function handleNativeSelectionKnown(event: Event) {
      const text = String((event as CustomEvent<{ text?: string }>).detail?.text ?? "").trim().slice(0, 200);
      const item = activeOpenItemRef.current;
      if (!text || !item || !["file", "course", "qa"].includes(item.type)) return;
      const sourceType: ViewerSelection["sourceType"] = item.type === "file"
        ? "file"
        : item.type === "qa" || item.qaRecordId
          ? "qa"
          : "course";
      void handleMarkSelectedTermKnown({
        sourceType,
        sourcePath: item.path,
        selectedText: text,
        language: item.language,
      });
    }
    function handleNativeSelectionHighlight(event: Event) {
      const text = String((event as CustomEvent<{ text?: string }>).detail?.text ?? "").trim().slice(0, 20000);
      const item = activeOpenItemRef.current;
      if (!text || !item || !["course", "qa"].includes(item.type)) return;
      const sourceType = item.type === "qa" || item.qaRecordId ? "qa" : "course";
      void handleToggleHighlight(sourceType, item.path, text);
    }
    window.addEventListener("codecourse-native-selection-ask", handleNativeSelectionAsk);
    window.addEventListener("codecourse-native-selection-explain", handleNativeSelectionExplain);
    window.addEventListener("codecourse-native-selection-known", handleNativeSelectionKnown);
    window.addEventListener("codecourse-native-selection-highlight", handleNativeSelectionHighlight);
    return () => {
      window.removeEventListener("codecourse-native-selection-ask", handleNativeSelectionAsk);
      window.removeEventListener("codecourse-native-selection-explain", handleNativeSelectionExplain);
      window.removeEventListener("codecourse-native-selection-known", handleNativeSelectionKnown);
      window.removeEventListener("codecourse-native-selection-highlight", handleNativeSelectionHighlight);
    };
  }, [mobileRuntime, project, llmSettings, qaSessionId, selectedQA, activeQAKey, activeTermRawTerms]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeMode === "dark" ? "#08111f" : "#edf4f1");
  }, [themeMode]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    try {
      const notice = window.sessionStorage.getItem(DATA_ARCHIVE_IMPORT_NOTICE_KEY);
      if (!notice) return;
      window.sessionStorage.removeItem(DATA_ARCHIVE_IMPORT_NOTICE_KEY);
      setToast(notice);
    } catch {
      // Session storage may be unavailable in hardened WebViews.
    }
  }, []);

  useEffect(() => {
    if (!gestureGuideOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGestureGuideOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [gestureGuideOpen]);

  useEffect(() => {
    loadProjects();
    loadLLMSettings();
  }, []);

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
    if (mobileRuntime && assistantOpen && navigationOpen) {
      setNavigationOpen(false);
    }
  }, [assistantOpen, mobileRuntime, navigationOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void handleImportRequest();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        openSettings();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (mobileRuntime) toggleMobileCommandPalette();
        else setCommandPaletteOpen((open) => !open);
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
      if (settingsOpen) {
        closeSettingsDialog();
        return;
      }
      if (promptEditorOpen) {
        void requestClosePromptEditor();
        return;
      }
      if (learnerProfileOpen) {
        setLearnerProfileOpen(false);
        return;
      }
      setMoreMenuOpen(false);
      setGenerationOpen(false);
      setAssistantOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [appDialog, commandPaletteOpen, learnerProfileOpen, mobileRuntime, promptEditorDirty, promptEditorOpen, promptEditorSaving, settingsDialogBusy, settingsOpen]);

  useEffect(() => {
    if (mobileRuntime || !window.codecourseDesktop?.onShortcut) return;
    return window.codecourseDesktop.onShortcut((action) => {
      if (action === "new-project") void handleImportRequest();
      else if (action === "settings") openSettings();
      else setCommandPaletteOpen(true);
    });
  }, [mobileRuntime]);

  useEffect(() => {
    if (mobileRuntime) return;
    window.addEventListener("dragend", clearDropPreview, true);
    window.addEventListener("drop", clearDropPreview, true);
    window.addEventListener("blur", clearDropPreview);
    return () => {
      window.removeEventListener("dragend", clearDropPreview, true);
      window.removeEventListener("drop", clearDropPreview, true);
      window.removeEventListener("blur", clearDropPreview);
    };
  }, [clearDropPreview, mobileRuntime]);

  function dismissTransientSurfaces() {
    if (appDialog) closeAppDialog(null);
    setSettingsOpen(false);
    setLearnerProfileOpen(false);
    setPromptEditorOpen(false);
    setGenerationOpen(false);
    setMoreMenuOpen(false);
    setCommandPaletteOpen(false);
    setQAHighlightDraft(null);
    setWorkspaceMenuGroupId(null);
    setGestureGuideOpen(false);
    clearDropPreview();
    setDragState(null);
    setEditingCourseItemId(null);
    setToast("");
  }

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
          closeSettingsDialog();
        } else if (promptEditorOpen) {
          void requestClosePromptEditor();
        } else if (learnerProfileOpen) {
          setLearnerProfileOpen(false);
        } else if (generationOpen) {
          setGenerationOpen(false);
        } else if (moreMenuOpen) {
          setMoreMenuOpen(false);
        } else if (mobileWorkspaceTab) {
          mobileWorkspaceSheetRef.current?.dismiss();
        } else if (assistantOpen) {
          setAssistantOpen(false);
        } else if (navigationOpen) {
          setNavigationOpen(false);
        } else if (isTaskRunning || qaInteractionBusy || isQAOperationActive()) {
          void CodeCourseNative.moveToBackground().catch(() => NativeApp.exitApp());
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
  }, [appDialog, assistantOpen, generationOpen, isTaskRunning, isQAOperationActive, learnerProfileOpen, mobileRuntime, mobileWorkspaceTab, moreMenuOpen, navigationOpen, promptEditorDirty, promptEditorOpen, promptEditorSaving, qaInteractionBusy, settingsDialogBusy, settingsOpen]);

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
      setLearningAnchor(null);
      return;
    }
    let cancelled = false;
    const sourcePath = selectedQA.output_path || String(selectedQA.id);
    Promise.all([
      selectedQA.session_id ? getQASessionTree(project.id, selectedQA.session_id) : Promise.resolve([selectedQA]),
      getLearningAnchor(project.id, selectedQA.id).catch(() => null),
    ]).then(([tree, anchor]) => {
      if (cancelled) return;
      setQASessionTree(tree);
      setLearningAnchor(anchor);
      void refreshDocumentTerms("qa", sourcePath, project.id);
    }).catch((caught) => {
      if (!cancelled) setQAPanelError(caught instanceof Error ? caught.message : "加载问答分支失败");
    });
    return () => { cancelled = true; };
  }, [project?.id, selectedQA?.id, selectedQA?.updated_at]);

  function clearQAQuestionInput() {
    setQAQuestionInput("");
    setQaResetToken((token) => token + 1);
  }

  const handleQAQuestionChange = useCallback((value: string) => {
    setQAQuestionInput(value);
  }, []);

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

  function undoWorkspaceLayout() {
    const item = undoLayout();
    if (!item) {
      setToast("没有可撤销的工作区调整");
      return;
    }
    applyActiveItem(item);
    setWorkspaceMenuGroupId(null);
    setToast("已撤销工作区调整");
  }

  function equalizeWorkspaceLayout() {
    equalizeControlledLayout();
    setWorkspaceMenuGroupId(null);
  }

  function closeWorkspaceGroup(groupId: string) {
    const nextItem = closeControlledGroup(groupId);
    if (nextItem) applyActiveItem(nextItem);
    setWorkspaceMenuGroupId(null);
  }

  function mergeWorkspaceGroups(groupId: string) {
    mergeControlledGroups(groupId);
    setWorkspaceMenuGroupId(null);
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
      if (nextProjects.length === 0) {
        window.localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
        window.localStorage.removeItem("codecourse-last-project-name");
      } else if (!project) {
        const rememberedId = Number(window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY));
        const rememberedProject = Number.isSafeInteger(rememberedId) && rememberedId > 0
          ? nextProjects.find((entry) => entry.id === rememberedId)
          : null;
        if (!rememberedProject && window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY)) {
          window.localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
        }
        await openProject(rememberedProject ?? nextProjects[0]);
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

  async function refreshQAContinuity(projectId = project?.id) {
    if (!projectId) {
      setQAContinuity(null);
      setQAThreads([]);
      return;
    }
    try {
      const [continuity, threads] = await Promise.all([
        getQAContinuity(projectId),
        listQAThreads(projectId),
      ]);
      if (currentProjectIdRef.current !== projectId) return;
      setQAContinuity(continuity);
      setQAThreads(threads);
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "加载教学进展失败");
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
    } else if (item.type === "knowledge_graph" || item.type === "call_guide") {
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

  function buildAskPayloadContext(): Pick<QAAskPayload, "source_type" | "source_path" | "selected_text" | "context_files"> {
    const base = buildAskPayloadContextBase();
    return { ...base, context_files: contextFiles.length > 0 ? contextFiles : undefined };
  }

  function buildAskPayloadContextBase(): Pick<QAAskPayload, "source_type" | "source_path" | "selected_text"> {
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

  function deferEditorMount(groupId: string, itemId: string) {
    deferControlledEditorMount(groupId, itemId);
  }

  function splitGroupWithItem(groupId: string, zone: DropZone, item: OpenItem) {
    // Android: never allow split — always open in root group
    if (mobileRuntime) {
      openItemInGroup(ROOT_GROUP_ID, item);
      return;
    }
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
    deferEditorMount(newGroupId, item.id);
    commitLayoutChange((prev) => splitGroup(prev, groupId, meta.direction, meta.placement, newGroup, nextId("split")));
    setActiveGroupId(newGroupId);
    applyActiveItem(item);
  }

  function moveTabToGroup(payload: DropPayload, targetGroupId: string, zone: DropZone, item: OpenItem) {
    const sourceGroupId = payload.sourceGroupId ?? findGroupIdForItem(layout, item.id);
    if (zone === "center" && sourceGroupId === targetGroupId) {
      activateItem(targetGroupId, item);
      return;
    }
    const meta = splitMeta(zone);
    const canSplit = Boolean(meta && countGroups(layout) < MAX_GROUPS);
    const newGroupId = canSplit ? nextId("group") : targetGroupId;
    if (canSplit) deferEditorMount(newGroupId, item.id);
    commitLayoutChange((current) => {
      let next = current;
      if (sourceGroupId && hasGroup(next, sourceGroupId)) {
        next = updateGroup(next, sourceGroupId, (group) => closeItem(group, item.id));
      }
      if (!canSplit || !meta) {
        return updateGroup(next, targetGroupId, (group) => openItem(group, item));
      }
      const group = createGroup(newGroupId);
      group.group = openItem(group.group, item);
      return splitGroup(next, targetGroupId, meta.direction, meta.placement, group, nextId("split"));
    });
    setActiveGroupId(newGroupId);
    applyActiveItem(item);
    touchOpenItem(item);
    if (meta && !canSplit) setToast(`最多支持 ${MAX_GROUPS} 个工作区，标签已移入当前工作区`);
  }

  function rememberClosedItem(groupId: string, item: OpenItem) {
    rememberClosedWorkbenchItem(groupId, item);
  }

  function closeItemInGroup(groupId: string, itemId: string) {
    const group = findGroup(layout, groupId);
    const item = group?.items.find((entry) => entry.id === itemId);
    if (item) {
      if (item.type === "file") flushPendingLearningUpdate("file", item.path);
      rememberClosedItem(groupId, item);
    }
    setLayout((prev) => updateGroup(prev, groupId, (group) => closeItem(group, itemId)));
  }

  function activateItem(groupId: string, item: OpenItem) {
    setLayout((prev) => updateGroup(prev, groupId, (group) => ({ ...group, activeItemId: item.id })));
    setActiveGroupId(groupId);
    if (item.hydrated === false && project) {
      const projectId = project.id;
      void hydrateStoredItem(item, projectId, courses).then((hydrated) => {
        if (!hydrated || currentProjectIdRef.current !== projectId) {
          if (!hydrated) setLayout((prev) => updateGroup(prev, groupId, (group) => closeItem(group, item.id)));
          return;
        }
        setLayout((prev) => updateGroup(prev, groupId, (group) => ({
          ...group,
          items: group.items.map((entry) => entry.id === item.id ? hydrated : entry),
        })));
        applyActiveItem(hydrated);
        touchOpenItem(hydrated);
      });
      return;
    }
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
    return hydratePersistedItem(
      item,
      projectId,
      availableCourses,
      findLearningState,
      rememberCallGuide,
    );
  }

  function syncLayoutIdCounter(node: LayoutNode): LayoutNode {
    return normalizeGroupIds(node, nextId);
  }

  async function buildOpenItem(payload: DropPayload): Promise<OpenItem | null> {
    if (!project) {
      return null;
    }
    if (payload.kind === "file" && payload.path) {
      const content = await getProjectFile(project.id, payload.path);
      const saved = findLearningState("file", payload.path);
      return {
        id: `file:${payload.path}`,
        type: "file",
        path: payload.path,
        title: payload.path.split("/").pop() ?? payload.path,
        content: content.content,
        language: content.language,
        restoreLine: saved?.position_kind === "line" ? saved.position_value : 1,
      };
    }
    if (payload.kind === "course" && payload.filename) {
      const content = await getCourseContent(project.id, payload.filename);
      void refreshDocumentTerms("course", payload.filename, project.id);
      return {
        id: `course:${payload.filename}`,
        type: "course",
        path: payload.filename,
        title: courses.find((file) => file.filename === payload.filename)?.title ?? titleFromMarkdown(payload.filename, content.content),
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
    if (payload.kind === "call_guide" && payload.callGuideId) {
      const guide = await getCallGuide(project.id, payload.callGuideId);
      rememberCallGuide(guide);
      return {
        id: `call-guide:${guide.id}`,
        type: "call_guide",
        path: `call-guide://${guide.id}`,
        title: guide.title,
        content: "",
        callGuideId: guide.id,
        hydrated: true,
      };
    }
    return null;
  }

  function prefetchDropItem(kind: "file" | "course", path: string) {
    if (!project) return;
    const payload: DropPayload = kind === "file"
      ? { kind, path }
      : { kind, filename: path };
    const key = dropPayloadCacheKey(project.id, payload);
    if (!key || dropPrefetchRef.current.has(key)) return;
    const request = buildOpenItem(payload).catch(() => null);
    dropPrefetchRef.current.set(key, request);
    window.setTimeout(() => {
      if (dropPrefetchRef.current.get(key) === request) dropPrefetchRef.current.delete(key);
    }, 15000);
  }

  async function resolveDropItem(payload: DropPayload): Promise<OpenItem | null> {
    if (!project) return null;
    const key = dropPayloadCacheKey(project.id, payload);
    if (key) {
      const request = dropPrefetchRef.current.get(key);
      if (request) {
        dropPrefetchRef.current.delete(key);
        const prefetched = await request;
        if (prefetched) return prefetched;
      }
    }
    return buildOpenItem(payload);
  }

  function dismissMobileWorkspaceAfterOpen() {
    if (!mobileRuntime) return;
    window.requestAnimationFrame(() => {
      mobileWorkspaceSheetRef.current?.dismiss();
    });
  }

  async function openFileInActiveGroup(projectId: number, path: string, explicitLine?: number) {
    const content = await getProjectFile(projectId, path);
    const saved = findLearningState("file", path);
    const restoreLine = saved?.position_kind === "line" ? saved.position_value : 1;
    setFileContent(content);
    setSelectedCourse(null);
    openItemInGroup(activeGroupId, {
      id: `file:${path}`,
      type: "file",
      path,
      title: path.split("/").pop() ?? path,
      content: content.content,
      language: content.language,
      restoreLine,
      jumpRequest: explicitLine ? {
        id: nextId("code-jump"),
        line: explicitLine,
        align: "start",
      } : undefined,
    });
    dismissMobileWorkspaceAfterOpen();
  }

  async function openCourseInActiveGroup(projectId: number, filename: string) {
    const content = await getCourseContent(projectId, filename);
    void refreshDocumentTerms("course", filename, projectId);
    setSelectedCourse(filename);
    setFileContent(null);
    const matchingQA = qaHistory.find((record) => _normalizeOutputPath(record.output_path, record.id, projectId) === filename);
    openItemInGroup(activeGroupId, {
      id: `course:${filename}`,
      type: "course",
      path: filename,
      title: courses.find((file) => file.filename === filename)?.title ?? titleFromMarkdown(filename, content.content),
      content: content.content,
      qaRecordId: matchingQA?.id,
    });
    dismissMobileWorkspaceAfterOpen();
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
    dismissMobileWorkspaceAfterOpen();
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

  /**
   * 恢复上次工作区布局。返回 true 表示已恢复并完成打开。
   * 在第二阶段异步执行，不阻塞骨架渲染。
   */
  async function restoreStoredWorkbench(projectId: number, courses: CourseFile[], projectTree?: TreeNode | null): Promise<boolean> {
    const restored = await restorePersistedWorkbench({
      projectId,
      courses,
      projectTree,
      mobile: mobileRuntime,
      normalizeIds: syncLayoutIdCounter,
      findLearningState,
      onCallGuide: rememberCallGuide,
    });
    if (!restored) return false;

    setLayout(restored.layout);
    setActiveGroupId(restored.activeGroupId);
    setNavigationView(restored.navigationView);
    setNavigationOpen(restored.navigationOpen);
    setSidebarWidth(restored.sidebarWidth);
    if (restored.activeItem?.type === "file") {
      setFileContent({
        path: restored.activeItem.path,
        content: restored.activeItem.content,
        language: restored.activeItem.language ?? "plaintext",
      });
      setSelectedCourse(null);
    } else if (restored.activeItem?.type === "course") {
      setFileContent(null);
      setSelectedCourse(restored.activeItem.path);
      void refreshDocumentTerms(
        restored.activeItem.qaRecordId ? "qa" : "course",
        restored.activeItem.path,
        projectId,
      );
    } else {
      setFileContent(null);
      setSelectedCourse(null);
    }
    return true;
  }

  async function openProject(nextProject: Project): Promise<boolean> {
    if (project && project.id !== nextProject.id) {
      if (rejectProjectMutationWhileQABusy() || rejectProjectMutationWhileGenerationBusy()) {
        return false;
      }
    }
    flushAllPendingLearningUpdates();
    setError("");
    setLoading(true);
    setRestoringWorkbenchProjectId(nextProject.id);
    layoutHistoryRef.current = [];
    setWorkspaceMenuGroupId(null);
    try {
      const freshProject = await getProject(nextProject.id);
      setProject(freshProject);
      /*
       * 不能等下一次 React 渲染才更新。
       * 后面的任务恢复需要立即识别新项目。
       */
      currentProjectIdRef.current = freshProject.id;
      window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, String(freshProject.id));
      window.localStorage.setItem("codecourse-last-project-name", freshProject.name);
      // 第一阶段：仅轻量元数据，尽快渲染骨架。
      const [nextTree, nextCourses, tasks] = await Promise.all([
        getTree(freshProject.id),
        getCourseFiles(freshProject.id),
        listGenerationTasks(freshProject.id),
      ]);
      const initialLayout = createInitialLayout();
      const sortedTasks = replaceGenerationTasks(freshProject.id, tasks);
      /*
       * openProject 有多个提前返回。
       * 所有成功路径都必须经过这个函数，
       * 才能恢复运行中的任务轮询。
       */
      const finishOpenProject = () => {
        resumeGenerationTracking(freshProject.id, sortedTasks);
        return true;
      };
      setTree(nextTree);
      setCourses(nextCourses);
      setLLMSettings(null);
      setTerminologyDensity(0.5);
      bumpPersonalizationRevision();
      setIndexStatus(null);
      setLearningStates([]);
      setQAHistory([]);
      setQAThreads([]);
      setQAContinuity(null);
      resetCallGuides();
      setIndexBuilding(false);
      setScopeType(freshProject.project_type === "learning_plan" ? "learning_plan" : "full_project");
      setSelectedScopeFiles([]);
      setScopePathsText("");
      setFileContent(null);
      setSelectedCourse(null);
      setSelection(null);
      setSelectionAnchor(null);
      setContextFiles([]);
      setContextFilePickerOpen(false);
      clearQAQuestionInput();
      setSelectedQA(null);
      setQASessionId(null);
      setQASessionTree([]);
      setLearningAnchor(null);
      setQAHistoryQuery("");
      setQAFavoriteOnly(false);
      setQAUpperTab("history");
      setMobileAssistantView("ask");
      setQAPanelError("");
      setHighlights([]);
      setKnowledgeLinks([]);
      setSelectionAnchor(null);
      setLayout(initialLayout);
      setActiveGroupId(ROOT_GROUP_ID);
      markDesktopPerformance("project-metadata-visible", { project_id: freshProject.id });
      void refreshQAContinuity(freshProject.id);

      // 阅读恢复只依赖学习位置和工作区数据，不等待模型、索引、历史或画像。
      const nextLearningStatesPromise = getLearningStates(freshProject.id).catch(() => []);
      const nextQARecordsPromise = listQARecords(freshProject.id).catch(() => []);
      void Promise.all([
        getLLMSettings().catch(() => null),
        getProjectIndexStatus(freshProject.id).catch(() => null),
        nextQARecordsPromise,
        getLearnerPreferences(freshProject.id).catch(() => null),
        mobileRuntime ? Promise.resolve([]) : listCallGuides(freshProject.id).catch(() => []),
      ]).then(([settings, nextIndexStatus, nextQARecords, nextPreferences, nextCallGuides]) => {
        if (currentProjectIdRef.current !== freshProject.id) return;
        setLLMSettings(settings);
        setTerminologyDensity(nextPreferences?.terminologyDensity ?? 0.5);
        bumpPersonalizationRevision();
        setIndexStatus(nextIndexStatus);
        setIndexBuilding(nextIndexStatus?.status === "building");
        setQAHistory(nextQARecords);
        replaceCallGuides(nextCallGuides);
        void refreshHighlights(freshProject.id);
        void refreshKnowledgeLinks(freshProject.id);
      });

      const restoreStartedAt = performance.now();
      void nextLearningStatesPromise.then(async (nextLearningStates) => {
        if (currentProjectIdRef.current !== freshProject.id) return;
        setLearningStates(nextLearningStates);
        const restored = await restoreStoredWorkbench(freshProject.id, nextCourses, nextTree);
        if (currentProjectIdRef.current !== freshProject.id) return;
        if (restored) {
          measureDesktopInteraction("project-document-restore", restoreStartedAt, {
            project_id: freshProject.id,
            source: "workbench",
          });
          return;
        }

        const recentDocument = await resolveRecentProjectDocument({
          projectId: freshProject.id,
          courses: nextCourses,
          learningStates: nextLearningStates,
          qaRecords: nextQARecordsPromise,
        });
        if (currentProjectIdRef.current !== freshProject.id) return;
        setFileContent(recentDocument.fileContent);
        setSelectedCourse(recentDocument.selectedCourse);
        setSelectedQA(recentDocument.selectedQA);
        setQASessionId(recentDocument.qaSessionId);
        if (recentDocument.item) {
          setLayout(updateGroup(initialLayout, ROOT_GROUP_ID, (group) => openItem(group, recentDocument.item!)));
        }
        if (recentDocument.termSource) {
          void refreshDocumentTerms(
            recentDocument.termSource.sourceType,
            recentDocument.termSource.sourcePath,
            freshProject.id,
          );
        }
        measureDesktopInteraction("project-document-restore", restoreStartedAt, {
          project_id: freshProject.id,
          source: recentDocument.source,
        });
      }).catch(() => {
        if (mobileRuntime && currentProjectIdRef.current === freshProject.id) {
          try { window.localStorage.removeItem(androidWorkbenchStorageKey(freshProject.id)); } catch { /* best-effort */ }
        }
      }).finally(() => {
        setRestoringWorkbenchProjectId((current) => current === freshProject.id ? null : current);
      });
      return finishOpenProject();
    } catch (caught) {
      setRestoringWorkbenchProjectId((current) => current === nextProject.id ? null : current);
      const msg = caught instanceof Error ? caught.message : "打开项目失败";
      if (/directory|路径|ENOENT/i.test(msg)) {
        setError("项目目录不存在或已被移动，请选择以下操作：");
      } else {
        setError(msg);
      }
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleImport(url: string) {
    if (rejectProjectMutationWhileQABusy() || rejectProjectMutationWhileGenerationBusy()) {
      return;
    }
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
    if (rejectProjectMutationWhileQABusy() || rejectProjectMutationWhileGenerationBusy()) {
      return;
    }
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

  function requestDataArchiveImport() {
    if (dataTransferBusy) {
      setToast("数据迁移正在进行，请稍候");
      return;
    }
    if (loading) {
      setToast("当前操作仍在处理，请稍候");
      return;
    }
    if (rejectProjectMutationWhileQABusy() || rejectProjectMutationWhileGenerationBusy()) return;
    dataArchiveInputRef.current?.click();
  }

  async function handleExportDataArchive() {
    if (dataTransferBusy) {
      setToast("数据迁移正在进行，请稍候");
      return;
    }
    if (loading) {
      setToast("当前操作仍在处理，请稍候");
      return;
    }
    if (rejectProjectMutationWhileQABusy() || rejectProjectMutationWhileGenerationBusy()) return;
    setDataTransferBusy(true);
    setLoading(true);
    setError("");
    setTaskMessage("正在整理 CodeCourse 数据包");
    try {
      await flushAllPendingLearningUpdates();
      const archive = await exportDataArchive();
      setTaskMessage("正在保存 CodeCourse 数据包");
      const saved = await saveDataArchive(archive.filename, archive.blob);
      if (!saved.saved) {
        setToast("已取消导出");
      } else if (mobileRuntime) {
        setToast(`数据包已保存到“文档/CodeCourse/${archive.filename}”`);
      } else {
        setToast(saved.location ? `数据包已导出到 ${saved.location}` : "数据包已导出");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出 CodeCourse 数据包失败");
    } finally {
      setDataTransferBusy(false);
      setLoading(false);
      setTaskMessage("");
    }
  }

  async function handleImportDataArchive(file: File) {
    try {
      if (dataTransferBusy) {
        setToast("数据迁移正在进行，请稍候");
        return;
      }
      if (loading) {
        setToast("当前操作仍在处理，请稍候");
        return;
      }
      if (rejectProjectMutationWhileQABusy() || rejectProjectMutationWhileGenerationBusy()) return;
      const confirmed = await confirmAction(
        "替换当前设备的 CodeCourse 数据",
        "导入后，数据包中的项目、源码、课件、问答、知识网络和学习记录将替换当前设备的全部 CodeCourse 数据。当前设备的 API Key 不会导出或被覆盖，代码索引会在需要时重建。此操作无法撤销。",
        { confirmText: "替换并导入", danger: true },
      );
      if (!confirmed) return;
      setDataTransferBusy(true);
      setLoading(true);
      setError("");
      setTaskMessage("正在校验并恢复 CodeCourse 数据");
      await flushAllPendingLearningUpdates();
      const result = await importDataArchive(file);
      try {
        window.sessionStorage.setItem(DATA_ARCHIVE_IMPORT_NOTICE_KEY, result.message);
      } catch {
        // Reload is still required even when session storage is unavailable.
      }
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入 CodeCourse 数据包失败");
    } finally {
      setDataTransferBusy(false);
      setLoading(false);
      setTaskMessage("");
      if (dataArchiveInputRef.current) dataArchiveInputRef.current.value = "";
    }
  }

  async function handleCreateLearningPlan(): Promise<boolean> {
    if (rejectProjectMutationWhileQABusy() || rejectProjectMutationWhileGenerationBusy()) {
      return false;
    }
    const name = await requestText({
      title: "新建学习计划",
      label: "学习计划名称",
      placeholder: "新的学习计划",
      confirmText: "创建",
    });
    if (!name?.trim()) {
      return false;
    }
    setLoading(true);
    setError("");
    try {
      const created = await createLearningPlan(name.trim());
      await loadProjects();
      return await openProject(created);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建学习计划失败");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateMobileLearningPlan() {
    const created = await handleCreateLearningPlan();
    if (!created) return;
    mobileWorkspaceSheetRef.current?.dismiss();
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
    if (rejectProjectMutationWhileQABusy() || rejectProjectMutationWhileGenerationBusy()) {
      return;
    }
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

  async function handleGenerateOutline(instructions: string) {
    if (!project) {
      return;
    }

    if (
      (
        isLearningPlanProject ||
        scopeType === "learning_plan"
      ) &&
      !instructions.trim()
    ) {
      setError("请先在生成要求中写明学习目标或知识点。");
      return;
    }

    if (
      !isLearningPlanProject &&
      scopeType === "files" &&
      selectedScopeFiles.length === 0
    ) {
      setError("请先选择至少一个学习文件。");

      if (mobileRuntime) {
        setMobileGenerationView("files");
      }

      return;
    }

    /*
     * 必须在确认框出现前取得同步锁。
     * 同一帧第二次点击会立即被 ref 拦截。
     */
    if (!acquireGenerationStart()) {
      return;
    }

    const projectId = project.id;
    const scope = buildScope();
    const instructionsText = instructions;

    handleDismissSelection();

    try {
      setError("");
      setTaskMessage("正在准备问卷");

      const preflight = await generateOutlinePreflight(projectId, scope, instructionsText);

      let answers: OutlineSurveyAnswer[] | null = [];
      if (preflight.status === "error") {
        // 问卷生成失败（例如未配置 API），直接回落为原有确认框，不阻塞总纲生成。
        answers = [];
      } else if (preflight.questions.length > 0) {
        answers = await openOutlineQuestionnaire(preflight);
      }

      setTaskMessage("正在创建总纲任务");
      const task = answers === null || preflight.status === "error"
        ? await generateOutline(projectId, scope, instructionsText, [])
        : await confirmOutlineAnswers(projectId, {
            preflight_id: preflight.preflight_id,
            answers,
            scope,
            instructions: instructionsText,
          });

      /*
       * 请求返回后立即写入任务列表，
       * 不等第一次轮询。
       */
      upsertCurrentGenerationTask(projectId, task);

      if (mobileRuntime) {
        setMobileGenerationView("tasks");
      } else {
        setGenerationOpen(false);
      }

      const nextScope = resetGenerationScope(isLearningPlanProject, scopeType);
      setScopeType(nextScope.scopeType);
      setSelectedScopeFiles(nextScope.selectedScopeFiles);

      void trackTask(projectId, task);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建总纲任务失败");
    } finally {
      releaseGenerationStart();
    }
  }

  async function openOutlineQuestionnaire(
    preflight: OutlinePreflight,
  ): Promise<OutlineSurveyAnswer[] | null> {
    setOutlinePreflight(preflight);
    setOutlinePreflightLoading(false);
    setOutlinePreflightError("");
    return new Promise((resolve) => {
      outlinePreflightResolveRef.current = resolve;
    });
  }

  function handleOutlineQuestionnaireAnswers(answers: OutlineSurveyAnswer[] | null) {
    const resolver = outlinePreflightResolveRef.current;
    outlinePreflightResolveRef.current = null;
    setOutlinePreflight(null);
    if (resolver) {
      resolver(answers);
    }
  }

  async function handleGenerateFileLesson(nextMode: "brief" | "detailed", instructions: string) {
    if (!project || !fileContent) {
      return;
    }
    if (!acquireGenerationStart()) {
      return;
    }
    handleDismissSelection();
    const label = nextMode === "brief" ? "粗略介绍" : "详细分析";
    // Backend `_safe_lesson_filename` publishes single-file lessons under
    // `files/`; the optimistic tab must use the same path or the
    // learning-state PUT fails with 404 "Learning source not found".
    let filename = "";
    try {
      const ok = await confirmAction(`生成${label}`, `将调用模型 API 为 ${fileContent.path} 生成${label}，可能消耗 token。是否继续？`, {
        confirmText: "生成", skipKey: "confirm.file_lesson",
      });
      if (!ok) {
        return;
      }
      setError("");

      if (mobileRuntime) {
        const projectId = project.id;
        const task = await generateFileLesson(projectId, fileContent.path, nextMode, instructions);
        upsertCurrentGenerationTask(projectId, task);
        setMobileGenerationView("tasks");
        void trackTask(projectId, task);
        return;
      }

      setGenerationOpen(false);
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      const pathParts = fileContent.path.split("/").filter(Boolean);
      const baseFileName = pathParts[pathParts.length - 1] ?? fileContent.path;
      const modeSuffix = nextMode === "brief" ? "_brief" : "_detailed";
      const safeName = baseFileName.replace(/[^a-zA-Z0-9_\-.]/g, "_");
      filename = `files/${safeName}${modeSuffix}.md`;

      setCourses((prev) => {
        if (prev.some((c) => c.filename === filename)) return prev;
        return [{ filename, title: "生成中…", group: "lessons" }, ...prev];
      });
      streamingContentRef.current.set(filename, "");
      streamingPathsRef.current.add(filename);

      openItemInGroup(activeGroupId, {
        id: `course:${filename}`,
        type: "course",
        path: filename,
        title: `${baseFileName} ${label}`,
        content: "",
      });
      setTaskMessage(`${label}生成中…`);

      const streamedFilename = await generateFileLessonStream(
        project.id,
        fileContent.path,
        nextMode,
        instructions,
        {
          onStage(_stage, nextLabel) { setTaskMessage(nextLabel); },
          onDelta(text) {
            const current = streamingContentRef.current.get(filename) ?? "";
            const updated = current + text;
            streamingContentRef.current.set(filename, updated);
            setLayout((previous) =>
              updateGroup(previous, activeGroupId, (group) => ({
                ...group,
                items: group.items.map((item) =>
                  item.id === `course:${filename}` ? { ...item, content: updated } : item,
                ),
              })),
            );
          },
          onCompleted({ cached }) {
            setTaskMessage(cached ? "已缓存，无需重新生成" : "生成完成");
            setToast("内容已生成");
            notifyTaskCompleted("CodeCourse 生成完成", `${baseFileName} ${label}已经可以阅读。`);
            streamingContentRef.current.delete(filename);
            streamingPathsRef.current.delete(filename);
          },
          onError(message) { throw new Error(message); },
        },
        abortControllerRef.current.signal,
      );
      if (streamedFilename) {
        await refreshCourses(project.id);
        await openCourseInActiveGroup(project.id, streamedFilename);
      }
    } catch (caught) {
      streamingPathsRef.current.delete(filename);
      if (caught instanceof Error && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "创建文件课件任务失败");
      /*
       * Generation failed: the backend deletes the placeholder file, so the
       * optimistic tab we opened would become a ghost course. Close it and
       * refresh the course list to drop it from the sidebar.
       */
      if (caught instanceof GenStreamError && caught.filename) {
        const itemId = `course:${caught.filename.replace(/\\/g, "/")}`;
        setLayout((previous) =>
          updateEveryGroup(previous, (group) =>
            group.items.some((item) => item.id === itemId)
              ? closeItem(group, itemId)
              : group,
          ),
        );
        void refreshCourses(project.id);
      }
    } finally {
      releaseGenerationStart();
    }
  }

  async function handleGenerateOutlineLesson(lessonNumber: number, title: string, instructions: string, outlinePath?: string) {
    if (!project) {
      return;
    }

    if (!acquireGenerationStart()) {
      return;
    }

    const projectId = project.id;

    handleDismissSelection();

    try {
      let evidenceSummary = "";
      if (!isLearningPlanProject) {
        setTaskMessage("正在检查课程代码证据");
        const preview = await previewOutlineLessonEvidence(projectId, lessonNumber, title, outlinePath);
        const warningCount = preview.read_failed.length + preview.budget_skipped.length;
        evidenceSummary = `将使用 ${preview.file_count} 个文件、${preview.snippet_count} 个代码片段。${
          warningCount > 0 ? `另有 ${warningCount} 个文件无法读取或因预算被跳过。` : ""
        }`;
      }
      const ok = await confirmAction(
        `生成第 ${lessonNumber} 课`,
        isLearningPlanProject
          ? `将分章节生成“${title}”的详细课件。本次操作最多调用 12 次模型 API，可能消耗较多 token；一次确认将授权完成整节课。是否继续？`
          : `${evidenceSummary}\n\n将调用模型 API 生成“${title}”的详细课件。是否继续？`,
        { confirmText: "生成", skipKey: "confirm.outline_lesson" },
      );

      if (!ok) {
        return;
      }

      setError("");
      setTaskMessage("正在创建课件任务");

      const task = outlinePath
        ? mobileRuntime
          ? await generateSubOutlineLesson(projectId, lessonNumber, title, instructions, outlinePath)
          : await generateOutlineLesson(projectId, lessonNumber, title, instructions, outlinePath)
        : await generateOutlineLesson(projectId, lessonNumber, title, instructions);

      upsertCurrentGenerationTask(projectId, task);

      if (mobileRuntime) {
        setMobileGenerationView("tasks");
      } else {
        setGenerationOpen(false);
      }

      const nextScope = resetGenerationScope(isLearningPlanProject, scopeType);
      setScopeType(nextScope.scopeType);
      setSelectedScopeFiles(nextScope.selectedScopeFiles);

      void trackTask(projectId, task);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建课件任务失败");
    } finally {
      releaseGenerationStart();
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
    if (project?.id === nextProject.id) {
      if (rejectProjectMutationWhileQABusy() || rejectProjectMutationWhileGenerationBusy()) {
        return;
      }
    }
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
    if (project?.id === nextProject.id) {
      if (rejectProjectMutationWhileQABusy() || rejectProjectMutationWhileGenerationBusy()) {
        return;
      }
    }
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
      if (window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY) === String(nextProject.id)) {
        window.localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
      }
      const remaining = await listProjects();
      setProjects(remaining);
      if (project?.id === nextProject.id) {
        setProject(null);

        currentProjectIdRef.current = null;
        resetGenerationTasks();
        clearRetryingTask();

        setTaskMessage("待生成");
        setMobileGenerationView("configure");
        setGenerationOpen(false);

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
        setQAHistory([]);
        setQAThreads([]);
        setQAContinuity(null);
        setHighlights([]);
        setKnowledgeLinks([]);
        setLearningStates([]);
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
    // Keep Android's native selection handles alive until the learner decides
    // to ask. Switching surfaces here collapses the initial text selection.
    if (!mobileRuntime && nextText.trim()) {
      openAssistant("history");
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
      anchorRect: nextSelection.anchorRect,
    });
  }

  function handleNewConversation() {
    setSelectedQA(null);
    setQASessionId(null);
    setQASessionTree([]);
    setLearningAnchor(null);
    clearQAQuestionInput();
    setQAUpperTab("history");
    setMobileAssistantView("ask");
    startNewQADraft();
  }

  async function handleResumeContinuity(handoff: TeachingHandoff) {
    if (!project || handoff.projectId !== project.id) return;
    try {
      const record = qaHistory.find((item) => item.id === handoff.qaRecordId)
        ?? await getQARecord(project.id, handoff.qaRecordId);
      setSelectedQA(record);
      setQASessionId(record.session_id ?? handoff.sessionId ?? null);
      clearQAQuestionInput();
      openAssistant("history");
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "无法继续上次学习");
    }
  }

  async function handleOpenContinuitySource(
    handoff: TeachingHandoff,
    action?: TeachingNextAction,
  ) {
    if (!project || handoff.projectId !== project.id) return;
    const sourceType = action?.sourceType || handoff.sourceType;
    const sourcePath = action?.sourcePath || handoff.sourcePath;
    try {
      if (sourceType === "course" && sourcePath) {
        await openCourseInActiveGroup(project.id, sourcePath);
      } else if (sourceType === "file" && sourcePath) {
        await openFileInActiveGroup(project.id, sourcePath);
      } else if (sourceType === "qa") {
        const numericId = Number(sourcePath);
        const linked = sourcePath
          ? qaHistory.find((record) => record.output_path === sourcePath || String(record.id) === sourcePath)
          : null;
        await openQAById(linked?.id || (Number.isInteger(numericId) && numericId > 0 ? numericId : handoff.qaRecordId));
      }
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "打开关联内容失败");
    }
  }

  async function handleDismissContinuity(handoff: TeachingHandoff) {
    if (!project || handoff.projectId !== project.id) return;
    try {
      await dismissQAContinuity(project.id);
      await refreshQAContinuity(project.id);
      setToast("已结束当前学习主题");
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "结束学习主题失败");
    }
  }

  function handleTeachingNextAction(action: TeachingNextAction, handoff: TeachingHandoff) {
    if (action.kind === "follow_up") {
      const prompt = action.prompt?.trim() || action.label;
      setQAQuestionInput(prompt);
      setQaResetToken((token) => token + 1);
      openAssistant("history");
      return;
    }
    if (action.kind === "open_source") {
      void handleOpenContinuitySource(handoff, action);
      return;
    }
    if (action.kind === "review") {
      void openQAById(handoff.qaRecordId).catch((caught) => {
        setQAPanelError(caught instanceof Error ? caught.message : "打开回答失败");
      });
    }
  }

  async function generateTermExplanation(term: DocumentTerm) {
    if (!project) {
      return;
    }

    const operationToken =
      acquireQAOperation();

    if (!operationToken) {
      return;
    }

    try {
      if (
        term.status ===
          "linked" &&
        term.qa_record_id
      ) {
        const record =
          qaHistory.find(
            (entry) =>
              entry.id ===
              term.qa_record_id,
          ) ??
          await getQARecord(
            project.id,
            term.qa_record_id,
          );

        setSelectedQA(record);

        setQASessionId(
          record.session_id ??
            null,
        );

        setQAUpperTab(
          "history",
        );

        openAssistant(
          "history",
        );

        return;
      }

      if (term.concept_id) {
        try {
          const reusable =
            await getReusableConceptExplanation(
              project.id,
              term.concept_id,
            );

          if (
            reusable.explanation
          ) {
            const {
              projectId:
                sourceProjectId,

              qa: record,
            } =
              reusable.explanation;

            setSelectedQA(record);

            setQASessionId(
              record.session_id ??
                null,
            );

            setQAUpperTab(
              "history",
            );

            openAssistant(
              "history",
            );

            if (
              sourceProjectId !==
              project.id
            ) {
              setToast(
                "已复用其他项目中的此前解释；当前为只读",
              );
            }

            return;
          }
        } catch {
          /*
           * 旧复用链接失效时，
           * 继续生成新回答。
           */
        }
      }

      if (
        !llmSettings?.enabled ||
        !llmSettings.has_api_key
      ) {
        setQAPanelError(
          "请先配置模型 API。",
        );

        openSettings();

        return;
      }

      const parent =
        term.source_type === "qa"
          ? (
              qaHistory.find(
                (record) =>
                  (
                    record.output_path ||
                    String(record.id)
                  ) ===
                  term.source_path,
              ) ??
              selectedQA
            )
          : null;

      const ok =
        await confirmAction(
          "生成术语解释",

          `将调用 ` +
            `${llmSettings.model}，` +
            `结合当前项目解释` +
            `"${term.term_text}"，` +
            `并把回答连接到` +
            `${
              parent
                ? `"${qaTitle(
                    parent,
                  )}"`
                : "当前课件"
            }。是否继续？`,

          {
            confirmText:
              "生成解释",

            skipKey:
              "confirm.term",
          },
        );

      if (!ok) {
        return;
      }

      setQAPanelError("");

      openAssistant(
        "history",
      );

      const generationKey =
        parent?.session_id
          ? `session:${parent.session_id}`
          : activeQAKey;

      const record =
        await runStreamingQuestion(
          {
            source_type:
              term.source_type,

            source_path:
              term.source_path,

            selected_text:
              term.term_text,

            question:
              `请结合当前项目解释` +
              `"${term.term_text}"：` +
              `它是什么、为什么会出现在这里，` +
              `以及接下来应该看哪里。` +
              `讲解深度由本轮 learner_context ` +
              `和我的当前要求决定。`,

            provider:
              llmSettings.provider,

            base_url:
              llmSettings.base_url,

            model:
              llmSettings.model,

            session_id:
              parent?.session_id ??
              qaSessionId,

            parent_qa_id:
              parent?.id ?? null,

            relation_type:
              "term_explanation",

            term_candidate_id:
              term.id,
          },

          generationKey,
          operationToken,
        );

      setSelectedQA(record);

      setQASessionId(
        record.session_id ??
          null,
      );

      setQAHistory(
        (items) => [
          record,

          ...items.filter(
            (item) =>
              item.id !==
              record.id,
          ),
        ],
      );

      await Promise.all([
        refreshCourses(
          project.id,
        ),

        refreshQAHistory(
          project.id,
        ),

        refreshKnowledgeLinks(
          project.id,
        ),

        refreshDocumentTerms(
          term.source_type,
          term.source_path,
          project.id,
        ).catch(
          () => undefined,
        ),
      ]);

      setKnowledgeRefreshKey(
        (value) =>
          value + 1,
      );

      schedulePersonalizationRefresh();
    } catch (caught) {
      setQAPanelError(
        caught instanceof Error
          ? caught.message
          : "术语解释处理失败",
      );
    } finally {
      endQAOperation(
        operationToken,
      );
    }
  }

  function handleGenerateTerm(term: DocumentTerm, position?: { x: number; y: number }) {
    if (term.status === "linked") {
      void generateTermExplanation(term);
      return;
    }
    if (project) {
      void recordTermImpressions(project.id, [{
        concept_id: term.concept_id ?? null,
        source_type: term.source_type,
        source_path: term.source_path,
        term_text: term.term_text,
        content_hash: term.content_hash ?? "",
        opened: true,
        display_style: "subtle",
      }]).catch(() => undefined);
    }
    void generateTermExplanation(term);
  }

  function handleTermAction(term: DocumentTerm, position?: { x: number; y: number }) {
    setTermAction({ term, position });
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

  async function handleOpenQAReference(referenceProjectId: number, qaRecordId: number) {
    try {
      const record = await getQARecord(referenceProjectId, qaRecordId);
      setSelectedQA(record);
      setQASessionId(record.session_id ?? null);
      setQAUpperTab("history");
      openAssistant("history");
      if (referenceProjectId !== project?.id) {
        setToast("已在当前侧栏只读打开其他项目中的此前解释");
      }
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "此前解释已不存在");
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
  }

  function handleClearSelection() {
    handleSelectionTextChange("");
  }

  function handleDismissSelection() {
    setSelection(null);
    setSelectionAnchor(null);
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
      setSelectedQA((current) => current?.id === updated.id ? updated : current);
      setQAHistory((items) => items.map((entry) => (entry.id === updated.id ? updated : entry)));
      updateOpenQARecord(updated);
      await refreshQAHistory(project.id);
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

  async function handleToggleHighlight(sourceType: "course" | "qa", sourcePath: string, selectedText: string) {
    if (!project || !sourcePath || !selectedText.trim()) {
      return;
    }
    const normalizedText = selectedText.trim();
    const matching = highlightsRef.current.filter((highlight) =>
      highlight.source_type === sourceType
      && highlight.source_path === sourcePath
      && highlight.selected_text.trim() === normalizedText,
    );
    if (matching.length === 0) {
      await handleCreateHighlight(sourceType, sourcePath, normalizedText);
      setToast("已添加高亮");
      return;
    }
    try {
      await Promise.all(matching.map((highlight) => deleteHighlight(project.id, highlight.id)));
      const deletedIds = new Set(matching.map((highlight) => highlight.id));
      setHighlights((items) => items.filter((highlight) => !deletedIds.has(highlight.id)));
      setQAPanelError("");
      setToast("已取消高亮");
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "取消高亮失败");
    }
  }

  async function handleTermMastery(term: DocumentTerm, status: "known" | "unknown") {
    if (!project) return;
    try {
      if (term.concept_id) {
        const key = `term-${status}:${project.id}:${term.concept_id}:${Date.now()}`;
        if (status === "known") await markConceptKnown(project.id, term.concept_id, key, term.term_text);
        else await markConceptUnknown(project.id, term.concept_id, key, term.term_text);
      }
      if (status === "known") {
        await markDocumentTermKnown(project.id, term.id);
      }
      void recordTermImpressions(project.id, [{
        concept_id: term.concept_id ?? null,
        source_type: term.source_type,
        source_path: term.source_path,
        term_text: term.term_text,
        content_hash: term.content_hash ?? "",
        feedback: status,
      }]).catch(() => undefined);
      await refreshDocumentTerms(term.source_type, term.source_path, project.id);
      setTermAction(null);
      setToast(status === "known" ? `已记住你认识"${term.term_text}"` : `后续会先解释"${term.term_text}"`);
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "术语状态更新失败");
    }
  }

  async function handleDismissTerm(term: DocumentTerm) {
    if (!project) return;
    try {
      await dismissDocumentTerm(project.id, term.id);
      void recordTermImpressions(project.id, [{
        concept_id: term.concept_id ?? null,
        source_type: term.source_type,
        source_path: term.source_path,
        term_text: term.term_text,
        content_hash: term.content_hash ?? "",
        feedback: "dismissed",
      }]).catch(() => undefined);
      await refreshDocumentTerms(term.source_type, term.source_path, project.id);
      setTermAction(null);
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "忽略术语失败");
    }
  }

  async function handleExplainSelectedTerm(anchor = selectionAnchor) {
    if (
      !project ||
      !anchor
        ?.selectedText
        .trim()
    ) {
      return;
    }

    if (
      !llmSettings?.enabled ||
      !llmSettings.has_api_key
    ) {
      setQAPanelError(
        "请先配置模型 API。",
      );

      openSettings();

      return;
    }

    const operationToken =
      acquireQAOperation();

    if (!operationToken) {
      return;
    }

    const term =
      anchor.selectedText
        .trim();

    try {
      try {
        const resolved =
          await resolvePersonalizationTerms(
            project.id,
            [
              {
                text:
                  term.slice(
                    0,
                    80,
                  ),

                source:
                  anchor.sourceType ===
                  "file"
                    ? "index"
                    : "selection",

                confidence:
                  0.95,

                context_relevance:
                  1,
              },
            ],
          );

        const conceptId =
          resolved
            .terms[0]
            ?.concept.id;

        if (conceptId) {
          const reusable =
            await getReusableConceptExplanation(
              project.id,
             conceptId,
            );

          if (
            reusable.explanation
          ) {
            await handleOpenQAReference(
              reusable
                .explanation
                .projectId,

              reusable
                .explanation
                .qa.id,
            );

            handleDismissSelection();

            return;
          }
        }
      } catch {
        /*
         * 复用检查失败不能阻止生成。
         */
      }

      const ok =
        await confirmAction(
          "解释术语",

          `将调用 ` +
            `${llmSettings.model}，` +
            `结合当前项目和文档解释` +
            `"${term}"。是否继续？`,

          {
            confirmText:
              "生成解释",

            skipKey:
              "confirm.term-selection",
          },
        );

      if (!ok) {
        return;
      }

      const generationKey =
        activeQAKey;

      const record =
        await runStreamingQuestion(
          {
            source_type:
              anchor.sourceType,

            source_path:
              anchor.sourcePath,

            selected_text:
              term,

            question:
              `请解释"${term}"：` +
              `先用通俗语言说明它是什么，` +
              `再说明它在当前上下文中的作用，` +
              `并给出下一步学习建议。`,

            provider:
              llmSettings.provider,

            base_url:
              llmSettings.base_url,

            model:
              llmSettings.model,

            session_id:
              qaSessionId,

            parent_qa_id:
              selectedQA?.id ??
              null,

            relation_type:
              "term_explanation",

            selection_range:
              anchor.range
                ? {
                    start_line:
                      anchor.range
                        .startLineNumber,

                    start_column:
                      anchor.range
                        .startColumn,

                    end_line:
                      anchor.range
                        .endLineNumber,

                    end_column:
                      anchor.range
                        .endColumn,
                  }
                : null,
          },

          generationKey,
          operationToken,
        );

      setSelectedQA(record);

      setQASessionId(
        record.session_id ??
          qaSessionId,
      );

      setQAHistory(
        (items) => [
          record,

          ...items.filter(
            (item) =>
              item.id !==
              record.id,
          ),
        ],
      );

      await Promise.all([
        refreshCourses(
          project.id,
        ),

        refreshQAHistory(
          project.id,
        ),

        refreshKnowledgeLinks(
          project.id,
        ),
      ]);

      setKnowledgeRefreshKey(
        (value) =>
          value + 1,
      );

      openAssistant(
        "history",
      );
    } catch (caught) {
      setQAPanelError(
        caught instanceof Error
          ? caught.message
          : "术语解释处理失败",
      );
    } finally {
      endQAOperation(
        operationToken,
      );
    }
  }

  async function handleMarkSelectedTermKnown(anchor = selectionAnchor) {
    if (!project || !anchor?.selectedText.trim()) return;
    const text = anchor.selectedText.trim().slice(0, 80);
    try {
      const matchingTerm = activeTermRawTerms.find(
        (term) => term.term_text.trim().toLocaleLowerCase() === text.toLocaleLowerCase(),
      );
      if (matchingTerm) {
        await handleTermMastery(matchingTerm, "known");
      } else {
        const resolved = await resolvePersonalizationTerms(project.id, [{
          text,
          source: anchor.sourceType === "file" ? "index" : "selection",
          confidence: 1,
          context_relevance: 1,
        }]);
        const conceptId = resolved.terms[0]?.concept.id;
        if (!conceptId) throw new Error("无法识别这个术语");
        await markConceptKnown(
          project.id,
          conceptId,
          `selection-known:${project.id}:${conceptId}:${Date.now()}`,
          text,
        );
        bumpPersonalizationRevision();
        setToast(`已记住你认识"${text}"`);
      }
      handleDismissSelection();
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "更新术语状态失败");
    }
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
        setQASessionId(null);
        setQASessionTree([]);
        setLearningAnchor(null);
        clearQAQuestionInput();
        setMobileAssistantView("history");
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
      await refreshQAContinuity(project.id);
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
      await refreshQAContinuity(project.id);
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

  async function handleRenameCourse(file: CourseFile) {
    if (!project) return;
    if (generationBusy || qaInteractionBusy || isTaskRunning) {
      setToast("当前有内容正在生成，请完成后再重命名");
      return;
    }
    const requestedName = await requestText({
      title: "重命名课件",
      message: "输入容易辨认的文件名；系统会自动保留 .md 扩展名，并同步知识网络等引用。",
      label: "文件名",
      initialValue: file.title,
      confirmText: "保存",
    });
    if (requestedName === null || requestedName.trim() === "") return;

    flushPendingLearningUpdate("course", file.filename);
    flushPendingLearningUpdate("qa", file.filename);
    setError("");
    try {
      const renamed = await renameCourseFile(project.id, file.filename, requestedName);
      const oldItemId = `course:${file.filename}`;
      const newItemId = `course:${renamed.filename}`;
      setLayout((previous) => updateEveryGroup(previous, (group) => ({
        ...group,
        items: group.items.map((item) => (item.type === "course" || item.type === "qa") && item.path === file.filename
          ? { ...item, id: item.type === "course" ? newItemId : item.id, path: renamed.filename, title: renamed.title }
          : item),
        activeItemId: group.activeItemId === oldItemId ? newItemId : group.activeItemId,
      })));
      setSelectedCourse((current) => current === file.filename ? renamed.filename : current);
      setQAHistory((items) => items.map((record) => ({
        ...record,
        source_path: record.source_type === "course" && record.source_path === file.filename ? renamed.filename : record.source_path,
        output_path: record.output_path === file.filename ? renamed.filename : record.output_path,
      })));
      setSelectedQA((record) => record ? {
        ...record,
        source_path: record.source_type === "course" && record.source_path === file.filename ? renamed.filename : record.source_path,
        output_path: record.output_path === file.filename ? renamed.filename : record.output_path,
        display_title: record.output_path === file.filename ? renamed.title : record.display_title,
        teaching_handoff: record.teaching_handoff?.sourceType === "course" && record.teaching_handoff.sourcePath === file.filename
          ? { ...record.teaching_handoff, sourcePath: renamed.filename }
          : record.teaching_handoff,
      } : record);
      setQASessionTree((items) => items.map((record) => ({
        ...record,
        source_path: record.source_type === "course" && record.source_path === file.filename ? renamed.filename : record.source_path,
        output_path: record.output_path === file.filename ? renamed.filename : record.output_path,
        display_title: record.output_path === file.filename ? renamed.title : record.display_title,
      })));
      await Promise.all([
        refreshCourses(project.id),
        getLearningStates(project.id).then(setLearningStates),
        refreshHighlights(project.id),
        refreshKnowledgeLinks(project.id),
        refreshQAHistory(project.id),
        refreshQAContinuity(project.id),
      ]);
      setKnowledgeRefreshKey((value) => value + 1);
      setToast(`已重命名为“${renamed.title}”`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重命名课件失败");
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
      setSelectedQA((current) => current?.id === updated.id ? updated : current);
      setQAHistory((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      updateOpenQARecord(updated);
      await refreshQAHistory(project.id);
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "切换收藏失败");
    }
  }

  async function handleGroupDrop(event: DragEvent<HTMLElement>, groupId: string) {
    event.preventDefault();
    event.stopPropagation();
    const zone = detectDropZone(event);
    clearDropPreview();
    if (!project) {
      return;
    }
    const raw = event.dataTransfer.getData("application/codecourse-item");
    if (!raw) {
      return;
    }
    try {
      const payload = JSON.parse(raw) as DropPayload;
      event.dataTransfer.dropEffect = payload.kind === "tab" ? "move" : "copy";
      const existingItemId = dropPayloadItemId(payload);
      const existingItem = existingItemId
        ? payload.kind === "tab" && payload.sourceGroupId
          ? findGroup(layout, payload.sourceGroupId)?.items.find((entry) => entry.id === existingItemId) ?? null
          : findOpenItem(layout, existingItemId)
        : null;
      // Two frames guarantee the cleared overlay is painted before a new
      // Monaco/Markdown tree starts mounting.
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      });
      const item = existingItem ? { ...existingItem } : await resolveDropItem(payload);
      if (!item) {
        return;
      }
      if (payload.kind === "tab") {
        moveTabToGroup(payload, groupId, zone, item);
        return;
      }
      if (zone === "center") {
        deferEditorMount(groupId, item.id);
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

  async function saveEditedCourseItem(group: EditorGroup, item: OpenItem) {
    if (!project || item.type !== "course") return;
    let recordId = item.qaRecordId;
    if (!recordId) {
      const matchingRecord = qaHistory.find((record) => (
        _normalizeOutputPath(record.output_path, record.id, project.id) === item.path
      ));
      recordId = matchingRecord?.id;
    }
    if (!recordId) {
      setError("找不到当前文档对应的问答记录");
      return;
    }
    try {
      const record = qaHistory.find((entry) => entry.id === recordId);
      if (!record) {
        setError("找不到当前文档对应的问答记录");
        return;
      }
      const updated = await updateQARecord(project.id, recordId, { answer_md: item.content });
      setQAHistory((items) => items.map((entry) => entry.id === updated.id ? updated : entry));
      if (selectedQA?.id === updated.id) setSelectedQA(updated);
      setLayout((previous) => updateGroup(previous, group.id, (currentGroup) => ({
        ...currentGroup,
        items: currentGroup.items.map((entry) => (
          entry.id === item.id ? { ...entry, content: updated.answer_md, dirty: false } : entry
        )),
      })));
      try {
        const fresh = await getCourseContent(project.id, item.path);
        setLayout((previous) => updateGroup(previous, group.id, (currentGroup) => ({
          ...currentGroup,
          items: currentGroup.items.map((entry) => (
            entry.id === item.id ? { ...entry, content: fresh.content, dirty: false } : entry
          )),
        })));
      } catch {
        // The answer was saved; keep the local confirmed content if reloading fails.
      }
      setEditingCourseItemId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    }
  }

  async function cancelEditedCourseItem(group: EditorGroup, item: OpenItem) {
    if (!project || item.type !== "course") return;
    if (!item.dirty) {
      setEditingCourseItemId(null);
      return;
    }
    try {
      const fresh = await getCourseContent(project.id, item.path);
      setLayout((previous) => updateGroup(previous, group.id, (currentGroup) => ({
        ...currentGroup,
        items: currentGroup.items.map((entry) => (
          entry.id === item.id ? { ...entry, content: fresh.content, dirty: false } : entry
        )),
      })));
      setEditingCourseItemId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法恢复文档原内容");
    }
  }

  function updateQAWorkspaceSelection(item: OpenItem, selectedText: string | null) {
    if (!selectedText) {
      setQAHighlightDraft(null);
      if (selectionAnchor?.sourcePath === item.path) {
        setSelection(null);
        setSelectionAnchor(null);
      }
      return;
    }
    setQAHighlightDraft({ sourcePath: item.path, selectedText });
    const nextSelection = {
      sourceType: "selection",
      sourcePath: item.path,
      selectedText,
    } as SelectionSummary;
    setSelection(nextSelection);
    setSelectionAnchor(nextSelection);
  }

  function renderGroup(group: EditorGroup) {
    const activeItem = group.items.find((item) => item.id === group.activeItemId) ?? null;
    const editorMountDeferred = activeItem ? deferredEditorMounts.has(`${group.id}:${activeItem.id}`) : false;
    return (
      <WorkbenchEditorGroup
        key={group.id}
        group={group}
        activeGroupId={activeGroupId}
        mobile={mobileRuntime}
        projectId={project?.id ?? null}
        courses={courses}
        editingCourseItemId={editingCourseItemId}
        editorMountDeferred={editorMountDeferred}
        workspaceMenuOpen={workspaceMenuGroupId === group.id}
        canUndoLayout={layoutHistoryRef.current.length > 0}
        canManageGroups={countGroups(layout) > 1}
        mobileCodeSearchRequestId={mobileCodeSearchRequestId}
        activeTermSourceKey={activeTermSource ? `${activeTermSource.sourceType}:${activeTermSource.sourcePath}` : ""}
        highlights={highlights}
        knowledgeLinks={knowledgeLinks}
        documentTerms={activeTermRawTerms}
        visibleTermCandidateIds={termDisplay.visibleCandidateIds}
        termDisplayTiers={termDisplay.tiersByCandidateId}
        selectionAnchor={selectionAnchor}
        qaHighlightDraft={qaHighlightDraft}
        callGuides={callGuides}
        callGuideBusyId={callGuideBusyId}
        knowledgeRefreshKey={knowledgeRefreshKey}
        learningStates={learningStates}
        knowledgeFocusRef={(() => {
          const item = getActiveOpenItem();
          if (item && item.type !== "knowledge_graph") {
            if (item.qaRecordId) return { ref_type: "qa", ref_id: item.qaRecordId };
            if (item.type === "course") return { ref_type: "course", ref_path: item.path };
            if (item.type === "file") return { ref_type: "file", ref_path: item.path };
          }
          return selectedQA ? { ref_type: "qa", ref_id: selectedQA.id } : null;
        })()}
        isOutlineCourse={(path) => courses.some((course) => (
          course.filename === path
          && (course.is_outline || course.filename === "outline.md" || course.filename.startsWith("sub-outline-"))
        ))}
        onActivatePane={() => {
          setActiveGroupId(group.id);
          if (workspaceMenuGroupId) setWorkspaceMenuGroupId(null);
        }}
        onActivateItem={(item) => activateItem(group.id, item)}
        onCloseItem={(itemId) => closeItemInGroup(group.id, itemId)}
        onTabDragEnd={(event, item) => { clearDropPreview(); void handleTabDragEnd(event, group.id, item); }}
        onToggleWorkspaceMenu={() => setWorkspaceMenuGroupId((current) => current === group.id ? null : group.id)}
        onUndoLayout={undoWorkspaceLayout}
        onEqualize={equalizeWorkspaceLayout}
        onMergeGroups={() => mergeWorkspaceGroups(group.id)}
        onCloseGroup={() => closeWorkspaceGroup(group.id)}
        onMobileCodeSearch={() => setMobileCodeSearchRequestId((current) => current + 1)}
        onOpenCourse={(path) => { if (project) void openCourseInActiveGroup(project.id, path); }}
        onToggleLessonComplete={(path) => { void toggleLessonComplete(path); }}
        onSetEditingCourse={setEditingCourseItemId}
        onSaveEditedCourse={(targetGroup, item) => { void saveEditedCourseItem(targetGroup, item); }}
        onCancelEditedCourse={(targetGroup, item) => { void cancelEditedCourseItem(targetGroup, item); }}
        onUpdateItemContent={updateQAItemContent}
        onSelectionChange={handleSelection}
        onQASelectionChange={updateQAWorkspaceSelection}
        onCodeJumpConsumed={(itemId, requestId) => {
          setLayout((current) => updateEveryGroup(current, (editorGroup) => ({
            ...editorGroup,
            items: editorGroup.items.map((item) => (
              item.id === itemId && item.jumpRequest?.id === requestId
                ? { ...item, jumpRequest: undefined }
                : item
            )),
          })));
        }}
        onLearningPosition={(sourceType, path, positionKind, value) => queueLearningUpdate(sourceType, path, positionKind, value)}
        onToggleFavorite={(item) => { void handleToggleFavorite(item); }}
        onCreateHighlight={(sourceType, sourcePath, selectedText) => { void handleCreateHighlight(sourceType, sourcePath, selectedText); }}
        onSaveQA={(groupId, item) => { void handleSaveQAItem(groupId, item); }}
        onPersonalizationChanged={bumpPersonalizationRevision}
        onOpenKnowledgeLink={(term, links) => { void handleOpenKnowledgeLink(term, links); }}
        onOpenQAReference={(referenceProjectId, qaRecordId) => { void handleOpenQAReference(referenceProjectId, qaRecordId); }}
        onGenerateTerm={handleGenerateTerm}
        onTermAction={handleTermAction}
        onGenerateLesson={(lessonNumber, title, outlinePath) => { void handleGenerateOutlineLesson(lessonNumber, title, generationInstructions, outlinePath); }}
        onCallGuideSelection={(guide, nodeId, visitedNodeIds) => { void handleCallGuideSelection(guide, nodeId, visitedNodeIds); }}
        onOpenCallGuideSource={(node) => { if (project) void openFileInActiveGroup(project.id, node.path, node.start_line); }}
        onExplainCallGuide={(guide, node, routeNodeIds) => { void handleExplainCallGuide(guide, node, routeNodeIds); }}
        onRefreshCallGuide={(guide) => { void handleRefreshCallGuide(guide); }}
        onDeleteCallGuide={(guide) => { void handleDeleteCallGuide(guide); }}
        onRequestText={requestText}
        onConfirm={confirmAction}
        onKnowledgeContentChanged={() => {
          if (!project) return;
          void Promise.all([refreshCourses(project.id), refreshQAHistory(project.id)]);
        }}
        onKnowledgeGraphChanged={() => setKnowledgeRefreshKey((value) => value + 1)}
        onOpenKnowledgeQA={(qaId) => { void openQAById(qaId).catch((caught) => setError(caught instanceof Error ? caught.message : "打开回答失败")); }}
        onOpenKnowledgeCourse={(path) => { if (project) void openCourseInActiveGroup(project.id, path).catch((caught) => setError(caught instanceof Error ? caught.message : "打开课件失败")); }}
        onOpenKnowledgeFile={(path) => { if (project) void openFileInActiveGroup(project.id, path).catch((caught) => setError(caught instanceof Error ? caught.message : "打开文件失败")); }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const previousZone = dropPreviewRef.current?.groupId === group.id
            ? dropPreviewRef.current.zone
            : undefined;
          const zone = detectDropZone(event, previousZone);
          showDropPreview(event.currentTarget, group.id, zone);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            if (dropPreviewRef.current?.groupId === group.id) clearDropPreview();
          }
        }}
        onDrop={(event) => handleGroupDrop(event, group.id)}
      />
    );
  }

  async function handleResetLearningProgress() {
    if (!project) return;
    const confirmed = await confirmAction("重置学习进度", "将清除课程完成状态和阅读位置。课程文件不会被删除。", { confirmText: "重置", danger: true });
    if (!confirmed) return;
    await resetLearningProgress();
    setTaskMessage("学习进度已重置");
    setToast("学习进度已重置");
  }

  async function handleCheckUpdates() {
    try {
      if (!mobileRuntime && window.codecourseDesktop?.checkForUpdates) {
        const result = await window.codecourseDesktop.checkForUpdates();
        if (result.status === "development") setToast(`开发版本 ${result.version}`);
        else setToast("正在检查更新");
        return;
      }
      const response = await fetch("https://api.github.com/repos/XY-729/CodeCourse/releases/latest", {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) throw new Error(`GitHub ${response.status}`);
      const release = await response.json() as { tag_name?: string; html_url?: string };
      const latest = String(release.tag_name || "").replace(/^v/i, "");
      if (!latest || latest === __CODECOURSE_VERSION__) {
        setToast(`当前已是最新版本 ${__CODECOURSE_VERSION__}`);
        return;
      }
      setToast(`发现新版本 ${latest}`);
      openExternal(release.html_url || "https://github.com/XY-729/CodeCourse/releases/latest");
    } catch (caught) {
      setError(caught instanceof Error ? `检查更新失败：${caught.message}` : "检查更新失败");
    }
  }

  async function handleOpenDiagnostics() {
    if (!mobileRuntime && window.codecourseDesktop?.openLogs) {
      await window.codecourseDesktop.openLogs();
      return;
    }
    const summary = {
      app: "CodeCourse",
      version: __CODECOURSE_VERSION__,
      platform: mobileRuntime ? "android" : "web",
      projectId: project?.id ?? null,
      projectType: project?.project_type ?? null,
      indexStatus: indexStatus?.status ?? null,
      modelEnabled: Boolean(llmSettings?.enabled && llmSettings.has_api_key),
      lastError: error || qaPanelError || null,
      generatedAt: new Date().toISOString(),
    };
    await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
    setToast("诊断摘要已复制，不包含 API Key");
  }

  const activeOpenItem = getActiveOpenItem();
  activeOpenItemRef.current = activeOpenItem;

  const mobilePrimaryDestination: MobilePrimaryDestination = (() => {
    if (mobileWorkspaceTab === "courses") return "learn";
    if (mobileWorkspaceTab === "files") return "source";
    if (mobileWorkspaceTab === "assistant") return "ask";
    if (mobileWorkspaceTab === "me") return "me";
    if (learnerProfileOpen || settingsOpen || promptEditorOpen) return "me";
    if (activeOpenItem?.type === "file") return "source";
    if (activeOpenItem?.type === "qa" || activeOpenItem?.qaRecordId) return "ask";
    return "learn";
  })();

  const assistantContextSummary = useMemo(
    () => buildAssistantContextSummary(),
    [project, layout, activeGroupId],
  );
  const activeLessonMatch = activeOpenItem?.type === "course" ? activeOpenItem.path.match(/^lessons\/lesson_(\d+)\.md$/i) : null;
  const activeLessonNumber = activeLessonMatch ? Number(activeLessonMatch[1]) : null;
  const activeLessonTitle = activeOpenItem && activeLessonNumber
    ? courses.find((item) => item.filename === activeOpenItem.path)?.title
      ?? titleFromMarkdown(activeOpenItem.path, activeOpenItem.content ?? "")
    : "";
  const { lessonFilesForProgress, completedLessonCount } = useMemo(() => {
    const lessonFiles = courses.filter((item) => isLessonPath(item.filename));
    const completedPaths = new Set(
      learningStates
        .filter((state) => state.source_type === "course" && state.status === "completed")
        .map((state) => state.source_path),
    );
    return {
      lessonFilesForProgress: lessonFiles,
      completedLessonCount: lessonFiles.filter((item) => completedPaths.has(item.filename)).length,
    };
  }, [courses, learningStates]);
  const progressLabel = lessonFilesForProgress.length ? `${completedLessonCount}/${lessonFilesForProgress.length} 课已完成` : undefined;

  const generationValidationMessage =
    !project
      ? "请先选择项目"
      : generationBusy
        ? "当前已有内容正在生成"
        : generationIntent === "outline" && (isLearningPlanProject || scopeType === "learning_plan") && !generationInstructions.trim()
          ? "请先填写学习目标或知识范围"
          : generationIntent === "outline" && !isLearningPlanProject && scopeType === "files" && selectedScopeFiles.length === 0
            ? "请至少选择一个学习文件"
            : generationIntent === "lesson" && !activeLessonNumber
              ? "请先打开需要生成的课程"
              : (generationIntent === "brief" || generationIntent === "detailed") && !fileContent
                ? "请先打开需要分析的源码文件"
                : "";

  const canStartGeneration = Boolean(project) && !generationValidationMessage;
  const activeDocumentTitle = activeOpenItem?.title ?? (project ? "学习工作台" : "CodeCourse");
  const commandFiles = useMemo(
    () => flattenTree(tree).filter((entry) => entry.type === "file"),
    [tree],
  );
  const commandItems = useCommandPaletteItems({
    open: commandPaletteOpen,
    mobile: mobileRuntime,
    projectAvailable: Boolean(project),
    learningPlan: isLearningPlanProject,
    hasLearningProgress: learningStates.length > 0,
    version: __CODECOURSE_VERSION__,
    courses,
    files: commandFiles,
    qaHistory,
    callGuides,
    projects,
    actions: {
      createCallGuide: () => {
        void requestText({
          title: "创建调用链学习导览",
          message: "输入函数、方法或限定符号名。CodeCourse 只显示结构索引确认的调用关系。",
          label: "符号",
          placeholder: "例如 run 或 App.start",
          confirmText: "查找",
        }).then((symbol) => { if (symbol) void resolveAndOpenCallGuide({ symbolName: symbol }); });
      },
      openAssistant: () => openAssistant("history"),
      openGeneration: () => openGeneration("outline"),
      openCourses: () => openMobileNavigation("courses"),
      openFiles: () => openMobileNavigation("files"),
      openSettings,
      openPrompts,
      buildIndex: () => { void handleBuildIndex(); },
      resetProgress: () => { void handleResetLearningProgress(); },
      checkUpdates: () => { void handleCheckUpdates(); },
      openDiagnostics: () => { void handleOpenDiagnostics(); },
      openCourse: (course) => { if (project) void openCourseInActiveGroup(project.id, course.filename); },
      openFile: (file) => { if (project) void openFileInActiveGroup(project.id, file.path); },
      openQA: (record) => { void openQAInActiveGroup(record); },
      openCallGuide,
      deleteCallGuide: (guide) => { void handleDeleteCallGuide(guide); },
      openProject: (entry) => { void openProject(entry); },
    },
  });

  function closeNavigationAnimated() {
    if (navigationOpen && !navigationClosing) {
      setNavigationClosing(true);
      setNavigationOpen(false);
      setTimeout(() => setNavigationClosing(false), 220);
    } else {
      setNavigationOpen(false);
      setNavigationClosing(false);
    }
  }

  function closeMobileWorkspaceSurfaces(except?: MobileSurface) {
    if (!mobileRuntime) return;
    if (except !== "workspace") setMobileWorkspaceTab(null);
    if (except !== "navigation") setNavigationOpen(false);
    if (except !== "assistant") setAssistantOpen(false);
    if (except !== "generation") setGenerationOpen(false);
    if (except !== "more") setMoreMenuOpen(false);
    if (except !== "command") setCommandPaletteOpen(false);
    if (except !== "settings") setSettingsOpen(false);
    if (except !== "prompts") setPromptEditorOpen(false);
    if (except !== "profile") setLearnerProfileOpen(false);
  }

  async function handleTabDragEnd(event: DragEvent<HTMLElement>, groupId: string, item: OpenItem) {
    if (mobileRuntime || item.type === "knowledge_graph" || item.type === "call_guide" || !window.codecourseDesktop?.detachTab) return;
    const outsideWindow = event.clientX <= 1
      || event.clientY <= 1
      || event.clientX >= window.innerWidth - 1
      || event.clientY >= window.innerHeight - 1;
    if (event.dataTransfer.dropEffect !== "none" || !outsideWindow) return;
    const detached = await window.codecourseDesktop.detachTab({
      type: item.type,
      path: item.path,
      title: item.title,
      content: item.content,
      language: item.language,
    });
    if (detached) closeItemInGroup(groupId, item.id);
  }

  async function handleImportLocalPath(path: string) {
    if (rejectProjectMutationWhileQABusy() || rejectProjectMutationWhileGenerationBusy()) {
      return;
    }
    setLoading(true);
    setError("");
    setTaskMessage("正在导入本地项目");
    try {
      const imported = await importLocalProject(path);
      await loadProjects();
      await openProject(imported);
      setToast("本地项目已导入");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入本地项目失败");
    } finally {
      setLoading(false);
    }
  }

  function notifyTaskCompleted(title: string, body: string) {
    if (mobileRuntime) {
      // Generation tasks notify themselves via AndroidLocalProvider.runTask().
      // Suppress App-level duplicate; only QA/answer completions use taskId=0 here.
      if (title.includes("生成完成")) return;
      void CodeCourseNative.notifyCompletion({ taskId: 0, label: body }).catch(() => undefined);
      return;
    }
    void window.codecourseDesktop?.notify?.({ title, body });
  }

  function openMobileNavigation(view: NavigationView) {
    if (!mobileRuntime) {
      setNavigationView(view);
      setNavigationOpen(true);
      return;
    }
    closeMobileWorkspaceSurfaces("workspace");
    setNavigationView(view);
    setNavigationOpen(false);
    setMobileWorkspaceTab(view);
  }

  function toggleMobileProjects() {
    if (mobileWorkspaceTab === "projects") {
      mobileWorkspaceSheetRef.current?.dismiss();
      return;
    }
    openMobileNavigation("projects");
  }

  function handleSelectMobileProject(nextProject: Project) {
    if (project?.id !== nextProject.id) {
      if (rejectProjectMutationWhileQABusy() || rejectProjectMutationWhileGenerationBusy()) {
        /*
         * 被阻止时不能关闭项目抽屉。
         */
        return;
      }
    }
    mobileWorkspaceSheetRef.current?.dismiss();
    void openProject(nextProject);
  }

  function toggleMobileNavigation(view: "courses" | "files") {
    if (mobileWorkspaceTab === view) {
      mobileWorkspaceSheetRef.current?.dismiss();
      return;
    }
    openMobileNavigation(view);
  }

  function openAssistant(tab: "history" | "knowledge") {
    if (mobileRuntime) {
      closeMobileWorkspaceSurfaces("workspace");
      setMobileAssistantView(tab === "knowledge" ? "knowledge" : "ask");
      setMobileWorkspaceTab("assistant");
      return;
    }
    closeMobileWorkspaceSurfaces("assistant");
    setQAUpperTab(tab);
    setAssistantOpen(true);
  }

  function toggleMobileAssistant(tab: "history" | "knowledge") {
    if (!mobileRuntime) { openAssistant(tab); return; }
    const nextView: MobileAssistantView = tab === "knowledge" ? "knowledge" : "ask";
    if (mobileWorkspaceTab === "assistant") {
      if (mobileAssistantView !== nextView) { setMobileAssistantView(nextView); return; }
      mobileWorkspaceSheetRef.current?.dismiss();
      return;
    }
    openAssistant(tab);
  }

  function rejectMobileMeActionWhileBusy() {
    if (
      !loading &&
      !isTaskRunning &&
      !isQABusyNow()
    ) {
      return false;
    }

    setToast(
      "当前任务仍在处理，请完成后再修改学习或模型设置",
    );

    return true;
  }

  function closeSettingsDialog() {
    if (settingsDialogBusy) {
      setToast(
        "设置正在处理，请完成后再关闭",
      );

      return;
    }

    setSettingsOpen(false);

    void loadLLMSettings();
  }

  async function requestClosePromptEditor() {
    if (
      !promptEditorOpen ||
      promptClosePendingRef.current
    ) {
      return;
    }

    if (promptEditorSaving) {
      setToast(
        "提示词正在保存，请完成后再关闭",
      );

      return;
    }

    if (promptEditorDirty) {
      promptClosePendingRef.current =
        true;

      try {
        const approved =
          await confirmAction(
            "放弃提示词修改",
            "提示词还有未保存的修改。关闭后，本次修改将被放弃。",
            {
              confirmText:
                "放弃修改",
              danger: true,
            },
          );

        if (!approved) {
          return;
        }
      } finally {
        promptClosePendingRef.current =
          false;
      }
    }

    setPromptEditorOpen(false);
    setPromptEditorDirty(false);
    setPromptEditorSaving(false);
  }

  function openSettings() {
    closeMobileWorkspaceSurfaces("settings");
    setSettingsDialogBusy(false);
    setSettingsOpen(true);
  }

  function openPrompts() {
    closeMobileWorkspaceSurfaces("prompts");
    setPromptEditorDirty(false);
    setPromptEditorSaving(false);
    setPromptEditorOpen(true);
  }

  function openLearnerProfile() {
    if (!project) {
      return;
    }
    closeMobileWorkspaceSurfaces("profile");
    setLearnerProfileOpen(true);
  }

  function openSettingsFromMobileMe() {
    if (rejectMobileMeActionWhileBusy()) {
      return;
    }
    setSettingsDialogBusy(false);
    setSettingsOpen(true);
  }

  function openPromptsFromMobileMe() {
    if (rejectMobileMeActionWhileBusy()) {
      return;
    }
    setPromptEditorDirty(false);
    setPromptEditorSaving(false);
    setPromptEditorOpen(true);
  }

  function openLearnerProfileFromMobileMe() {
    if (!project || rejectMobileMeActionWhileBusy()) {
      return;
    }
    setLearnerProfileOpen(true);
  }

  function toggleMobileCommandPalette() {
    const next = !commandPaletteOpen;
    closeMobileWorkspaceSurfaces(next ? "command" : undefined);
    setCommandPaletteOpen(next);
  }

  function toggleMobileMoreMenu() {
    const next = !moreMenuOpen;
    closeMobileWorkspaceSurfaces(next ? "more" : undefined);
    setMoreMenuOpen(next);
  }

  function toggleMobileMe() {
    if (mobileWorkspaceTab === "me") {
      mobileWorkspaceSheetRef.current?.dismiss();
      return;
    }
    closeMobileWorkspaceSurfaces("workspace");
    setMobileWorkspaceTab("me");
  }

  async function handleExplainCallGuide(guide: CallGuide, node: CallGuideNode, routeNodeIds: string[]) {
    if (!project) return;
    if (guide.stale) {
      setError("调用链导览已过期，请刷新后再生成讲解");
      return;
    }
    if (!llmSettings?.enabled || !llmSettings.has_api_key) {
      setError("请先配置模型 API");
      openSettings();
      return;
    }
    const operationToken = acquireQAOperation();
    if (!operationToken) return;
    try {
      const ok = await confirmAction(
        "讲解调用路径",
        `将调用 ${llmSettings.model}，只使用结构索引验证过的路径和源码片段讲解“${node.symbol_name}”。是否继续？`,
        { confirmText: "开始讲解" },
      );
      if (!ok) return;
      const record = await runStreamingQuestion({
        source_type: "call_guide",
        source_path: node.path,
        selected_text: "",
        question: `请讲解当前节点到调用链起点的真实调用路径，说明每一跳的职责、输入输出和阅读顺序。当前关注：${node.qualified_name || node.symbol_name}`,
        provider: llmSettings.provider,
        base_url: llmSettings.base_url,
        model: llmSettings.model,
        session_id: qaSessionId,
        relation_type: "follow_up",
        call_guide_id: guide.id,
        focused_node_id: node.id,
        route_node_ids: routeNodeIds,
      }, `call-guide:${guide.id}`, operationToken);
      setSelectedQA(record);
      setQASessionId(record.session_id ?? qaSessionId);
      setQAHistory((items) => [record, ...items.filter((item) => item.id !== record.id)]);
      openAssistant("history");
      await Promise.all([
        refreshCourses(project.id),
        refreshQAHistory(project.id),
        refreshKnowledgeLinks(project.id),
      ]);
      setKnowledgeRefreshKey((value) => value + 1);
      schedulePersonalizationRefresh();
      notifyTaskCompleted("CodeCourse 回答完成", record.display_title || "调用路径讲解已完成");
    } catch (caught) {
      setQAPanelError(caught instanceof Error ? caught.message : "生成调用路径讲解失败");
    } finally {
      endQAOperation(operationToken);
    }
  }

  function preloadMobileWorkspaceContent(tab: MobileWorkspaceTab) {
    if (tab === "assistant") void import("./components/MobileAssistantPanel");
    else if (tab === "generation") void import("./components/MobileGenerationPanel");
    else if (tab === "me") void import("./components/MobileMePanel");
  }

  function renderMobileWorkspaceContent(tab: MobileWorkspaceTab) {
    if (tab === "projects" || tab === "courses" || tab === "files") return renderSidebar(tab, true);
    if (tab === "assistant") return renderMobileAssistantPanel();
    if (tab === "generation") return renderMobileGenerationPanel();
    return renderMobileMePanel();
  }

  function openGeneration(intent: GenerationIntent) {
    setGenerationIntent(intent);
    if (mobileRuntime) {
      closeMobileWorkspaceSurfaces("workspace");
      setMobileGenerationView(isTaskRunning ? "tasks" : "configure");
      setMobileWorkspaceTab("generation");
      return;
    }
    closeMobileWorkspaceSurfaces("generation");
    setGenerationOpen(true);
  }

  function runSelectedGeneration(instructions: string) {
    if (generationIntent === "outline") {
      void handleGenerateOutline(instructions);
    } else if (generationIntent === "lesson" && activeLessonNumber) {
      void handleGenerateOutlineLesson(activeLessonNumber, activeLessonTitle, instructions);
    } else if (generationIntent === "brief" || generationIntent === "detailed") {
      void handleGenerateFileLesson(generationIntent, instructions);
    }
  }

  function renderSidebar(view: NavigationView, embedded = false) {
    return (
      <Sidebar
        embedded={embedded}
        view={view}
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
        onSelectProject={mobileRuntime && embedded ? handleSelectMobileProject : openProject}
        onCreateLearningPlan={handleCreateLearningPlan}
        onRegenerateProject={handleRegenerate}
        onDeleteProject={handleDelete}
        onSelectFile={handleSelectFile}
        onOpenFile={handleOpenFile}
        onSelectCourse={handleSelectCourse}
        onCreateCourse={handleCreateCourse}
        onDeleteCourse={handleDeleteCourse}
        onRenameCourse={handleRenameCourse}
        learningStates={learningStates}
        onContinueLearning={(filename) => project && void openCourseInActiveGroup(project.id, filename)}
        onDragItem={prefetchDropItem}
        onViewChange={!embedded && !mobileRuntime ? (nextView) => setNavigationView(nextView) : undefined}
      />
    );
  }

  function renderKnowledgeGraph() {
    if (!project) return <div className="empty small">请选择项目后查看知识网络</div>;
    const activeItem = getActiveOpenItem();
    const focusRef = activeItem
      ? activeItem.qaRecordId ? { ref_type: "qa" as const, ref_id: activeItem.qaRecordId }
      : activeItem.type === "course" ? { ref_type: "course" as const, ref_path: activeItem.path }
      : activeItem.type === "file" ? { ref_type: "file" as const, ref_path: activeItem.path }
      : null
      : selectedQA ? { ref_type: "qa" as const, ref_id: selectedQA.id }
      : null;
    return (
      <Suspense fallback={<div className="viewer-loading">正在加载知识网络…</div>}>
        <KnowledgeGraphViewer
          projectId={project.id} refreshKey={knowledgeRefreshKey} compact focusRef={focusRef}
          onRequestText={requestText} onConfirm={confirmAction}
          onContentChanged={async () => { await refreshCourses(project.id); await refreshQAHistory(project.id); }}
          onGraphChanged={() => { setKnowledgeRefreshKey((value) => value + 1); }}
          onOpenQA={(qaId) => { void openQAById(qaId).catch((caught) => { setError(caught instanceof Error ? caught.message : "打开回答失败"); }); }}
          onOpenCourse={(path) => { void openCourseInActiveGroup(project.id, path).catch((caught) => { setError(caught instanceof Error ? caught.message : "打开课件失败"); }); }}
          onOpenFile={(path) => { void openFileInActiveGroup(project.id, path).catch((caught) => { setError(caught instanceof Error ? caught.message : "打开文件失败"); }); }}
        />
      </Suspense>
    );
  }

  function renderAssistantPanel() {
    const showKnowledgeGraph = qaUpperTab === "knowledge" && Boolean(project);
    return (
      <ExplainPanel
        selection={selection}
        contextSummary={assistantContextSummary}
        contextFiles={contextFiles}
        onOpenFilePicker={() => setContextFilePickerOpen(true)}
        onRemoveContextFile={(path) => setContextFiles((current) => current.filter((item) => item !== path))}
        question={qaQuestionInput}
        questionInput={qaQuestionInput}
        resetToken={qaResetToken}
        loading={qaInteractionBusy}
        loadingLabel={qaBusyLabel}
        streamContent={visibleQAGeneration?.partial}
        history={qaHistory}
        threads={qaThreads}
        continuity={qaContinuity}
        historyQuery={qaHistoryQuery}
        favoriteOnly={qaFavoriteOnly}
        selectedRecord={selectedQA}
        selectedRecordReadOnly={Boolean(selectedQA && project && selectedQA.project_id !== project.id)}
        surveyCandidate={dynamicSurvey}
        diagnosticItem={diagnosticItem}
        diagnosticResult={diagnosticResult}
        settings={llmSettings}
        panelError={qaPanelError}
        upperTab={qaUpperTab}
        onUpperTabChange={setQAUpperTab}
        knowledgeDisabled={!project}
        knowledgeContent={showKnowledgeGraph ? renderKnowledgeGraph() : null}
        onQuestionChange={handleQAQuestionChange}
        onSelectionTextChange={handleSelectionTextChange}
        onClearSelection={handleClearSelection}
        onAsk={handleAsk}
        onNewConversation={handleNewConversation}
        onHistoryQueryChange={setQAHistoryQuery}
        onFavoriteOnlyChange={setQAFavoriteOnly}
        onSelectRecord={(record) => { setSelectedQA(record); setQASessionId(record.session_id ?? null); }}
        onOpenRecord={(record) => { void openQAInActiveGroup(record); }}
        onDeleteRecord={handleDeleteQA}
        onRenameRecord={handleRenameQA}
        onToggleFavorite={handleToggleFavorite}
        onResumeContinuity={(handoff) => { void handleResumeContinuity(handoff); }}
        onOpenContinuitySource={(handoff) => { void handleOpenContinuitySource(handoff); }}
        onDismissContinuity={(handoff) => { void handleDismissContinuity(handoff); }}
        onTeachingNextAction={handleTeachingNextAction}
        onOpenSettings={openSettings}
        onAnswerSurvey={(choice) => { void handleDynamicSurveyAnswer(choice); }}
        onDismissSurvey={() => { void handleDynamicSurveyDismiss(); }}
        onDisableSurveys={() => { void handleDisableDynamicSurveys(); }}
        onAnswerDiagnostic={(answer) => { void handleDiagnosticAnswer(answer); }}
        onDismissDiagnostic={() => { void handleDiagnosticDismiss(); }}
        onFlagDiagnostic={() => { void handleDiagnosticFlag(); }}
        onClose={() => setAssistantOpen(false)}
      />
    );
  }

  function renderMobileAssistantPanel() {
    return (
      <MobileAssistantPanel
        view={mobileAssistantView}
        onViewChange={setMobileAssistantView}
        selection={selection}
        contextSummary={assistantContextSummary}
        contextFiles={contextFiles}
        onOpenFilePicker={() => setContextFilePickerOpen(true)}
        onRemoveContextFile={(path) => setContextFiles((current) => current.filter((item) => item !== path))}
        question={qaQuestionInput}
        resetToken={qaResetToken}
        loading={qaInteractionBusy}
        loadingLabel={qaBusyLabel}
        streamContent={visibleQAGeneration?.partial}
        history={qaHistory}
        threads={qaThreads}
        continuity={qaContinuity}
        historyQuery={qaHistoryQuery}
        favoriteOnly={qaFavoriteOnly}
        selectedRecord={selectedQA}
        selectedRecordReadOnly={Boolean(selectedQA && project && selectedQA.project_id !== project.id)}
        surveyCandidate={dynamicSurvey}
        diagnosticItem={diagnosticItem}
        diagnosticResult={diagnosticResult}
        settings={llmSettings}
        panelError={qaPanelError}
        knowledgeDisabled={!project}
        knowledgeContent={mobileAssistantView === "knowledge" && mobileWorkspaceMotionRef.current === "open" && project ? renderKnowledgeGraph() : null}
        onQuestionChange={handleQAQuestionChange}
        onSelectionTextChange={handleSelectionTextChange}
        onClearSelection={handleClearSelection}
        onAsk={handleAsk}
        onNewConversation={handleNewConversation}
        onHistoryQueryChange={setQAHistoryQuery}
        onFavoriteOnlyChange={setQAFavoriteOnly}
        onSelectRecord={(record) => { setSelectedQA(record); setQASessionId(record.session_id ?? null); }}
        onOpenRecord={(record) => { void openQAInActiveGroup(record); }}
        onDeleteRecord={handleDeleteQA}
        onRenameRecord={handleRenameQA}
        onToggleFavorite={handleToggleFavorite}
        onResumeContinuity={(handoff) => { void handleResumeContinuity(handoff); }}
        onOpenContinuitySource={(handoff) => { void handleOpenContinuitySource(handoff); }}
        onDismissContinuity={(handoff) => { void handleDismissContinuity(handoff); }}
        onTeachingNextAction={handleTeachingNextAction}
        onOpenSettings={openSettings}
        onAnswerSurvey={(choice) => { void handleDynamicSurveyAnswer(choice); }}
        onDismissSurvey={() => { void handleDynamicSurveyDismiss(); }}
        onDisableSurveys={() => { void handleDisableDynamicSurveys(); }}
        onAnswerDiagnostic={(answer) => { void handleDiagnosticAnswer(answer); }}
        onDismissDiagnostic={() => { void handleDiagnosticDismiss(); }}
        onFlagDiagnostic={() => { void handleDiagnosticFlag(); }}
      />
    );
  }

  function renderMobileMePanel() {
    const modelReady =
      Boolean(
        llmSettings?.enabled &&
        llmSettings.has_api_key,
      );

    const modelLabel =
      llmSettings
        ? modelReady
          ? `${llmSettings.provider} / ${llmSettings.model}`
          : "模型尚未启用或没有 API Key"
        : "尚未读取到模型配置";

    const meIndexLabel =
      !project
        ? "打开项目后可查看索引状态"
        : isLearningPlanProject
          ? "学习计划无需代码索引"
          : indexStatusMessage(
              indexStatus,
            );

    return (
      <MobileMePanel
        projectName={
          project?.name ?? null
        }

        projectType={
          project?.project_type ??
          null
        }

        completedLessons={
          completedLessonCount
        }

        totalLessons={
          lessonFilesForProgress
            .length
        }

        modelReady={modelReady}
        modelLabel={modelLabel}

        terminologyDensity={
          project
            ? terminologyDensity
            : null
        }

        indexLabel={meIndexLabel}

        indexBusy={
          indexBuilding ||
          indexStatus?.status ===
            "building"
        }

        hasLearningProgress={
          learningStates.length > 0
        }

        busy={mobileMeBusy}

        themeMode={themeMode}

        onOpenProjects={() => {
          if (
            rejectMobileMeActionWhileBusy()
          ) {
            return;
          }

          setMobileWorkspaceTab(
            "projects",
          );
        }}

        onOpenProfile={
          openLearnerProfileFromMobileMe
        }

        onOpenSettings={
          openSettingsFromMobileMe
        }

        onOpenPrompts={
          openPromptsFromMobileMe
        }

        onBuildIndex={() => {
          if (
            rejectMobileMeActionWhileBusy() ||
            indexBuilding
          ) {
            return;
          }

          void handleBuildIndex();
        }}

        onResetLearningProgress={() => {
          if (
            rejectMobileMeActionWhileBusy()
          ) {
            return;
          }

          void handleResetLearningProgress();
        }}

        onExportDataArchive={() => {
          void handleExportDataArchive();
        }}

        onImportDataArchive={
          requestDataArchiveImport
        }

        onToggleTheme={() => {
          setThemeMode(
            (current) =>
              current === "dark"
                ? "light"
                : "dark",
          );
        }}
      />
    );
  }

  function openPromptsFromMobileGeneration() {
    if (generationBusy) {
      setToast("当前内容仍在生成，请完成后再修改提示词");
      return;
    }
    setPromptEditorDirty(false);
    setPromptEditorSaving(false);
    setPromptEditorOpen(true);
  }

  async function handleOpenGenerationTask(task: GenerationTask) {
    if (!project || task.project_id !== project.id || task.status !== "completed" || !task.output_path) {
      return;
    }
    try {
      const outputPath = task.output_path;
      const matchingCourse = courses.find((course) => course.filename === outputPath || outputPath.endsWith(`/${course.filename}`));
      const filename = matchingCourse?.filename ?? outputPath;
      await openCourseInActiveGroup(project.id, filename);
      mobileWorkspaceSheetRef.current?.dismiss();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "打开生成结果失败");
    }
  }

  function renderMobileGenerationPanel() {
    return (
      <MobileGenerationPanel
        view={mobileGenerationView}
        projectName={project?.name ?? null}
        projectType={project?.project_type ?? null}
        tree={tree}
        intent={generationIntent}
        scope={isLearningPlanProject ? "learning_plan" : scopeType}
        selectedFiles={selectedScopeFiles}
        instructions={generationInstructions}
        currentFilePath={fileContent?.path ?? null}
        currentLesson={activeLessonNumber ? { number: activeLessonNumber, title: activeLessonTitle || `第 ${activeLessonNumber} 课` } : null}
        tasks={generationTasks}
        generationBusy={generationBusy}
        generationStarting={generationStarting}
        retryingTaskId={retryingTaskId}
        canGenerate={canStartGeneration}
        validationMessage={generationValidationMessage}
        onViewChange={setMobileGenerationView}
        onIntentChange={setGenerationIntent}
        onScopeChange={(nextScope) => { setScopeType(nextScope); if (nextScope !== "files") setSelectedScopeFiles([]); }}
        onToggleFile={(path) => { setSelectedScopeFiles((items) => items.includes(path) ? items.filter((item) => item !== path) : [...items, path]); setScopePathsText(""); }}
        onClearFiles={() => { setSelectedScopeFiles([]); setScopePathsText(""); }}
        onInstructionsChange={setGenerationInstructions}
        onGenerate={runSelectedGeneration}
        onRetry={(task) => { void handleRetryTask(task); }}
        onOpenTask={(task) => { void handleOpenGenerationTask(task); }}
        onOpenPrompts={openPromptsFromMobileGeneration}
      />
    );
  }

  return (
    <div className="app-shell">
      <TitleBar />
      <input ref={archiveInputRef} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImportArchive(file); }} />
      <input ref={dataArchiveInputRef} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImportDataArchive(file); }} />
      {dataTransferBusy ? (
        <div className="data-transfer-lock" role="status" aria-live="assertive">
          <div className="data-transfer-lock-card">
            <Loader2 className="spin" size={20} aria-hidden="true" />
            <span>{taskMessage || "正在处理 CodeCourse 数据包"}</span>
          </div>
        </div>
      ) : null}
      {!mobileRuntime && DesktopToolbar ? (
        <DesktopToolbar
          project={project}
          projects={projects}
          activeTitle={activeDocumentTitle}
          progressLabel={progressLabel}
          navigationOpen={navigationOpen}
          assistantOpen={assistantOpen}
          busyProjectId={busyProjectId}
          loading={loading || dataTransferBusy || isTaskRunning}
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
          onOpenPreferences={openLearnerProfile}
          onOpenPrompts={() => setPromptEditorOpen(true)}
          onOpenGestureGuide={() => setGestureGuideOpen(true)}
          onExportDataArchive={() => { void handleExportDataArchive(); }}
          onImportDataArchive={requestDataArchiveImport}
          onBuildIndex={() => void handleBuildIndex()}
          onToggleTheme={() => setThemeMode((current) => current === "dark" ? "light" : "dark")}
        />
      ) : (
        <MobileTopBar
          projectName={project?.name ?? null}
          projectSheetOpen={mobileWorkspaceTab === "projects"}
          onToggleProjects={toggleMobileProjects}
          onSearch={toggleMobileCommandPalette}
          onMore={toggleMobileMoreMenu}
        />
      )}
      <MobileMoreMenu
        open={mobileRuntime && moreMenuOpen}
        projectAvailable={Boolean(project)}
        generationLabel={activeLessonNumber ? "生成当前课件" : fileContent ? "分析当前文件" : "生成学习内容"}
        onGenerate={() => {
          openGeneration(activeLessonNumber ? "lesson" : fileContent ? "brief" : "outline");
          setMoreMenuOpen(false);
        }}
        onOpenKnowledge={() => { openAssistant("knowledge"); setMoreMenuOpen(false); }}
        onImportRepository={() => { void handleImportRequest(); setMoreMenuOpen(false); }}
        onImportArchive={() => { archiveInputRef.current?.click(); setMoreMenuOpen(false); }}
        onClose={() => setMoreMenuOpen(false)}
      />
      <AppFeedbackLayer
        permissionNotice={permissionNotice}
        permissionNoticeDismissed={Boolean(permissionNotice && dismissedPermissionStatusRef.current === permissionNotice.status)}
        error={mobileRuntime && mobileWorkspaceTab ? "" : error}
        busy={showBusy && !(mobileRuntime && mobileWorkspaceTab)}
        label={dataTransferBusy ? taskMessage : qaInteractionBusy ? qaBusyLabel : loading ? "正在处理" : activeTask ? taskStatusMessage(activeTask) : taskMessage}
        progressCurrent={activeTask?.progress_current}
        progressTotal={activeTask?.progress_total}
        toast={mobileRuntime && mobileWorkspaceTab ? "" : toast}
        desktopDropActive={desktopDropActive}
        gestureHint={gestureHint}
        onOpenNotificationSettings={handleOpenNotificationSettings}
        onDismissPermissionNotice={handleDismissPermissionNotice}
        onDismissError={() => setError("")}
      />
      {GestureGuide ? <GestureGuide open={gestureGuideOpen && !mobileRuntime} onClose={() => setGestureGuideOpen(false)} /> : null}
      <WorkbenchSurface
        mobile={mobileRuntime}
        mobilePanelOpen={mobileRuntime && Boolean(navigationOpen || mobileWorkspaceTab)}
        projectAvailable={Boolean(project)}
        projectError={error}
        layout={layout}
        navigationOpen={navigationOpen}
        assistantOpen={assistantOpen}
        navigationResizing={dragState?.kind === "sidebar-width"}
        assistantResizing={dragState?.kind === "explain-width"}
        sidebarWidth={sidebarWidth}
        assistantWidth={explainWidth}
        navigationContent={renderSidebar(navigationView === "files" ? "files" : "courses")}
        assistantContent={renderAssistantPanel()}
        renderGroup={renderGroup}
        onCollapseSplit={collapseControlledSplit}
        onStartSplitResize={setDragState}
        onStartNavigationResize={(clientX) => setDragState({ kind: "sidebar-width", startX: clientX, startWidth: sidebarWidth })}
        onStartAssistantResize={(clientX) => setDragState({ kind: "explain-width", startX: clientX, startWidth: explainWidth })}
        onRelocateProject={() => { setError(""); handleImportRequest(); }}
        onReturnToProjects={() => {
          setError("");
          setProject(null);
          window.localStorage.removeItem("codecourse-last-project");
        }}
        onImportProject={handleImportRequest}
        onCreateLearningPlan={handleCreateLearningPlan}
      />
      {mobileRuntime ? (
        <MobileWorkspaceChrome
          ref={mobileWorkspaceSheetRef}
          activeDestination={mobilePrimaryDestination}
          tab={mobileWorkspaceTab}
          projectAvailable={Boolean(project)}
          coursesAvailable={courses.length > 0}
          error={error}
          busy={mobileWorkspaceBusy}
          busyLabel={dataTransferBusy ? taskMessage : mobileWorkspaceTab !== "assistant" && qaInteractionBusy ? qaBusyLabel : loading ? "正在处理" : activeTask ? taskStatusMessage(activeTask) : taskMessage}
          progressCurrent={activeTask?.progress_current}
          progressTotal={activeTask?.progress_total}
          toast={toast}
          preloadContent={preloadMobileWorkspaceContent}
          renderContent={renderMobileWorkspaceContent}
          onLearn={() => toggleMobileNavigation("courses")}
          onSource={() => toggleMobileNavigation("files")}
          onAsk={() => toggleMobileAssistant("history")}
          onMe={toggleMobileMe}
          onCreateLearningPlan={() => { void handleCreateMobileLearningPlan(); }}
          onCreateCourse={() => { void handleCreateCourse(); }}
          onDismissError={() => setError("")}
          onMotionPhaseChange={(phase) => {
            mobileWorkspaceMotionRef.current = phase;
            document.documentElement.toggleAttribute("data-mobile-sheet-moving", phase !== "open");
            if (phase === "entering") markAndroidPerformance("drawer-first-frame");
            if (phase === "open") markAndroidPerformance("drawer-open");
          }}
          onDismiss={() => {
            document.documentElement.removeAttribute("data-mobile-sheet-moving");
            setMobileWorkspaceTab(null);
          }}
        />
      ) : null}
      {!mobileRuntime && GenerationSheet ? (
        <GenerationSheet
          open={generationOpen}
          intent={generationIntent}
          project={project}
          scope={scopeType}
          selectedFileCount={selectedScopeFiles.length}
          instructions={generationInstructions}
          running={generationBusy}
          activeTask={activeTask}
          taskMessage={taskMessage}
          onClose={() => setGenerationOpen(false)}
          onScopeChange={(nextScope) => {
            setScopeType(nextScope);
            if (nextScope !== "files") {
              setSelectedScopeFiles([]);
            } else {
              /*
               * 桌面端以左侧源码侧边栏承载文件选择。面板遮罩（.apple-sheet-layer）
               * 会盖住侧边栏并拦截点击，必须先关闭面板，否则看起来“没有弹出选择窗口”。
               */
              setGenerationOpen(false);
              openMobileNavigation("files");
            }
          }}
          onInstructionsChange={setGenerationInstructions}
          onOpenPrompts={openPrompts}
          onGenerate={runSelectedGeneration}
        />
      ) : null}
      <AppOverlayLayer
        termAction={termAction ? {
          term: termAction.term,
          position: termAction.position,
          onGenerate: () => {
            const term = termAction.term;
            setTermAction(null);
            void generateTermExplanation(term);
          },
          onKnown: () => void handleTermMastery(termAction.term, "known"),
          onUnknown: () => void handleTermMastery(termAction.term, "unknown"),
          onDismiss: () => void handleDismissTerm(termAction.term),
          onClose: () => setTermAction(null),
        } : null}
        settings={{
          open: settingsOpen,
          projectId: project?.id ?? null,
          onConfirm: confirmAction,
          onOpenExternal: openExternal,
          onPreferencesChanged: (density) => {
            setTerminologyDensity(density);
            bumpPersonalizationRevision();
          },
          onBusyChange: setSettingsDialogBusy,
          onClose: closeSettingsDialog,
        }}
        learnerProfile={{
          open: learnerProfileOpen,
          projectId: project?.id ?? null,
          onClose: () => setLearnerProfileOpen(false),
          onChanged: bumpPersonalizationRevision,
          onConfirm: confirmAction,
          termScanStatus: activeTermScanStatus,
          termDiagnostics: termDisplay.diagnostics,
          onRescanTerms: rescanActiveDocumentTerms,
        }}
        promptEditor={promptEditorOpen ? {
          onClose: () => { void requestClosePromptEditor(); },
          onDirtyChange: setPromptEditorDirty,
          onSavingChange: setPromptEditorSaving,
        } : null}
        selectionBar={!mobileRuntime && selectionAnchor?.selectedText ? {
          canHighlight: selectionAnchor.sourceType === "course" || selectionAnchor.sourceType === "qa",
          highlighted: highlights.some((highlight) => (
            highlight.source_type === selectionAnchor.sourceType
            && highlight.source_path === (selectionAnchor.sourcePath ?? "")
            && highlight.selected_text.trim() === selectionAnchor.selectedText.trim()
          )),
          anchorRect: selectionAnchor.anchorRect,
          onAsk: () => {
            setSelection({ ...selectionAnchor });
            openAssistant("history");
          },
          onExplainTerm: () => void handleExplainSelectedTerm(),
          onCallGuide: selectionAnchor.sourceType === "file" && project?.project_type === "repository"
            ? () => void resolveAndOpenCallGuide({
                sourcePath: selectionAnchor.sourcePath,
                line: selectionAnchor.range?.startLineNumber,
                selectedText: selectionAnchor.selectedText,
              })
            : undefined,
          onToggleHighlight: () => {
            if (selectionAnchor.sourceType === "course" || selectionAnchor.sourceType === "qa") {
              void handleToggleHighlight(selectionAnchor.sourceType, selectionAnchor.sourcePath ?? "", selectionAnchor.selectedText);
            }
          },
          onCopy: () => void navigator.clipboard.writeText(selectionAnchor.selectedText),
          onClose: handleDismissSelection,
        } : null}
        commandPalette={{ open: commandPaletteOpen, items: commandItems, onClose: () => setCommandPaletteOpen(false) }}
        appDialog={{
          state: appDialog,
          value: appDialogValue,
          skipChecked: appDialogSkipChecked,
          onSkipChange: handleAppDialogSkipChange,
          onValueChange: setAppDialogValue,
          onCancel: () => closeAppDialog(null),
          onConfirm: handleAppDialogConfirm,
        }}
        outlineQuestionnaire={{
          preflight: outlinePreflight,
          loading: outlinePreflightLoading,
          error: outlinePreflightError,
          onAnswers: handleOutlineQuestionnaireAnswers,
          onClose: () => handleOutlineQuestionnaireAnswers(null),
        }}
        contextFilePicker={{
          open: contextFilePickerOpen,
          files: flattenTree(tree).filter((entry) => entry.type === "file").map((entry) => entry.path),
          selected: contextFiles,
          currentPath: getActiveOpenItem()?.type === "file" ? getActiveOpenItem()?.path ?? null : null,
          onConfirm: (files) => { setContextFiles(files); setContextFilePickerOpen(false); },
          onClose: () => setContextFilePickerOpen(false),
        }}
      />
    </div>
  );
}
