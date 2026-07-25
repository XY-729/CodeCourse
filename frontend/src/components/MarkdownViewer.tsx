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
  onScrollRatioChange?: (ratio: number) => void;
  initialScrollRatio?: number;
};

export function calculateReadingProgress(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  if (scrollHeight <= 0 || clientHeight <= 0 || scrollHeight <= clientHeight) return 1;
  const safeTop = Math.max(0, Math.min(scrollTop, scrollHeight - clientHeight));
  return safeTop / (scrollHeight - clientHeight);
}

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
  if (!annotation.style.color && !annotation.style.bold && !annotation.style.underline) {
    return [text];
  }
  if (!text.includes(annotation.selectedText)) {
    return [text];
  }
  const cls = buildAnnotationClasses(annotation);
  const inlineStyle = buildAnnotationInlineStyle(annotation);
  const parts = text.split(annotation.selectedText);
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
    if (isAndroidRuntime()) {
      result.push(
        <span
          key={`${keyPrefix}-knowledge-${index}`}
          className="knowledge-inline-link document-term"
          data-knowledge-term={term}
          onClick={() => {
            if (window.getSelection() && !window.getSelection()?.isCollapsed) return;
            onOpenKnowledgeLink(term, links);
          }}
        >
          {term}
        </span>,
      );
    } else {
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
    }
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
    if (isAndroidRuntime()) {
      result.push(
        <span
          key={`${keyPrefix}-term-${term.id}-${index}`}
          className={`document-term document-term-${term.status} ${term.status === "linked" ? "knowledge-inline-link" : "term-candidate-link"}`}
          data-term-id={term.id}
          onClick={() => {
            if (window.getSelection() && !window.getSelection()?.isCollapsed) return;
            onGenerateTerm(term);
          }}
        >
          {term.term_text}
        </span>,
      );
    } else {
      result.push(
        <button
          key={`${keyPrefix}-term-${term.id}-${index}`}
          className={term.status === "linked" ? "knowledge-inline-link" : "term-candidate-link"}
          type="button"
          title={term.status === "linked" ? `打开"${term.term_text}"的解释` : `生成"${term.term_text}"的解释；右键可标记为已认识或忽略`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onGenerateTerm(term);
          }}
          onContextMenu={(event) => {
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
    }
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
    for (const hl of highlights) {
      parts = parts.flatMap((p, i) =>
        typeof p === "string" ? applyHighlightToText(p, hl, `hl-${i}`) : [p],
      );
    }
    for (const ann of annotations) {
      parts = parts.flatMap((p, i) =>
        typeof p === "string" ? applyAnnotationToText(p, ann, `ann-${i}`) : [p],
      );
    }
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
  initialScrollRatio,
  onScrollRatioChange,
}: Props) {
  const articleRef = useRef<HTMLElement | null>(null);
  const progressFillRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const androidRuntime = isAndroidRuntime();
  // Never inject <mark> temp-selection elements on Android — they would
  // destroy the native Range and collapse the drag handles.
  const effectiveTempSelectedText = androidRuntime ? null : tempSelectedText;
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

  // Desktop only: restore reading position on open. Android never auto-scrolls.
  useEffect(() => {
    if (androidRuntime || !initialScrollRatio) return;
    const article = articleRef.current;
    if (!article) return;
    const frame = window.requestAnimationFrame(() => {
      const maxScroll = Math.max(0, article.scrollHeight - article.clientHeight);
      if (maxScroll <= 0) return;
      article.scrollTop = maxScroll * Math.min(1, Math.max(0, initialScrollRatio));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [androidRuntime, sourcePath, initialScrollRatio]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update progress bar whenever content size or scroll position changes
  function refreshProgress() {
    const article = articleRef.current;
    const fill = progressFillRef.current;
    if (!article || !fill) return;
    const progress = calculateReadingProgress(article.scrollTop, article.scrollHeight, article.clientHeight);
    fill.style.transform = `scaleX(${progress})`;
    fill.style.opacity = article.scrollHeight <= article.clientHeight ? "0" : "1";
  }

  // Unified progress refresh — multiple resize sources, single rAF per frame
  const scheduleProgressRefresh = useCallback(() => {
    if (progressRafRef.current) return;
    progressRafRef.current = window.requestAnimationFrame(() => {
      progressRafRef.current = 0;
      refreshProgress();
    });
  }, []);

  // ResizeObserver on markdown body
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const ro = new ResizeObserver(() => scheduleProgressRefresh());
    ro.observe(body);
    return () => ro.disconnect();
  }, [content, scheduleProgressRefresh]);

  // ResizeObserver on article viewport
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const ro = new ResizeObserver(() => scheduleProgressRefresh());
    ro.observe(article);
    return () => ro.disconnect();
  }, [scheduleProgressRefresh]);

  // window resize
  useEffect(() => {
    window.addEventListener("resize", scheduleProgressRefresh);
    return () => window.removeEventListener("resize", scheduleProgressRefresh);
  }, [scheduleProgressRefresh]);

  // visualViewport resize (soft keyboard, etc.)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    vv.addEventListener("resize", scheduleProgressRefresh);
    return () => vv.removeEventListener("resize", scheduleProgressRefresh);
  }, [scheduleProgressRefresh]);

  // Recalculate on content/sourcePath change
  useEffect(() => {
    scheduleProgressRefresh();
  }, [content, sourcePath, scheduleProgressRefresh]);

  // Cleanup: unified timer, rAF, ResizeObserver — single flush on unmount
  const scrollValueRef = useRef<number | null>(null);
  const positionSaveTimerRef = useRef<number>(0);
  const unmountedRef = useRef(false);
  const lastSavedRatioRef = useRef<number | null>(null);
  const progressRafRef = useRef(0);

  // Always use latest callback + source identity via ref
  const onScrollRatioChangeRef = useRef(onScrollRatioChange);
  useEffect(() => { onScrollRatioChangeRef.current = onScrollRatioChange; }, [onScrollRatioChange]);
  const sourceKeyRef = useRef(`${sourceType}:${sourcePath ?? title}`);
  useEffect(() => { sourceKeyRef.current = `${sourceType}:${sourcePath ?? title}`; }, [sourceType, sourcePath, title]);

  function hasActiveAndroidSelection(): boolean {
    if (!androidRuntime) return false;
    const sel = window.getSelection();
    return sel !== null && !sel.isCollapsed;
  }

  function commitReadingPosition(allowDuringUnmount = false) {
    if (!allowDuringUnmount && unmountedRef.current) return;
    if (hasActiveAndroidSelection()) return;
    if (scrollValueRef.current === null) return;
    if (lastSavedRatioRef.current === scrollValueRef.current) return;
    const cb = onScrollRatioChangeRef.current;
    if (!cb) return;
    lastSavedRatioRef.current = scrollValueRef.current;
    cb(scrollValueRef.current);
  }

  // Source key change: flush old position, reset state, prepare new key
  useEffect(() => {
    const currentKey = `${sourceType}:${sourcePath ?? title}`;
    sourceKeyRef.current = currentKey;
    // Reset scroll position state for new document
    scrollValueRef.current = null;
    lastSavedRatioRef.current = null;
    unmountedRef.current = false;

    return () => {
      // Flush before source changes
      window.clearTimeout(positionSaveTimerRef.current);
      if (!hasActiveAndroidSelection() && scrollValueRef.current !== null) {
        const cb = onScrollRatioChangeRef.current;
        if (cb) {
          cb(scrollValueRef.current);
          scrollValueRef.current = null;
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceType, sourcePath, title]);

  // Flush pending position on unmount — commit before setting unmounted flag
  useEffect(() => () => {
    window.clearTimeout(positionSaveTimerRef.current);
    window.cancelAnimationFrame(scrollFrameRef.current);
    window.cancelAnimationFrame(progressRafRef.current);
    resizeObserverRef.current?.disconnect();
    commitReadingPosition(true);
    unmountedRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // rAF-throttled scroll: only updates the progress bar (visual).
  function reportScrollRaf() {
    if (scrollFrameRef.current) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = 0;
      refreshProgress();
    });
  }

  // Unified scroll handler: update progress bar (visual) + track position
  function onScrollHandler() {
    reportScrollRaf();
    const article = articleRef.current;
    if (article && onScrollRatioChange) {
      scrollValueRef.current = calculateReadingProgress(
        article.scrollTop, article.scrollHeight, article.clientHeight,
      );
    }
    // Only set debounce if scrollend is NOT supported
    if (article && !("onscrollend" in article)) {
      if (hasActiveAndroidSelection()) return;
      window.clearTimeout(positionSaveTimerRef.current);
      positionSaveTimerRef.current = window.setTimeout(() => {
        commitReadingPosition();
      }, 700) as unknown as number;
    }
  }

  // scrollend listener (preferred path when supported)
  useEffect(() => {
    const article = articleRef.current;
    if (!article || !onScrollRatioChange) return;

    const handleScrollEnd = () => {
      commitReadingPosition();
    };

    if ("onscrollend" in article) {
      article.addEventListener("scrollend", handleScrollEnd);
      return () => article.removeEventListener("scrollend", handleScrollEnd);
    }
    return undefined;
  }, [onScrollRatioChange]);

  const captureSelection = useCallback(() => {
    // Android relies entirely on native WebView ActionMode. React state
    // updates during selection would mutate the DOM and destroy the Range.
    if (androidRuntime) return;
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
  }, [onSelectionChange, sourcePath, sourceType, title, androidRuntime]);

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
      <p>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</p>
    ),
    li: ({ children }: { children?: ReactNode }) => (
      <li>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</li>
    ),
    td: ({ children }: { children?: ReactNode }) => (
      <td>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</td>
    ),
    th: ({ children }: { children?: ReactNode }) => (
      <th>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</th>
    ),
    h1: ({ children }: { children?: ReactNode }) => (
      <h1>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</h1>
    ),
    h2: ({ children }: { children?: ReactNode }) => (
      <h2>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</h2>
    ),
    h3: ({ children }: { children?: ReactNode }) => (
      <h3>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</h3>
    ),
    h4: ({ children }: { children?: ReactNode }) => (
      <h4>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</h4>
    ),
    strong: ({ children }: { children?: ReactNode }) => (
      <strong>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</strong>
    ),
    em: ({ children }: { children?: ReactNode }) => (
      <em>{highlightChildren(children, highlights, knowledgeLinks, documentTerms, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink, onGenerateTerm, onTermAction)}</em>
    ),
  }), [highlights, knowledgeLinks, documentTerms, annotations, effectiveTempSelectedText, onOpenKnowledgeLink, onGenerateTerm, onTermAction, onGenerateLesson]);

  return (
    <div className={`viewer markdown-viewer ${embedded ? "embedded" : ""}`}>
      {!embedded ? <div className="viewer-header">
        <span>{title ?? "课件"}</span>
        <div className="viewer-actions">
          {headerActions}
          <strong>Markdown</strong>
        </div>
      </div> : null}
      <div className="reader-progress-bar" aria-hidden="true">
        <div ref={progressFillRef} className="reader-progress-fill" />
      </div>
      <article
        ref={articleRef}
        className="markdown-scroll-viewport"
        onMouseUp={androidRuntime ? undefined : captureSelection}
        onKeyUp={androidRuntime ? undefined : captureSelection}
        onContextMenu={androidRuntime ? undefined : handleContextMenu}
        onScroll={onScrollHandler}
      >
        <div ref={bodyRef} className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={highlightedComponents}>
            {content}
          </ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
