import { useEffect, useState } from "react";
import CodeViewer from "./CodeViewer";
import MarkdownViewer from "./MarkdownViewer";
import TitleBar from "./TitleBar";

type DetachedPayload = {
  type: "file" | "course" | "qa";
  path: string;
  title: string;
  content: string;
  language?: string;
};

export default function DetachedDocumentWindow() {
  const [payload, setPayload] = useState<DetachedPayload | null>(null);

  useEffect(() => {
    void window.codecourseDesktop?.getDetachedPayload?.().then(setPayload);
  }, []);

  return (
    <div className="app-shell detached-document-shell">
      <TitleBar />
      <header className="detached-document-header">
        <strong>{payload?.title || "正在打开文档"}</strong>
        {payload?.path ? <span>{payload.path}</span> : null}
      </header>
      <main className="detached-document-body">
        {!payload ? <div className="viewer-loading">正在恢复文档…</div> : payload.type === "file" ? (
          <CodeViewer path={payload.path} language={payload.language || "plaintext"} content={payload.content} />
        ) : (
          <MarkdownViewer
            title={payload.title}
            sourcePath={payload.path}
            sourceType={payload.type === "qa" ? "qa" : "course"}
            content={payload.content}
          />
        )}
      </main>
    </div>
  );
}
