import type { DragEvent, ReactNode } from "react";
import { MoreHorizontal, X } from "lucide-react";
import MobileReaderHeader from "../components/MobileReaderHeader";
import SlidingSelectionIndicator from "../components/SlidingSelectionIndicator";
import { setCodeCourseDragImage } from "../utils/dragImage";
import type { EditorGroup, OpenItem } from "./layout";

export type MobileReaderLesson = {
  index: number;
  total: number;
  completed: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  onToggleComplete: () => void;
};

type Props = {
  group: EditorGroup;
  active: boolean;
  mobile: boolean;
  mobileLesson?: MobileReaderLesson;
  mobileLanguage?: string;
  mobileActions?: ReactNode;
  onMobileSearch?: () => void;
  workspaceMenuOpen: boolean;
  canUndoLayout: boolean;
  canManageGroups: boolean;
  onActivatePane: () => void;
  onActivateItem: (item: OpenItem) => void;
  onCloseItem: (itemId: string) => void;
  onTabDragEnd: (event: DragEvent<HTMLElement>, item: OpenItem) => void;
  onToggleWorkspaceMenu: () => void;
  onUndoLayout: () => void;
  onEqualize: () => void;
  onMergeGroups: () => void;
  onCloseGroup: () => void;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLElement>) => void;
  onDrop?: (event: DragEvent<HTMLElement>) => void;
  children: ReactNode;
};

export default function EditorPaneFrame({
  group,
  active,
  mobile,
  mobileLesson,
  mobileLanguage,
  mobileActions,
  onMobileSearch,
  workspaceMenuOpen,
  canUndoLayout,
  canManageGroups,
  onActivatePane,
  onActivateItem,
  onCloseItem,
  onTabDragEnd,
  onToggleWorkspaceMenu,
  onUndoLayout,
  onEqualize,
  onMergeGroups,
  onCloseGroup,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: Props) {
  return (
    <section
      className={`reader-pane ${active ? "active" : ""}`}
      onClick={onActivatePane}
      onDragOver={mobile ? undefined : onDragOver}
      onDragLeave={mobile ? undefined : onDragLeave}
      onDrop={mobile ? undefined : onDrop}
    >
      {mobile ? (
        group.items.length > 0 ? (
          <MobileReaderHeader
            tabs={group.items.map((item) => ({
              id: item.id,
              title: item.title,
              path: item.path,
              dirty: Boolean(item.dirty),
            }))}
            activeId={group.activeItemId}
            onActivate={(itemId) => {
              const item = group.items.find((entry) => entry.id === itemId);
              if (item) onActivateItem(item);
            }}
            onClose={onCloseItem}
            lesson={mobileLesson}
            language={mobileLanguage}
            onSearch={onMobileSearch}
            actions={mobileActions}
          />
        ) : null
      ) : (
        <div className="pane-tabs">
          <SlidingSelectionIndicator activeKey={group.activeItemId} className="pane-tab-indicator" />
          <span className="pane-name">工作区</span>
          {group.items.map((item) => (
            <div
              key={item.id}
              className={`pane-tab ${item.id === group.activeItemId ? "active" : ""}`}
              data-selection-key={item.id}
              role="tab"
              aria-selected={item.id === group.activeItemId}
              title={item.path}
              draggable={item.type !== "knowledge_graph"}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/codecourse-tab", item.id);
                event.dataTransfer.setData("application/codecourse-item", JSON.stringify({
                  kind: "tab",
                  itemId: item.id,
                  sourceGroupId: group.id,
                }));
                setCodeCourseDragImage(event.dataTransfer, item.title);
              }}
              onDragEnd={(event) => onTabDragEnd(event, item)}
            >
              <button type="button" className="pane-tab-main" onClick={() => onActivateItem(item)}>
                <span>{item.dirty ? `${item.title} *` : item.title}</span>
              </button>
              <button
                type="button"
                className="pane-tab-close"
                aria-label={`关闭 ${item.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseItem(item.id);
                }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {!mobile ? (
        <div className="pane-workspace-actions" onClick={(event) => event.stopPropagation()}>
          <button
            className="icon-button pane-workspace-menu-button"
            onClick={onToggleWorkspaceMenu}
            title="工作区选项"
            aria-label="工作区选项"
            aria-expanded={workspaceMenuOpen}
          >
            <MoreHorizontal size={15} />
          </button>
          {workspaceMenuOpen ? (
            <div className="pane-workspace-menu" role="menu">
              <button type="button" role="menuitem" onClick={onUndoLayout} disabled={!canUndoLayout}>撤销布局调整</button>
              <button type="button" role="menuitem" onClick={onEqualize} disabled={!canManageGroups}>平均分配工作区</button>
              <button type="button" role="menuitem" onClick={onMergeGroups} disabled={!canManageGroups}>合并全部到当前组</button>
              <div className="pane-workspace-menu-separator" />
              <button type="button" role="menuitem" className="danger" onClick={onCloseGroup} disabled={!canManageGroups}>关闭当前工作区</button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="pane-body">{children}</div>
      {!mobile ? <div className="drop-preview" aria-hidden="true" /> : null}
    </section>
  );
}
