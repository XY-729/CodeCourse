import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  title: string | null;
  content: string;
};

export default function MarkdownViewer({ title, content }: Props) {
  return (
    <div className="viewer markdown-viewer">
      <div className="viewer-header">
        <span>{title ?? "课件"}</span>
        <strong>Markdown</strong>
      </div>
      <article className="markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </article>
    </div>
  );
}
