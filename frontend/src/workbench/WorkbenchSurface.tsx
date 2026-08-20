import type { ReactNode } from "react";
import { AlertCircle, BookOpen, Download } from "lucide-react";
import WorkbenchLayoutTree, { type SplitResizeStart } from "./WorkbenchLayoutTree";
import type { EditorGroup, LayoutNode } from "./layout";

export type WorkbenchSurfaceProps = {
  mobile: boolean;
  mobilePanelOpen: boolean;
  projectAvailable: boolean;
  projectError: string;
  layout: LayoutNode;
  navigationOpen: boolean;
  assistantOpen: boolean;
  navigationResizing: boolean;
  assistantResizing: boolean;
  sidebarWidth: number;
  assistantWidth: number;
  navigationContent?: ReactNode;
  assistantContent?: ReactNode;
  renderGroup: (group: EditorGroup) => ReactNode;
  onCollapseSplit: (splitId: string, removeSide: "first" | "second") => void;
  onStartSplitResize: (state: SplitResizeStart) => void;
  onStartNavigationResize: (clientX: number) => void;
  onStartAssistantResize: (clientX: number) => void;
  onRelocateProject: () => void;
  onReturnToProjects: () => void;
  onImportProject: () => void;
  onCreateLearningPlan: () => void;
};

export default function WorkbenchSurface(props: WorkbenchSurfaceProps) {
  const {
    mobile,
    mobilePanelOpen,
    projectAvailable,
    projectError,
    layout,
    navigationOpen,
    assistantOpen,
    navigationResizing,
    assistantResizing,
    sidebarWidth,
    assistantWidth,
  } = props;

  return (
    <main
      className={`workbench ${navigationOpen ? "navigation-open" : ""} ${assistantOpen && !mobile ? "assistant-open" : ""} ${mobilePanelOpen ? "mobile-panel-open" : ""} ${navigationResizing ? "navigation-resizing" : ""} ${assistantResizing ? "assistant-resizing" : ""}`}
      style={{
        gridTemplateColumns: [
          ...(navigationOpen && !mobile ? [`var(--nav-width, ${sidebarWidth}px)`, "5px"] : []),
          "minmax(0, 1fr)",
          ...(assistantOpen && !mobile ? ["5px", `var(--explain-width, ${assistantWidth}px)`] : []),
        ].join(" "),
      }}
    >
      {navigationOpen && !mobile ? props.navigationContent : null}
      {navigationOpen && !mobile ? (
        <div
          className="resize-handle navigation-resizer"
          onMouseDown={(event) => props.onStartNavigationResize(event.clientX)}
          title="拖拽调整左栏宽度"
        />
      ) : null}
      <section className="center-pane">
        {projectAvailable ? (
          <div className="reader-workspace">
            <WorkbenchLayoutTree
              layout={layout}
              mobile={mobile}
              renderGroup={props.renderGroup}
              onCollapseSplit={props.onCollapseSplit}
              onStartResize={props.onStartSplitResize}
            />
          </div>
        ) : projectError ? (
          <section className="learning-empty-state">
            <div className="learning-empty-mark"><AlertCircle size={24} /></div>
            <h1>项目无法打开</h1>
            <p>{projectError}</p>
            <div>
              <button className="primary-button" onClick={props.onRelocateProject}>重新定位目录</button>
              <button className="secondary-button" onClick={props.onReturnToProjects}>返回项目列表</button>
            </div>
          </section>
        ) : (
          <section className="learning-empty-state">
            <div className="learning-empty-mark"><BookOpen size={24} /></div>
            <h1>从一个项目开始学习</h1>
            <p>导入 GitHub 仓库，或先创建一个自定义学习计划。</p>
            <div>
              <button className="primary-button" onClick={props.onImportProject}><Download size={15} />导入仓库</button>
              <button className="secondary-button" onClick={props.onCreateLearningPlan}>新建学习计划</button>
            </div>
          </section>
        )}
      </section>
      {!mobile ? (
        <div
          className={`resize-handle assistant-resizer ${assistantOpen ? "visible" : ""}`}
          onMouseDown={(event) => props.onStartAssistantResize(event.clientX)}
          title="拖拽调整右栏宽度"
        />
      ) : null}
      {!mobile && assistantOpen ? <div className="assistant-drawer open">{props.assistantContent}</div> : null}
    </main>
  );
}
