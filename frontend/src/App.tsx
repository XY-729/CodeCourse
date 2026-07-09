import { useEffect, useMemo, useState } from "react";
import {
  CourseFile,
  FileContent,
  GenerationTask,
  LearningScope,
  Project,
  TreeNode,
  deleteProject,
  explainCurrent,
  generateFileLesson,
  generateOutline,
  getCourseContent,
  getCourseFiles,
  getGenerationTask,
  getProject,
  getProjectFile,
  getTree,
  importProject,
  listGenerationTasks,
  listProjects,
  regenerateProject,
} from "./api/client";
import CodeViewer from "./components/CodeViewer";
import ExplainPanel from "./components/ExplainPanel";
import LLMSettingsDialog from "./components/LLMSettingsDialog";
import MarkdownViewer from "./components/MarkdownViewer";
import RepositoryForm from "./components/RepositoryForm";
import Sidebar from "./components/Sidebar";

type ViewerMode = "empty" | "code" | "course";
type ScopeType = LearningScope["type"];
type DragTarget = "sidebar" | "explain" | null;

const TERMINAL_TASK_STATUSES = new Set(["completed", "failed"]);

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

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [courses, setCourses] = useState<CourseFile[]>([]);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewerMode>("empty");
  const [loading, setLoading] = useState(false);
  const [busyProjectId, setBusyProjectId] = useState<number | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explanation, setExplanation] = useState("选择文件或课件后，可点击右上角刷新按钮手动生成解释。调用模型 API 前会再次确认。");
  const [provider, setProvider] = useState("manual");
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scopeType, setScopeType] = useState<ScopeType>("full_project");
  const [scopePathsText, setScopePathsText] = useState("");
  const [generationInstructions, setGenerationInstructions] = useState("");
  const [activeTask, setActiveTask] = useState<GenerationTask | null>(null);
  const [taskMessage, setTaskMessage] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [explainWidth, setExplainWidth] = useState(320);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);

  const selectedCourseTitle = useMemo(() => {
    return courses.find((file) => file.filename === selectedCourse)?.title ?? selectedCourse;
  }, [courses, selectedCourse]);

  const selectedContext = fileContent?.path ?? selectedCourse ?? "";
  const canGenerateFileLesson = Boolean(project && fileContent);
  const isTaskRunning = activeTask ? !TERMINAL_TASK_STATUSES.has(activeTask.status) : false;

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (!dragTarget) {
      return;
    }
    function onMouseMove(event: MouseEvent) {
      if (dragTarget === "sidebar") {
        setSidebarWidth(Math.min(520, Math.max(220, event.clientX)));
      } else if (dragTarget === "explain") {
        setExplainWidth(Math.min(560, Math.max(240, window.innerWidth - event.clientX)));
      }
    }
    function onMouseUp() {
      setDragTarget(null);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    document.body.classList.add("resizing");
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.classList.remove("resizing");
    };
  }, [dragTarget]);

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

  async function openProject(nextProject: Project) {
    setError("");
    setLoading(true);
    try {
      const freshProject = await getProject(nextProject.id);
      setProject(freshProject);
      const [nextTree, nextCourses, tasks] = await Promise.all([
        getTree(freshProject.id),
        getCourseFiles(freshProject.id),
        listGenerationTasks(freshProject.id),
      ]);
      setTree(nextTree);
      setCourses(nextCourses);
      setActiveTask(tasks[0] ?? null);
      setTaskMessage(tasks[0] ? `最近任务：${taskLabel(tasks[0])}` : "当前默认内容为“待生成”，不会自动调用模型 API。");
      setFileContent(null);
      setProvider("manual");
      setExplanation("已打开项目。请选择文件或课件；需要解释时手动点击右侧刷新按钮。");
      const firstCourse = nextCourses.find((file) => file.filename === "outline.md") ?? nextCourses[0];
      if (firstCourse) {
        const content = await getCourseContent(freshProject.id, firstCourse.filename);
        setSelectedCourse(firstCourse.filename);
        setMarkdown(content.content);
        setMode("course");
      } else {
        setSelectedCourse(null);
        setMarkdown("");
        setMode("empty");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "打开项目失败");
    } finally {
      setLoading(false);
    }
  }

  async function refreshExplain(nextMode = mode, path = selectedContext) {
    if (!project) {
      return;
    }
    if (!path) {
      setExplanation("请先选择一个文件或课件。");
      return;
    }
    const ok = window.confirm("将调用模型 API 生成解释，可能消耗 token。是否继续？");
    if (!ok) {
      return;
    }
    setExplainLoading(true);
    try {
      const result = await explainCurrent(project.id, path, nextMode === "course" ? "course" : "file");
      setProvider(result.provider);
      setExplanation(result.explanation);
    } catch (caught) {
      setExplanation(caught instanceof Error ? caught.message : "解释失败");
    } finally {
      setExplainLoading(false);
    }
  }

  async function handleImport(url: string) {
    setLoading(true);
    setError("");
    setExplanation("导入项目不会自动调用模型 API。");
    setTaskMessage("");
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
      const content = await getProjectFile(project.id, path);
      setFileContent(content);
      setSelectedCourse(null);
      setMode("code");
      setProvider("manual");
      setExplanation("已选择文件。可在上方输入要求后生成粗略介绍或详细分析；右侧解释需要手动确认。");
      if (scopeType === "files") {
        setScopePathsText(path);
      } else if (scopeType === "directories") {
        setScopePathsText(parentDir(path));
      }
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
      const content = await getCourseContent(project.id, filename);
      setSelectedCourse(filename);
      setMarkdown(content.content);
      setFileContent(null);
      setMode("course");
      setProvider("manual");
      setExplanation("已选择课件。若要重新生成，请在中间栏上方输入新的要求后点击生成按钮。");
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
      setTaskMessage(`生成任务：${taskLabel(nextTask)}`);
    }
    const nextCourses = await refreshCourses(project.id);
    const freshProject = await getProject(project.id);
    setProject(freshProject);
    setProjects((items) => items.map((item) => (item.id === freshProject.id ? freshProject : item)));
    if (nextTask.status === "completed") {
      setTaskMessage("生成完成，课程目录已刷新。");
      const preferred = nextTask.task_type === "file_lesson"
        ? nextCourses.find((item) => item.filename === nextTask.output_path?.split("/").slice(-2).join("/"))
        : nextCourses.find((item) => item.filename === "outline.md");
      if (preferred) {
        await handleSelectCourse(preferred.filename);
      } else if (selectedCourse) {
        const content = await getCourseContent(project.id, selectedCourse).catch(() => null);
        if (content) {
          setMarkdown(content.content);
        }
      }
    } else if (nextTask.status === "failed") {
      setTaskMessage(`生成失败：${nextTask.error_message ?? "未知错误"}。旧课件已保留。`);
    }
  }

  async function handleGenerateOutline() {
    if (!project) {
      return;
    }
    const ok = window.confirm("将调用模型 API 生成或重新生成项目总纲，可能消耗 token。是否继续？");
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
    const ok = window.confirm(`将调用模型 API 为 ${fileContent.path} 生成或重新生成${label}，可能消耗 token。是否继续？`);
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
    if (!window.confirm(`删除本地导入项目 ${nextProject.name}？克隆目录和生成内容都会删除。`)) {
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
        setMarkdown("");
        setMode("empty");
        setExplanation("选择文件或课件后，可点击右上角刷新按钮手动生成解释。");
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>GitHub 项目学习器</strong>
          <span>{project ? project.name : "MVP"}</span>
        </div>
        <RepositoryForm loading={loading} onSubmit={handleImport} />
        <button className="topbar-action" onClick={() => setSettingsOpen(true)} title="配置模型 API">
          模型 API
        </button>
      </header>
      {error ? <div className="error-bar">{error}</div> : null}
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
          onSelectProject={openProject}
          onRegenerateProject={handleRegenerate}
          onDeleteProject={handleDelete}
          onSelectFile={handleSelectFile}
          onSelectCourse={handleSelectCourse}
        />
        <div className="resize-handle" onMouseDown={() => setDragTarget("sidebar")} title="拖拽调整左栏宽度" />
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
                placeholder="目录或文件路径，多个用逗号分隔"
                disabled={!project || scopeType === "full_project" || isTaskRunning}
              />
              <button onClick={handleGenerateOutline} disabled={!project || isTaskRunning}>
                生成/重新生成 AI 总纲
              </button>
            </div>
            <textarea
              className="generation-instructions"
              value={generationInstructions}
              onChange={(event) => setGenerationInstructions(event.target.value)}
              placeholder="重新提出要求，例如：面向 C++ 初学者；重点讲判题核心；每节课必须给出相关文件和自测题。"
              disabled={!project || isTaskRunning}
            />
            <div className="lesson-actions">
              <button onClick={() => handleGenerateFileLesson("brief")} disabled={!canGenerateFileLesson || isTaskRunning}>
                生成/重新生成粗略介绍
              </button>
              <button onClick={() => handleGenerateFileLesson("detailed")} disabled={!canGenerateFileLesson || isTaskRunning}>
                生成/重新生成详细分析
              </button>
            </div>
            <div className={`task-status ${activeTask?.status === "failed" ? "failed" : ""}`}>
              {taskMessage || "默认内容均为“待生成”；所有模型 API 调用都需要手动点击并确认。"}
            </div>
          </div>
          {mode === "code" && fileContent ? (
            <CodeViewer path={fileContent.path} language={fileContent.language} content={fileContent.content} />
          ) : null}
          {mode === "course" ? <MarkdownViewer title={selectedCourseTitle} content={markdown} /> : null}
          {mode === "empty" ? <div className="empty-state">导入仓库后开始阅读</div> : null}
        </section>
        <div className="resize-handle" onMouseDown={() => setDragTarget("explain")} title="拖拽调整右栏宽度" />
        <ExplainPanel provider={provider} explanation={explanation} loading={explainLoading} onRefresh={() => refreshExplain()} />
      </main>
      <LLMSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
