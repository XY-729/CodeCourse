import { useEffect, useRef, useState, type ReactNode } from "react";
import { Star, ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  title: string;
  index: number;
  total: number;
  completed: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  onToggleComplete: () => void;
  actions?: ReactNode;
};

export default function ReaderLearningToolbar({ title, index, total, completed, onPrevious, onNext, onToggleComplete, actions }: Props) {
  const requested = useRef(false);
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (!completed || !requested.current) return;
    requested.current = false;
    setCelebrating(true);
    const timer = window.setTimeout(() => setCelebrating(false), 2400);
    return () => window.clearTimeout(timer);
  }, [completed]);
  return (
    <div className={`reader-learning-toolbar ${celebrating && completed ? "is-celebrating" : ""}`}>
      <div className="reader-breadcrumb" title={title}><span className="lesson-station">第 {index + 1} 站</span><span className="lesson-station-total">/ {total}</span><span className="lesson-celebration" role="status">{celebrating && completed ? "✦ 又点亮了一颗星" : ""}</span></div>
      <div className="reader-learning-actions">
        {actions}
        <button className="icon-button" onClick={onPrevious} disabled={!onPrevious} title="上一课" aria-label="上一课"><ChevronLeft size={16} /></button>
        <button className="icon-button" onClick={onNext} disabled={!onNext} title="下一课" aria-label="下一课"><ChevronRight size={16} /></button>
        <button type="button" aria-pressed={completed} aria-label={completed ? "已完成" : "标记完成"} title={completed ? "点击恢复为学习中" : "完成这一课，点亮一颗星"} className={`secondary-button compact complete-button ${completed ? "completed" : ""}`} onClick={() => { requested.current = !completed; setCelebrating(false); onToggleComplete(); }}>
          <Star size={15} fill={completed ? "currentColor" : "none"} />{completed ? "已完成" : "完成这一课"}
        </button>
      </div>
    </div>
  );
}
