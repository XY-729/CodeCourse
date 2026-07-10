import { useEffect, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { Columns2, PanelLeft, Save, Star, X } from "lucide-react";
import {
  askQuestion,
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
type PaneId = "left" | "right";
type OpenItemType = "file" | "course" | "qa";
type WorkspaceMode = "single" | "split";

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

type DragState =
  | { kind: "sidebar-width"; startX: number; startWidth: number }
  | { kind: "explain-width"; startX: number; startWidth: number }
  | { kind: "sidebar-project"; startY: number; startHeight: number }
  | { kind: "sidebar-course"; startY: number; startHeight: number }
  | { kind: "qa-ask"; startY: number; startHeight: number };

const TERMINAL_TASK_STATUSES = new Set(["completed", "failed"]);

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

function emptyPanes(): Record<PaneId, OpenItem[]> {
  return { left: [], right: [] };
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
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("split");
  const [activePane, setActivePane] = useState<PaneId>("left");
  const [openItems, setOpenItems] = useState<Record<PaneId, OpenItem[]>>(emptyPanes);
  const [activeItemIds, setActiveItemIds] = useState<Record<PaneId, string | null>>({ left: null, right: null });

  const [selection, setSelection] = useState<SelectionSummary | null>(null);
  const [qaQuestion, setQAQuestion] = useState("");
  const [qaLoading, setQALoading] = useState(false);
  const [qaHistory, setQAHistory] = useState<QARecord[]>([]);
  const [qaHistoryQuery, setQAHistoryQuery] = useState("");
  const [qaFavoriteOnly, setQAFavoriteOnly] = useState(false);
  const [selectedQA, setSelectedQA] = useState<QARecord | null>(null);
  const [qaPanelError, setQAPanelError] = useState("");

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
      }
    }
    function onMouseUp() {
      setDragState(null);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    document.body.classList.add(currentDrag.kind.includes("width") ? "resizing-x" : "resizing-y");
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

  function rememberOpenItem(pane: PaneId, item: OpenItem) {
    setOpenItems((prev) => {
      const existing = prev[pane].filter((entry) => entry.id !== item.id);
      return { ...prev, [pane]: [...existing, item] };
    });
    setActiveItemIds((prev) => ({ ...prev, [pane]: item.id }));
    setActivePane(pane);
  }

  function updateOpenQARecord(record: QARecord) {
    setOpenItems((prev) => ({
      left: prev.left.map((item) => (item.qaRecordId === record.id ? { ...item, favorite: record.favorite } : item)),
      right: prev.right.map((item) => (item.qaRecordId === record.id ? { ...item, favorite: record.favorite } : item)),
    }));
  }

  function activateItem(pane: PaneId, item: OpenItem) {
    setActivePane(pane);
    setActiveItemIds((prev) => ({ ...prev, [pane]: item.id }));
    if (item.type === "file") {
      setFileContent({ path: item.path, content: item.content, language: item.language ?? "plaintext" });
      setSelectedCourse(null);
    } else if (item.type === "course") {
      setSelectedCourse(item.path);
      setFileContent(null);
    } else if (item.type === "qa") {
      setFileContent(null);
      setSelectedCourse(null);
      const record = qaHistory.find((entry) => entry.id === item.qaRecordId);
      if (record) {
        setSelectedQA(record);
      }
    }
  }

  function closeItem(pane: PaneId, itemId: string) {
    setOpenItems((prev) => {
      const nextPane = prev[pane].filter((item) => item.id !== itemId);
      const nextActive = activeItemIds[pane] === itemId ? nextPane[nextPane.length - 1]?.id ?? null : activeItemIds[pane];
      setActiveItemIds((ids) => ({ ...ids, [pane]: nextActive }));
      return { ...prev, [pane]: nextPane };
    });
  }

  async function openFileInPane(projectId: number, path: string, pane: PaneId) {
    const content = await getProjectFile(projectId, path);
    setFileContent(content);
    setSelectedCourse(null);
    if (scopeType === "files") {
      setScopePathsText(path);
    } else if (scopeType === "directories") {
      setScopePathsText(parentDir(path));
    }
    rememberOpenItem(pane, {
      id: `file:${path}`,
      type: "file",
      path,
      title: path.split("/").pop() ?? path,
      content: content.content,
      language: content.language,
    });
  }

  async function openCourseInPane(projectId: number, filename: string, pane: PaneId) {
    const content = await getCourseContent(projectId, filename);
    setSelectedCourse(filename);
    setFileContent(null);
    rememberOpenItem(pane, {
      id: `course:${filename}`,
      type: "course",
      path: filename,
      title: courses.find((file) => file.filename === filename)?.title ?? filename,
      content: content.content,
    });
  }

  function openQAInPane(record: QARecord, pane = activePane) {
    setSelectedQA(record);
    rememberOpenItem(pane, {
      id: `qa:${record.id}`,
      type: "qa",
      path: record.output_path ?? `qa/${record.id}`,
      title: `回答 #${record.id}`,
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
      setOpenItems(emptyPanes());
      setActiveItemIds({ left: null, right: null });
      await refreshQAHistory(freshProject.id);
      const firstCourse = nextCourses.find((file) => file.filename === "outline.md") ?? nextCourses[0];
      if (firstCourse) {
        const content = await getCourseContent(freshProject.id, firstCourse.filename);
        setSelectedCourse(firstCourse.filename);
        rememberOpenItem("right", {
          id: `course:${firstCourse.filename}`,
          type: "course",
          path: firstCourse.filename,
          title: firstCourse.title,
          content: content.content,
        });
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
      await openFileInPane(project.id, path, activePane);
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
      await openCourseInPane(project.id, filename, activePane);
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
        await openCourseInPane(project.id, preferred.filename, "right");
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
        setOpenItems(emptyPanes());
        setActiveItemIds({ left: null, right: null });
        setSelection(null);
        setQAHistory([]);
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
    if (!project || !selection || !qaQuestion.trim() || !llmSettings?.enabled || !llmSettings.has_api_key) {
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
        source_type: selection.sourceType,
        source_path: selection.sourcePath,
        selected_text: selection.selectedText,
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

  async function handleSaveQAItem(pane: PaneId, item: OpenItem) {
    if (!project || !item.qaRecordId) {
      return;
    }
    setError("");
    try {
      const record = await updateQARecord(project.id, item.qaRecordId, { answer_md: item.content });
      setSelectedQA(record);
      setQAHistory((items) => items.map((entry) => (entry.id === record.id ? record : entry)));
      setOpenItems((prev) => ({
        ...prev,
        [pane]: prev[pane].map((entry) =>
          entry.id === item.id ? { ...entry, content: record.answer_md, favorite: record.favorite, dirty: false } : entry,
        ),
      }));
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

  function handleDrop(event: DragEvent<HTMLElement>, pane: PaneId) {
    event.preventDefault();
    if (!project) {
      return;
    }
    const raw = event.dataTransfer.getData("application/codecourse-item");
    if (!raw) {
      return;
    }
    try {
      const payload = JSON.parse(raw) as { kind?: string; path?: string; filename?: string };
      if (payload.kind === "file" && payload.path) {
        openFileInPane(project.id, payload.path, pane).catch((caught) => {
          setError(caught instanceof Error ? caught.message : "拖拽打开文件失败");
        });
      } else if (payload.kind === "course" && payload.filename) {
        openCourseInPane(project.id, payload.filename, pane).catch((caught) => {
          setError(caught instanceof Error ? caught.message : "拖拽打开课程失败");
        });
      }
    } catch {
      setError("拖拽数据无法识别");
    }
  }

  function updateQAItemContent(pane: PaneId, itemId: string, content: string) {
    setOpenItems((prev) => ({
      ...prev,
      [pane]: prev[pane].map((item) => (item.id === itemId ? { ...item, content, dirty: true } : item)),
    }));
  }

  function renderPane(pane: PaneId) {
    const items = openItems[pane];
    const activeId = activeItemIds[pane];
    const activeItem = items.find((item) => item.id === activeId) ?? null;
    return (
      <section
        className={`reader-pane ${activePane === pane ? "active" : ""}`}
        onClick={() => setActivePane(pane)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event, pane)}
      >
        <div className="pane-tabs">
          <span className="pane-name">{pane === "left" ? "左工作区" : "右工作区"}</span>
          {items.map((item) => (
            <button
              key={item.id}
              className={`pane-tab ${item.id === activeId ? "active" : ""}`}
              onClick={() => activateItem(pane, item)}
              title={item.path}
            >
              <span>{item.dirty ? `${item.title} *` : item.title}</span>
              <X
                size={13}
                onClick={(event) => {
                  event.stopPropagation();
                  closeItem(pane, item.id);
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
              onSelectionChange={handleSelection}
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
                  <button className="secondary-button compact" onClick={() => handleSaveQAItem(pane, activeItem)} disabled={!activeItem.dirty}>
                    <Save size={14} />
                    保存
                  </button>
                </div>
              </div>
              <textarea
                className="qa-workspace-editor"
                value={activeItem.content}
                onChange={(event) => updateQAItemContent(pane, activeItem.id, event.target.value)}
              />
            </div>
          ) : null}
          {!activeItem ? <div className="empty-state">点击或拖拽左侧文件/课件到这里阅读</div> : null}
        </div>
      </section>
    );
  }

  const visiblePanes: PaneId[] = workspaceMode === "split" ? ["left", "right"] : [activePane];

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
            <div className="workspace-controls">
              <button
                className={workspaceMode === "single" ? "selected" : ""}
                onClick={() => setWorkspaceMode("single")}
                title="单工作区"
              >
                <PanelLeft size={15} />
              </button>
              <button
                className={workspaceMode === "split" ? "selected" : ""}
                onClick={() => setWorkspaceMode("split")}
                title="双工作区"
              >
                <Columns2 size={15} />
              </button>
              <button className={activePane === "left" ? "selected" : ""} onClick={() => setActivePane("left")}>左</button>
              <button className={activePane === "right" ? "selected" : ""} onClick={() => setActivePane("right")}>右</button>
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
          <div className={`reader-workspace ${workspaceMode}`}>
            {visiblePanes.map((pane) => renderPane(pane))}
          </div>
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
          onAsk={handleAsk}
          onHistoryQueryChange={setQAHistoryQuery}
          onFavoriteOnlyChange={setQAFavoriteOnly}
          onSelectRecord={setSelectedQA}
          onOpenRecord={(record) => openQAInPane(record)}
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
