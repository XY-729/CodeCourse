import { Children, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { HighlightRecord } from "../api/client";
import type { ViewerSelection } from "./CodeViewer";

type Props = {
  title: string | null;
  sourcePath?: string | null;
  content: string;
  highlights?: HighlightRecord[];
  onSelectionChange?: (selection: ViewerSelection) => void;
  onCreateHighlight?: (text: string) => void;
};

function applyHighlightToText(text: string, highlight: HighlightRecord, keyPrefix: string): ReactNode[] {
  if (!highlight.selected_text || !text.includes(highlight.selected_text)) {
    return [text];
  }
  const parts = text.split(highlight.selected_text);
  return parts.flatMap((part, index) => {
    if (index === parts.length - 1) {
      return [part];
    }
    return [
      part,
      <mark key={`${keyPrefix}-${highlight.id}-${index}`} className="reader-highlight" style={{ backgroundColor: highlight.color }}>
        {highlight.selected_text}
      </mark>,
    ];
  });
}

function applyHighlights(text: string, highlights: HighlightRecord[]): ReactNode[] {
  let parts: ReactNode[] = [text];
  for (const highlight of highlights) {
    parts = parts.flatMap((part, index) =>
      typeof part === "string" ? applyHighlightToText(part, highlight, `hl-${index}`) : [part],
    );
  }
  return parts;
}

function highlightChildren(children: ReactNode, highlights: HighlightRecord[]): ReactNode {
  return Children.map(children, (child, index) => {
    if (typeof child === "string") {
      return applyHighlights(child, highlights);
    }
    return child;
  });
}

export default function MarkdownViewer({
  title,
  sourcePath,
  content,
  highlights = [],
  onSelectionChange,
  onCreateHighlight,
}: Props) {
  const articleRef = useRef<HTMLElement | null>(null);
  const [selectedText, setSelectedText] = useState("");

  function captureSelection() {
    const article = articleRef.current;
    const selection = window.getSelection();
    if (!article || !selection || selection.isCollapsed) {
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      return;
    }
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (anchorNode && focusNode && article.contains(anchorNode) && article.contains(focusNode)) {
      setSelectedText(text);
      onSelectionChange?.({
        sourceType: "course",
        sourcePath: sourcePath ?? title,
        selectedText: text,
      });
    }
  }

  const highlightedComponents = {
    p: ({ children }: { children?: ReactNode }) => <p>{highlightChildren(children, highlights)}</p>,
    li: ({ children }: { children?: ReactNode }) => <li>{highlightChildren(children, highlights)}</li>,
    td: ({ children }: { children?: ReactNode }) => <td>{highlightChildren(children, highlights)}</td>,
    th: ({ children }: { children?: ReactNode }) => <th>{highlightChildren(children, highlights)}</th>,
    h1: ({ children }: { children?: ReactNode }) => <h1>{highlightChildren(children, highlights)}</h1>,
    h2: ({ children }: { children?: ReactNode }) => <h2>{highlightChildren(children, highlights)}</h2>,
    h3: ({ children }: { children?: ReactNode }) => <h3>{highlightChildren(children, highlights)}</h3>,
    h4: ({ children }: { children?: ReactNode }) => <h4>{highlightChildren(children, highlights)}</h4>,
    strong: ({ children }: { children?: ReactNode }) => <strong>{highlightChildren(children, highlights)}</strong>,
    em: ({ children }: { children?: ReactNode }) => <em>{highlightChildren(children, highlights)}</em>,
  };

  return (
    <div className="viewer markdown-viewer">
      <div className="viewer-header">
        <span>{title ?? "课件"}</span>
        <div className="viewer-actions">
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => onCreateHighlight?.(selectedText)}
            disabled={!selectedText.trim()}
          >
            标记
          </button>
          <strong>Markdown</strong>
        </div>
      </div>
      <article ref={articleRef} className="markdown-body" onMouseUp={captureSelection} onKeyUp={captureSelection}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={highlightedComponents}>
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}
