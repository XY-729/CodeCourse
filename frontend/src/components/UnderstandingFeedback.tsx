import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { getTeachingDocument, saveUnderstanding, TEACHING_CHANGED, understandingLabels, type TeachingDocument } from "../personalization/teachingApi";
import "../styles/teaching.css";
import TeachingIndexControl from "./TeachingIndexControl";

type Props = { projectId: number; sourceType: "course" | "qa"; sourcePath: string; revision?: string; simple?: boolean };

export default function UnderstandingFeedback({ projectId, sourceType, sourcePath, revision, simple = false }: Props) {
  const [document, setDocument] = useState<TeachingDocument | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
    setDocument(null); load();
    window.addEventListener(TEACHING_CHANGED, load);
    return () => { generation.current++; window.removeEventListener(TEACHING_CHANGED, load); };
  }, [projectId, sourceType, sourcePath, revision]);

  async function send(result: "understood" | "partial" | "needs_help" | "clear") {
    if (!document || busy) return;
    const token = generation.current;
    const signature = JSON.stringify([document.contentHash, result, selected]);
    if (retry.current?.signature !== signature) retry.current = { signature, key: crypto.randomUUID() };
    setBusy(true); setError("");
    try {
      const next = await saveUnderstanding(projectId, document, result, selected, retry.current.key);
      if (token !== generation.current) return;
      setDocument(next); retry.current = null;
      window.dispatchEvent(new CustomEvent(TEACHING_CHANGED, { detail: { projectId, document: next } }));
    } catch (e) {
      if (token === generation.current) setError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally { if (token === generation.current) setBusy(false); }
  }
  if (simple) {
    const confirmed = document?.feedback.some((f) => f.result === "understood") ?? false;
    return <span className="understanding-single-action">
      <button type="button" className={`secondary-button compact ${confirmed ? "completed" : ""}`}
        disabled={!document || busy} aria-pressed={confirmed} aria-busy={busy}
        title={confirmed ? "已理解，点击撤销" : "确认已理解这次回答"}
        onClick={() => void send(confirmed ? "clear" : "understood")}>
        {busy ? <><Loader2 size={14} className="spin" aria-hidden="true" />保存中…</> : confirmed ? "✓ 已理解" : "已理解"}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </span>;
  }
  return <section className="understanding-feedback" aria-label={sourceType === "qa" ? "回答理解反馈" : "课程理解反馈"}>
    <div className="understanding-actions" aria-busy={busy}>
      <strong>{sourceType === "qa" ? "这次讲解" : "本课理解"}</strong>
      {busy ? <span role="status"><Loader2 size={14} className="spin" aria-hidden="true" />保存中…</span> : null}
      {document ? <span aria-live="polite">{understandingLabels[document.status]}</span> : null}
      <button type="button" disabled={!document || busy} onClick={() => void send("understood")}>{sourceType === "qa" ? "已理解" : "本课已理解"}</button>
      <button type="button" disabled={!document || busy} onClick={() => void send("partial")}>部分理解</button>
      <button type="button" disabled={!document || busy} onClick={() => void send("needs_help")}>仍有疑问</button>
      {document?.feedback.length ? <button type="button" disabled={busy} onClick={() => void send("clear")}>撤销反馈</button> : null}
    </div>
    {document ? <details>
      <summary>本次关联 {selected.length} 个讲解范围 · 可调整</summary>
      {document.passages.filter((p) => ["brief", "explained"].includes(p.kind)).map((p) => <label key={p.id}>
        <input type="checkbox" disabled={busy} checked={selected.includes(p.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, p.id] : current.filter((id) => id !== p.id))} />
        {p.display_name} · {p.aspect}
      </label>)}
      <small>反馈作用于勾选范围。“已理解”是你的确认，不等同于已掌握。部分理解时可勾选尚有疑问的范围。</small>
      {document.indexStatus !== "complete" ? <small>这份文档的知识索引尚不完整；未关联的反馈只保存在当前文档，不推断整课掌握。</small> : null}
    </details> : null}
    {document?.feedback.some((f) => !f.passage_id) ? <small role="status">已保存本篇反馈；尚未关联知识点，不改变课程掌握状态。</small> : null}
    {document && document.indexStatus !== "complete" ? <TeachingIndexControl key={`${projectId}:${sourceType}:${sourcePath}`} projectId={projectId} source={{ sourceType, sourcePath }} /> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
