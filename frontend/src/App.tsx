import { useEffect, useMemo, useState } from "react";
import {
  CourseFile,
  FileContent,
  Project,
  TreeNode,
  deleteProject,
  explainCurrent,
  getCourseContent,
  getCourseFiles,
  getProject,
  getProjectFile,
  getTree,
  importProject,
  listProjects,
  regenerateProject,
} from "./api/client";
import CodeViewer from "./components/CodeViewer";
import ExplainPanel from "./components/ExplainPanel";
import MarkdownViewer from "./components/MarkdownViewer";
import RepositoryForm from "./components/RepositoryForm";
import Sidebar from "./components/Sidebar";

type ViewerMode = "empty" | "code" | "course";

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

  const selectedCourseTitle = useMemo(() => {
    return courses.find((file) => file.filename === selectedCourse)?.title ?? selectedCourse;
  }, [courses, selectedCourse]);

  useEffect(() => {
    loadProjects();
  }, []);

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

  async function openProject(nextProject: Project) {
    setError("");
    setLoading(true);
    try {
      const freshProject = await getProject(nextProject.id);
      setProject(freshProject);
      const [nextTree, nextCourses] = await Promise.all([getTree(freshProject.id), getCourseFiles(freshProject.id)]);
      setTree(nextTree);
      setCourses(nextCourses);
      setFileContent(null);
      const firstCourse = nextCourses.find((file) => file.filename === "outline.md") ?? nextCourses[0];
      if (firstCourse) {
        const content = await getCourseContent(freshProject.id, firstCourse.filename);
        setSelectedCourse(firstCourse.filename);
        setMarkdown(content.content);
        setMode("course");
        const result = await explainCurrent(freshProject.id, firstCourse.filename, "course");
        setProvider(result.provider);
        setExplanation(result.explanation);
      } else {
        setSelectedCourse(null);
        setMarkdown("");
        setMode("empty");
        setExplanation("");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "打开项目失败");
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
      setError(caught instanceof Error ? caught.message : "读取课程失败");
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
    if (!window.confirm(`删除本地导入项目 ${nextProject.name}？生成课程和克隆目录也会删除。`)) {
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
          {mode === "code" && fileContent ? (
            <CodeViewer path={fileContent.path} language={fileContent.language} content={fileContent.content} />
          ) : null}
          {mode === "course" ? <MarkdownViewer title={selectedCourseTitle} content={markdown} /> : null}
          {mode === "empty" ? <div className="empty-state">导入仓库后开始阅读</div> : null}
        </section>
        <ExplainPanel provider={provider} explanation={explanation} loading={explainLoading} onRefresh={() => refreshExplain()} />
      </main>
    </div>
  );
}
