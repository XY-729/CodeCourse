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
  const [explanation, setExplanation] = useState("");
  const [provider, setProvider] = useState("template");
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scopeType, setScopeType] = useState<ScopeType>("full_project");
  const [scopePathsText, setScopePathsText] = useState("");
  const [activeTask, setActiveTask] = useState<GenerationTask | null>(null);
  const [taskMessage, setTaskMessage] = useState("");

  const selectedCourseTitle = useMemo(() => {
    return courses.find((file) => file.filename === selectedCourse)?.title ?? selectedCourse;
  }, [courses, selectedCourse]);

  const canGenerateFileLesson = Boolean(project && fileContent);
  const isTaskRunning = activeTask ? !TERMINAL_TASK_STATUSES.has(activeTask.status) : false;

  useEffect(() => {
    loadProjects();
  }, []);

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

      // 1. 文件树是核心功能，必须优先加载，且独立失败提示
      try {
        const nextTree = await getTree(freshProject.id);
        setTree(nextTree);
      } catch (caught) {
        setTree(null);
        setCourses([]);
        setMode("empty");
        setError(caught instanceof Error ? `读取文件树失败：${caught.message}` : "读取文件树失败");
        return;
      }

      // 2. 课程目录是次核心，失败不应该影响文件树
      let nextCourses: CourseFile[] = [];
      try {
        nextCourses = await getCourseFiles(freshProject.id);
        setCourses(nextCourses);
      } catch (caught) {
        setCourses([]);
        setError(caught instanceof Error ? `读取课程目录失败：${caught.message}` : "读取课程目录失败");
      }

      // 3. 任务列表是附加功能，失败不能影响文件树和课程阅读
      try {
        const tasks = await listGenerationTasks(freshProject.id);
        setActiveTask(tasks[0] ?? null);
        setTaskMessage(tasks[0] ? `最近任务：${tasks[0].task_type} / ${tasks[0].status}` : "默认显示规则模板回退总纲");
      } catch (caught) {
        setActiveTask(null);
        setTaskMessage("任务状态接口不可用，不影响文件阅读。");
      }

      setFileContent(null);

      const firstCourse = nextCourses.find((file) => file.filename === "outline.md") ?? nextCourses[0];

      if (!firstCourse) {
        setSelectedCourse(null);
        setMarkdown("");
        setMode("empty");
        setExplanation("");
        return;
      }

      try {
        const firstContent = await getCourseContent(freshProject.id, firstCourse.filename);
        setSelectedCourse(firstCourse.filename);
        setMarkdown(firstContent.content);
        setMode("course");
      } catch (caught) {
        setSelectedCourse(null);
        setMarkdown("");
        setMode("empty");
        setError(caught instanceof Error ? `读取默认课件失败：${caught.message}` : "读取默认课件失败");
      }

      try {
        const result = await explainCurrent(freshProject.id, firstCourse.filename, "course");
        setProvider(result.provider);
        setExplanation(result.explanation);
      } catch {
        setProvider("template");
        setExplanation("解释面板加载失败，不影响文件树和课件阅读。");
      }
    } finally {
      setLoading(false);
    }
  }

  async function refreshExplain(nextMode = mode, path = fileContent?.path ?? selectedCourse) {
    if (!project) {
      return;
    }
    setExplainLoading(true);
    try {
      const result = await explainCurrent(project.id, path ?? null, nextMode === "course" ? "course" : "file");
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
    setExplanation("");
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
      if (scopeType === "files") {
        setScopePathsText(path);
      } else if (scopeType === "directories") {
        setScopePathsText(parentDir(path));
      }
      const result = await explainCurrent(project.id, path, "file");
      setProvider(result.provider);
      setExplanation(result.explanation);
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
      const result = await explainCurrent(project.id, filename, "course");
      setProvider(result.provider);
      setExplanation(result.explanation);
    } catch (caught) {
      setError(caught instanceof Error ? "读取课件失败：" + caught.message : "读取课件失败");
    }
  }

  async function trackTask(initialTask: GenerationTask) {
    if (!project) {
      return;
    }
    setActiveTask(initialTask);
    setTaskMessage(`任务已创建：${initialTask.task_type} / ${initialTask.status}`);
    let nextTask = initialTask;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (TERMINAL_TASK_STATUSES.has(nextTask.status)) {
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      nextTask = await getGenerationTask(project.id, initialTask.id);
      setActiveTask(nextTask);
      setTaskMessage(`生成任务：${nextTask.task_type} / ${nextTask.status}`);
    }
    await refreshCourses(project.id);
    const freshProject = await getProject(project.id);
    setProject(freshProject);
    setProjects((items) => items.map((item) => (item.id === freshProject.id ? freshProject : item)));
    if (nextTask.status === "completed") {
      setTaskMessage("生成完成，课程目录已刷新");
      if (selectedCourse) {
        const refreshedContent = await getCourseContent(project.id, selectedCourse).catch(() => null);
        if (refreshedContent) {
          setMarkdown(refreshedContent.content);
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
    setError("");
    try {
      const task = await generateOutline(project.id, buildScope());
      await trackTask(task);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建总纲任务失败");
    }
  }

  async function handleGenerateFileLesson(nextMode: "brief" | "detailed") {
    if (!project || !fileContent) {
      return;
    }
    setError("");
    try {
      const task = await generateFileLesson(project.id, fileContent.path, nextMode);
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
      setError(caught instanceof Error ? caught.message : "重新生成失败");
    } finally {
      setBusyProjectId(null);
    }
  }

  async function handleDelete(nextProject: Project) {
    if (!window.confirm(`删除本地导入项目 ${nextProject.name}？克隆目录也会删除。`)) {
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
        setExplanation("");
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
      <main className="workbench">
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
                生成 AI 总纲
              </button>
            </div>
            <div className="lesson-actions">
              <button onClick={() => handleGenerateFileLesson("brief")} disabled={!canGenerateFileLesson || isTaskRunning}>
                生成粗略课件
              </button>
              <button onClick={() => handleGenerateFileLesson("detailed")} disabled={!canGenerateFileLesson || isTaskRunning}>
                生成详细课件
              </button>
            </div>
            <div className={`task-status ${activeTask?.status === "failed" ? "failed" : ""}`}>{taskMessage || "导入后先显示规则模板回退内容；AI 内容按需生成。"}</div>
          </div>
          {mode === "code" && fileContent ? (
            <CodeViewer path={fileContent.path} language={fileContent.language} content={fileContent.content} />
          ) : null}
          {mode === "course" ? <MarkdownViewer title={selectedCourseTitle} content={markdown} /> : null}
          {mode === "empty" ? <div className="empty-state">导入仓库后开始阅读</div> : null}
        </section>
        <ExplainPanel provider={provider} explanation={explanation} loading={explainLoading} onRefresh={() => refreshExplain()} />
      </main>
      <LLMSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
