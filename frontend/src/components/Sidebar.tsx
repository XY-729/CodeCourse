import { ArrowRight, BookOpen, CheckCircle2, Code2, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { CourseFile, LearningState, Project, TreeNode } from "../api/client";
import CourseList from "./CourseList";
import FileTree from "./FileTree";

export type NavigationView = "projects" | "courses" | "files";

type Props = {
  view: NavigationView;
  projects: Project[];
  currentProjectId: number | null;
  tree: TreeNode | null;
  courses: CourseFile[];
  selectedPath: string | null;
  selectedScopePaths: string[];
  selectedCourse: string | null;
  projectType: Project["project_type"];
  fileSelectionMode: boolean;
  busyProjectId: number | null;
  onSelectProject: (project: Project) => void;
  onCreateLearningPlan: () => void;
  onRegenerateProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onSelectFile: (path: string) => void;
  onOpenFile: (path: string) => void;
  onSelectCourse: (filename: string) => void;
  onCreateCourse?: () => void;
  onDeleteCourse?: (file: CourseFile) => void;
  learningStates?: LearningState[];
  onContinueLearning?: (filename: string) => void;
  onViewChange?: (view: Extract<NavigationView, "courses" | "files">) => void;
};

export default function Sidebar({
  view,
  projects,
  currentProjectId,
  tree,
  courses,
  selectedPath,
  selectedScopePaths,
  selectedCourse,
  projectType,
  fileSelectionMode,
  busyProjectId,
  onSelectProject,
  onCreateLearningPlan,
  onRegenerateProject,
  onDeleteProject,
  onSelectFile,
  onOpenFile,
  onSelectCourse,
  onCreateCourse,
  onDeleteCourse,
  learningStates = [],
  onContinueLearning,
  onViewChange,
}: Props) {
  if (view === "projects") {
    return (
      <aside className="sidebar navigation-panel">
        <header className="navigation-panel-header">
          <span>项目</span>
          <button className="icon-button" onClick={onCreateLearningPlan} title="新建学习计划">
            <Plus size={16} />
          </button>
        </header>
        <div className="sidebar-scroll compact">
          {projects.length ? (
            projects.map((item) => (
              <div className={`project-row ${item.id === currentProjectId ? "selected" : ""}`} key={item.id}>
                <button className="project-main" onClick={() => onSelectProject(item)} title={item.url}>
                  <span>{item.name}</span>
                  <small>{item.project_type === "learning_plan" ? "学习计划" : item.status}</small>
                </button>
                {item.project_type === "learning_plan" ? <span /> : (
                  <button className="icon-button" onClick={() => onRegenerateProject(item)} disabled={busyProjectId === item.id} title="重新生成规则课程">
                    <RefreshCw size={14} />
                  </button>
                )}
                <button className="icon-button danger" onClick={() => onDeleteProject(item)} disabled={busyProjectId === item.id} title="删除项目">
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          ) : <div className="empty">还没有项目</div>}
        </div>
      </aside>
    );
  }

  if (view === "files") {
    return (
      <aside className="sidebar navigation-panel">
        <header className="navigation-panel-header">
          {onViewChange ? (
            <div className="navigation-segmented" aria-label="导航内容">
              <button onClick={() => onViewChange("courses")}><BookOpen size={14} />课程</button>
              <button className="active" onClick={() => onViewChange("files")}><Code2 size={14} />源码</button>
            </div>
          ) : <span>源码</span>}
          {fileSelectionMode ? <small>选择生成范围</small> : null}
        </header>
        <div className="sidebar-scroll">
          {projectType === "learning_plan" ? <div className="empty">学习计划不包含源码文件</div> : tree ? (
            <FileTree
              node={tree}
              selectedPath={selectedPath}
              selectedScopePaths={selectedScopePaths}
              fileSelectionMode={fileSelectionMode}
              onSelect={onSelectFile}
              onOpenFile={onOpenFile}
            />
          ) : <div className="empty">选择项目后查看源码</div>}
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar navigation-panel">
      <header className="navigation-panel-header">
        {onViewChange ? (
          <div className="navigation-segmented" aria-label="导航内容">
            <button className="active" onClick={() => onViewChange("courses")}><BookOpen size={14} />课程</button>
            <button onClick={() => onViewChange("files")}><Code2 size={14} />源码</button>
          </div>
        ) : <span>课程</span>}
        {onCreateCourse ? (
          <button className="icon-button" onClick={onCreateCourse} disabled={!currentProjectId} title="新建文档">
            <Plus size={16} />
          </button>
        ) : null}
      </header>
      <div className="sidebar-scroll compact">
        {(() => {
          const lessons = courses.filter((file) => /^lessons\/lesson_\d+\.md$/i.test(file.filename));
          const completed = lessons.filter((file) => learningStates.some((entry) => entry.source_type === "course" && entry.source_path === file.filename && entry.status === "completed")).length;
          const recent = [...learningStates].filter((entry) => entry.source_type === "course" && lessons.some((file) => file.filename === entry.source_path)).sort((a, b) => b.last_opened_at.localeCompare(a.last_opened_at))[0];
          const next = lessons.find((file) => !learningStates.some((entry) => entry.source_type === "course" && entry.source_path === file.filename && entry.status === "completed"));
          const target = recent?.source_path ?? next?.filename;
          const complete = completed === lessons.length;
          const progress = lessons.length ? (completed / lessons.length) * 100 : 0;
          return lessons.length ? (
            <section className={`continue-learning-card ${complete ? "is-complete" : ""}`}>
              <div className="continue-learning-copy">
                <span className="continue-learning-kicker">
                  {complete ? <CheckCircle2 size={13} /> : <i aria-hidden="true" />}
                  {complete ? "阶段完成" : "继续学习"}
                </span>
                <strong>{courses.find((file) => file.filename === target)?.title ?? "从第一课开始"}</strong>
              </div>
              <button className="secondary-button compact continue-learning-action" onClick={() => target && onContinueLearning?.(target)} disabled={!target}>
                {complete ? "复习" : "继续"}<ArrowRight size={13} />
              </button>
              <div className="learning-progress-track" role="progressbar" aria-label="课程学习进度" aria-valuemin={0} aria-valuemax={lessons.length} aria-valuenow={completed}>
                <span style={{ width: `${progress}%` }} />
              </div>
              <small>{complete ? `已完成全部 ${lessons.length} 课` : `${completed}/${lessons.length} 课已完成`}</small>
            </section>
          ) : null;
        })()}
        {courses.length ? <CourseList files={courses} selected={selectedCourse} onSelect={onSelectCourse} onDelete={onDeleteCourse} learningStates={learningStates} /> : (
          <div className="empty">还没有课程内容</div>
        )}
      </div>
    </aside>
  );
}
