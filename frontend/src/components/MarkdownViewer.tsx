import { Children, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { HighlightRecord } from "../api/client";
import type { Annotation } from "../types";
import { ANNOTATION_COLORS } from "../types";
import type { ViewerSelection } from "./CodeViewer";

type Props = {
  title: string | null;
  sourcePath?: string | null;
  content: string;
  highlights?: HighlightRecord[];
  annotations?: Annotation[];
  tempSelectedText?: string | null;
  onSelectionChange?: (selection: ViewerSelection) => void;
  onCreateHighlight?: (text: string) => void;
  onContextMenu?: (event: React.MouseEvent, text: string, sourcePath: string) => void;
};

/* ---- Backend highlights (yellow <mark>) ---- */
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

/* ---- Local annotations (type-specific colors) ---- */
function applyAnnotationToText(text: string, annotation: Annotation, keyPrefix: string): ReactNode[] {
  if (!text.includes(annotation.selectedText)) {
    return [text];
  }
  const color = ANNOTATION_COLORS[annotation.type];
  const cls = `annotation-${annotation.type}`;
  const parts = text.split(annotation.selectedText);
  // TODO: use positional matching (offsets) to handle duplicate text precisely
  return parts.flatMap((part, index) => {
    if (index === parts.length - 1) {
      return [part];
    }
    return [
      part,
      <mark key={`${keyPrefix}-${annotation.id}-${index}`} className={`reader-highlight ${cls}`} style={{ backgroundColor: color }}>
        {annotation.selectedText}
      </mark>,
    ];
  });
}

function applyAnnotations(text: string, annotations: Annotation[]): ReactNode[] {
  let parts: ReactNode[] = [text];
  for (const annotation of annotations) {
    parts = parts.flatMap((part, index) =>
      typeof part === "string" ? applyAnnotationToText(part, annotation, `ann-${index}`) : [part],
    );
  }
  return parts;
}

/* ---- Temp selection preview ---- */
function applyTempSelection(text: string, tempText: string, keyPrefix: string): ReactNode[] {
  if (!tempText || !text.includes(tempText)) {
    return [text];
  }
  const parts = text.split(tempText);
  return parts.flatMap((part, index) => {
    if (index === parts.length - 1) {
      return [part];
    }
    return [
      part,
      <mark key={`${keyPrefix}-temp-${index}`} className="temp-selection">
        {tempText}
      </mark>,
    ];
  });
}

function applyTempToAll(text: string, tempText: string): ReactNode[] {
  let parts: ReactNode[] = [text];
  parts = parts.flatMap((part, index) =>
    typeof part === "string" ? applyTempSelection(part, tempText, `tmp-${index}`) : [part],
  );
  return parts;
}

/* ---- Combined rendering (highlights → annotations → temp, temp wins visually) ---- */
function highlightChildren(
  children: ReactNode,
  highlights: HighlightRecord[],
  annotations: Annotation[],
  tempText: string | null,
): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== "string") {
      return child;
    }
    let parts: ReactNode[] = [child];
    // Layer 1: backend highlights
    for (const hl of highlights) {
      parts = parts.flatMap((p, i) =>
        typeof p === "string" ? applyHighlightToText(p, hl, `hl-${i}`) : [p],
      );
    }
    // Layer 2: local annotations (overwrite highlights where they overlap)
    for (const ann of annotations) {
      parts = parts.flatMap((p, i) =>
        typeof p === "string" ? applyAnnotationToText(p, ann, `ann-${i}`) : [p],
      );
    }
    // Layer 3: temp selection preview (top layer)
    if (tempText) {
      parts = parts.flatMap((p, i) =>
        typeof p === "string" ? applyTempSelection(p, tempText, `tmp-${i}`) : [p],
      );
    }
    return parts;
  });
}

export default function MarkdownViewer({
  title,
  sourcePath,
  content,
  highlights = [],
  annotations = [],
  tempSelectedText,
  onSelectionChange,
  onCreateHighlight: _onCreateHighlight, // kept for backward compat, no longer rendered
  onContextMenu,
}: Props) {
  const articleRef = useRef<HTMLElement | null>(null);
  const [selectedText, setSelectedText] = useState("");

  function captureSelection() {
    const article = articleRef.current;
    const selection = window.getSelection();
    if (!article || !selection) {
      return;
    }
    if (selection.isCollapsed) {
      // User clicked elsewhere — clear temp selection
      setSelectedText("");
      onSelectionChange?.({
        sourceType: "course",
        sourcePath: sourcePath ?? title,
        selectedText: "",
      });
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

  function handleContextMenu(event: React.MouseEvent) {
    if (!selectedText.trim()) {
      return;
    }
    const article = articleRef.current;
    const selection = window.getSelection();
    if (!article || !selection || selection.isCollapsed) {
      return;
    }
    if (article.contains(event.target as Node)) {
      event.preventDefault();
      onContextMenu?.(event, selectedText, sourcePath ?? title ?? "");
    }
  }

  const highlightedComponents = {
    p: ({ children }: { children?: ReactNode }) => (
      <p>{highlightChildren(children, highlights, annotations, tempSelectedText ?? null)}</p>
    ),
    li: ({ children }: { children?: ReactNode }) => (
      <li>{highlightChildren(children, highlights, annotations, tempSelectedText ?? null)}</li>
    ),
    td: ({ children }: { children?: ReactNode }) => (
      <td>{highlightChildren(children, highlights, annotations, tempSelectedText ?? null)}</td>
    ),
    th: ({ children }: { children?: ReactNode }) => (
      <th>{highlightChildren(children, highlights, annotations, tempSelectedText ?? null)}</th>
    ),
    h1: ({ children }: { children?: ReactNode }) => (
      <h1>{highlightChildren(children, highlights, annotations, tempSelectedText ?? null)}</h1>
    ),
    h2: ({ children }: { children?: ReactNode }) => (
      <h2>{highlightChildren(children, highlights, annotations, tempSelectedText ?? null)}</h2>
    ),
    h3: ({ children }: { children?: ReactNode }) => (
      <h3>{highlightChildren(children, highlights, annotations, tempSelectedText ?? null)}</h3>
    ),
    h4: ({ children }: { children?: ReactNode }) => (
      <h4>{highlightChildren(children, highlights, annotations, tempSelectedText ?? null)}</h4>
    ),
    strong: ({ children }: { children?: ReactNode }) => (
      <strong>{highlightChildren(children, highlights, annotations, tempSelectedText ?? null)}</strong>
    ),
    em: ({ children }: { children?: ReactNode }) => (
      <em>{highlightChildren(children, highlights, annotations, tempSelectedText ?? null)}</em>
    ),
  };

  return (
    <div className="viewer markdown-viewer">
      <div className="viewer-header">
        <span>{title ?? "课件"}</span>
        <div className="viewer-actions">
          <strong>Markdown</strong>
        </div>
      </div>
      <article
        ref={articleRef}
        className="markdown-body"
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
        onContextMenu={handleContextMenu}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={highlightedComponents}>
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}
