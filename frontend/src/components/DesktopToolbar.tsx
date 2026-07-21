import { useEffect, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  Code2,
  Download,
  FileText,
  FolderPlus,
  MoreHorizontal,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import type { Project } from "../api/client";

export type GenerationIntent = "outline" | "lesson" | "brief" | "detailed";

type Props = {
  project: Project | null;
  projects: Project[];
  activeTitle: string;
  progressLabel?: string;
  navigationOpen: boolean;
  assistantOpen: boolean;
  busyProjectId: number | null;
  loading: boolean;
  canGenerateLesson: boolean;
  canGenerateFile: boolean;
  indexLabel: string;
  indexDisabled: boolean;
  themeMode: "light" | "dark";
  onToggleNavigation: () => void;
  onSelectProject: (project: Project) => void;
  onImport: () => void;
  onCreateLearningPlan: () => void;
  onRegenerateProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onOpenGeneration: (intent: GenerationIntent) => void;
  onToggleAssistant: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
  onOpenPrompts: () => void;
  onBuildIndex: () => void;
  onToggleTheme: () => void;
};

type MenuName = "projects" | "generate" | "more" | null;

export default function DesktopToolbar(props: Props) {
  const {
    project,
    projects,
    activeTitle,
    progressLabel,
    navigationOpen,
    assistantOpen,
    busyProjectId,
    loading,
    canGenerateLesson,
    canGenerateFile,
    indexLabel,
    indexDisabled,
    themeMode,
    onToggleNavigation,
    onSelectProject,
    onImport,
    onCreateLearningPlan,
    onRegenerateProject,
    onDeleteProject,
    onOpenGeneration,
    onToggleAssistant,
    onOpenCommandPalette,
    onOpenSettings,
    onOpenPrompts,
    onBuildIndex,
    onToggleTheme,
  } = props;
  const [menu, setMenu] = useState<MenuName>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", closeOnPointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);

  function pickGeneration(intent: GenerationIntent) {
    setMenu(null);
    onOpenGeneration(intent);
  }

  return (
    <header className="apple-toolbar desktop-only" ref={rootRef}>
      <div className="apple-toolbar-leading">
        <button className="apple-icon-button" onClick={onToggleNavigation} title={navigationOpen ? "隐藏侧栏" : "显示侧栏"}>
          {navigationOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
        </button>

        <div className="apple-menu-anchor project-switcher-anchor">
          <button
            className={`apple-project-switcher ${menu === "projects" ? "active" : ""}`}
            onClick={() => setMenu((current) => current === "projects" ? null : "projects")}
            aria-haspopup="menu"
            aria-expanded={menu === "projects"}
          >
            <img src="./logo.ico" alt="" />
            <span>{project?.name ?? "选择项目"}</span>
            <ChevronDown size={13} />
          </button>
          {menu === "projects" ? (
            <div className="apple-popover project-popover" role="menu">
              <div className="apple-popover-heading">项目</div>
              <div className="project-popover-list">
                {projects.length ? projects.map((item) => (
                  <div className={`project-popover-row ${item.id === project?.id ? "selected" : ""}`} key={item.id}>
                    <button
                      className="project-popover-main"
                      onClick={() => { setMenu(null); onSelectProject(item); }}
                      title={item.url}
                    >
                      <span>{item.name}</span>
                      <small>{item.project_type === "learning_plan" ? "学习计划" : item.status}</small>
                    </button>
                    {item.project_type === "repository" ? (
                      <button className="apple-icon-button subtle" onClick={() => onRegenerateProject(item)} disabled={busyProjectId === item.id} title="重新扫描并生成规则课程">
                        <RefreshCw size={13} />
                      </button>
                    ) : null}
                    <button className="apple-icon-button subtle danger" onClick={() => onDeleteProject(item)} disabled={busyProjectId === item.id} title="删除项目">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )) : <div className="apple-popover-empty">还没有项目</div>}
              </div>
              <div className="apple-popover-divider" />
              <button role="menuitem" onClick={() => { setMenu(null); onImport(); }}><Download size={15} />导入 GitHub 仓库</button>
              <button role="menuitem" onClick={() => { setMenu(null); onCreateLearningPlan(); }}><FolderPlus size={15} />新建学习计划</button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="apple-document-identity" title={activeTitle}>
        <strong>{activeTitle}</strong>
        {progressLabel ? <span>{progressLabel}</span> : null}
      </div>

      <div className="apple-toolbar-actions">
        <button className="apple-search-button" onClick={onOpenCommandPalette} title="搜索课程、源码和命令">
          <Search size={15} />
          <span>搜索</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="apple-menu-anchor">
          <button
            className={`apple-toolbar-button ${menu === "generate" ? "active" : ""}`}
            onClick={() => setMenu((current) => current === "generate" ? null : "generate")}
            disabled={!project || loading}
            aria-label="生成学习内容"
            title="生成学习内容"
            aria-haspopup="menu"
            aria-expanded={menu === "generate"}
          >
            <Sparkles size={15} />
            <span>生成</span>
            <ChevronDown size={12} />
          </button>
          {menu === "generate" ? (
            <div className="apple-popover generation-popover" role="menu">
              <button onClick={() => pickGeneration("outline")}><FileText size={15} /><span><strong>学习总纲</strong><small>规划整个项目或学习主题</small></span></button>
              <button onClick={() => pickGeneration("lesson")} disabled={!canGenerateLesson}><Sparkles size={15} /><span><strong>当前课件</strong><small>重新生成正在阅读的一课</small></span></button>
              <div className="apple-popover-divider" />
              <button onClick={() => pickGeneration("brief")} disabled={!canGenerateFile}><Code2 size={15} /><span><strong>粗略介绍</strong><small>快速理解当前源码文件</small></span></button>
              <button onClick={() => pickGeneration("detailed")} disabled={!canGenerateFile}><Code2 size={15} /><span><strong>详细分析</strong><small>逐段学习当前源码文件</small></span></button>
            </div>
          ) : null}
        </div>

        <button className={`apple-icon-button ${assistantOpen ? "active" : ""}`} onClick={onToggleAssistant} title={assistantOpen ? "关闭 AI 助手" : "打开 AI 助手"}>
          <Bot size={17} />
        </button>

        <button
          className="apple-icon-button"
          onClick={onToggleTheme}
          title={themeMode === "dark" ? "切换到亮色模式" : "切换到暗色模式"}
          aria-label={themeMode === "dark" ? "切换到亮色模式" : "切换到暗色模式"}
        >
          {themeMode === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        <div className="apple-menu-anchor">
          <button className={`apple-icon-button ${menu === "more" ? "active" : ""}`} onClick={() => setMenu((current) => current === "more" ? null : "more")} title="更多">
            <MoreHorizontal size={18} />
          </button>
          {menu === "more" ? (
            <div className="apple-popover more-popover" role="menu">
              <button onClick={() => { setMenu(null); onOpenSettings(); }}><Bot size={15} />模型 API</button>
              <button onClick={() => { setMenu(null); onOpenPrompts(); }}><Sparkles size={15} />提示词编辑</button>
              <button onClick={() => { setMenu(null); onBuildIndex(); }} disabled={indexDisabled}><RefreshCw size={15} />{indexLabel}</button>
              <div className="apple-popover-divider" />
              <button onClick={() => { setMenu(null); onOpenCommandPalette(); }}><Settings2 size={15} />命令面板 <kbd>Ctrl K</kbd></button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
