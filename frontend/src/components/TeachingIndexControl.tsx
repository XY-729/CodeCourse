import { useEffect, useRef, useState } from "react";
import { providerRequest } from "../platform/provider";
import { getCourseUnderstanding, TEACHING_CHANGED, type TeachingDocument } from "../personalization/teachingApi";

type Source = { sourceType: "course" | "qa"; sourcePath: string };
export default function TeachingIndexControl({ projectId, source }: { projectId: number; source?: Source }) {
  const [pending, setPending] = useState<Source[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const cancel = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; cancel.current = false;
    return () => { mounted.current = false; cancel.current = true; };
  }, [projectId]);
  async function preview() {
    setBusy(true); setMessage("");
    try {
      const sources = source ? [source] : (await getCourseUnderstanding(projectId)).filter((d) => d.indexStatus !== "complete");
      if (mounted.current) { setPending(sources); if (!sources.length) setMessage("当前文档的知识索引已完整"); }
    } catch (e) { if (mounted.current) setMessage(e instanceof Error ? e.message : "读取文档失败"); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function run() {
    if (!pending?.length || busy) return;
    cancel.current = false; setBusy(true);
    let done = 0;
    try {
      for (const item of pending) {
        if (cancel.current) break;
        if (mounted.current) setMessage(`正在补录 ${done + 1}/${pending.length}：${item.sourcePath}`);
        const result = await providerRequest<TeachingDocument>(`/projects/${projectId}/teaching/reindex`, { method: "POST", body: JSON.stringify(item) });
        done++;
        window.dispatchEvent(new CustomEvent(TEACHING_CHANGED, { detail: { projectId } }));
        if (result.indexStatus !== "complete") throw new Error("部分索引未通过校验，请检查当前文档后重试");
      }
      if (mounted.current) { setMessage(`已补录 ${done} 份文档${cancel.current ? "，其余已停止" : ""}`); setPending(null); }
    } catch (e) {
      if (mounted.current) { setMessage(`已完成 ${done} 份；${e instanceof Error ? e.message : "补录失败"}`); setPending(pending.slice(done)); }
    } finally { if (mounted.current) setBusy(false); }
  }
  return <div className="teaching-index-control">
    {!pending?.length ? <button type="button" className="secondary-button compact" disabled={busy} aria-busy={busy} onClick={() => void preview()}>{busy ? "检查中…" : "补全知识关联"}</button> : <>
      <p>将分析 {pending.length} 份文档，每份调用一次当前模型，可能消耗 token；只补充知识索引，保留正文。</p>
      <button type="button" disabled={busy} aria-busy={busy} onClick={() => void run()}>{busy ? "补全中…" : "确认补全"}</button>
      <button type="button" onClick={() => { cancel.current = true; if (!busy) setPending(null); }}>{busy ? "当前文档完成后停止" : "取消"}</button>
    </>}
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
