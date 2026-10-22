import MarkdownViewer from "../../reader/MarkdownViewer";
import UnderstandingFeedback from "../../teaching/UnderstandingFeedback";
import { normalizeOutputPath } from "../../../app/appUtils";
import {
  CornerUpLeft, Square, Bot, BrainCircuit, Edit3, ExternalLink, FileText,
  History as HistoryIcon, Loader2, MessageCircle, Search, Send,
  Settings as SettingsIcon, Sparkles, Star, Trash2, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LLMSettings, QARecord, QAThreadSummary, SourceType, TeachingHandoff, TeachingNextAction } from "../../../api/client";
import type { AssistantContextSummary, SelectionSummary } from "../ExplainPanel";
import { DeferredLiftInput, DeferredLiftTextarea, type DeferredLiftTextareaHandle } from "../../../components/ui/DeferredLiftText";
import SlidingSelectionIndicator from "../../../components/ui/SlidingSelectionIndicator";
import { groupQARecordsByThreads, TeachingClosureCard, TeachingResumeCard } from "../../teaching/TeachingContinuityCards";

export type MobileAssistantView = "ask" | "history" | "knowledge";

type Props = {
  includeContext?: boolean;
  onIncludeContextChange?: (value: boolean) => void;
  conversationActive?: boolean;
  conversationLabel?: string;
  canStopAnswer?: boolean;
  onStopAnswer?: () => void;
  onReturnToSource?: (record: QARecord) => void;
  view: MobileAssistantView;
  onViewChange: (view: MobileAssistantView) => void;
  selection: SelectionSummary | null;
  contextSummary: AssistantContextSummary | null;
  contextFiles: string[];
  onOpenFilePicker: () => void;
  onRemoveContextFile: (path: string) => void;
  question: string;
  loading: boolean;
  loadingLabel?: string;
  streamContent?: string;
  history: QARecord[];
  historyLoading?: boolean;
  historyError?: string;
  onRetryHistory?: () => void;
  threads?: QAThreadSummary[];
  continuity?: TeachingHandoff | null;
  historyQuery: string;
  favoriteOnly: boolean;
  selectedRecord: QARecord | null;
  followUpRecord: QARecord | null;
  selectedRecordReadOnly?: boolean;
  settings: LLMSettings | null;
  panelError: string;
  knowledgeContent?: ReactNode;
  knowledgeDisabled?: boolean;
  onQuestionChange: (value: string) => void;
  onSelectionTextChange: (value: string) => void;
  onClearSelection: () => void;
  onAsk: (question: string) => void;
  onNewConversation: () => void;
  onHistoryQueryChange: (value: string) => void;
  /** Bumped by the parent when it clears the underlying question state; resets the composer draft. */
  resetToken?: unknown;
  onFavoriteOnlyChange: (value: boolean) => void;
  onSelectRecord: (record: QARecord) => void;
  onFollowUp: (record: QARecord) => void;
  onOpenRecord: (record: QARecord) => void;
  onDeleteRecord?: (record: QARecord) => void;
  onRenameRecord: (record: QARecord) => void;
  onToggleFavorite: (record: QARecord) => void;
  onResumeContinuity?: (handoff: TeachingHandoff) => void;
  onOpenContinuitySource?: (handoff: TeachingHandoff) => void;
  onDismissContinuity?: (handoff: TeachingHandoff) => void;
  onTeachingNextAction?: (action: TeachingNextAction, handoff: TeachingHandoff) => void;
  onOpenSettings: () => void;
};

function sourceLabel(sourceType: SourceType) {
  if (sourceType === "file") return "当前源码";
  if (sourceType === "course") return "当前课件";
  if (sourceType === "qa") return "当前回答";
  return "已选内容";
}

function recordTitle(record: QARecord) {
  return record.display_title?.trim() || record.question;
}

function fileLabel(path: string) {
  return path.split("/").pop() ?? path;
}

function summarizeMarkdown(content: string) {
  return content.replace(/[#>*`_\-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

function configuredModelLabel(settings: LLMSettings | null) {
  if (!settings?.enabled || !settings.has_api_key) return "尚未配置模型";
  return `${settings.provider} / ${settings.model}`;
}

function formatRecordDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function buildSuggestions(selection: SelectionSummary | null, context: AssistantContextSummary | null) {
  if (selection?.selectedText.trim()) {
    return ["这段内容在做什么？", "为什么要这样实现？", "它和项目中的其他部分有什么关系？"];
  }
  if (context?.sourceType === "file") {
    return ["这个文件的主要职责是什么？", "梳理这个文件的调用链", "这里最容易出错的地方是什么？"];
  }
  if (context?.sourceType === "course") {
    return ["用更简单的方式解释本课", "给我一个具体代码例子", "学习这里需要哪些前置知识？"];
  }
  if (context?.sourceType === "qa") {
    return ["把这个回答再讲简单一点", "给我一个相反的例子", "我应该如何验证自己理解了？"];
  }
  return ["这个项目的主要架构是什么？", "我应该从哪里开始学习？", "如何运行这个项目？"];
}

export default function MobileAssistantPanel({
  includeContext = false, onIncludeContextChange, conversationActive = false, conversationLabel, canStopAnswer = false, onStopAnswer, onReturnToSource,
  view, onViewChange, selection, contextSummary, contextFiles, onOpenFilePicker, onRemoveContextFile, question, loading, loadingLabel, streamContent,
  history, historyLoading = false, historyError = "", onRetryHistory, threads = [], continuity = null, historyQuery, favoriteOnly, selectedRecord, followUpRecord, selectedRecordReadOnly = false,
  settings, panelError,
  knowledgeContent, knowledgeDisabled = false,
  onQuestionChange, onSelectionTextChange, onClearSelection, onAsk, onNewConversation,
  onHistoryQueryChange, onFavoriteOnlyChange, onSelectRecord, onFollowUp, onOpenRecord,
  onDeleteRecord, onRenameRecord, onToggleFavorite, onResumeContinuity = () => {}, onOpenContinuitySource = () => {}, onDismissContinuity = () => {}, onTeachingNextAction = () => {}, onOpenSettings,
  resetToken,
}: Props) {
  const composerRef = useRef<DeferredLiftTextareaHandle | null>(null);
  /*
   * The composer draft lives here instead of App state so typing does not
   * re-render the whole app (which was the source of input lag). The parent
   * only hears about the draft on blur/unmount or via an explicit resetToken.
   */
  const [questionDraft, setQuestionDraft] = useState(question);
  useEffect(() => {
    setQuestionDraft(question);
  }, [question, resetToken]);


  const suggestions = useMemo(
    () => buildSuggestions(selection, contextSummary),
    [selection?.sourceType, selection?.sourcePath, selection?.selectedText, contextSummary?.sourceType, contextSummary?.sourcePath],
  );

  const modelReady = Boolean(settings?.enabled && settings.has_api_key);
  const canAsk = !loading && modelReady && Boolean(questionDraft.trim());
  const threadGroups = groupQARecordsByThreads(threads, history);

  function chooseSuggestion(value: string) {
    setQuestionDraft(value);
    onQuestionChange(value);
    composerRef.current?.setValue(value);
    onViewChange("ask");
    window.requestAnimationFrame(() => { composerRef.current?.focus(); });
  }

  function handleSend() {
    const questionText = questionDraft.trim();
    if (!questionText) return;
    onAsk(questionText);
  }

  function selectHistoryRecord(record: QARecord) {
    onSelectRecord(record);
    onViewChange("ask");
  }

  function followUpHistoryRecord(record: QARecord) {
    onFollowUp(record);
    onViewChange("ask");
  }

  return (
    <section className="mobile-assistant-panel">
      <div className="mobile-assistant-tabs" role="tablist" aria-label="AI 助手页面">
        <SlidingSelectionIndicator activeKey={view} className="mobile-assistant-tab-indicator" />
        <button data-selection-key="ask" type="button" role="tab" id="mobile-assistant-tab-ask" aria-controls="mobile-assistant-view-ask" aria-selected={view === "ask"} className={view === "ask" ? "active" : ""} onClick={() => onViewChange("ask")}>
          <MessageCircle size={18} aria-hidden="true" /><span>提问</span>
        </button>
        <button data-selection-key="history" type="button" role="tab" id="mobile-assistant-tab-history" aria-controls="mobile-assistant-view-history" aria-selected={view === "history"} className={view === "history" ? "active" : ""} onClick={() => onViewChange("history")} disabled={loading}>
          <HistoryIcon size={18} aria-hidden="true" /><span>历史</span>
        </button>
        <button data-selection-key="knowledge" type="button" role="tab" id="mobile-assistant-tab-knowledge" aria-controls="mobile-assistant-view-knowledge" aria-selected={view === "knowledge"} className={view === "knowledge" ? "active" : ""} onClick={() => onViewChange("knowledge")} disabled={loading || knowledgeDisabled}>
          <BrainCircuit size={18} aria-hidden="true" /><span>知识</span>
        </button>
      </div>

      {view === "ask" ? (
        <section id="mobile-assistant-view-ask" className="mobile-assistant-view mobile-assistant-ask-view" role="tabpanel" aria-labelledby="mobile-assistant-tab-ask">
          <div className="mobile-assistant-scroll">
            {loading ? (
              <section className="mobile-assistant-answer-card is-loading" aria-live="polite">
                <header><Loader2 size={17} className="spin" aria-hidden="true" /><strong>{loadingLabel || "正在生成回答"}</strong></header>
                {streamContent ? <MarkdownViewer title={null} content={streamContent} streaming embedded hideHeader /> : <span>正在等待模型返回正文…</span>}
              </section>
            ) : selectedRecord ? (
              <section className="mobile-assistant-answer-card">
                <header>
                  <div><small>{selectedRecordReadOnly ? "跨项目历史回答" : "当前回答"}</small><strong>{recordTitle(selectedRecord)}</strong></div>
                  <button type="button" className="mobile-assistant-text-action" onClick={onNewConversation} disabled={loading}>新对话</button>
                </header>
                <p>{summarizeMarkdown(selectedRecord.answer_md) || "回答内容为空"}</p>
                {!selectedRecordReadOnly && selectedRecord.source_path && onReturnToSource ? <button type="button" className="mobile-assistant-text-action" onClick={() => onReturnToSource(selectedRecord)}><CornerUpLeft size={17} />回到原文</button> : null}
                {!selectedRecordReadOnly ? (
                  <button type="button" className="mobile-assistant-open-answer" onClick={() => onOpenRecord(selectedRecord)}>
                    <ExternalLink size={17} aria-hidden="true" />打开完整回答
                  </button>
                ) : (
                  <span className="mobile-assistant-readonly-note">此回答来自其他项目，只能在助手中继续查看。</span>
                )}
              </section>
            ) : (
              <>
                {continuity ? (
                  <TeachingResumeCard handoff={continuity} disabled={loading} onResume={onResumeContinuity} onOpenSource={onOpenContinuitySource} onDismiss={onDismissContinuity} />
                ) : null}
                <section className="mobile-assistant-welcome">
                  <div><Bot size={24} aria-hidden="true" /></div>
                  <strong>关于当前内容提问</strong>
                  <p>可以发送问题与选区，需要当前文档和项目检索时勾选附带上下文。</p>
                </section>
              </>
            )}

            {!loading && !selectedRecordReadOnly && selectedRecord?.teaching_handoff ? (
              <TeachingClosureCard handoff={selectedRecord.teaching_handoff} onAction={onTeachingNextAction} />
            ) : null}

            <section className="mobile-assistant-context-card">
              <header>
                <div><Sparkles size={17} aria-hidden="true" /><strong>当前上下文</strong></div>
                {selection ? <button type="button" className="mobile-assistant-text-action" onClick={onClearSelection} disabled={loading}>清除</button> : null}
              </header>
              {onIncludeContextChange ? <label><input type="checkbox" checked={includeContext} disabled={loading} onChange={event => onIncludeContextChange(event.target.checked)} />附带上下文（当前文档及相关项目检索）</label> : null}
              {selection ? (
                <>
                  <div className="mobile-assistant-context-meta"><span>{sourceLabel(selection.sourceType)}</span><span>{selection.selectedText.length} 字符</span></div>
                  <div className="mobile-assistant-context-path">{selection.sourcePath || "未命名来源"}</div>
                  <DeferredLiftTextarea value={selection.selectedText} onLift={onSelectionTextChange} liftDelayMs={250} disabled={loading} aria-label="附带给 AI 的上下文" />
                </>
              ) : contextSummary && includeContext ? (
                <>
                  <div className="mobile-assistant-context-meta"><span>{contextSummary.label}</span></div>
                  <div className="mobile-assistant-context-path">{contextSummary.sourcePath || "项目上下文"}</div>
                  <p>{contextSummary.preview}</p>
                </>
              ) : (
                <p>默认仅发送问题、选区、简短对话历史和已有画像摘要；自选参考文件独立生效。</p>
              )}
              {contextFiles.length > 0 ? (
                <div className="mobile-context-file-chips">
                  {contextFiles.map((path) => (
                    <span key={path} className="context-file-chip" title={path}>
                      <FileText size={12} />
                      <span>{fileLabel(path)}</span>
                      <button type="button" aria-label={`移除 ${fileLabel(path)}`} disabled={loading} onClick={() => onRemoveContextFile(path)}><X size={11} /></button>
                    </span>
                  ))}
                </div>
              ) : null}
              <button type="button" className="mobile-assistant-text-action" onClick={onOpenFilePicker} disabled={loading}><FileText size={15} />选择参考文件</button>
            </section>

            <section className="mobile-assistant-suggestions">
              <strong>你可能想问</strong>
              <div>
                {suggestions.map((suggestion) => (
                  <button type="button" key={suggestion} onClick={() => chooseSuggestion(suggestion)} disabled={loading}>{suggestion}</button>
                ))}
              </div>
            </section>

            {!loading && selectedRecord && !selectedRecordReadOnly ? <UnderstandingFeedback projectId={selectedRecord.project_id} sourceType="qa" sourcePath={normalizeOutputPath(selectedRecord.output_path, selectedRecord.id, selectedRecord.project_id)} /> : null}
          </div>

          <div className="mobile-assistant-composer">
            <div className="mobile-assistant-composer-heading">
              <span>{conversationLabel || (followUpRecord ? `正在追问：${recordTitle(followUpRecord)}` : conversationActive ? "当前对话" : "新对话")}</span>
              <button type="button" onClick={onNewConversation} disabled={loading}>新对话</button>
            </div>
            {selectedRecordReadOnly ? <div className="mobile-assistant-readonly-note">这是其他项目中的历史回答，只能查看；你仍可发起新的独立问题。</div> : null}
            <DeferredLiftTextarea
              ref={composerRef}
              value={question}
              onLift={onQuestionChange}
              onDraftChange={setQuestionDraft}
              resetToken={resetToken}
              onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && canAsk) { event.preventDefault(); handleSend(); } }}
              placeholder="请输入问题"
              disabled={loading} aria-label="输入问题" rows={3}
            />
            {panelError ? <div className="mobile-assistant-error" role="alert">{panelError}</div> : null}
            <div className="mobile-assistant-composer-actions">
              {modelReady ? (
                <span className="mobile-assistant-model" title={configuredModelLabel(settings)}>{configuredModelLabel(settings)}</span>
              ) : (
                <button type="button" className="mobile-assistant-configure" onClick={onOpenSettings}><SettingsIcon size={17} aria-hidden="true" />配置模型</button>
              )}
              {loading && canStopAnswer && onStopAnswer ? <button type="button" className="mobile-assistant-send" onClick={onStopAnswer}><Square size={18} />停止回答</button> : null}
              <button type="button" className="mobile-assistant-send" onClick={handleSend} disabled={!canAsk}>
                {loading ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
                <span>{loading ? loadingLabel || "生成中" : followUpRecord ? "继续追问" : "询问"}</span>
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {view === "history" ? (
        <section id="mobile-assistant-view-history" className="mobile-assistant-view mobile-assistant-history-view" role="tabpanel" aria-labelledby="mobile-assistant-tab-history">
          <div className="mobile-assistant-history-tools">
            <label><Search size={18} aria-hidden="true" /><DeferredLiftInput value={historyQuery} onLift={onHistoryQueryChange} liftDelayMs={250} placeholder="搜索历史回答" aria-label="搜索历史回答" /></label>
            <button type="button" className={favoriteOnly ? "active" : ""} aria-pressed={favoriteOnly} onClick={() => onFavoriteOnlyChange(!favoriteOnly)}><Star size={18} aria-hidden="true" />收藏</button>
          </div>
          <div className="mobile-assistant-history-list" aria-busy={historyLoading}>
            {historyError || panelError ? <div className="mobile-assistant-error" role="alert">
              {historyError || panelError}
              {historyError && onRetryHistory ? <button type="button" className="mobile-assistant-text-action" onClick={onRetryHistory} disabled={historyLoading}>重试加载历史</button> : null}
            </div> : null}
            {historyLoading ? <div role="status">正在加载历史记录…</div> : null}
            {history.length ? threadGroups.map(({ summary, records }) => (
              <details className={`mobile-assistant-thread ${summary.isCurrent ? "current" : ""}`} key={summary.topic} open={Boolean(historyQuery.trim() || favoriteOnly) || summary.isCurrent || records.some((record) => record.id === selectedRecord?.id)}>
                <summary>
                  <span><strong>{`主题 · ${summary.topic}`}</strong>{summary.progressSummary ? <small>{summary.progressSummary}</small> : null}</span>
                  <small>{summary.turnCount} 轮{summary.sourcePath ? ` · ${fileLabel(summary.sourcePath)}` : ""}{summary.updatedAt ? ` · ${formatRecordDate(summary.updatedAt)}` : ""}</small>
                </summary>
                <div className="mobile-assistant-thread-records">
                  {records.map((record) => {
                    const selected = selectedRecord?.id === record.id;
                    return (
                      <article key={record.id} className={`mobile-assistant-history-card ${selected ? "selected" : ""}`}>
                        <button type="button" className="mobile-assistant-history-main" onClick={() => selectHistoryRecord(record)} disabled={loading}>
                          <strong>{recordTitle(record)}</strong>
                          <span>{summarizeMarkdown(record.answer_md) || record.question}</span>
                          <small>{record.model}{record.updated_at ? ` · ${formatRecordDate(record.updated_at)}` : ""}</small>
                        </button>
                        <div className="mobile-assistant-history-actions">
                          <button type="button" onClick={() => onOpenRecord(record)} disabled={loading} aria-label={`打开 ${recordTitle(record)}`} title="打开完整回答"><ExternalLink size={17} aria-hidden="true" /></button>
                          {record.source_path && onReturnToSource ? <button type="button" onClick={() => onReturnToSource(record)} disabled={loading} aria-label={`回到原文 ${recordTitle(record)}`} title="回到原文"><CornerUpLeft size={17} aria-hidden="true" /></button> : null}
                          <button type="button" onClick={() => followUpHistoryRecord(record)} disabled={loading} aria-label={`追问 ${recordTitle(record)}`} title="将此问答链作为追问材料"><MessageCircle size={17} aria-hidden="true" /></button>
                          <button type="button" className={record.favorite ? "active" : ""} onClick={() => onToggleFavorite(record)} disabled={loading} aria-label={record.favorite ? `取消收藏 ${recordTitle(record)}` : `收藏 ${recordTitle(record)}`} aria-pressed={record.favorite} title={record.favorite ? "取消收藏" : "收藏"}><Star size={17} aria-hidden="true" /></button>
                          <button type="button" onClick={() => onRenameRecord(record)} disabled={loading} aria-label={`重命名 ${recordTitle(record)}`} title="重命名"><Edit3 size={17} aria-hidden="true" /></button>
                          {onDeleteRecord ? <button type="button" className="danger" onClick={() => onDeleteRecord(record)} disabled={loading} aria-label={`删除 ${recordTitle(record)}`} title="删除"><Trash2 size={17} aria-hidden="true" /></button> : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </details>
            )) : !historyLoading && !historyError ? (
              <section className="mobile-assistant-empty-state">
                <HistoryIcon size={28} aria-hidden="true" />
                <strong>{historyQuery || favoriteOnly ? "没有符合条件的回答" : "还没有提问记录"}</strong>
                <p>{historyQuery || favoriteOnly ? "修改搜索词或关闭收藏筛选。" : "提出第一个问题后，回答会出现在这里。"}</p>
                <button type="button" onClick={() => onViewChange("ask")}>去提问</button>
              </section>
            ) : null}
          </div>
        </section>
      ) : null}

      {view === "knowledge" ? (
        <section id="mobile-assistant-view-knowledge" className="mobile-assistant-view mobile-assistant-knowledge-view" role="tabpanel" aria-labelledby="mobile-assistant-tab-knowledge">
          {knowledgeContent ?? (
            <section className="mobile-assistant-empty-state">
              <BrainCircuit size={30} aria-hidden="true" /><strong>暂无知识网络</strong>
              <p>选择一个项目并完成一些课程或问答后再查看。</p>
            </section>
          )}
        </section>
      ) : null}
    </section>
  );
}
