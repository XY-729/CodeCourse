import { Children, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { HighlightRecord, KnowledgeLink } from "../api/client";
import type { Annotation } from "../types";
import { COLOR_VALUES } from "../types";
import type { ViewerSelection } from "./CodeViewer";

type Props = {
  title: string | null;
  sourcePath?: string | null;
  content: string;
  highlights?: HighlightRecord[];
  knowledgeLinks?: KnowledgeLink[];
  annotations?: Annotation[];
  tempSelectedText?: string | null;
  onSelectionChange?: (selection: ViewerSelection) => void;
  onCreateHighlight?: (text: string) => void;
  onContextMenu?: (event: React.MouseEvent, text: string, sourcePath: string) => void;
  onOpenKnowledgeLink?: (term: string, links: KnowledgeLink[]) => void;
  headerActions?: ReactNode;
};

/* ---- Backend highlights ---- */
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

/* ---- Local annotations with composable styles ---- */
function buildAnnotationClasses(annotation: Annotation): string {
  const classes: string[] = ["reader-highlight"];
  const { style } = annotation;
  if (style.color) {
    classes.push(`annotation-color-${style.color}`);
  }
  if (style.bold) {
    classes.push("annotation-bold");
  }
  if (style.underline) {
    classes.push("annotation-underline");
  }
  return classes.join(" ");
}

function buildAnnotationInlineStyle(annotation: Annotation): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (annotation.style.color) {
    s.backgroundColor = COLOR_VALUES[annotation.style.color];
  }
  return s;
}

function applyAnnotationToText(text: string, annotation: Annotation, keyPrefix: string): ReactNode[] {
  // Skip annotations with no visible style
  if (!annotation.style.color && !annotation.style.bold && !annotation.style.underline) {
    return [text];
  }
  if (!text.includes(annotation.selectedText)) {
    return [text];
  }
  const cls = buildAnnotationClasses(annotation);
  const inlineStyle = buildAnnotationInlineStyle(annotation);
  const parts = text.split(annotation.selectedText);
  // TODO: use positional matching (offsets) to handle duplicate text precisely
  return parts.flatMap((part, index) => {
    if (index === parts.length - 1) {
      return [part];
    }
    return [
      part,
      <mark key={`${keyPrefix}-${annotation.id}-${index}`} className={cls} style={inlineStyle}>
        {annotation.selectedText}
      </mark>,
    ];
  });
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

function groupKnowledgeLinks(links: KnowledgeLink[]): Map<string, KnowledgeLink[]> {
  const grouped = new Map<string, KnowledgeLink[]>();
  for (const link of links) {
    const term = link.term_text.trim();
    if (!term) {
      continue;
    }
    grouped.set(term, [...(grouped.get(term) ?? []), link]);
  }
  return grouped;
}

function applyKnowledgeLinksToText(
  text: string,
  groupedLinks: Map<string, KnowledgeLink[]>,
  onOpenKnowledgeLink: ((term: string, links: KnowledgeLink[]) => void) | undefined,
  keyPrefix: string,
): ReactNode[] {
  if (!onOpenKnowledgeLink || groupedLinks.size === 0) {
    return [text];
  }
  const terms = [...groupedLinks.keys()].sort((a, b) => b.length - a.length);
  const result: ReactNode[] = [];
  let index = 0;
  while (index < text.length) {
    const term = terms.find((candidate) => text.startsWith(candidate, index));
    if (!term) {
      result.push(text[index]);
      index += 1;
      continue;
    }
    const links = groupedLinks.get(term) ?? [];
    result.push(
      <button
        key={`${keyPrefix}-knowledge-${index}`}
        className="knowledge-inline-link"
        type="button"
        title={`打开 ${term} 的回答`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenKnowledgeLink(term, links);
        }}
      >
        {term}
      </button>,
    );
    index += term.length;
  }
  return result;
}

/* ---- Combined rendering (highlights -> annotations -> temp -> knowledge links) ---- */
function highlightChildren(
  children: ReactNode,
  highlights: HighlightRecord[],
  knowledgeLinks: KnowledgeLink[],
  annotations: Annotation[],
  tempText: string | null,
  onOpenKnowledgeLink?: (term: string, links: KnowledgeLink[]) => void,
): ReactNode {
  const groupedLinks = groupKnowledgeLinks(knowledgeLinks);
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
    parts = parts.flatMap((p, i) =>
      typeof p === "string" ? applyKnowledgeLinksToText(p, groupedLinks, onOpenKnowledgeLink, `kl-${i}`) : [p],
    );
    return parts;
  });
}

export default function MarkdownViewer({
  title,
  sourcePath,
  content,
  highlights = [],
  knowledgeLinks = [],
  annotations = [],
  tempSelectedText,
  onSelectionChange,
  onCreateHighlight: _onCreateHighlight,
  onContextMenu,
  onOpenKnowledgeLink,
  headerActions,
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
    const article = articleRef.current;
    if (!article || !article.contains(event.target as Node)) {
      return;
    }

    const liveText = window.getSelection()?.toString().trim();
    const text = liveText || selectedText.trim();

    if (!text) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (liveText) {
      setSelectedText(liveText);
      onSelectionChange?.({
        sourceType: "course",
        sourcePath: sourcePath ?? title,
        selectedText: liveText,
      });
    }

    onContextMenu?.(event, text, sourcePath ?? title ?? "");
  }

  const highlightedComponents = {
    p: ({ children }: { children?: ReactNode }) => (
      <p>{highlightChildren(children, highlights, knowledgeLinks, annotations, tempSelectedText ?? null, onOpenKnowledgeLink)}</p>
    ),
    li: ({ children }: { children?: ReactNode }) => (
      <li>{highlightChildren(children, highlights, knowledgeLinks, annotations, tempSelectedText ?? null, onOpenKnowledgeLink)}</li>
    ),
    td: ({ children }: { children?: ReactNode }) => (
      <td>{highlightChildren(children, highlights, knowledgeLinks, annotations, tempSelectedText ?? null, onOpenKnowledgeLink)}</td>
    ),
    th: ({ children }: { children?: ReactNode }) => (
      <th>{highlightChildren(children, highlights, knowledgeLinks, annotations, tempSelectedText ?? null, onOpenKnowledgeLink)}</th>
    ),
    h1: ({ children }: { children?: ReactNode }) => (
      <h1>{highlightChildren(children, highlights, knowledgeLinks, annotations, tempSelectedText ?? null, onOpenKnowledgeLink)}</h1>
    ),
    h2: ({ children }: { children?: ReactNode }) => (
      <h2>{highlightChildren(children, highlights, knowledgeLinks, annotations, tempSelectedText ?? null, onOpenKnowledgeLink)}</h2>
    ),
    h3: ({ children }: { children?: ReactNode }) => (
      <h3>{highlightChildren(children, highlights, knowledgeLinks, annotations, tempSelectedText ?? null, onOpenKnowledgeLink)}</h3>
    ),
    h4: ({ children }: { children?: ReactNode }) => (
      <h4>{highlightChildren(children, highlights, knowledgeLinks, annotations, tempSelectedText ?? null, onOpenKnowledgeLink)}</h4>
    ),
    strong: ({ children }: { children?: ReactNode }) => (
      <strong>{highlightChildren(children, highlights, knowledgeLinks, annotations, tempSelectedText ?? null, onOpenKnowledgeLink)}</strong>
    ),
    em: ({ children }: { children?: ReactNode }) => (
      <em>{highlightChildren(children, highlights, knowledgeLinks, annotations, tempSelectedText ?? null, onOpenKnowledgeLink)}</em>
    ),
  };

  return (
    <div className="viewer markdown-viewer">
      <div className="viewer-header">
        <span>{title ?? "课件"}</span>
        <div className="viewer-actions">
          {headerActions}
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
