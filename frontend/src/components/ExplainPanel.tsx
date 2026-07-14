import { BookOpenCheck, ChevronRight, Edit3, Loader2, Plus, Search, Send, Star, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import type { DocumentTerm, LearningAnchor, LLMSettings, QARecord, SourceType } from "../api/client";
import MarkdownViewer from "./MarkdownViewer";

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

type AssistantTab = "assistant" | "history" | "knowledge";

type Props = {
  selection: SelectionSummary | null;
  contextSummary: AssistantContextSummary | null;
  question: string;
  loading: boolean;
  history: QARecord[];
  sessionTree: QARecord[];
  historyQuery: string;
  favoriteOnly: boolean;
  selectedRecord: QARecord | null;
  learningAnchor: LearningAnchor | null;
  documentTerms: DocumentTerm[];
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
  onSaveUnderstanding: (record: QARecord, summary: string) => void;
  onDeleteUnderstanding: (record: QARecord) => void;
  onGenerateTerm: (term: DocumentTerm) => void;
  onTermAction: (term: DocumentTerm) => void;
  onSelectionChange: (selection: SelectionSummary & { sourceType: Exclude<SourceType, "selection"> }) => void;
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

function buildBreadcrumb(records: QARecord[], current: QARecord | null): QARecord[] {
  if (!current) return [];
  const byId = new Map(records.map((record) => [record.id, record]));
  const result: QARecord[] = [];
  const visited = new Set<number>();
  let cursor: QARecord | undefined = current;
  while (cursor && !visited.has(cursor.id)) {
    result.unshift(cursor);
    visited.add(cursor.id);
    cursor = cursor.parent_qa_id ? byId.get(cursor.parent_qa_id) : undefined;
  }
  return result;
}

function depthOf(record: QARecord, byId: Map<number, QARecord>) {
  let depth = 0;
  let parentId = record.parent_qa_id;
  const visited = new Set<number>();
  while (parentId && !visited.has(parentId) && depth < 8) {
    visited.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)?.parent_qa_id;
  }
  return depth;
}

export default function ExplainPanel(props: Props) {
  const {
    selection, contextSummary, question, loading, history, sessionTree, historyQuery, favoriteOnly,
    selectedRecord, learningAnchor, documentTerms, settings, panelError, askHeight, upperTab,
    onUpperTabChange, knowledgeContent, knowledgeDisabled, onAskResizeStart, onQuestionChange,
    onSelectionTextChange, onClearSelection, onAsk, onNewConversation, onHistoryQueryChange,
    onFavoriteOnlyChange, onSelectRecord, onOpenRecord, onDeleteRecord, onRenameRecord,
    onToggleFavorite, onSaveUnderstanding, onDeleteUnderstanding, onGenerateTerm, onTermAction,
    onSelectionChange, onOpenSettings, onClose,
  } = props;
  const [editingUnderstanding, setEditingUnderstanding] = useState(false);
  const [understandingText, setUnderstandingText] = useState("");
  const selectedLength = selection?.selectedText.length ?? 0;
  const modelReady = Boolean(settings?.enabled && settings.has_api_key);
  const byId = useMemo(() => new Map(sessionTree.map((record) => [record.id, record])), [sessionTree]);
  const breadcrumb = useMemo(() => buildBreadcrumb(sessionTree, selectedRecord), [sessionTree, selectedRecord]);

  useEffect(() => {
    setUnderstandingText(learningAnchor?.summary ?? "");
    setEditingUnderstanding(false);
  }, [learningAnchor?.id, learningAnchor?.summary, selectedRecord?.id]);

  const assistantContent = (
    <div className="assistant-thread-view">
      <div className="assistant-thread-toolbar">
        <div className="thread-breadcrumb" aria-label="当前问答路径">
          {breadcrumb.length ? breadcrumb.map((record, index) => (
            <span key={record.id}>
              {index > 0 ? <ChevronRight size={12} /> : null}
              <button onClick={() => onSelectRecord(record)} title={recordTitle(record)}>{recordTitle(record)}</button>
            </span>
          )) : <span className="muted">从当前文件、课件或选区开始提问</span>}
        </div>
        <button className="icon-button" onClick={onNewConversation} title="新对话"><Plus size={15} /></button>
      </div>

      {sessionTree.length > 1 ? (
        <div className="assistant-mini-tree" aria-label="会话分支">
          {sessionTree.map((record) => (
            <button
              key={record.id}
              className={record.id === selectedRecord?.id ? "active" : ""}
              style={{ marginLeft: `${Math.min(depthOf(record, byId), 5) * 13}px` }}
              onClick={() => onSelectRecord(record)}
              title={recordTitle(record)}
            >
              <span className="tree-dot" />
              <span>{recordTitle(record)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {selectedRecord ? (
        <div className="assistant-card-stack">
          {breadcrumb.length > 2 ? <div className="assistant-card-shadow back" /> : null}
          {breadcrumb.length > 1 ? <div className="assistant-card-shadow middle" /> : null}
          <article
            className="assistant-answer-card"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/codecourse-item", JSON.stringify({ kind: "qa", qaId: selectedRecord.id }));
              event.dataTransfer.effectAllowed = "copy";
            }}
            onDoubleClick={() => onOpenRecord(selectedRecord)}
          >
            <header>
              <div><strong>{recordTitle(selectedRecord)}</strong><small>{selectedRecord.model}</small></div>
              <div className="assistant-card-actions">
                <button className="icon-button" onClick={() => onToggleFavorite(selectedRecord)} title={selectedRecord.favorite ? "取消收藏" : "收藏"}>
                  <Star size={15} className={selectedRecord.favorite ? "starred" : ""} />
                </button>
                <button className="icon-button" onClick={() => onOpenRecord(selectedRecord)} title="在工作区打开"><Edit3 size={15} /></button>
              </div>
            </header>
            <MarkdownViewer
              title={recordTitle(selectedRecord)}
              sourceType="qa"
              sourcePath={selectedRecord.output_path || String(selectedRecord.id)}
              content={selectedRecord.answer_md}
              documentTerms={documentTerms}
              embedded
              onSelectionChange={onSelectionChange}
              onGenerateTerm={onGenerateTerm}
              onTermAction={onTermAction}
            />
            <footer className="understanding-block">
              {editingUnderstanding ? (
                <>
                  <textarea
                    value={understandingText}
                    onChange={(event) => setUnderstandingText(event.target.value)}
                    placeholder="用自己的话写下你理解了什么"
                    autoFocus
                  />
                  <div>
                    <button className="secondary-button compact" onClick={() => setEditingUnderstanding(false)}>取消</button>
                    <button
                      className="primary-button compact"
                      disabled={!understandingText.trim()}
                      onClick={() => {
                        onSaveUnderstanding(selectedRecord, understandingText.trim());
                        setEditingUnderstanding(false);
                      }}
                    >保存理解</button>
                  </div>
                </>
              ) : learningAnchor ? (
                <div className="understanding-saved">
                  <BookOpenCheck size={15} />
                  <span>{learningAnchor.summary}</span>
                  <button className="icon-button" onClick={() => setEditingUnderstanding(true)} title="编辑理解"><Edit3 size={14} /></button>
                  <button className="icon-button" onClick={() => onDeleteUnderstanding(selectedRecord)} title="删除理解"><Trash2 size={14} /></button>
                </div>
              ) : (
                <button className="understanding-action" onClick={() => setEditingUnderstanding(true)}><BookOpenCheck size={15} />我已理解</button>
              )}
            </footer>
          </article>
        </div>
      ) : (
        <div className="assistant-empty-card"><BookOpenCheck size={22} /><strong>边读边问</strong><span>回答会在这里形成可回溯的学习分支。</span></div>
      )}
    </div>
  );

  return (
    <aside className="explain-panel qa-panel" style={{ gridTemplateRows: `minmax(0, 1fr) 6px ${askHeight}px` }}>
      <section className="qa-history-section">
        <div className="qa-panel-tabs">
          <button className={upperTab === "assistant" ? "active" : ""} onClick={() => onUpperTabChange("assistant")}>助手</button>
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
          {onClose ? <button className="icon-button panel-close" onClick={onClose} title="关闭 AI 助手"><X size={16} /></button> : null}
        </div>
        {upperTab === "assistant" ? assistantContent : upperTab === "knowledge" ? (
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
                  onClick={() => { onSelectRecord(record); onUpperTabChange("assistant"); }}
                  onDoubleClick={() => onOpenRecord(record)}
                  draggable
                  onDragStart={(event) => { event.dataTransfer.setData("application/codecourse-item", JSON.stringify({ kind: "qa", qaId: record.id })); event.dataTransfer.effectAllowed = "copy"; }}
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
            <><div className="selection-meta"><span>{contextSummary.label}</span></div><div className="selection-path">{contextSummary.sourcePath ?? "项目上下文"}</div><div className="context-preview">{contextSummary.preview}</div></>
          ) : <div className="context-preview">将根据当前项目和已生成课程回答。</div>}
        </div>
        <div className="qa-section ask-box">
          <textarea value={question} onChange={(event) => onQuestionChange(event.target.value)} placeholder={selectedRecord ? `继续追问“${recordTitle(selectedRecord)}”` : "问项目、文件、课件或选中内容"} disabled={loading} />
          <div className="model-row">
            <select value={modelReady ? "configured" : "missing"} disabled><option>{configuredModelLabel(settings)}</option></select>
            {!modelReady ? <button type="button" className="secondary-button compact" onClick={onOpenSettings}>配置</button> : null}
          </div>
          {panelError ? <div className="qa-local-error">{panelError}</div> : null}
          <button className="primary-button" onClick={onAsk} disabled={loading || !modelReady || !question.trim()}>
            {loading ? <Loader2 size={15} className="spin" /> : <Send size={15} />}{loading ? "生成中..." : selectedRecord ? "继续追问" : "询问"}
          </button>
        </div>
      </section>
    </aside>
  );
}
