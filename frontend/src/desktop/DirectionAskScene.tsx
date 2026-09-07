import { useEffect, useMemo, useRef, useState, type ComponentProps, type PointerEvent } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ArrowUpRight, ArrowLeft, Plus, Search, Star, Trash2, Pencil, MessageCircle, FileText, X, Network, ChevronRight, Copy, Check } from 'lucide-react';
import type ExplainPanel from '../components/ExplainPanel';
import type { QARecord } from '../api/client';
import { DeferredLiftInput, DeferredLiftTextarea } from '../components/DeferredLiftText';
import { groupQARecordsByThreads, TeachingClosureCard, TeachingResumeCard } from '../components/TeachingContinuityCards';
import AssistantLearningChecks from '../components/AssistantLearningChecks';

type Props = ComponentProps<typeof ExplainPanel>;
const titleOf = (record: QARecord) => record.display_title?.trim() || record.question;

/* A dev-only visual fixture. It is intentionally opt-in so production data,
   history and callbacks are never replaced. Open /?preview=ask-answer while
   running Vite to inspect the selected-card and answer states without a
   configured backend. */
const ASK_PREVIEW_RECORD: QARecord = {
  id: 9001,
  project_id: 1,
  session_id: 900,
  parent_qa_id: null,
  relation_type: 'follow_up',
  source_type: 'course',
  source_path: 'lessons/03-memory-model.md',
  display_title: '为什么引用失效后仍然能读到旧值？',
  selected_text: '当对象的所有权已经转移，原来的引用仍然指向一段已经不再属于它的内存。',
  question: '为什么引用失效后仍然能读到旧值？',
  answer_md: '## 先看生命周期\n\n引用本身不拥有对象。对象被释放后，引用仍可能保留旧地址，所以偶尔读到旧值并不代表它仍然有效。\n\n```cpp\nconst auto& view = make_view();\n// view 的生命周期必须不晚于它引用的对象\n```\n\n> 关键判断：地址还在，不等于对象还活着。',
  provider: 'preview',
  model: 'direction-c-preview',
  output_path: 'qa/9001.md',
  retrieval_trace: null,
  retrieval_sources: [],
  teaching_handoff: null,
  favorite: true,
  created_at: '2026-09-06T11:20:00.000Z',
  updated_at: '2026-09-06T11:20:00.000Z',
};
const ASK_PREVIEW_RECORDS: QARecord[] = [
  ASK_PREVIEW_RECORD,
  { ...ASK_PREVIEW_RECORD, id: 9002, display_title: 'unique_ptr 和 shared_ptr 应该怎么选？', question: 'unique_ptr 和 shared_ptr 应该怎么选？', source_path: 'lessons/02-ownership.md', favorite: false, created_at: '2026-09-06T10:20:00.000Z', updated_at: '2026-09-06T10:20:00.000Z' },
  { ...ASK_PREVIEW_RECORD, id: 9003, display_title: '析构函数为什么要设为 virtual？', question: '析构函数为什么要设为 virtual？', source_path: 'lessons/04-polymorphism.md', favorite: false, created_at: '2026-09-06T09:20:00.000Z', updated_at: '2026-09-06T09:20:00.000Z' },
  { ...ASK_PREVIEW_RECORD, id: 9004, display_title: '移动构造会在什么时候发生？', question: '移动构造会在什么时候发生？', source_path: 'lessons/05-move-semantics.md', favorite: false, created_at: '2026-09-06T08:20:00.000Z', updated_at: '2026-09-06T08:20:00.000Z' },
];
const ASK_PREVIEW_THREAD = {
  sessionId: 900,
  topic: 'C++ 生命周期与引用',
  progressSummary: '从地址、所有权和对象生命周期建立联系。',
  unresolvedPoints: [],
  turnCount: 1,
  latestQaRecordId: ASK_PREVIEW_RECORD.id,
  sourceType: 'course' as const,
  sourcePath: ASK_PREVIEW_RECORD.source_path,
  isCurrent: true,
  updatedAt: ASK_PREVIEW_RECORD.updated_at,
  records: ASK_PREVIEW_RECORDS.map(record => record.id),
};

/** A desktop-only presentation; all operations still belong to the original controllers. */
export default function DirectionAskScene(p: Props) {
  const [draft, setDraft] = useState(p.questionInput ?? p.question);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const historyRail = useRef<HTMLDivElement>(null);
  const historyWheelGesture = useRef({ lastEventAt: -Infinity, direction: 0, distance: 0, selected: false });
  const reducedMotion = useReducedMotion();
  const composing = useRef(false);
  const askPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'ask-answer';
  const [previewRecordId, setPreviewRecordId] = useState(ASK_PREVIEW_RECORD.id);
  const activeRecord = askPreview
    ? (ASK_PREVIEW_RECORDS.find(record => record.id === previewRecordId) ?? ASK_PREVIEW_RECORD)
    : p.selectedRecord;
  const activeHistory = askPreview ? ASK_PREVIEW_RECORDS : p.history;
  const activeThreads = askPreview ? [ASK_PREVIEW_THREAD] : (p.threads ?? []);
  const previewAnswer = askPreview ? <section className="direction-answer-view direction-answer-preview" aria-label="预览回答">
    <header><span>回答 · PREVIEW</span><small>来源 / {activeRecord?.source_path}</small></header>
    <h2>{activeRecord?.question ?? ASK_PREVIEW_RECORD.question}</h2>
    <div className="markdown-body"><h3>先看生命周期</h3><p>引用本身不拥有对象。对象被释放后，引用仍可能保留旧地址，所以偶尔读到旧值并不代表它仍然有效。</p><pre><code>const auto&amp; view = make_view();{`\n`}// view 的生命周期必须不晚于它引用的对象</code></pre><blockquote>关键判断：地址还在，不等于对象还活着。</blockquote></div>
  </section> : null;
  const selectionKey = `${p.selection?.sourcePath || ''}:${p.selection?.selectedText || ''}`;
  const hasSelection = Boolean(p.selection?.selectedText);
  const hasAnswer = Boolean(activeRecord || p.loading);
  const modelReady = Boolean(p.settings?.enabled && p.settings.has_api_key);
  const knowledge = p.upperTab === 'knowledge';
  const groups = groupQARecordsByThreads(activeThreads, activeHistory);
  const historyRecords = useMemo(() => groups.flatMap(group => group.records), [groups]);
  const selectedHistoryIndex = Math.max(0, historyRecords.findIndex(record => record.id === activeRecord?.id));
  const historyIndex = (record: QARecord) => Math.max(0, historyRecords.findIndex(item => item.id === record.id));
  useEffect(() => {
    const rail = historyRail.current;
    if (!rail) return;
    function handleHistoryWheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey || event.shiftKey || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const slots = Array.from(rail!.querySelectorAll<HTMLElement>('[data-history-id]'))
        .filter(slot => !slot.closest('details:not([open])'));
      if (!slots.length) return;
      // React's delegated wheel listener is passive. This native listener owns
      // vertical scrolling so a gesture cannot both select and scroll past a card.
      event.preventDefault();
      const gesture = historyWheelGesture.current;
      const now = performance.now();
      const direction = Math.sign(event.deltaY);
      if (now - gesture.lastEventAt > 160 || gesture.direction !== direction) {
        gesture.distance = 0;
        gesture.selected = false;
      }
      gesture.lastEventAt = now;
      gesture.direction = direction;
      gesture.distance += Math.abs(event.deltaY) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rail!.clientHeight : 1);
      if (gesture.selected || gesture.distance < 12) return;
      // Touchpad inertia belongs to the same gesture, even after React updates.
      gesture.selected = true;
      const current = slots.findIndex(slot => Number(slot.dataset.historyId) === activeRecord?.id);
      const nextIndex = current < 0
        ? direction > 0 ? 0 : slots.length - 1
        : Math.min(slots.length - 1, Math.max(0, current + direction));
      const slot = slots[nextIndex];
      const next = historyRecords.find(record => record.id === Number(slot.dataset.historyId));
      if (!next || next.id === activeRecord?.id) return;
      if (askPreview) {
        setPreviewRecordId(next.id);
      } else {
        p.onUpperTabChange('history');
        p.onSelectRecord(next);
      }
      const railBounds = rail!.getBoundingClientRect();
      const slotBounds = slot.getBoundingClientRect();
      const centeredTop = rail!.scrollTop + slotBounds.top - railBounds.top - rail!.clientTop + (slotBounds.height - rail!.clientHeight) / 2;
      rail!.scrollTo({
        top: Math.max(0, Math.min(rail!.scrollHeight - rail!.clientHeight, centeredTop)),
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
    }
    rail.addEventListener('wheel', handleHistoryWheel, { passive: false });
    return () => rail.removeEventListener('wheel', handleHistoryWheel);
  }, [historyRecords, activeRecord?.id, askPreview, reducedMotion, p.onUpperTabChange, p.onSelectRecord]);
  useEffect(() => { setDraft(p.questionInput ?? p.question); }, [p.question, p.questionInput, p.resetToken]);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); setCopied(false); setCopyError(false); }, [activeRecord?.id, selectionKey]);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);
  const submit = () => { if (!composing.current && draft.trim() && modelReady && !p.loading) p.onAsk(draft.trim()); };
  async function copyAnswer() {
    try { await navigator.clipboard.writeText(activeRecord?.answer_md || p.streamContent || ''); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  function tiltHistoryCard(event: PointerEvent<HTMLDivElement>) {
    if (reducedMotion || event.pointerType !== 'mouse') return;
    // Measure the stationary slot so the lifted card cannot chase the pointer.
    const slot = event.currentTarget;
    const bounds = slot.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
    slot.style.setProperty('--history-tilt-x', `${-y * 2.5}deg`);
    slot.style.setProperty('--history-tilt-y', `${x * 3}deg`);
  }
  function resetHistoryTilt(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.style.removeProperty('--history-tilt-x');
    event.currentTarget.style.removeProperty('--history-tilt-y');
  }
  function recordRow(record: QARecord) {
    const distance = Math.min(3, Math.abs(historyIndex(record) - selectedHistoryIndex));
    return <div className={`game-history-record depth-${distance} ${record.id === activeRecord?.id ? 'selected' : ''}`} data-history-id={record.id} key={record.id} onPointerMove={tiltHistoryCard} onPointerLeave={resetHistoryTilt} onPointerCancel={resetHistoryTilt}>
      <div className="game-history-card"><div className="game-history-face">
      <i className="game-history-sheen" aria-hidden="true"/>
      <button className="game-history-open" onClick={() => { if (askPreview) setPreviewRecordId(record.id); else { p.onUpperTabChange('history'); p.onSelectRecord(record); } }} onDoubleClick={() => { if (!askPreview) p.onOpenRecord(record); }} draggable onDragStart={event => {
        event.dataTransfer.setData('application/codecourse-item', JSON.stringify({ kind: 'qa', qaId: record.id })); event.dataTransfer.effectAllowed = 'copy';
      }} aria-label={`查看回答 ${titleOf(record)}`} aria-pressed={record.id === activeRecord?.id}>
        <b>{String(historyIndex(record) + 1).padStart(2, '0')}</b><span><strong>{titleOf(record)}</strong><small>{record.source_path?.split('/').pop() || record.model}</small></span><ArrowUpRight size={17}/>
      </button>
      <div className="game-history-actions">
        <button onClick={() => p.onFollowUp(record)} disabled={p.loading || p.selectedRecordReadOnly && activeRecord?.id === record.id} aria-label={`追问 ${titleOf(record)}`} title="追问"><MessageCircle size={14}/></button>
        <button onClick={() => p.onToggleFavorite(record)} aria-label={record.favorite ? '取消收藏' : '收藏'} title={record.favorite ? '取消收藏' : '收藏'}><Star size={14} fill={record.favorite ? 'currentColor' : 'none'}/></button>
        <button onClick={() => p.onRenameRecord(record)} aria-label="重命名记录" title="重命名"><Pencil size={14}/></button>
        <button onClick={() => p.onDeleteRecord?.(record)} aria-label="删除记录" title="删除"><Trash2 size={14}/></button>
      </div>
      </div></div>
    </div>;
  }
  return <section className="game-ask" aria-label="AI 提问场景">
    <aside className="game-ask-history" aria-label="问答历史">
      <header className="game-history-heading"><span><b>04</b><i/>问答历史</span><h1 tabIndex={-1}>HISTORY<span>.</span></h1></header>
      <div className="game-history-filter"><label><Search size={16}/><DeferredLiftInput value={p.historyQuery} onLift={p.onHistoryQueryChange} liftDelayMs={250} placeholder="检索过往问题" aria-label="搜索历史"/></label><button className={p.favoriteOnly ? 'selected' : ''} onClick={() => p.onFavoriteOnlyChange(!p.favoriteOnly)} aria-label="只看收藏" aria-pressed={p.favoriteOnly}><Star size={17} fill={p.favoriteOnly ? 'currentColor' : 'none'}/></button></div>
      <div className="game-history-track" ref={historyRail}>
        {!activeRecord && p.continuity && <TeachingResumeCard handoff={p.continuity} disabled={p.loading} onResume={p.onResumeContinuity!} onOpenSource={p.onOpenContinuitySource!} onDismiss={p.onDismissContinuity!}/>}
        {groups.map(({ summary, records }) => <details className="game-history-thread" key={summary.sessionId} open>
          <summary><ChevronRight size={13}/><strong>{summary.topic}</strong><span>{records.length}</span></summary>
          {records.map(recordRow)}
        </details>)}
        {!groups.length && <div className="game-history-empty"><span>— —</span><p>{p.historyQuery || p.favoriteOnly ? '没有匹配的回答' : '你的探索，从第一个问题开始。'}</p></div>}
      </div>
      <button className="game-ask-action game-new-question" disabled={p.loading} onClick={() => { p.onNewConversation(); p.onUpperTabChange('history'); }}><Plus size={16}/>开始新问题<ArrowUpRight size={18}/></button>
    </aside>
    <div className={`game-ask-main ${knowledge ? 'show-knowledge' : ''}`}>
      <div className="game-ask-tools"><span>{knowledge ? 'KNOWLEDGE NETWORK' : hasSelection ? 'SELECTED CONTEXT' : hasAnswer ? 'ANSWER / LOG' : 'A QUESTION OPENS A WORLD'}</span><div>
        <button disabled={p.knowledgeDisabled} onClick={() => p.onUpperTabChange(knowledge ? 'history' : 'knowledge')} className={knowledge ? 'selected' : ''}><Network size={16}/>{knowledge ? '返回提问' : '知识网络'}</button>
        <button className="game-ask-close" onClick={p.onClose} aria-label="关闭 AI 助手"><ArrowLeft size={16}/>返回阅读</button>
      </div></div>
      {knowledge ? <div className="game-ask-knowledge">{p.knowledgeContent}</div> : <>
        <div className="game-ask-display" ref={scroll}>
          {!hasAnswer && !hasSelection && <div className="game-ask-poster" aria-label="提问欢迎画面"><span aria-hidden="true">ASK.</span><h2>越过表面。<br/><em>问到深处。</em></h2><i aria-hidden="true"/></div>}
          {(hasSelection || p.contextSummary || p.contextFiles.length > 0) && <details key={`${p.selection?.sourcePath || ''}:${p.resetToken}`} className={`game-context ${hasSelection && !hasAnswer ? 'spotlight' : ''}`} open={hasSelection && !hasAnswer}>
            <summary><FileText size={15}/><span>{hasSelection ? '选中语段' : '提问上下文'}</span><strong>{p.selection?.sourcePath || p.contextSummary?.sourcePath || p.contextSummary?.label || '当前项目'}</strong><ChevronRight size={15}/></summary>
            {hasSelection && <div className="game-context-quote"><span aria-hidden="true">“</span><DeferredLiftTextarea value={p.selection!.selectedText} onLift={p.onSelectionTextChange} liftDelayMs={250} disabled={p.loading} aria-label="附带上下文文本"/><button disabled={p.loading} onClick={p.onClearSelection}><X size={13}/>清空语段</button></div>}
            {!hasSelection && p.contextSummary?.preview && <p className="game-context-preview">{p.contextSummary.preview}</p>}
            {p.contextFiles.length > 0 && <div className="game-context-files">{p.contextFiles.map(path => <span key={path}><FileText size={13}/><span title={path}>{path}</span><button disabled={p.loading} onClick={() => p.onRemoveContextFile(path)} aria-label={`移除 ${path.split('/').pop()}`}><X size={13}/></button></span>)}</div>}
          </details>}
          {hasAnswer && <div className="game-answer">{askPreview ? previewAnswer : p.answerContent}
            {activeRecord && !p.loading && <div className="game-answer-actions"><button onClick={copyAnswer}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? '已复制' : '复制回答'}</button><button onClick={() => p.onFollowUp(activeRecord)} disabled={p.selectedRecordReadOnly}><MessageCircle size={15}/>继续追问</button>{copyError && <span role="alert">复制失败，请选择正文手动复制。</span>}</div>}
          </div>}
          {!p.loading && !p.selectedRecordReadOnly && activeRecord?.teaching_handoff && <TeachingClosureCard handoff={activeRecord.teaching_handoff} onAction={p.onTeachingNextAction!}/>}
          <AssistantLearningChecks {...p}/>
        </div>
        <div className={`game-composer ${p.loading ? 'busy' : ''}`}>
          <div className="game-composer-caption"><span>{p.followUpRecord ? `追问 / ${titleOf(p.followUpRecord)}` : 'YOUR QUESTION'}</span>{p.followUpRecord && <button onClick={p.onNewConversation} disabled={p.loading}>取消追问<X size={13}/></button>}</div>
          <DeferredLiftTextarea value={p.questionInput ?? p.question} onLift={p.onQuestionChange} onDraftChange={setDraft} resetToken={p.resetToken} disabled={p.loading} placeholder="写下你的问题…" aria-label="输入问题" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); submit(); } }}/>
          <i className="game-composer-flash" aria-hidden="true"/>
        </div>
        <footer className="game-ask-footer"><div><button className="game-context-pick" disabled={p.loading} onClick={p.onOpenFilePicker}><FileText size={15}/>参考文件{p.contextFiles.length ? ` · ${p.contextFiles.length}` : ''}</button><button className="game-model" onClick={p.onOpenSettings} title="配置模型">{modelReady ? p.settings!.model : '配置模型'}<ChevronRight size={13}/></button></div><button className="game-ask-action game-send" onClick={submit} disabled={p.loading || !modelReady || !draft.trim()} aria-busy={p.loading}><span>{p.loading ? p.loadingLabel || '回答生成中' : p.followUpRecord ? '继续追问' : '询问'}</span><ArrowUpRight size={23}/></button></footer>
        {p.panelError && <div className="game-ask-error" role="alert">{p.panelError}</div>}
      </>}
    </div>
  </section>;
}
