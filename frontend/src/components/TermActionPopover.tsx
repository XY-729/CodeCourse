import { BookOpen, CircleHelp, EyeOff, Sparkles, X } from "lucide-react";
import type { DocumentTerm } from "../api/client";
import { isAndroidRuntime } from "../platform/runtime";

type Props = {
  term: DocumentTerm;
  position?: { x: number; y: number };
  onGenerate: () => void;
  onKnown: () => void;
  onUnknown: () => void;
  onDismiss: () => void;
  onClose: () => void;
};

export default function TermActionPopover({
  term,
  position,
  onGenerate,
  onKnown,
  onUnknown,
  onDismiss,
  onClose,
}: Props) {
  const android = isAndroidRuntime();
  const style = android || !position
    ? undefined
    : {
        left: Math.max(12, Math.min(position.x, window.innerWidth - 292)),
        top: Math.max(12, Math.min(position.y, window.innerHeight - 260)),
      };
  return (
    <div className={`term-action-layer ${android ? "android" : "desktop"}`} onMouseDown={onClose}>
      <section
        className="term-action-popover"
        style={style}
        role="dialog"
        aria-label={`${term.term_text} 术语操作`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div><small>陌生术语</small><strong>{term.term_text}</strong></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </header>
        <div className="term-action-list">
          <button type="button" onClick={onGenerate}><Sparkles size={16} /><span><strong>生成解释</strong><small>确认后调用模型，并建立知识链接</small></span></button>
          <button type="button" onClick={onKnown}><BookOpen size={16} /><span><strong>我认识</strong><small>以后不再作为陌生术语强调</small></span></button>
          <button type="button" onClick={onUnknown}><CircleHelp size={16} /><span><strong>我不认识</strong><small>后续回答会先补充通俗解释</small></span></button>
          <button type="button" onClick={onDismiss}><EyeOff size={16} /><span><strong>忽略</strong><small>只隐藏当前文档里的这次识别</small></span></button>
        </div>
      </section>
    </div>
  );
}
