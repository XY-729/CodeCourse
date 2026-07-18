import { Check, ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  title: string;
  index: number;
  total: number;
  completed: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  onToggleComplete: () => void;
};

export default function ReaderLearningToolbar({ title, index, total, completed, onPrevious, onNext, onToggleComplete }: Props) {
  return (
    <div className="reader-learning-toolbar">
      <div className="reader-breadcrumb"><span>课程</span><ChevronRight size={13} /><strong>{title}</strong></div>
      <div className="reader-learning-actions">
        <span className="lesson-position">{index + 1}/{total}</span>
        <button className="icon-button" onClick={onPrevious} disabled={!onPrevious} title="上一课"><ChevronLeft size={16} /></button>
        <button className="icon-button" onClick={onNext} disabled={!onNext} title="下一课"><ChevronRight size={16} /></button>
        <button className={`secondary-button compact complete-button ${completed ? "completed" : ""}`} onClick={onToggleComplete}>
          <Check size={14} />{completed ? "已完成" : "标记完成"}
        </button>
      </div>
    </div>
  );
}
