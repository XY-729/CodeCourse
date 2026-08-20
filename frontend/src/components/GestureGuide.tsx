import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function GestureGuide({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="gesture-guide-layer" onMouseDown={onClose}>
      <section
        className="gesture-guide-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gesture-guide-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="gesture-guide-title">鼠标手势</h2>
            <p>按住鼠标右键划动，松开后执行操作。</p>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭" aria-label="关闭手势指南">
            <X size={17} />
          </button>
        </header>
        <div className="gesture-guide-grid">
          <div><kbd>↖</kbd><strong>源码</strong><span>打开源码导航</span></div>
          <div><kbd>↑</kbd><strong>恢复文档</strong><span>恢复最近关闭的文档</span></div>
          <div><kbd>↗</kbd><strong>搜索</strong><span>打开命令与内容搜索</span></div>
          <div><kbd>←</kbd><strong>撤销布局</strong><span>撤销工作区调整</span></div>
          <div className="gesture-guide-center"><span>右键</span><strong>按住划动</strong></div>
          <div><kbd>→</kbd><strong>下一文档</strong><span>切换当前组标签</span></div>
          <div><kbd>↙</kbd><strong>AI 助手</strong><span>打开问答历史</span></div>
          <div><kbd>↓</kbd><strong>关闭文档</strong><span>关闭当前标签</span></div>
          <div><kbd>↘</kbd><strong>课程</strong><span>打开课程导航</span></div>
        </div>
        <footer>短划不会触发操作；未识别的轨迹会直接取消。</footer>
      </section>
    </div>
  );
}
