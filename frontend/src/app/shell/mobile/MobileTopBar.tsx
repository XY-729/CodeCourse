import { ChevronDown, MoreHorizontal, Search } from "lucide-react";

type Props = {
  projectName: string | null;
  projectSheetOpen: boolean;
  onToggleProjects: () => void;
  onSearch: () => void;
  onMore: () => void;
};

export default function MobileTopBar({
  projectName,
  projectSheetOpen,
  onToggleProjects,
  onSearch,
  onMore,
}: Props) {
  const currentProjectName = projectName?.trim() || "选择项目";

  return (
    <header className="mobile-app-bar">
      <button
        type="button"
        className="mobile-project-control"
        onClick={onToggleProjects}
        aria-expanded={projectSheetOpen}
        aria-label={`切换项目，当前项目：${currentProjectName}`}
      >
        <span className="mobile-project-control-copy">
          <small>当前项目</small>
          <strong>{currentProjectName}</strong>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>

      <div className="mobile-app-bar-actions">
        <button
          type="button"
          className="mobile-shell-icon-button"
          onClick={onSearch}
          aria-label="搜索课程、源码和回答"
          title="搜索"
        >
          <Search size={20} />
        </button>
        <button
          type="button"
          className="mobile-shell-icon-button"
          onClick={onMore}
          aria-label="更多操作"
          title="更多"
        >
          <MoreHorizontal size={21} />
        </button>
      </div>
    </header>
  );
}
