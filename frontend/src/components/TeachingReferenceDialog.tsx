import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getTeachingReference, OPEN_TEACHING, type TeachingReference } from "../personalization/teachingApi";
import { useModalFocus } from "../hooks/useModalFocus";
import MarkdownViewer from "./MarkdownViewer";

export default function TeachingReferenceDialog({ projectId }: { projectId: number | null }) {
  const [target, setTarget] = useState<{ reference: TeachingReference; content: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLElement | null>(null);
  const sequence = useRef(0);
  useModalFocus(dialog, open);
  useEffect(() => {
    const show = (event: Event) => {
      const identity = (event as CustomEvent<string>).detail;
      if (!projectId || typeof identity !== "string") return;
      const token = ++sequence.current;
      setOpen(true); setTarget(null); setError("");
      void (async () => {
        const reference = await getTeachingReference(projectId, identity);
        const content = reference.content;
        if (token === sequence.current) setTarget({ reference, content });
      })().catch((e: Error) => { if (token === sequence.current) setError(e.message); });
    };
    window.addEventListener(OPEN_TEACHING, show);
    return () => { window.removeEventListener(OPEN_TEACHING, show); sequence.current++; };
  }, [projectId]);
  function close() { sequence.current++; setOpen(false); }
  if (!open) return null;
  return createPortal(<div className="modal-backdrop teaching-reference-backdrop" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <section ref={dialog} className="teaching-reference-dialog" role="dialog" aria-modal="true" aria-label="此前知识讲解" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
      <header><strong>{target?.reference.title ?? "此前知识讲解"}</strong><button type="button" onClick={close}>关闭</button></header>
      {target ? <><small>{target.reference.sourcePath} · 第 {target.reference.line} 行</small>
        <MarkdownViewer title={target.reference.title} sourcePath={target.reference.sourcePath} content={target.content} embedded jumpLine={target.reference.line} />
      </> : <p role={error ? "alert" : "status"}>{error || "正在定位原文…"}</p>}
    </section>
  </div>, document.body);
}
