import { Check, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export type MobileReaderTabItem = {
  id: string;
  title: string;
  path: string;
  dirty?: boolean;
};

export type MobileReaderLessonState = {
  index: number;
  total: number;
  completed: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  onToggleComplete: () => void;
};

type Props = {
  tabs: MobileReaderTabItem[];
  activeId: string | null;
  onActivate: (itemId: string) => void;
  onClose: (itemId: string) => void;
  lesson?: MobileReaderLessonState;
  language?: string | null;
  onSearch?: () => void;
  actions?: ReactNode;
};

export default function MobileReaderHeader({
  tabs,
  activeId,
  onActivate,
  onClose,
  lesson,
  language,
  onSearch,
  actions,
}: Props) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!activeId) return;
    const frame = window.requestAnimationFrame(() => {
      const strip = stripRef.current;
      const tab = tabRefs.current.get(activeId);
      if (!strip || !tab) return;
      const sr = strip.getBoundingClientRect();
      const tr = tab.getBoundingClientRect();
      const pad = 8;
      if (tr.left < sr.left + pad) {
        strip.scrollBy({ left: tr.left - sr.left - pad, behavior: "smooth" });
      } else if (tr.right > sr.right - pad) {
        strip.scrollBy({ left: tr.right - sr.right + pad, behavior: "smooth" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeId, tabs.length]);

  return (
    <div className="mobile-reader-header">
      <div ref={stripRef} className="mobile-reader-tabs" role="tablist" aria-label="已打开的文档">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              ref={(node) => { if (node) tabRefs.current.set(tab.id, node); else tabRefs.current.delete(tab.id); }}
              className={`mobile-reader-tab ${active ? "active" : ""}`}
              role="presentation"
              title={tab.path}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className="mobile-reader-tab-main"
                onClick={() => onActivate(tab.id)}
              >
                <span>{tab.dirty ? `${tab.title} *` : tab.title}</span>
              </button>
              <button
                type="button"
                className="mobile-reader-tab-close"
                aria-label={`关闭 ${tab.title}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); onClose(tab.id); }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      {lesson || language || onSearch || actions ? (
        <div className="mobile-reader-actions">
          {lesson ? (
            <>
              <button type="button" className="mobile-reader-action-button" onClick={lesson.onPrevious} disabled={!lesson.onPrevious} aria-label="上一课" title="上一课">
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <span className="mobile-reader-position" aria-label={`第 ${lesson.index + 1} 课，共 ${lesson.total} 课`}>
                {lesson.index + 1}/{lesson.total}
              </span>
              <button type="button" className="mobile-reader-action-button" onClick={lesson.onNext} disabled={!lesson.onNext} aria-label="下一课" title="下一课">
                <ChevronRight size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`mobile-reader-action-button mobile-reader-complete-button ${lesson.completed ? "completed" : ""}`}
                onClick={lesson.onToggleComplete}
                aria-pressed={lesson.completed}
                aria-label={lesson.completed ? "将本课标记为未完成" : "标记本课完成"}
                title={lesson.completed ? "已完成" : "标记完成"}
              >
                <Check size={18} aria-hidden="true" />
              </button>
            </>
          ) : null}

          {language ? <span className="mobile-reader-language" title={language}>{language}</span> : null}

          {onSearch ? (
            <button type="button" className="mobile-reader-action-button" onClick={onSearch} aria-label="在当前文件中搜索" title="在当前文件中搜索">
              <Search size={18} aria-hidden="true" />
            </button>
          ) : null}

          {actions}
        </div>
      ) : null}
    </div>
  );
}
