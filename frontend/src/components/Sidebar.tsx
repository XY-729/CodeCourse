import { RefreshCw, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";
import type { CourseFile, Project, TreeNode } from "../api/client";
import CourseList from "./CourseList";
import FileTree from "./FileTree";

type Props = {
  projects: Project[];
  currentProjectId: number | null;
  tree: TreeNode | null;
  courses: CourseFile[];
  selectedPath: string | null;
  selectedCourse: string | null;
  busyProjectId: number | null;
  projectHeight: number;
  courseHeight: number;
  onResizeProjectStart: (event: MouseEvent<HTMLDivElement>) => void;
  onResizeCourseStart: (event: MouseEvent<HTMLDivElement>) => void;
  onSelectProject: (project: Project) => void;
  onRegenerateProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onSelectFile: (path: string) => void;
  onSelectCourse: (filename: string) => void;
  onDeleteCourse?: (file: CourseFile) => void;
};

export default function Sidebar({
  projects,
  currentProjectId,
  tree,
  courses,
  selectedPath,
  selectedCourse,
  busyProjectId,
  projectHeight,
  courseHeight,
  onResizeProjectStart,
  onResizeCourseStart,
  onSelectProject,
  onRegenerateProject,
  onDeleteProject,
  onSelectFile,
  onSelectCourse,
  onDeleteCourse,
}: Props) {
  return (
    <aside
      className="sidebar"
      style={{ gridTemplateRows: `${projectHeight}px 6px minmax(120px, 1fr) 6px ${courseHeight}px` }}
    >
      <section className="sidebar-section">
        <h2>已导入项目</h2>
        <div className="sidebar-scroll compact">
          {projects.length ? (
            projects.map((project) => (
              <div className={`project-row ${project.id === currentProjectId ? "selected" : ""}`} key={project.id}>
                <button className="project-main" onClick={() => onSelectProject(project)} title={project.url}>
                  <span>{project.name}</span>
                  <small>{project.status}</small>
                </button>
                <button
                  className="icon-button"
                  onClick={() => onRegenerateProject(project)}
                  disabled={busyProjectId === project.id}
                  title="重置为待生成"
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  className="icon-button danger"
                  onClick={() => onDeleteProject(project)}
                  disabled={busyProjectId === project.id}
                  title="删除本地导入"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          ) : (
            <div className="empty">暂无导入</div>
          )}
        </div>
      </section>
      <div className="resize-handle-y" onMouseDown={onResizeProjectStart} title="上下拖动调整项目区高度" />
      <section className="sidebar-section">
        <h2>文件树</h2>
        <div className="sidebar-scroll">
          {tree ? <FileTree node={tree} selectedPath={selectedPath} onSelect={onSelectFile} /> : <div className="empty">暂无项目</div>}
        </div>
      </section>
      <div className="resize-handle-y" onMouseDown={onResizeCourseStart} title="上下拖动调整课程目录高度" />
      <section className="sidebar-section">
        <h2>课程目录</h2>
        <div className="sidebar-scroll compact">
          <CourseList files={courses} selected={selectedCourse} onSelect={onSelectCourse} onDelete={onDeleteCourse} />
        </div>
      </section>
    </aside>
  );
}
