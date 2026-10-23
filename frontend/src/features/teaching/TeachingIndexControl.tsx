import { useEffect, useRef, useState } from "react";
import { getCourseUnderstanding, TEACHING_CHANGED } from "../../personalization/teachingApi";
import { applyBackfill, listBackfills, prepareBackfill, undoKnowledgeChange, type BackfillPreview } from "../../personalization/knowledgeMaintenance";

type Source = { sourceType: "course" | "qa"; sourcePath: string };
export default function TeachingIndexControl({ projectId, source }: { projectId: number; source?: Source }) {
  const [pending, setPending] = useState<Source[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [previews, setPreviews] = useState<BackfillPreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const cancel = useRef(false), mounted = useRef(true);
  const scope = `${projectId}:${source?.sourceType ?? ''}:${source?.sourcePath ?? ''}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const active = () => mounted.current && currentScope.current === scope;
  const key = (s: Source) => `${s.sourceType}:${s.sourcePath}`;
  useEffect(() => {
    mounted.current = true; cancel.current = false; setBusy(false); setPending(null); setPreviews([]); setSelected([]); setMessage('');
    return () => { mounted.current = false; cancel.current = true; };
  }, [scope]);
  const changed = () => window.dispatchEvent(new CustomEvent(TEACHING_CHANGED, { detail: { projectId } }));
  async function inspect() {
    setBusy(true); setMessage("");
    try {
      const documents = source ? [source] : (await getCourseUnderstanding(projectId))
        .filter(d => d.indexStatus !== "complete" || d.schemaVersion !== 2)
        .sort((a, b) => Number(Boolean(b.documentConfirmed || b.courseCompleted)) - Number(Boolean(a.documentConfirmed || a.courseCompleted)));
      const saved = await listBackfills(projectId);
      if (active()) { setPending(documents); setSelected(documents.map(key)); setPreviews(saved.filter(p => !source || key(p) === key(source))); if (!documents.length) setMessage("当前文档的知识索引已完整"); }
    } catch (e) { if (active()) setMessage(e instanceof Error ? e.message : "读取文档失败"); }
    finally { if (active()) setBusy(false); }
  }
  async function prepare() {
    if (!pending?.length || busy) return;
    cancel.current = false; setBusy(true); setMessage('');
    let done = 0;
    try {
      const sources = pending.filter(s => selected.includes(key(s)));
      for (const item of sources) {
        if (cancel.current || !active()) break;
        if (active()) setMessage(`正在生成预览 ${done + 1}/${sources.length}：${item.sourcePath}`);
        const result = await prepareBackfill(projectId, item); done++;
        if (active()) setPreviews(old => [result, ...old.filter(p => key(p) !== key(result) || p.status !== 'preview')]);
      }
      if (active()) setMessage(`已生成 ${done} 份清单预览${cancel.current ? '，其余已停止' : ''}。尚未写入知识树，请核对后应用。`);
    } catch (e) { if (active()) setMessage(`已生成 ${done} 份预览；${e instanceof Error ? e.message : '预览失败'}`); }
    finally { if (active()) setBusy(false); }
  }
  async function apply() {
    if (busy) return;
    cancel.current = false; setBusy(true); let done = 0;
    try {
      const ready = previews.filter(p => p.status === 'preview');
      for (const item of ready) {
        if (cancel.current || !active()) break;
        if (active()) setMessage(`正在应用 ${done + 1}/${ready.length}：${item.sourcePath}`);
        const result = await applyBackfill(projectId, item.id); done++; changed();
        if (active()) setPreviews(old => old.map(p => p.id === item.id ? result : p));
      }
      if (active()) setMessage(`已应用 ${done} 份补录，正文和原反馈已保留${cancel.current ? '，其余已停止' : ''}。`);
    } catch (e) { if (active()) setMessage(`已应用 ${done} 份；${e instanceof Error ? e.message : '应用失败'}`); }
    finally { if (active()) setBusy(false); }
  }
  async function undo(item: BackfillPreview) {
    if (!item.changeId || busy) return;
    setBusy(true);
    try {
      await undoKnowledgeChange(projectId, item.changeId); changed();
      if (active()) { setPreviews(old => old.map(p => p.id === item.id ? { ...p, status: 'undone' } : p)); setMessage('已撤销本次补录，原文和原有学习记录保留。'); }
    } catch (e) { if (active()) setMessage(e instanceof Error ? e.message : '撤销失败'); }
    finally { if (active()) setBusy(false); }
  }
  return <div className="teaching-index-control">
    <button type="button" className="secondary-button compact" disabled={busy} aria-busy={busy} onClick={() => void inspect()}>检查历史知识关联</button>
    {pending?.length ? <details open><summary>待补录文档（已完成或已确认的优先）</summary>
      {pending.map(item => <label key={key(item)} style={{ display: 'block' }}><input type="checkbox" disabled={busy} checked={selected.includes(key(item))}
        onChange={e => setSelected(old => e.target.checked ? [...old, key(item)] : old.filter(k => k !== key(item)))} />{item.sourcePath}</label>)}
      <p>生成预览会使用当前模型，长文可能分段分析。预览不改正文、知识树或熟悉度；确认应用后只补清单与来源。</p>
      <button type="button" disabled={busy || !selected.length} onClick={() => void prepare()}>生成所选文档的清单预览</button>
    </details> : null}
    {previews.length ? <div>
      {previews.some(p => p.status === 'preview') ? <button type="button" disabled={busy} onClick={() => void apply()}>确认应用预览清单</button> : null}
      {previews.map(item => <details key={item.id}>
        <summary>{item.sourcePath} · {item.concepts.length} 个概念 / {item.coverage.length} 个范围 · {item.status === 'applied' ? '已应用' : item.status === 'undone' ? '已撤销' : '待确认'}</summary>
        {item.concepts.map(c => <p key={c.ref}>{c.name}{c.existing_id ? '（复用）' : '（新增）'} · 父分类：{c.parent_ref ? item.concepts.find(parent => parent.ref === c.parent_ref)?.name ?? c.parent_ref : '根分类'}</p>)}
        {item.coverage.map((c, i) => <p key={i}>{item.concepts.find(n => n.ref === c.concept_ref)?.name} · {c.aspect}：{c.quote}</p>)}
        {item.status === 'applied' ? <button type="button" disabled={busy} onClick={() => void undo(item)}>撤销这次补录</button> : null}
      </details>)}
    </div> : null}
    {busy ? <button type="button" onClick={() => { cancel.current = true; }}>当前文档完成后停止</button> : null}
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
