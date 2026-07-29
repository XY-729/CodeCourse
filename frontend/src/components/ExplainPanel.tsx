import { ArrowDown, ArrowUp, Edit3, Loader2, Search, Send, Star, Trash2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { DiagnosticItem, DynamicSurveyCandidate, LLMSettings, QARecord, SourceType } from "../api/client";

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
  questionInput?: string;
  loading: boolean;
  loadingLabel?: string;
  streamContent?: string;
  history: QARecord[];
  historyQuery: string;
  favoriteOnly: boolean;
  selectedRecord: QARecord | null;
  selectedRecordReadOnly?: boolean;
  surveyCandidate?: DynamicSurveyCandidate | null;
  diagnosticItem?: DiagnosticItem | null;
  diagnosticResult?: boolean | null;
  settings: LLMSettings | null;
  panelError: string;
  upperTab: AssistantTab;
  mobileMode?: boolean;
  embeddedMobileSheet?: boolean;
  onUpperTabChange: (value: AssistantTab) => void;
  knowledgeContent?: ReactNode;
  knowledgeDisabled?: boolean;
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
  onAnswerSurvey?: (choice: string) => void;
  onDismissSurvey?: () => void;
  onDisableSurveys?: () => void;
  onAnswerDiagnostic?: (answer: unknown) => void;
  onDismissDiagnostic?: () => void;
  onFlagDiagnostic?: () => void;
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
    selection, contextSummary, question, questionInput, loading, loadingLabel, streamContent, history, historyQuery, favoriteOnly,
    selectedRecord, selectedRecordReadOnly = false, surveyCandidate, diagnosticItem, diagnosticResult, settings, panelError, upperTab, mobileMode = false, embeddedMobileSheet = false, onUpperTabChange, knowledgeContent,
    knowledgeDisabled, onQuestionChange, onSelectionTextChange, onClearSelection,
    onAsk, onNewConversation, onHistoryQueryChange, onFavoriteOnlyChange, onSelectRecord,
    onOpenRecord, onDeleteRecord, onRenameRecord, onToggleFavorite, onOpenSettings,
    onAnswerSurvey, onDismissSurvey, onDisableSurveys,
    onAnswerDiagnostic, onDismissDiagnostic, onFlagDiagnostic, onClose,
  } = props;
  const [diagnosticAnswer, setDiagnosticAnswer] = useState<unknown>(null);
  const [diagnosticOrder, setDiagnosticOrder] = useState<string[]>([]);
  useEffect(() => {
    setDiagnosticAnswer(null);
    setDiagnosticOrder(
      diagnosticItem?.itemType === "step_order"
        ? diagnosticItem.options.map((option) => String(option.value))
        : [],
    );
  }, [diagnosticItem?.id]);
  const selectedLength = selection?.selectedText.length ?? 0;
  const modelReady = Boolean(settings?.enabled && settings.has_api_key);

  const mobileKnowledge = mobileMode && upperTab === "knowledge";
  const mobileAssistant = mobileMode && upperTab === "history";
  const knowledgeOnly = upperTab === "knowledge";

  return (
    <aside
      className={`explain-panel qa-panel ${knowledgeOnly ? "knowledge-only" : ""} ${mobileKnowledge ? "mobile-knowledge-only" : ""} ${mobileAssistant ? "mobile-assistant-only" : ""}`}
      style={{
        gridTemplateRows: knowledgeOnly
          ? "minmax(0, 1fr) 0"
          : mobileAssistant
            ? "auto minmax(0, 1fr)"
            : "minmax(140px, 1fr) auto",
      }}
    >
      <section className="qa-history-section">
        {!embeddedMobileSheet ? <div className="qa-panel-tabs">
          {mobileMode ? <strong className="mobile-panel-title">{mobileKnowledge ? "知识网络" : "AI 助手"}</strong> : (
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
          )}
          {onClose ? <button className="icon-button panel-close" onClick={onClose} title="关闭 AI 助手" aria-label="关闭 AI 助手"><X size={16} /></button> : null}
        </div> : null}

        <div className={`qa-upper-view ${upperTab}`} key={upperTab}>
          {upperTab === "knowledge" ? (
            <div className="qa-knowledge-slot">{knowledgeContent ?? <div className="empty small">请选择项目后查看知识网络</div>}</div>
          ) : mobileAssistant ? (
            <>
              {loading && streamContent ? (
                <div className="qa-stream-card mobile-current-answer">
                  <header><Loader2 size={14} className="spin" /> <span>{loadingLabel || "生成中…"}</span></header>
                  <div className="qa-stream-body markdown-body">{streamContent}</div>
                </div>
              ) : selectedRecord ? (
                <button className="mobile-current-answer-card" type="button" onClick={() => onOpenRecord(selectedRecord)}>
                  <strong>{recordTitle(selectedRecord)}</strong>
                  <span>{selectedRecord.answer_md.replace(/[#>*`_\-]+/g, " ").replace(/\s+/g, " ").trim()}</span>
                </button>
              ) : null}
            </>
          ) : (
            <>
              {loading && streamContent ? (
                <div className="qa-stream-card">
                  <header><Loader2 size={14} className="spin" /> <span>{loadingLabel || "生成中…"}</span></header>
                  <div className="qa-stream-body markdown-body">{streamContent}</div>
                </div>
              ) : null}
              <div className="qa-section history-tools">
                <div className="search-row"><Search size={14} /><input value={historyQuery} onChange={(event) => onHistoryQueryChange(event.target.value)} placeholder="搜索历史" aria-label="搜索历史" /></div>
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
                    <Trash2 size={14} className="history-delete" role="button" tabIndex={0} aria-label="删除记录" onClick={(event) => { event.stopPropagation(); onDeleteRecord?.(record); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onDeleteRecord?.(record); } }} />
                    <Edit3 size={14} className="history-rename" role="button" tabIndex={0} aria-label="重命名记录" onClick={(event) => { event.stopPropagation(); onRenameRecord(record); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onRenameRecord(record); } }} />
                    <Star size={14} className={record.favorite ? "history-star starred" : "history-star"} role="button" tabIndex={0} aria-label={record.favorite ? "取消收藏" : "收藏"} onClick={(event) => { event.stopPropagation(); onToggleFavorite(record); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onToggleFavorite(record); } }} />
                  </button>
                )) : <div className="empty small">暂无问答历史</div>}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="qa-ask-section">
        <div className="qa-ask-scroll">
          <div className="qa-section selection-card">
            <div className="qa-section-title">附带上下文</div>
            {selection ? (
              <>
                <div className="selection-meta"><span>{sourceLabel(selection.sourceType)}</span><span>{selectedLength} 字符</span></div>
                <div className="selection-path">{selection.sourcePath ?? "未命名来源"}</div>
                <textarea className="selection-editor" value={selection.selectedText} onChange={(event) => onSelectionTextChange(event.target.value)} disabled={loading} aria-label="附带上下文文本" />
                <button type="button" className="secondary-button compact" onClick={onClearSelection} disabled={loading}><Trash2 size={14} />清空文本</button>
              </>
            ) : contextSummary ? (
              <><div className="selection-meta"><span>{contextSummary.label}</span></div><div className="selection-path">{contextSummary.sourcePath ?? "项目上下文"}</div></>
            ) : <div className="selection-meta"><span>项目上下文</span></div>}
          </div>

        </div>

        {!loading && surveyCandidate ? (
          <section className="assistant-survey-card">
            <strong>{surveyCandidate.question}</strong>
            <div>
              {surveyCandidate.options.map((option) => (
                <button type="button" key={option.value} onClick={() => onAnswerSurvey?.(option.value)}>
                  {option.label}
                </button>
              ))}
              <button type="button" className="text-button" onClick={onDismissSurvey}>稍后</button>
              <button type="button" className="text-button" onClick={onDisableSurveys}>以后不再询问</button>
            </div>
          </section>
        ) : null}

        {!loading && diagnosticItem ? (
          <section className="assistant-diagnostic-card" aria-label="理解检查">
            <div className="diagnostic-card-heading">
              <strong>快速理解检查</strong>
              <span>{diagnosticItem.dimension.replace("_", " ")}</span>
            </div>
            <p>{diagnosticItem.prompt}</p>
            {diagnosticItem.itemType === "step_order" ? (
              <div className="diagnostic-order-list">
                {diagnosticOrder.map((value, index) => {
                  const label = diagnosticItem.options.find((option) => String(option.value) === value)?.label || value;
                  return (
                    <div key={value}>
                      <span>{index + 1}. {label}</span>
                      <button type="button" aria-label="上移" disabled={index === 0 || diagnosticResult != null} onClick={() => setDiagnosticOrder((items) => {
                        const next = [...items];
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        return next;
                      })}><ArrowUp size={14} /></button>
                      <button type="button" aria-label="下移" disabled={index === diagnosticOrder.length - 1 || diagnosticResult != null} onClick={() => setDiagnosticOrder((items) => {
                        const next = [...items];
                        [next[index + 1], next[index]] = [next[index], next[index + 1]];
                        return next;
                      })}><ArrowDown size={14} /></button>
                    </div>
                  );
                })}
              </div>
            ) : diagnosticItem.options.length ? (
              <div className="diagnostic-options">
                {diagnosticItem.options.map((option) => (
                  <button
                    type="button"
                    key={String(option.value)}
                    className={diagnosticAnswer === option.value ? "selected" : ""}
                    disabled={diagnosticResult != null}
                    onClick={() => setDiagnosticAnswer(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : (
              <input
                className="diagnostic-text-answer"
                value={String(diagnosticAnswer ?? "")}
                disabled={diagnosticResult != null}
                onChange={(event) => setDiagnosticAnswer(event.target.value)}
                placeholder="输入你的判断"
              />
            )}
            {diagnosticResult != null ? (
              <div className={`diagnostic-result ${diagnosticResult ? "correct" : "incorrect"}`}>
                {diagnosticResult ? "回答正确，已记为一次验证证据。" : "这次没有答对，老师会补充这一处。"}
                <button type="button" className="text-button" onClick={onFlagDiagnostic}>题目有问题</button>
              </div>
            ) : (
              <div className="diagnostic-actions">
                <button
                  type="button"
                  className="primary-button compact"
                  disabled={diagnosticItem.itemType === "step_order" ? !diagnosticOrder.length : diagnosticAnswer == null || diagnosticAnswer === ""}
                  onClick={() => onAnswerDiagnostic?.(
                    diagnosticItem.itemType === "step_order" ? diagnosticOrder : diagnosticAnswer,
                  )}
                >
                  提交
                </button>
                <button type="button" className="text-button" onClick={onDismissDiagnostic}>跳过</button>
              </div>
            )}
          </section>
        ) : null}

        <div className="qa-section ask-box">
          <div className="ask-box-toolbar">
            <span>{selectedRecord ? `继续：${recordTitle(selectedRecord)}` : "新问题"}</span>
            {selectedRecord ? (
              <button className="assistant-new-question-button" type="button" onClick={onNewConversation}>
                开始新问题
              </button>
            ) : null}
          </div>
          {selectedRecordReadOnly ? <div className="qa-readonly-note">这是其他项目中的此前解释。当前以只读方式打开。</div> : null}
          <textarea value={questionInput ?? question} onChange={(event) => onQuestionChange(event.target.value)} placeholder={selectedRecord ? `继续追问"${recordTitle(selectedRecord)}"` : "问项目、文件、课件或选中内容"} disabled={loading || selectedRecordReadOnly} aria-label="输入问题" />
        </div>

        <div className="qa-ask-bottom">
          {panelError ? <div className="qa-local-error" role="alert">{panelError}</div> : null}
          <div className="model-row">
            <select value={modelReady ? "configured" : "missing"} disabled aria-label="当前模型"><option>{configuredModelLabel(settings)}</option></select>
            {!modelReady ? <button type="button" className="secondary-button compact" onClick={onOpenSettings}>配置</button> : null}
          </div>
          <button className="primary-button" onClick={onAsk} disabled={loading || selectedRecordReadOnly || !modelReady || !question.trim()}>
            {loading ? <Loader2 size={15} className="spin" /> : <Send size={15} />}{loading ? (loadingLabel || "生成中...") : selectedRecord ? "继续追问" : "询问"}
          </button>
        </div>
      </section>
    </aside>
  );
}
