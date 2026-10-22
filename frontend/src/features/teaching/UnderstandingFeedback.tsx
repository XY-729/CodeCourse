import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { getTeachingDocument, saveUnderstanding, TEACHING_CHANGED, understandingLabels, teachingMetadataReady, isPlanOnly, type TeachingDocument } from "../../personalization/teachingApi";
import "../../styles/teaching.css";
import TeachingIndexControl from "./TeachingIndexControl";

type Props = { projectId: number; sourceType: "course" | "qa"; sourcePath: string; revision?: string; simple?: boolean };

export default function UnderstandingFeedback({ projectId, sourceType, sourcePath, revision, simple = false }: Props) {
  const [document, setDocument] = useState<TeachingDocument | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  // Failed requests can safely be retried with the same key.
  const retry = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    const load = () => {
      const token = ++generation.current;
      setError(""); setBusy(false); retry.current = null;
      void getTeachingDocument(projectId, sourceType, sourcePath).then((next) => {
      if (token !== generation.current) return;
      setDocument(next);
      setSelected(next.passages.filter((p) => p.core && ["brief", "explained"].includes(p.kind)).map((p) => p.id));
      }).catch((e: Error) => { if (token === generation.current) setError(e.message); });
    };
    setDocument(null); setSaved(false); load();
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: number; document?: TeachingDocument }>).detail;
      if (detail?.projectId != null && detail.projectId !== projectId) return;
      // Keep a successful local response and selected ranges intact.
      if (detail?.document?.sourceType === sourceType && detail.document.sourcePath === sourcePath) {
        setDocument(detail.document); return;
      }
      load();
    };
    window.addEventListener(TEACHING_CHANGED, changed);
    return () => { generation.current++; window.removeEventListener(TEACHING_CHANGED, changed); };
  }, [projectId, sourceType, sourcePath, revision]);

  async function send(result: "understood" | "partial" | "needs_help" | "clear") {
    if (!document || busy || (result !== "clear" && (!teachingMetadataReady(document) || (!isPlanOnly(document) && selected.length === 0)))) return;
    const token = generation.current;
    const signature = JSON.stringify([document.contentHash, result, selected]);
    if (retry.current?.signature !== signature) retry.current = { signature, key: crypto.randomUUID() };
    setBusy(true); setError(""); setSaved(false);
    try {
      const next = await saveUnderstanding(projectId, document, result, selected, retry.current.key);
      if (token !== generation.current) return;
      setDocument(next); retry.current = null; setSaved(true);
      window.dispatchEvent(new CustomEvent(TEACHING_CHANGED, { detail: { projectId, document: next } }));
    } catch (e) {
      if (token === generation.current) {
        const message = e instanceof Error ? e.message : "保存失败，请重试";
        // A conflict must never silently bind an old selection to a new body.
        try {
          const latest = await getTeachingDocument(projectId, sourceType, sourcePath);
          if (token !== generation.current) return;
          if (latest.contentHash !== document.contentHash) {
            setDocument(latest); setSelected([]); retry.current = null;
            setError("内容已更新，已刷新知识清单；请重新选择并确认讲解范围。");
            return;
          }
        } catch { /* Keep the original error and retry key if refreshing fails. */ }
        if (token === generation.current) setError(message);
      }
    } finally { if (token === generation.current) setBusy(false); }
  }
  const ready = Boolean(document && teachingMetadataReady(document));
  const planOnly = Boolean(document && isPlanOnly(document));
  const canConfirm = ready && (planOnly || selected.length > 0);
  const notReady = document && !ready ? <span role="status">知识清单未就绪，请先单独补全知识关联。</span> : null;
  const repair = document && !ready ? <TeachingIndexControl key={`${projectId}:${sourceType}:${sourcePath}`} projectId={projectId} source={{ sourceType, sourcePath }} /> : null;
  if (simple) {
    const confirmed = document?.feedback.some((f) => f.result === "understood") ?? false;
    return <span className="understanding-single-action">
      <button type="button" className={`secondary-button compact ${confirmed ? "completed" : ""}`}
        disabled={busy || (confirmed ? !document : !canConfirm)} aria-pressed={confirmed} aria-busy={busy}
        title={confirmed ? "点击撤销反馈" : planOnly ? "只记录已看过计划，不确认知识理解" : "确认已理解本次所选讲解范围"}
        onClick={() => void send(confirmed ? "clear" : "understood")}>
        {busy ? <><Loader2 size={14} className="spin" aria-hidden="true" />保存中…</> : planOnly ? confirmed ? "✓ 已看过计划" : "已看过计划" : confirmed ? "✓ 已理解" : "已理解"}
      </button>
      {error ? <span role="alert">{error}</span> : null}
      {notReady}{repair}
      {saved ? <span role="status">已保存</span> : null}
    </span>;
  }
  return <section className="understanding-feedback" aria-label={sourceType === "qa" ? "回答理解反馈" : "课程理解反馈"}>
    <div className="understanding-actions" aria-busy={busy}>
      <strong>{sourceType === "qa" ? "这次讲解" : "本课理解"}</strong>
      {busy ? <span role="status"><Loader2 size={14} className="spin" aria-hidden="true" />保存中…</span> : null}
      {document && !planOnly ? <span aria-live="polite">{understandingLabels[document.status]}</span> : null}
      <button type="button" disabled={!canConfirm || busy} onClick={() => void send("understood")}>{planOnly ? "已看过计划" : sourceType === "qa" ? "已理解" : "本课已理解"}</button>
      {!planOnly ? <><button type="button" disabled={!canConfirm || busy} onClick={() => void send("partial")}>部分理解</button>
      <button type="button" disabled={!canConfirm || busy} onClick={() => void send("needs_help")}>仍有疑问</button></> : null}
      {document?.feedback.length ? <button type="button" disabled={busy} onClick={() => void send("clear")}>撤销反馈</button> : null}
    </div>
    {document && !planOnly ? <details>
      <summary>本次关联 {selected.length} 个讲解范围 · 可调整</summary>
      {document.passages.filter((p) => ["brief", "explained"].includes(p.kind)).map((p) => <label key={p.id}>
        <input type="checkbox" disabled={busy} checked={selected.includes(p.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, p.id] : current.filter((id) => id !== p.id))} />
        {p.display_name} · {p.aspect}
      </label>)}
      <small>反馈作用于勾选范围。“已理解”是你的确认，不等同于已掌握。部分理解时可勾选尚有疑问的范围。</small>
    </details> : null}
    {planOnly ? <small>此处记录的是阅读计划，不会确认未来知识点已理解。</small> : null}
    {notReady}{repair}
    {saved ? <p role="status">已保存</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
