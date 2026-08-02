import {
  ArrowDown, ArrowUp, Bot, BrainCircuit, Edit3, ExternalLink,
  History as HistoryIcon, Loader2, MessageCircle, Search, Send,
  Settings as SettingsIcon, Sparkles, Star, Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DiagnosticItem, DynamicSurveyCandidate, LLMSettings, QARecord, SourceType } from "../api/client";
import type { AssistantContextSummary, SelectionSummary } from "./ExplainPanel";
import SlidingSelectionIndicator from "./SlidingSelectionIndicator";

export type MobileAssistantView = "ask" | "history" | "knowledge";

type Props = {
  view: MobileAssistantView;
  onViewChange: (view: MobileAssistantView) => void;
  selection: SelectionSummary | null;
  contextSummary: AssistantContextSummary | null;
  question: string;
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
  view, onViewChange, selection, contextSummary, question, loading, loadingLabel, streamContent,
  history, historyQuery, favoriteOnly, selectedRecord, selectedRecordReadOnly = false,
  surveyCandidate, diagnosticItem, diagnosticResult, settings, panelError,
  knowledgeContent, knowledgeDisabled = false,
  onQuestionChange, onSelectionTextChange, onClearSelection, onAsk, onNewConversation,
  onHistoryQueryChange, onFavoriteOnlyChange, onSelectRecord, onOpenRecord,
  onDeleteRecord, onRenameRecord, onToggleFavorite, onOpenSettings,
  onAnswerSurvey, onDismissSurvey, onDisableSurveys,
  onAnswerDiagnostic, onDismissDiagnostic, onFlagDiagnostic,
}: Props) {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
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

  const suggestions = useMemo(
    () => buildSuggestions(selection, contextSummary),
    [selection?.sourceType, selection?.sourcePath, selection?.selectedText, contextSummary?.sourceType, contextSummary?.sourcePath],
  );

  const modelReady = Boolean(settings?.enabled && settings.has_api_key);
  const canAsk = !loading && !selectedRecordReadOnly && modelReady && Boolean(question.trim());

  function chooseSuggestion(value: string) {
    onQuestionChange(value);
    onViewChange("ask");
    window.requestAnimationFrame(() => { composerRef.current?.focus(); });
  }

  function selectHistoryRecord(record: QARecord) {
    onSelectRecord(record);
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
                {streamContent ? <p>{streamContent}</p> : <span>正在整理项目上下文，请稍候…</span>}
              </section>
            ) : selectedRecord ? (
              <section className="mobile-assistant-answer-card">
                <header>
                  <div><small>{selectedRecordReadOnly ? "跨项目历史回答" : "当前回答"}</small><strong>{recordTitle(selectedRecord)}</strong></div>
                  <button type="button" className="mobile-assistant-text-action" onClick={onNewConversation} disabled={loading}>新问题</button>
                </header>
                <p>{summarizeMarkdown(selectedRecord.answer_md) || "回答内容为空"}</p>
                {!selectedRecordReadOnly ? (
                  <button type="button" className="mobile-assistant-open-answer" onClick={() => onOpenRecord(selectedRecord)}>
                    <ExternalLink size={17} aria-hidden="true" />打开完整回答
                  </button>
                ) : (
                  <span className="mobile-assistant-readonly-note">此回答来自其他项目，只能在助手中继续查看。</span>
                )}
              </section>
            ) : (
              <section className="mobile-assistant-welcome">
                <div><Bot size={24} aria-hidden="true" /></div>
                <strong>关于当前内容提问</strong>
                <p>我会结合当前项目、文档和你的选区回答。</p>
              </section>
            )}

            <section className="mobile-assistant-context-card">
              <header>
                <div><Sparkles size={17} aria-hidden="true" /><strong>当前上下文</strong></div>
                {selection ? <button type="button" className="mobile-assistant-text-action" onClick={onClearSelection} disabled={loading}>清除</button> : null}
              </header>
              {selection ? (
                <>
                  <div className="mobile-assistant-context-meta"><span>{sourceLabel(selection.sourceType)}</span><span>{selection.selectedText.length} 字符</span></div>
                  <div className="mobile-assistant-context-path">{selection.sourcePath || "未命名来源"}</div>
                  <textarea value={selection.selectedText} onChange={(event) => onSelectionTextChange(event.target.value)} disabled={loading} aria-label="附带给 AI 的上下文" />
                </>
              ) : contextSummary ? (
                <>
                  <div className="mobile-assistant-context-meta"><span>{contextSummary.label}</span></div>
                  <div className="mobile-assistant-context-path">{contextSummary.sourcePath || "项目上下文"}</div>
                  <p>{contextSummary.preview}</p>
                </>
              ) : (
                <p>将使用当前项目的结构和学习内容作为上下文。</p>
              )}
            </section>

            <section className="mobile-assistant-suggestions">
              <strong>你可能想问</strong>
              <div>
                {suggestions.map((suggestion) => (
                  <button type="button" key={suggestion} onClick={() => chooseSuggestion(suggestion)} disabled={loading || selectedRecordReadOnly}>{suggestion}</button>
                ))}
              </div>
            </section>

            {!loading && surveyCandidate ? (
              <section className="mobile-assistant-survey-card">
                <header><strong>帮我更了解你的习惯</strong></header>
                <p>{surveyCandidate.question}</p>
                <div className="mobile-assistant-option-list">
                  {surveyCandidate.options.map((option) => (
                    <button type="button" key={option.value} onClick={() => onAnswerSurvey?.(option.value)}>{option.label}</button>
                  ))}
                </div>
                <footer>
                  <button type="button" onClick={onDismissSurvey}>稍后</button>
                  <button type="button" onClick={onDisableSurveys}>以后不再询问</button>
                </footer>
              </section>
            ) : null}

            {!loading && diagnosticItem ? (
              <section className="mobile-assistant-diagnostic-card" aria-label="快速理解检查">
                <header><strong>快速理解检查</strong><span>{diagnosticItem.dimension}</span></header>
                <p>{diagnosticItem.prompt}</p>
                {diagnosticItem.itemType === "step_order" ? (
                  <div className="mobile-assistant-order-list">
                    {diagnosticOrder.map((value, index) => {
                      const label = diagnosticItem.options.find((option) => String(option.value) === value)?.label || value;
                      return (
                        <div key={value}>
                          <span>{index + 1}. {label}</span>
                          <button type="button" aria-label={`上移 ${label}`} disabled={index === 0 || diagnosticResult != null} onClick={() => setDiagnosticOrder((items) => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}><ArrowUp size={16} /></button>
                          <button type="button" aria-label={`下移 ${label}`} disabled={index === diagnosticOrder.length - 1 || diagnosticResult != null} onClick={() => setDiagnosticOrder((items) => { const next = [...items]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}><ArrowDown size={16} /></button>
                        </div>
                      );
                    })}
                  </div>
                ) : diagnosticItem.options.length ? (
                  <div className="mobile-assistant-option-list">
                    {diagnosticItem.options.map((option) => (
                      <button type="button" key={String(option.value)} className={diagnosticAnswer === option.value ? "selected" : ""} disabled={diagnosticResult != null} onClick={() => setDiagnosticAnswer(option.value)}>{option.label}</button>
                    ))}
                  </div>
                ) : (
                  <input className="mobile-assistant-diagnostic-input" value={String(diagnosticAnswer ?? "")} disabled={diagnosticResult != null} onChange={(event) => setDiagnosticAnswer(event.target.value)} placeholder="输入你的判断" aria-label="理解检查答案" />
                )}
                {diagnosticResult != null ? (
                  <div className={`mobile-assistant-diagnostic-result ${diagnosticResult ? "correct" : "incorrect"}`}>
                    <span>{diagnosticResult ? "回答正确，已记为一次验证证据。" : "这次没有答对，老师会补充这一处。"}</span>
                    <button type="button" onClick={onFlagDiagnostic}>题目有问题</button>
                  </div>
                ) : (
                  <footer>
                    <button type="button" className="primary" disabled={diagnosticItem.itemType === "step_order" ? !diagnosticOrder.length : diagnosticAnswer == null || diagnosticAnswer === ""} onClick={() => onAnswerDiagnostic?.(diagnosticItem.itemType === "step_order" ? diagnosticOrder : diagnosticAnswer)}>提交</button>
                    <button type="button" onClick={onDismissDiagnostic}>跳过</button>
                  </footer>
                )}
              </section>
            ) : null}
          </div>

          <div className="mobile-assistant-composer">
            <div className="mobile-assistant-composer-heading">
              <span>{selectedRecord ? `继续：${recordTitle(selectedRecord)}` : "新问题"}</span>
              {selectedRecord ? <button type="button" onClick={onNewConversation} disabled={loading}>清空会话</button> : null}
            </div>
            {selectedRecordReadOnly ? <div className="mobile-assistant-readonly-note">这是其他项目中的历史回答，当前只能查看，不能继续追问。</div> : null}
            <textarea
              ref={composerRef} value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && canAsk) { event.preventDefault(); onAsk(); } }}
              placeholder={selectedRecord ? `继续追问"${recordTitle(selectedRecord)}"` : "问项目、文件、课件或选中内容"}
              disabled={loading || selectedRecordReadOnly} aria-label="输入问题" rows={3}
            />
            {panelError ? <div className="mobile-assistant-error" role="alert">{panelError}</div> : null}
            <div className="mobile-assistant-composer-actions">
              {modelReady ? (
                <span className="mobile-assistant-model" title={configuredModelLabel(settings)}>{configuredModelLabel(settings)}</span>
              ) : (
                <button type="button" className="mobile-assistant-configure" onClick={onOpenSettings}><SettingsIcon size={17} aria-hidden="true" />配置模型</button>
              )}
              <button type="button" className="mobile-assistant-send" onClick={onAsk} disabled={!canAsk}>
                {loading ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
                <span>{loading ? loadingLabel || "生成中" : selectedRecord ? "继续追问" : "询问"}</span>
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {view === "history" ? (
        <section id="mobile-assistant-view-history" className="mobile-assistant-view mobile-assistant-history-view" role="tabpanel" aria-labelledby="mobile-assistant-tab-history">
          <div className="mobile-assistant-history-tools">
            <label><Search size={18} aria-hidden="true" /><input value={historyQuery} onChange={(event) => onHistoryQueryChange(event.target.value)} placeholder="搜索历史回答" aria-label="搜索历史回答" /></label>
            <button type="button" className={favoriteOnly ? "active" : ""} aria-pressed={favoriteOnly} onClick={() => onFavoriteOnlyChange(!favoriteOnly)}><Star size={18} aria-hidden="true" />收藏</button>
          </div>
          <div className="mobile-assistant-history-list">
            {history.length ? history.map((record) => {
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
                    <button type="button" className={record.favorite ? "active" : ""} onClick={() => onToggleFavorite(record)} disabled={loading} aria-label={record.favorite ? `取消收藏 ${recordTitle(record)}` : `收藏 ${recordTitle(record)}`} aria-pressed={record.favorite} title={record.favorite ? "取消收藏" : "收藏"}><Star size={17} aria-hidden="true" /></button>
                    <button type="button" onClick={() => onRenameRecord(record)} disabled={loading} aria-label={`重命名 ${recordTitle(record)}`} title="重命名"><Edit3 size={17} aria-hidden="true" /></button>
                    {onDeleteRecord ? <button type="button" className="danger" onClick={() => onDeleteRecord(record)} disabled={loading} aria-label={`删除 ${recordTitle(record)}`} title="删除"><Trash2 size={17} aria-hidden="true" /></button> : null}
                  </div>
                </article>
              );
            }) : (
              <section className="mobile-assistant-empty-state">
                <HistoryIcon size={28} aria-hidden="true" />
                <strong>{historyQuery || favoriteOnly ? "没有符合条件的回答" : "还没有提问记录"}</strong>
                <p>{historyQuery || favoriteOnly ? "修改搜索词或关闭收藏筛选。" : "提出第一个问题后，回答会出现在这里。"}</p>
                <button type="button" onClick={() => onViewChange("ask")}>去提问</button>
              </section>
            )}
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
