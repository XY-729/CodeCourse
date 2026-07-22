import { Children, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js";
import type { DocumentTerm, HighlightRecord, KnowledgeLink } from "../api/client";
import { isAndroidRuntime } from "../platform/runtime";
import type { Annotation } from "../types";
import { COLOR_VALUES } from "../types";
import type { ViewerSelection } from "./CodeViewer";

type Props = {
  title: string | null;
  sourcePath?: string | null;
  sourceType?: "course" | "qa";
  content: string;
  highlights?: HighlightRecord[];
  knowledgeLinks?: KnowledgeLink[];
  documentTerms?: DocumentTerm[];
  annotations?: Annotation[];
  tempSelectedText?: string | null;
  onSelectionChange?: (selection: ViewerSelection) => void;
  onCreateHighlight?: (text: string) => void;
  onContextMenu?: (event: React.MouseEvent, text: string, sourcePath: string) => void;
  onOpenKnowledgeLink?: (term: string, links: KnowledgeLink[]) => void;
  onGenerateTerm?: (term: DocumentTerm) => void;
  onTermAction?: (term: DocumentTerm) => void;
  onGenerateLesson?: (lessonNumber: number, title: string) => void;
  headerActions?: ReactNode;
  embedded?: boolean;
  initialScrollRatio?: number;
  onScrollRatioChange?: (ratio: number) => void;
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

function applyTermCandidatesToText(
  text: string,
  terms: DocumentTerm[],
  onGenerateTerm: ((term: DocumentTerm) => void) | undefined,
  onTermAction: ((term: DocumentTerm) => void) | undefined,
  keyPrefix: string,
): ReactNode[] {
  if (!onGenerateTerm || terms.length === 0) {
    return [text];
  }
  const candidates = terms
    .filter((term) => term.status === "candidate" || term.status === "linked")
    .sort((a, b) => b.term_text.length - a.term_text.length);
  if (!candidates.length) {
    return [text];
  }
  const result: ReactNode[] = [];
  let index = 0;
  while (index < text.length) {
    const term = candidates.find((candidate) => text.startsWith(candidate.term_text, index));
    if (!term) {
      result.push(text[index]);
      index += 1;
      continue;
    }
    result.push(
      <button
        key={`${keyPrefix}-term-${term.id}-${index}`}
        className={term.status === "linked" ? "knowledge-inline-link" : "term-candidate-link"}
        type="button"
        title={term.status === "linked" ? `打开“${term.term_text}”的解释` : `生成“${term.term_text}”的解释；右键可标记为已认识或忽略`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onGenerateTerm(term);
        }}
        onContextMenu={isAndroidRuntime() ? undefined : (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (term.status === "candidate") {
            onTermAction?.(term);
          }
        }}
      >
        {term.term_text}
      </button>,
    );
    index += term.term_text.length;
  }
  return result;
}

/* ---- Combined rendering (highlights -> annotations -> temp -> knowledge links) ---- */
function highlightChildren(
  children: ReactNode,
  highlights: HighlightRecord[],
  knowledgeLinks: KnowledgeLink[],
  documentTerms: DocumentTerm[],
  annotations: Annotation[],
  tempText: string | null,
  onOpenKnowledgeLink?: (term: string, links: KnowledgeLink[]) => void,
  onGenerateTerm?: (term: DocumentTerm) => void,
  onTermAction?: (term: DocumentTerm) => void,
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
    parts = parts.flatMap((p, i) =>
      typeof p === "string" ? applyTermCandidatesToText(p, documentTerms, onGenerateTerm, onTermAction, `term-${i}`) : [p],
    );
    return parts;
  });
}

export default function MarkdownViewer({
  title,
  sourcePath,
  sourceType = "course",
  content,
  highlights = [],
  knowledgeLinks = [],
  documentTerms = [],
  annotations = [],
  tempSelectedText,
  onSelectionChange,
  onCreateHighlight: _onCreateHighlight,
  onContextMenu,
  onOpenKnowledgeLink,
  onGenerateTerm,
  onTermAction,
  onGenerateLesson,
  headerActions,
  embedded = false,
  initialScrollRatio = 0,
  onScrollRatioChange,
}: Props) {
  const articleRef = useRef<HTMLElement | null>(null);
  const androidRuntime = isAndroidRuntime();
  const [selectedText, setSelectedText] = useState("");
  const [docFontSize, setDocFontSize] = useState(() => {
    try {
      const v = localStorage.getItem("codecourse.desktop.docFontSize");
      if (v != null) return Math.max(8, Math.min(36, Number(v) || 16));
    } catch { /* noop */ }
    return 16;
  });
  const docFontSizeRef = useRef(docFontSize);
  docFontSizeRef.current = docFontSize;

  // Apply persisted doc font size on mount
  useEffect(() => {
    document.documentElement.style.setProperty("--reader-font-size", `${docFontSize}px`);
  }, [docFontSize]);

  // Ctrl+wheel zoom for Markdown viewer
  const handleWheel = useCallback((event: WheelEvent) => {
    if (!event.ctrlKey) return;
    // Only intercept if the target is inside the markdown article
    const article = articleRef.current;
    if (!article || !article.contains(event.target as Node)) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -1 : 1;
    const next = Math.max(8, Math.min(36, docFontSizeRef.current + delta));
    docFontSizeRef.current = next;
    setDocFontSize(next);
    document.documentElement.style.setProperty("--reader-font-size", `${next}px`);
    try { localStorage.setItem("codecourse.desktop.docFontSize", String(next)); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    article.addEventListener("wheel", handleWheel, { passive: false });
    return () => article.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const frame = window.requestAnimationFrame(() => {
      const maxScroll = Math.max(0, article.scrollHeight - article.clientHeight);
      article.scrollTop = maxScroll * Math.min(1, Math.max(0, initialScrollRatio));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sourcePath]);

  function reportScroll() {
    const article = articleRef.current;
    if (!article || !onScrollRatioChange) return;
    const maxScroll = Math.max(0, article.scrollHeight - article.clientHeight);
    onScrollRatioChange(maxScroll > 0 ? article.scrollTop / maxScroll : 0);
  }

  const captureSelection = useCallback(() => {
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
      const rect = selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null;
      setSelectedText(text);
      onSelectionChange?.({
        sourceType,
        sourcePath: sourcePath ?? title,
        selectedText: text,
        anchorRect: rect && rect.width + rect.height > 0 ? {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        } : undefined,
      });
    }
  }, [onSelectionChange, sourcePath, sourceType, title]);

  // On Android, use selectionchange (not mouseup) so dragging the handles
  // re-fires as the range changes. rAF debounce avoids DOM thrashing mid-gesture.
  useEffect(() => {
    if (!androidRuntime) return;
    let frameId = 0;
    const handleSelectionChange = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => captureSelection());
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [androidRuntime, captureSelection]);

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
        sourceType,
        sourcePath: sourcePath ?? title,
        selectedText: liveText,
      });
    }

    onContextMenu?.(event, text, sourcePath ?? title ?? "");
  }

  const highlightedComponents = useMemo(() => ({
    code: ({ className, children, ...props }: { className?: string; children?: ReactNode; node?: unknown }) => {
      const codeText = String(children ?? "").replace(/\n$/, "");
      const lang = className?.replace(/^language-/, "") ?? "";
      // Only highlight fenced code blocks (those with a language- class from markdown)
      if (className?.startsWith("language-") && lang) {
        try {
          const validLang = hljs.getLanguage(lang) ? lang : undefined;
          const result = validLang
            ? hljs.highlight(codeText, { language: validLang, ignoreIllegals: true })
            : hljs.highlightAuto(codeText);
          return <code className={`hljs ${className}`} dangerouslySetInnerHTML={{ __html: result.value }} />;
        } catch {
          return <code className={className}>{children}</code>;
        }
      }
      // Inline code — no className, render plainly
      return <code>{children}</code>;
    },
    pre: ({ children }: { children?: ReactNode }) => <pre>{children}</pre>,
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      const match = href?.match(/^https:\/\/codecourse\.local\/generate-lesson\/(\d+)\?title=(.*)$/);
      if (match && onGenerateLesson) {
        return (
          <button
            type="button"
            className="lesson-generate-link"
            onClick={() => onGenerateLesson(Number(match[1]), decodeURIComponent(match[2] || "课件"))}
          >
            {children}
          </button>
        );
      }
      return <a href={href}>{children}</a>;
    },
    p: ({ children }: { children?: ReactNode }) => (
      <p>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, tempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</p>
    ),
    li: ({ children }: { children?: ReactNode }) => (
      <li>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, tempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</li>
    ),
    td: ({ children }: { children?: ReactNode }) => (
      <td>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, tempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</td>
    ),
    th: ({ children }: { children?: ReactNode }) => (
      <th>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, tempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</th>
    ),
    h1: ({ children }: { children?: ReactNode }) => (
      <h1>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, tempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</h1>
    ),
    h2: ({ children }: { children?: ReactNode }) => (
      <h2>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, tempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</h2>
    ),
    h3: ({ children }: { children?: ReactNode }) => (
      <h3>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, tempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</h3>
    ),
    h4: ({ children }: { children?: ReactNode }) => (
      <h4>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, tempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</h4>
    ),
    strong: ({ children }: { children?: ReactNode }) => (
      <strong>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, tempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</strong>
    ),
    em: ({ children }: { children?: ReactNode }) => (
      <em>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, tempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</em>
    ),
  }), [highlights, knowledgeLinks, documentTerms, annotations, tempSelectedText, onOpenKnowledgeLink, onGenerateTerm, onTermAction, onGenerateLesson]);

  return (
    <div className={`viewer markdown-viewer ${embedded ? "embedded" : ""}`}>
      {!embedded ? <div className="viewer-header">
        <span>{title ?? "课件"}</span>
        <div className="viewer-actions">
          {headerActions}
          <strong>Markdown</strong>
        </div>
      </div> : null}
      <article
        ref={articleRef}
        className="markdown-scroll-viewport"
        onMouseUp={androidRuntime ? undefined : captureSelection}
        onKeyUp={captureSelection}
        onContextMenu={androidRuntime ? undefined : handleContextMenu}
        onScroll={reportScroll}
      >
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={highlightedComponents}>
            {content}
          </ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
