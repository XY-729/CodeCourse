import { Edit3, Loader2, Search, Send, Star, Trash2, X } from "lucide-react";
import type { MouseEvent } from "react";
import type { LLMSettings, QARecord, SourceType } from "../api/client";
import type { Annotation, AnnotationType } from "../types";
import { ANNOTATION_COLORS, ANNOTATION_LABELS } from "../types";

export type SelectionSummary = {
  sourceType: SourceType;
  sourcePath: string | null;
  selectedText: string;
  language?: string;
};

const QUICK_ANNOTATION_TYPES: AnnotationType[] = ["highlight", "important", "question", "concept", "code"];

type Props = {
  selection: SelectionSummary | null;
  question: string;
  loading: boolean;
  history: QARecord[];
  historyQuery: string;
  favoriteOnly: boolean;
  selectedRecord: QARecord | null;
  settings: LLMSettings | null;
  panelError: string;
  askHeight: number;
  annotations?: Annotation[];
  onAskResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onQuestionChange: (value: string) => void;
  onSelectionTextChange: (value: string) => void;
  onClearSelection: () => void;
  onAsk: () => void;
  onHistoryQueryChange: (value: string) => void;
  onFavoriteOnlyChange: (value: boolean) => void;
  onSelectRecord: (record: QARecord) => void;
  onOpenRecord: (record: QARecord) => void;
  onRenameRecord: (record: QARecord) => void;
  onToggleFavorite: (record: QARecord) => void;
  onOpenSettings: () => void;
  onCreateAnnotation?: (type: AnnotationType) => void;
  onExplain?: () => void;
  onDeleteAnnotation?: (id: string) => void;
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
  question,
  loading,
  history,
  historyQuery,
  favoriteOnly,
  selectedRecord,
  settings,
  panelError,
  askHeight,
  annotations = [],
  onAskResizeStart,
  onQuestionChange,
  onSelectionTextChange,
  onClearSelection,
  onAsk,
  onHistoryQueryChange,
  onFavoriteOnlyChange,
  onSelectRecord,
  onOpenRecord,
  onRenameRecord,
  onToggleFavorite,
  onOpenSettings,
  onCreateAnnotation,
  onExplain,
  onDeleteAnnotation,
}: Props) {
  const selectedLength = selection?.selectedText.length ?? 0;
  const modelReady = Boolean(settings?.enabled && settings.has_api_key);

  function handleExplainClick() {
    if (!window.confirm("将调用模型 API 解释这段内容，可能消耗 token。是否继续？")) {
      return;
    }
    onExplain?.();
  }

  return (
    <aside className="explain-panel qa-panel" style={{ gridTemplateRows: `${askHeight}px 6px minmax(0, 1fr)` }}>
      <section className="qa-ask-section">
        <div className="panel-title">
          <span>选区提问</span>
          {loading ? <Loader2 size={16} className="spin" /> : null}
        </div>

        <div className="qa-section selection-card">
          <div className="qa-section-title">当前选区</div>
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
              <button type="button" className="secondary-button compact" onClick={onClearSelection} disabled={loading}>
                <Trash2 size={14} />
                清空
              </button>

              {selection.sourceType === "course" && selection.selectedText.trim() ? (
                <div className="annotation-quick-actions">
                  {QUICK_ANNOTATION_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="annotation-quick-btn"
                      onClick={() => onCreateAnnotation?.(type)}
                    >
                      <span className="annotation-badge" style={{ backgroundColor: ANNOTATION_COLORS[type] }} />
                      {ANNOTATION_LABELS[type]}
                    </button>
                  ))}
                  <button type="button" className="annotation-quick-btn" onClick={handleExplainClick}>
                    解释这段
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="empty small">尚未选中文本</div>
          )}
        </div>

        {annotations.length > 0 ? (
          <div className="qa-section">
            <div className="qa-section-title">已保存标注 ({annotations.length})</div>
            <div className="annotation-list">
              {annotations.map((ann) => (
                <div key={ann.id} className="annotation-item">
                  <span className="annotation-badge" style={{ backgroundColor: ANNOTATION_COLORS[ann.type] }} />
                  <span className="annotation-item-text">{ann.selectedText}</span>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onDeleteAnnotation?.(ann.id)}
                    title="删除标注"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="qa-section ask-box">
          <textarea
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            placeholder="输入问题"
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

      <div className="resize-handle-y" onMouseDown={onAskResizeStart} title="上下拖动调整提问区高度" />

      <section className="qa-history-section">
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
      </section>
    </aside>
  );
}
