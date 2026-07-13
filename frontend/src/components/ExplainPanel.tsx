import { Edit3, Loader2, Search, Send, Star, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";
import type { ReactNode } from "react";
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

type Props = {
  selection: SelectionSummary | null;
  contextSummary: AssistantContextSummary | null;
  question: string;
  loading: boolean;
  history: QARecord[];
  historyQuery: string;
  favoriteOnly: boolean;
  selectedRecord: QARecord | null;
  settings: LLMSettings | null;
  panelError: string;
  askHeight: number;
  upperTab: "history" | "knowledge";
  onUpperTabChange: (value: "history" | "knowledge") => void;
  knowledgeContent?: ReactNode;
  knowledgeDisabled?: boolean;
  onAskResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onQuestionChange: (value: string) => void;
  onSelectionTextChange: (value: string) => void;
  onClearSelection: () => void;
  onAsk: () => void;
  onHistoryQueryChange: (value: string) => void;
  onFavoriteOnlyChange: (value: boolean) => void;
  onSelectRecord: (record: QARecord) => void;
  onOpenRecord: (record: QARecord) => void;
  onDeleteRecord?: (record: QARecord) => void;
  onRenameRecord: (record: QARecord) => void;
  onToggleFavorite: (record: QARecord) => void;
  onOpenSettings: () => void;
};

function sourceLabel(type: SourceType) {
  if (type === "file") {
    return "代码";
  }
  if (type === "course") {
    return "课件";
  }
  return "选区";
}

function configuredModelLabel(settings: LLMSettings | null) {
  if (!settings?.enabled || !settings.has_api_key) {
    return "未配置模型";
  }
  return `${settings.provider} / ${settings.model}`;
}

export default function ExplainPanel({
  selection,
  contextSummary,
  question,
  loading,
  history,
  historyQuery,
  favoriteOnly,
  selectedRecord,
  settings,
  panelError,
  askHeight,
  upperTab,
  onUpperTabChange,
  knowledgeContent,
  knowledgeDisabled,
  onAskResizeStart,
  onQuestionChange,
  onSelectionTextChange,
  onClearSelection,
  onAsk,
  onHistoryQueryChange,
  onFavoriteOnlyChange,
  onSelectRecord,
  onOpenRecord,
  onDeleteRecord,
  onRenameRecord,
  onToggleFavorite,
  onOpenSettings,
}: Props) {
  const selectedLength = selection?.selectedText.length ?? 0;
  const modelReady = Boolean(settings?.enabled && settings.has_api_key);

  return (
    <aside className="explain-panel qa-panel" style={{ gridTemplateRows: `minmax(0, 1fr) 6px ${askHeight}px` }}>
      <section className="qa-history-section">
        <div className="qa-panel-tabs">
          <button className={upperTab === "history" ? "active" : ""} onClick={() => onUpperTabChange("history")}>
            问答历史
          </button>
          <button
            className={upperTab === "knowledge" ? "active" : ""}
            onClick={() => onUpperTabChange("knowledge")}
            disabled={knowledgeDisabled}
            draggable={!knowledgeDisabled}
            onDragStart={(event) => {
              event.dataTransfer.setData("application/codecourse-item", JSON.stringify({ kind: "knowledge_graph" }));
              event.dataTransfer.effectAllowed = "copy";
            }}
            title="可拖拽到中间工作区打开"
          >
            知识网络
          </button>
        </div>
        {upperTab === "knowledge" ? (
          <div className="qa-knowledge-slot">
            {knowledgeContent ?? <div className="empty small">请选择项目后查看知识网络</div>}
          </div>
        ) : (
          <>
        <div className="qa-section history-tools">
          <div className="search-row">
            <Search size={14} />
            <input value={historyQuery} onChange={(event) => onHistoryQueryChange(event.target.value)} placeholder="搜索历史" />
          </div>
          <label className="favorite-filter">
            <input type="checkbox" checked={favoriteOnly} onChange={(event) => onFavoriteOnlyChange(event.target.checked)} />
            只看收藏
          </label>
        </div>

        <div className="qa-history">
          {history.length ? (
            history.map((record) => (
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
                title="双击在工作区编辑"
              >
                <span>{record.display_title || record.question}</span>
                <small>{record.model}</small>
                <Trash2
                  size={14}
                  className="history-delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteRecord?.(record);
                  }}
                />
                <Edit3
                  size={14}
                  className="history-rename"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRenameRecord(record);
                  }}
                />
                <Star
                  size={14}
                  className={record.favorite ? "history-star starred" : "history-star"}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFavorite(record);
                  }}
                />
              </button>
            ))
          ) : (
            <div className="empty small">暂无问答历史</div>
          )}
        </div>
          </>
        )}
      </section>

      <div className="resize-handle-y" onMouseDown={onAskResizeStart} title="上下拖动调整提问区高度" />

      <section className="qa-ask-section">
        <div className="panel-title">
          <span>AI 助手</span>
          {loading ? <Loader2 size={16} className="spin" /> : null}
        </div>

        <div className="qa-section selection-card">
          <div className="qa-section-title">附带上下文</div>
          {selection ? (
            <>
              <div className="selection-meta">
                <span>{sourceLabel(selection.sourceType)}</span>
                <span>{selectedLength} 字符</span>
              </div>
              <div className="selection-path">{selection.sourcePath ?? "未命名来源"}</div>
              <textarea
                className="selection-editor"
                value={selection.selectedText}
                onChange={(event) => onSelectionTextChange(event.target.value)}
                disabled={loading}
              />
              <div className="selection-actions">
                <button type="button" className="secondary-button compact" onClick={onClearSelection} disabled={loading}>
                  <Trash2 size={14} />
                  清空文本
                </button>
              </div>
            </>
          ) : contextSummary ? (
            <>
              <div className="selection-meta">
                <span>{contextSummary.label}</span>
              </div>
              <div className="selection-path">{contextSummary.sourcePath ?? "项目上下文"}</div>
              <div className="context-preview">{contextSummary.preview}</div>
            </>
          ) : (
            <div className="context-preview">将根据当前项目和已生成课程回答。</div>
          )}
        </div>

        <div className="qa-section ask-box">
          <textarea
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            placeholder="问项目、文件、课件或选中内容"
            disabled={loading}
          />
          <div className="model-row">
            <select value={modelReady ? "configured" : "missing"} disabled>
              <option value={modelReady ? "configured" : "missing"}>{configuredModelLabel(settings)}</option>
            </select>
            {!modelReady ? (
              <button type="button" className="secondary-button compact" onClick={onOpenSettings}>
                配置
              </button>
            ) : null}
          </div>
          {panelError ? <div className="qa-local-error">{panelError}</div> : null}
          <button className="primary-button" onClick={onAsk} disabled={loading || !modelReady || !question.trim()}>
            {loading ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
            {loading ? "生成中..." : "询问"}
          </button>
        </div>
      </section>
    </aside>
  );
}
