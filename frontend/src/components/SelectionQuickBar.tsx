import { Bot, Copy, Highlighter, X } from "lucide-react";

type Props = {
  canHighlight: boolean;
  onAsk: () => void;
  onHighlight: () => void;
  onCopy: () => void;
  onClose: () => void;
};

export default function SelectionQuickBar({ canHighlight, onAsk, onHighlight, onCopy, onClose }: Props) {
  return (
    <div className="selection-quick-bar" role="toolbar" aria-label="选区操作">
      <button onClick={onAsk}><Bot size={14} />提问</button>
      {canHighlight ? <button onClick={onHighlight}><Highlighter size={14} />高亮</button> : null}
      <button onClick={onCopy}><Copy size={14} />复制</button>
      <button className="icon-button" onClick={onClose} title="取消选区"><X size={14} /></button>
    </div>
  );
}
