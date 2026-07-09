import { Edit3, Loader2, Save, Search, Send, Star } from "lucide-react";
import type { QARecord, SourceType } from "../api/client";

export type SelectionSummary = {
  sourceType: SourceType;
  sourcePath: string | null;
  selectedText: string;
  language?: string;
};

type Props = {
  selection: SelectionSummary | null;
  question: string;
  provider: string;
  baseUrl: string;
  model: string;
  loading: boolean;
  history: QARecord[];
  historyQuery: string;
  favoriteOnly: boolean;
  selectedRecord: QARecord | null;
  editingAnswer: string;
  onQuestionChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onAsk: () => void;
  onHistoryQueryChange: (value: string) => void;
  onFavoriteOnlyChange: (value: boolean) => void;
  onSelectRecord: (record: QARecord) => void;
  onToggleFavorite: (record: QARecord) => void;
  onEditingAnswerChange: (value: string) => void;
  onSaveRecord: () => void;
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

export default function ExplainPanel({
  selection,
  question,
  provider,
  baseUrl,
  model,
  loading,
  history,
  historyQuery,
  favoriteOnly,
  selectedRecord,
  editingAnswer,
  onQuestionChange,
  onProviderChange,
  onBaseUrlChange,
  onModelChange,
  onAsk,
  onHistoryQueryChange,
  onFavoriteOnlyChange,
  onSelectRecord,
  onToggleFavorite,
  onEditingAnswerChange,
  onSaveRecord,
}: Props) {
  const selectedLength = selection?.selectedText.length ?? 0;

  return (
    <aside className="explain-panel qa-panel">
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
            <pre className="selection-preview">{selection.selectedText}</pre>
          </>
        ) : (
          <div className="empty small">在代码或课件中选中文本后，这里会同步显示。</div>
        )}
      </div>

      <div className="qa-section ask-box">
        <textarea
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          placeholder="针对选区提问，例如：这段代码在整个项目中负责什么？关键分支怎么读？"
          disabled={loading}
        />
        <div className="model-grid">
          <input value={provider} onChange={(event) => onProviderChange(event.target.value)} placeholder="provider" disabled={loading} />
          <input value={model} onChange={(event) => onModelChange(event.target.value)} placeholder="model" disabled={loading} />
          <input value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} placeholder="base URL" disabled={loading} />
        </div>
        <button className="primary-button" onClick={onAsk} disabled={loading || !selection || !question.trim()}>
          {loading ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
          {loading ? "正在生成回答..." : "询问"}
        </button>
      </div>

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
              title={record.question}
            >
              <span>{record.question}</span>
              <small>
                {record.model} · {record.favorite ? "已收藏" : "未收藏"}
              </small>
            </button>
          ))
        ) : (
          <div className="empty small">暂无问答历史</div>
        )}
      </div>

      <div className="qa-editor">
        <div className="qa-editor-title">
          <span>{selectedRecord ? `回答 #${selectedRecord.id}` : "回答编辑"}</span>
          <div className="qa-editor-actions">
            <button className="icon-button" onClick={() => selectedRecord && onToggleFavorite(selectedRecord)} disabled={!selectedRecord} title="收藏/取消收藏">
              <Star size={14} className={selectedRecord?.favorite ? "starred" : ""} />
            </button>
            <button className="icon-button" onClick={onSaveRecord} disabled={!selectedRecord} title="保存为 Markdown">
              <Save size={14} />
            </button>
          </div>
        </div>
        <textarea
          value={editingAnswer}
          onChange={(event) => onEditingAnswerChange(event.target.value)}
          placeholder="选中一条历史后可编辑 Markdown 回答。"
          disabled={!selectedRecord}
        />
        <div className="editor-hint">
          <Edit3 size={13} />
          保存会同步更新 workspace/generated/&lt;project_id&gt;/qa 下的 Markdown 文件。
        </div>
      </div>
    </aside>
  );
}
