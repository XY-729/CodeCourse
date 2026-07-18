import { Edit3, Loader2, Plus, Search, Send, Star, Trash2, X } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import type { LLMSettings, QARecord, SourceType } from "../api/client";

export type SelectionSummary = {
  sourceType: SourceType;
  sourcePath: string | null;
  selectedText: string;
  language?: string;
};

export type AssistantContextSummary = {
  label: string;
  sourceType: SourceType;
  sourcePath: string | null;
  preview: string;
};

type AssistantTab = "history" | "knowledge";

type Props = {
  selection: SelectionSummary | null;
  contextSummary: AssistantContextSummary | null;
  question: string;
  loading: boolean;
  loadingLabel?: string;
  history: QARecord[];
  historyQuery: string;
  favoriteOnly: boolean;
  selectedRecord: QARecord | null;
  settings: LLMSettings | null;
  panelError: string;
  askHeight: number;
  upperTab: AssistantTab;
  onUpperTabChange: (value: AssistantTab) => void;
  knowledgeContent?: ReactNode;
  knowledgeDisabled?: boolean;
  onAskResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onQuestionChange: (value: string) => void;
  onSelectionTextChange: (value: string) => void;
  onClearSelection: () => void;
  onAsk: () => void;
  onNewConversation: () => void;
  onHistoryQueryChange: (value: string) => void;
  onFavoriteOnlyChange: (value: boolean) => void;
  onSelectRecord: (record: QARecord) => void;
  onOpenRecord: (record: QARecord) => void;
  onDeleteRecord?: (record: QARecord) => void;
  onRenameRecord: (record: QARecord) => void;
  onToggleFavorite: (record: QARecord) => void;
  onOpenSettings: () => void;
  onClose?: () => void;
};

function sourceLabel(type: SourceType) {
  if (type === "file") return "代码";
  if (type === "course") return "课件";
  if (type === "qa") return "回答";
  return "选区";
}

function configuredModelLabel(settings: LLMSettings | null) {
  if (!settings?.enabled || !settings.has_api_key) return "未配置模型";
  return `${settings.provider} / ${settings.model}`;
}

function recordTitle(record: QARecord) {
  return record.display_title?.trim() || record.question;
}

export default function ExplainPanel(props: Props) {
  const {
    selection, contextSummary, question, loading, loadingLabel, history, historyQuery, favoriteOnly,
    selectedRecord, settings, panelError, askHeight, upperTab, onUpperTabChange, knowledgeContent,
    knowledgeDisabled, onAskResizeStart, onQuestionChange, onSelectionTextChange, onClearSelection,
    onAsk, onNewConversation, onHistoryQueryChange, onFavoriteOnlyChange, onSelectRecord,
    onOpenRecord, onDeleteRecord, onRenameRecord, onToggleFavorite, onOpenSettings, onClose,
  } = props;
  const selectedLength = selection?.selectedText.length ?? 0;
  const modelReady = Boolean(settings?.enabled && settings.has_api_key);

  return (
    <aside className="explain-panel qa-panel" style={{ gridTemplateRows: `minmax(0, 1fr) 6px ${askHeight}px` }}>
      <section className="qa-history-section">
        <div className="qa-panel-tabs">
          <div className="qa-panel-mode-tabs">
            <button className={upperTab === "history" ? "active" : ""} onClick={() => onUpperTabChange("history")}>历史</button>
            <button
              className={upperTab === "knowledge" ? "active" : ""}
              onClick={() => onUpperTabChange("knowledge")}
              disabled={knowledgeDisabled}
              draggable={!knowledgeDisabled}
              onDragStart={(event) => {
                event.dataTransfer.setData("application/codecourse-item", JSON.stringify({ kind: "knowledge_graph" }));
                event.dataTransfer.effectAllowed = "copy";
              }}
            >知识网络</button>
          </div>
          {onClose ? <button className="icon-button panel-close" onClick={onClose} title="关闭 AI 助手" aria-label="关闭 AI 助手"><X size={16} /></button> : null}
        </div>

        <div className={`qa-upper-view ${upperTab}`} key={upperTab}>
          {upperTab === "knowledge" ? (
            <div className="qa-knowledge-slot">{knowledgeContent ?? <div className="empty small">请选择项目后查看知识网络</div>}</div>
          ) : (
            <>
              <div className="qa-section history-tools">
                <div className="search-row"><Search size={14} /><input value={historyQuery} onChange={(event) => onHistoryQueryChange(event.target.value)} placeholder="搜索历史" /></div>
                <label className="favorite-filter"><input type="checkbox" checked={favoriteOnly} onChange={(event) => onFavoriteOnlyChange(event.target.checked)} />只看收藏</label>
              </div>
              <div className="qa-history">
                {history.length ? history.map((record) => (
                  <button
                    key={record.id}
                    className={`qa-history-row ${selectedRecord?.id === record.id ? "selected" : ""}`}
                    onClick={() => onSelectRecord(record)}
                    onDoubleClick={() => onOpenRecord(record)}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("application/codecourse-item", JSON.stringify({ kind: "qa", qaId: record.id }));
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                  >
                    <span>{recordTitle(record)}</span><small>{record.model}</small>
                    <Trash2 size={14} className="history-delete" onClick={(event) => { event.stopPropagation(); onDeleteRecord?.(record); }} />
                    <Edit3 size={14} className="history-rename" onClick={(event) => { event.stopPropagation(); onRenameRecord(record); }} />
                    <Star size={14} className={record.favorite ? "history-star starred" : "history-star"} onClick={(event) => { event.stopPropagation(); onToggleFavorite(record); }} />
                  </button>
                )) : <div className="empty small">暂无问答历史</div>}
              </div>
            </>
          )}
        </div>
      </section>

      <div className="resize-handle-y" onMouseDown={onAskResizeStart} title="上下拖动调整提问区高度" />

      <section className="qa-ask-section">
        <div className="qa-section selection-card">
          <div className="qa-section-title">附带上下文</div>
          {selection ? (
            <>
              <div className="selection-meta"><span>{sourceLabel(selection.sourceType)}</span><span>{selectedLength} 字符</span></div>
              <div className="selection-path">{selection.sourcePath ?? "未命名来源"}</div>
              <textarea className="selection-editor" value={selection.selectedText} onChange={(event) => onSelectionTextChange(event.target.value)} disabled={loading} />
              <button type="button" className="secondary-button compact" onClick={onClearSelection} disabled={loading}><Trash2 size={14} />清空文本</button>
            </>
          ) : contextSummary ? (
            <><div className="selection-meta"><span>{contextSummary.label}</span></div><div className="selection-path">{contextSummary.sourcePath ?? "项目上下文"}</div></>
          ) : <div className="selection-meta"><span>项目上下文</span></div>}
        </div>

        <div className="qa-section ask-box">
          <div className="ask-box-toolbar">
            <span>{selectedRecord ? `继续：${recordTitle(selectedRecord)}` : "新问题"}</span>
            <button className="icon-button" type="button" onClick={onNewConversation} title="新对话" aria-label="新对话"><Plus size={15} /></button>
          </div>
          <textarea value={question} onChange={(event) => onQuestionChange(event.target.value)} placeholder={selectedRecord ? `继续追问“${recordTitle(selectedRecord)}”` : "问项目、文件、课件或选中内容"} disabled={loading} />
          <div className="model-row">
            <select value={modelReady ? "configured" : "missing"} disabled><option>{configuredModelLabel(settings)}</option></select>
            {!modelReady ? <button type="button" className="secondary-button compact" onClick={onOpenSettings}>配置</button> : null}
          </div>
          {panelError ? <div className="qa-local-error">{panelError}</div> : null}
          <button className="primary-button" onClick={onAsk} disabled={loading || !modelReady || !question.trim()}>
            {loading ? <Loader2 size={15} className="spin" /> : <Send size={15} />}{loading ? (loadingLabel || "生成中...") : selectedRecord ? "继续追问" : "询问"}
          </button>
        </div>
      </section>
    </aside>
  );
}
