import { RefreshCw, Trash2 } from "lucide-react";
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
  onSelectProject: (project: Project) => void;
  onRegenerateProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onSelectFile: (path: string) => void;
  onSelectCourse: (filename: string) => void;
};

export default function Sidebar({
  projects,
  currentProjectId,
  tree,
  courses,
  selectedPath,
  selectedCourse,
  busyProjectId,
  onSelectProject,
  onRegenerateProject,
  onDeleteProject,
  onSelectFile,
  onSelectCourse,
}: Props) {
  return (
    <aside className="sidebar">
      <section className="project-section">
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
      <section>
        <h2>文件树</h2>
        <div className="sidebar-scroll">
          {tree ? <FileTree node={tree} selectedPath={selectedPath} onSelect={onSelectFile} /> : <div className="empty">暂无项目</div>}
        </div>
      </section>
      <section>
        <h2>课程目录</h2>
        <div className="sidebar-scroll compact">
          <CourseList files={courses} selected={selectedCourse} onSelect={onSelectCourse} />
        </div>
      </section>
    </aside>
  );
}
