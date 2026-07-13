import { Plus, RefreshCw, Trash2 } from "lucide-react";
import type { CourseFile, Project, TreeNode } from "../api/client";
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
          <span>源码</span>
          {fileSelectionMode ? <small>点击选择，双击打开</small> : null}
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
        <span>课程</span>
        {onCreateCourse ? (
          <button className="icon-button" onClick={onCreateCourse} disabled={!currentProjectId} title="新建文档">
            <Plus size={16} />
          </button>
        ) : null}
      </header>
      <div className="sidebar-scroll compact">
        {courses.length ? <CourseList files={courses} selected={selectedCourse} onSelect={onSelectCourse} onDelete={onDeleteCourse} /> : (
          <div className="empty">还没有课程内容</div>
        )}
      </div>
    </aside>
  );
}
