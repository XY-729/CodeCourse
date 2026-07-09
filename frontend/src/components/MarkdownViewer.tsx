import { useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ViewerSelection } from "./CodeViewer";

type Props = {
  title: string | null;
  sourcePath?: string | null;
  content: string;
  onSelectionChange?: (selection: ViewerSelection) => void;
};

export default function MarkdownViewer({ title, sourcePath, content, onSelectionChange }: Props) {
  const articleRef = useRef<HTMLElement | null>(null);

  function captureSelection() {
    const article = articleRef.current;
    const selection = window.getSelection();
    if (!article || !selection || selection.isCollapsed) {
      return;
    }
    const selectedText = selection.toString().trim();
    if (!selectedText) {
      return;
    }
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (
      anchorNode &&
      focusNode &&
      article.contains(anchorNode) &&
      article.contains(focusNode)
    ) {
      onSelectionChange?.({
        sourceType: "course",
        sourcePath: sourcePath ?? title,
        selectedText,
      });
    }
  }

  return (
    <div className="viewer markdown-viewer">
      <div className="viewer-header">
        <span>{title ?? "课件"}</span>
        <strong>Markdown</strong>
      </div>
      <article
        ref={articleRef}
        className="markdown-body"
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </article>
    </div>
  );
}
