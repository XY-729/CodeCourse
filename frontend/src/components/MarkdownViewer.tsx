import { Children, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { PluggableList } from "unified";
import { remarkTermOccurrences } from "../personalization/termOccurrences";
import remarkGfm from "remark-gfm";
import type { DocumentTerm, HighlightRecord, KnowledgeLink } from "../api/client";
import { isAndroidRuntime } from "../platform/runtime";
import { normalizeHighlightLanguage } from "../utils/highlightLanguages";
import type { Annotation } from "../types";
import { COLOR_VALUES } from "../types";
import type { ViewerSelection } from "./CodeViewer";

function HighlightedCode({ className, code }: { className: string; code: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const language = normalizeHighlightLanguage(className.replace(/^language-/, ""));

  useEffect(() => {
    setHtml(null);
    if (language === "plaintext") return;
    let cancelled = false;
    let idleId: number | null = null;
    const run = () => {
      void import("../utils/highlightRuntime")
        .then(({ highlightCode }) => highlightCode(code, language))
        .then((value) => { if (!cancelled) setHtml(value); })
        .catch(() => undefined);
    };
    if (window.requestIdleCallback) idleId = window.requestIdleCallback(run, { timeout: 500 });
    else window.setTimeout(run, 0);
    return () => {
      cancelled = true;
      if (idleId !== null) window.cancelIdleCallback?.(idleId);
    };
  }, [code, language]);

  return html
    ? <code className={`hljs ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
    : <code className={className}>{code}</code>;
}

type Props = {
  title: string | null;
  sourcePath?: string | null;
  sourceType?: "course" | "qa";
  content: string;
  termSourceKey?: string;
  highlights?: HighlightRecord[];
  knowledgeLinks?: KnowledgeLink[];
  documentTerms?: DocumentTerm[];
  visibleTermCandidateIds?: ReadonlySet<string>;
  termDisplayTiers?: ReadonlyMap<string, string>;
  annotations?: Annotation[];
  tempSelectedText?: string | null;
  onSelectionChange?: (selection: ViewerSelection) => void;
  onOpenKnowledgeLink?: (term: string, links: KnowledgeLink[]) => void;
  onOpenQAReference?: (projectId: number, qaRecordId: number) => void;
  onGenerateTerm?: (term: DocumentTerm, position?: { x: number; y: number }) => void;
  onTermAction?: (term: DocumentTerm, position?: { x: number; y: number }) => void;
  onGenerateLesson?: (lessonNumber: number, title: string, outlinePath?: string) => void;
  headerActions?: ReactNode;
  embedded?: boolean;
  immersiveReading?: boolean;
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

export type ReadingChromeState = {
  lastScrollTop: number;
  downwardTravel: number;
  upwardTravel: number;
  hidden: boolean;
};

export function advanceReadingChrome(
  state: ReadingChromeState,
  scrollTop: number,
): ReadingChromeState {
  const nextTop = Math.max(0, scrollTop);
  if (nextTop <= 12) {
    return {
      lastScrollTop: nextTop,
      downwardTravel: 0,
      upwardTravel: 0,
      hidden: false,
    };
  }

  const delta = nextTop - state.lastScrollTop;
  if (Math.abs(delta) < 0.5) {
    return { ...state, lastScrollTop: nextTop };
  }

  if (delta > 0) {
    const downwardTravel = Math.min(48, state.downwardTravel + delta);
    return {
      lastScrollTop: nextTop,
      downwardTravel,
      upwardTravel: 0,
      hidden: state.hidden || (nextTop > 32 && downwardTravel >= 18),
    };
  }

  const upwardTravel = Math.min(32, state.upwardTravel - delta);
  return {
    lastScrollTop: nextTop,
    downwardTravel: 0,
    upwardTravel,
    hidden: state.hidden && upwardTravel < 8,
  };
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
          role="button"
          tabIndex={0}
          aria-label={`查看 "${term}" 的知识链接`}
          onClick={() => {
            if (window.getSelection() && !window.getSelection()?.isCollapsed) return;
            onOpenKnowledgeLink(term, links);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenKnowledgeLink(term, links);
            }
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
    for (const hl of highlights) {
      parts = parts.flatMap((part, index) =>
        typeof part === "string"
          ? applyHighlightToText(part, hl, `hl-${index}`)
          : [part],
      );
    }
    for (const annotation of annotations) {
      parts = parts.flatMap((part, index) =>
        typeof part === "string"
          ? applyAnnotationToText(part, annotation, `ann-${index}`)
          : [part],
      );
    }
    if (tempText) {
      parts = parts.flatMap((part, index) =>
        typeof part === "string"
          ? applyTempSelection(part, tempText, `tmp-${index}`)
          : [part],
      );
    }
    return parts.flatMap((part, index) =>
      typeof part === "string"
        ? applyKnowledgeLinksToText(
            part,
            groupedLinks,
            onOpenKnowledgeLink,
            `kl-${index}`,
          )
        : [part],
    );
  });
}

export default function MarkdownViewer({
  title,
  sourcePath,
  sourceType = "course",
  content,
  termSourceKey,
  highlights = [],
  knowledgeLinks = [],
  documentTerms = [],
  visibleTermCandidateIds,
  termDisplayTiers,
  annotations = [],
  tempSelectedText,
  onSelectionChange,
  onOpenKnowledgeLink,
  onOpenQAReference,
  onGenerateTerm,
  onTermAction,
  onGenerateLesson,
  headerActions,
  embedded = false,
  immersiveReading = false,
  initialScrollRatio,
  onScrollRatioChange,
}: Props) {
  const articleRef = useRef<HTMLElement | null>(null);
  const progressFillRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const restoredSourceRef = useRef<string | null>(null);
  const scrollRangeRef = useRef(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const readingChromeRef = useRef<ReadingChromeState>({
    lastScrollTop: 0,
    downwardTravel: 0,
    upwardTravel: 0,
    hidden: false,
  });
  const androidRuntime = isAndroidRuntime();
  // Never inject <mark> temp-selection elements on Android — they would
  // destroy the native Range and collapse the drag handles.
  const effectiveTempSelectedText = androidRuntime ? null : tempSelectedText;
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

  // Restore once per opened document. Live learning-state updates must not be
  // fed back into scrollTop or they create a save -> restore jump loop.
  // Android previously returned early here, silently dropping the saved reading
  // position for every reopened lesson. Now it restores too, but defers while a
  // native selection is active so drag handles are not disturbed.
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    if (hasActiveAndroidSelection()) return;
    const restoreKey = `${sourceType}:${sourcePath ?? title}`;
    if (restoredSourceRef.current === restoreKey) return;
    const ratio = Math.min(1, Math.max(0, initialScrollRatio ?? 0));
    if (ratio === 0) {
      restoredSourceRef.current = restoreKey;
      article.scrollTop = 0;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      // Re-check: a native selection may have started between the effect
      // running and the frame callback. Restoring under a live selection would
      // jump the drag handles and collapse the ActionMode.
      if (hasActiveAndroidSelection()) return;
      const maxScroll = Math.max(0, article.scrollHeight - article.clientHeight);
      if (maxScroll <= 0) return;
      scrollRangeRef.current = maxScroll;
      article.scrollTop = maxScroll * ratio;
      restoredSourceRef.current = restoreKey;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [androidRuntime, content, initialScrollRatio, sourcePath, sourceType, title]);

  // Update progress bar whenever content size or scroll position changes
  function refreshProgress(remeasure = false) {
    const article = articleRef.current;
    const fill = progressFillRef.current;
    if (!article || !fill) return;
    if (remeasure) {
      scrollRangeRef.current = Math.max(0, article.scrollHeight - article.clientHeight);
    }
    const range = scrollRangeRef.current;
    const progress = range > 0 ? Math.min(1, Math.max(0, article.scrollTop / range)) : 0;
    fill.style.transform = `scaleX(${progress})`;
    fill.style.opacity = range <= 0 ? "0" : "1";
  }

  // Unified progress refresh — multiple resize sources, single rAF per frame
  const scheduleProgressRefresh = useCallback(() => {
    if (progressRafRef.current) return;
    progressRafRef.current = window.requestAnimationFrame(() => {
      progressRafRef.current = 0;
      refreshProgress(true);
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

  // Cleanup: unified timer, rAF, ResizeObserver — single commit path
  const scrollValueRef = useRef<number | null>(null);
  const positionSaveTimerRef = useRef<number>(0);
  const unmountedRef = useRef(false);
  const lastSavedRatioRef = useRef<number | null>(null);
  const progressRafRef = useRef(0);

  // Always use latest callback via stable ref
  const onScrollRatioChangeRef = useRef(onScrollRatioChange);
  onScrollRatioChangeRef.current = onScrollRatioChange;

  function hasActiveAndroidSelection(): boolean {
    if (!androidRuntime) return false;
    const sel = window.getSelection();
    return sel !== null && !sel.isCollapsed;
  }

  function updateReadingChrome(scrollTop: number) {
    if (!androidRuntime || !immersiveReading) return;
    if (hasActiveAndroidSelection()) {
      readingChromeRef.current = {
        ...readingChromeRef.current,
        lastScrollTop: scrollTop,
        hidden: false,
      };
      document.documentElement.classList.remove("android-reading-immersive");
      return;
    }
    const next = advanceReadingChrome(readingChromeRef.current, scrollTop);
    readingChromeRef.current = next;
    document.documentElement.classList.toggle("android-reading-immersive", next.hidden);
  }

  useEffect(() => {
    if (!androidRuntime || !immersiveReading) return;
    readingChromeRef.current = {
      lastScrollTop: articleRef.current?.scrollTop ?? 0,
      downwardTravel: 0,
      upwardTravel: 0,
      hidden: false,
    };
    document.documentElement.classList.remove("android-reading-immersive");
    return () => {
      document.documentElement.classList.remove("android-reading-immersive");
    };
  }, [androidRuntime, immersiveReading, sourcePath, sourceType, title]);

  function commitReadingPosition(
    allowDuringUnmount = false,
    callback = onScrollRatioChangeRef.current,
  ) {
    if (!allowDuringUnmount && unmountedRef.current) return;
    if (hasActiveAndroidSelection()) return;
    if (scrollValueRef.current === null) return;
    if (lastSavedRatioRef.current === scrollValueRef.current) return;
    if (!callback) return;
    lastSavedRatioRef.current = scrollValueRef.current;
    callback(scrollValueRef.current);
  }

  // Source key change: flush old position via commitReadingPosition, then reset
  useEffect(() => {
    const prevKey = `${sourceType}:${sourcePath ?? title}`;
    // Reset scroll position state for new document
    scrollValueRef.current = null;
    lastSavedRatioRef.current = null;
    unmountedRef.current = false;

    return () => {
      // Flush pending position for outgoing document — unified path
      window.clearTimeout(positionSaveTimerRef.current);
      // Capture the outgoing document's callback. React updates refs during
      // render, before this cleanup runs, so reading the shared callback ref
      // here could otherwise save document A's ratio into document B.
      commitReadingPosition(false, onScrollRatioChange);
      scrollValueRef.current = null;
    };
  }, [sourceType, sourcePath, title]);

  // Flush pending position on unmount — commit before setting unmounted flag
  useEffect(() => () => {
    window.clearTimeout(positionSaveTimerRef.current);
    window.cancelAnimationFrame(progressRafRef.current);
    resizeObserverRef.current?.disconnect();
    commitReadingPosition(true);
    unmountedRef.current = true;
  }, []);

  function captureCurrentScrollPosition() {
    const article = articleRef.current;
    if (article && onScrollRatioChangeRef.current) {
      const range = scrollRangeRef.current;
      scrollValueRef.current = range > 0
        ? Math.min(1, Math.max(0, article.scrollTop / range))
        : 0;
    }
  }

  // Progress bar updates at most once per animation frame via rAF.
  // scroll events can fire many times per frame; throttling to rAF
  // keeps the compositor happy while still looking real-time.
  useEffect(() => {
    const article = articleRef.current;
    if (!article || (!onScrollRatioChange && !immersiveReading)) return;

    const settleScroll = () => {
      captureCurrentScrollPosition();
      commitReadingPosition();
    };

    const onScroll = () => {
      updateReadingChrome(article.scrollTop);
      if (!progressRafRef.current) {
        progressRafRef.current = window.requestAnimationFrame(() => {
          progressRafRef.current = 0;
          refreshProgress();
        });
      }
      window.clearTimeout(positionSaveTimerRef.current);
      positionSaveTimerRef.current = window.setTimeout(settleScroll, 180) as unknown as number;
    };

    const supportsScrollEnd = typeof (
      article as unknown as { onscrollend?: unknown }
    ).onscrollend !== "undefined";
    if (supportsScrollEnd) {
      article.addEventListener("scroll", onScroll, { passive: true });
      article.addEventListener("scrollend", settleScroll);
      scheduleProgressRefresh();
      return () => {
        article.removeEventListener("scroll", onScroll);
        article.removeEventListener("scrollend", settleScroll);
        // The ref must reset after cancelling, otherwise the in-flight frame
        // marker sticks and every later scroll short-circuits: the progress
        // bar never updates again for this document.
        window.cancelAnimationFrame(progressRafRef.current);
        progressRafRef.current = 0;
      };
    }

    article.addEventListener("scroll", onScroll, { passive: true });
    scheduleProgressRefresh();
    return () => {
      article.removeEventListener("scroll", onScroll);
      window.clearTimeout(positionSaveTimerRef.current);
      window.cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = 0;
    };
  }, [androidRuntime, immersiveReading, onScrollRatioChange, sourcePath, sourceType, title]);

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

  const resolvedTermSourceKey =
    termSourceKey ?? `${sourceType}:${sourcePath ?? title ?? "document"}`;

  const termById = useMemo(
    () => new Map(documentTerms.map((term) => [String(term.id), term])),
    [documentTerms],
  );

  const markdownRemarkPlugins = useMemo<PluggableList>(
    () => [
      remarkGfm,
      [
        remarkTermOccurrences,
        {
          sourceKey: resolvedTermSourceKey,
          terms: documentTerms,
        },
      ],
    ],
    [resolvedTermSourceKey, documentTerms],
  );

  const highlightedComponents = useMemo(() => ({
    code: ({ className, children, ...props }: { className?: string; children?: ReactNode; node?: unknown }) => {
      const codeText = String(children ?? "").replace(/\n$/, "");
      const lang = className?.replace(/^language-/, "") ?? "";
      if (className?.startsWith("language-") && lang) {
        return <HighlightedCode className={className} code={codeText} />;
      }
      return <code>{children}</code>;
    },
    pre: ({ children }: { children?: ReactNode }) => <pre>{children}</pre>,
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      const match = href?.match(/^https:\/\/codecourse\.local\/generate-lesson\/(\d+)\?title=(.*)$/);
      if (match && onGenerateLesson) {
        const outlineMatch = href?.match(/[?&]outline_path=([^&]+)/)?.[1];
        return (
          <button
            type="button"
            className="lesson-generate-link"
            onClick={() => onGenerateLesson(Number(match[1]), decodeURIComponent(match[2] || "课件"), outlineMatch ? decodeURIComponent(outlineMatch) : undefined)}
          >
            {children}
          </button>
        );
      }
      const qaReference = href?.match(/^https:\/\/codecourse\.local\/qa\/(\d+)\/(\d+)$/);
      if (qaReference && onOpenQAReference) {
        return (
          <button
            type="button"
            className="knowledge-inline-link"
            onClick={() => onOpenQAReference(Number(qaReference[1]), Number(qaReference[2]))}
          >
            {children}
          </button>
        );
      }
      return <a href={href}>{children}</a>;
    },
    span: (spanProps: React.HTMLAttributes<HTMLSpanElement> & {
      children?: ReactNode;
      node?: unknown;
    }) => {
      const rawProps = spanProps as Record<string, unknown>;
      const candidateId = String(
        rawProps["data-term-candidate-id"] ?? rawProps["dataTermCandidateId"] ?? "",
      );
      const termId = String(
        rawProps["data-term-id"] ?? rawProps["dataTermId"] ?? "",
      );
      if (!candidateId || !termId) {
        const { node: _node, children, ...plainProps } = spanProps;
        return <span {...plainProps}>{children}</span>;
      }

      const term = termById.get(termId);
      if (!term || !onGenerateTerm) {
        return <>{spanProps.children}</>;
      }

      const isManual = (term.link_origin ?? "legacy_unknown") === "manual";
      const isVisible =
        isManual || (visibleTermCandidateIds?.has(candidateId) ?? false);
      if (!isVisible) {
        return <>{spanProps.children}</>;
      }

      const tier = termDisplayTiers?.get(candidateId) ?? "subtle";
      const tierClass =
        term.status === "linked"
          ? "knowledge-inline-link"
          : `term-candidate-link personalized-term--${tier}`;

      if (androidRuntime) {
        return (
          <span
            className={`personalized-term document-term document-term-${term.status} ${tierClass}`}
            data-term-candidate-id={candidateId}
            data-term-id={term.id}
            data-codecourse-unfamiliar-term={term.status === "candidate" ? "true" : undefined}
            role="button"
            tabIndex={0}
            aria-label={`查看术语 "${term.term_text}"`}
            onClick={(event) => {
              if (window.getSelection() && !window.getSelection()?.isCollapsed) {
                return;
              }
              onGenerateTerm(term, { x: event.clientX, y: event.clientY });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onGenerateTerm(term, { x: 0, y: 0 });
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (term.status === "candidate") {
                onTermAction?.(term, { x: event.clientX, y: event.clientY });
              }
            }}
          >
            {spanProps.children}
          </span>
        );
      }

      return (
        <button
          className={`personalized-term ${tierClass}`}
          type="button"
          data-term-candidate-id={candidateId}
          data-term-id={term.id}
          title={
            term.status === "linked"
              ? `打开"${term.term_text}"的解释`
              : `生成"${term.term_text}"的解释；右键可标记为已认识或忽略`
          }
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onGenerateTerm(term, { x: event.clientX, y: event.clientY });
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (term.status === "candidate") {
              onTermAction?.(term, { x: event.clientX, y: event.clientY });
            }
          }}
        >
          {spanProps.children}
        </button>
      );
    },
    p: ({ children }: { children?: ReactNode }) => (
      <p>{highlightChildren(children, highlights, knowledgeLinks, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink)}</p>
    ),
    li: ({ children }: { children?: ReactNode }) => (
      <li>{highlightChildren(children, highlights, knowledgeLinks, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink)}</li>
    ),
    td: ({ children }: { children?: ReactNode }) => (
      <td>{highlightChildren(children, highlights, knowledgeLinks, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink)}</td>
    ),
    th: ({ children }: { children?: ReactNode }) => (
      <th>{highlightChildren(children, highlights, knowledgeLinks, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink)}</th>
    ),
    h1: ({ children }: { children?: ReactNode }) => (
      <h1>{highlightChildren(children, highlights, knowledgeLinks, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink)}</h1>
    ),
    h2: ({ children }: { children?: ReactNode }) => (
      <h2>{highlightChildren(children, highlights, knowledgeLinks, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink)}</h2>
    ),
    h3: ({ children }: { children?: ReactNode }) => (
      <h3>{highlightChildren(children, highlights, knowledgeLinks, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink)}</h3>
    ),
    h4: ({ children }: { children?: ReactNode }) => (
      <h4>{highlightChildren(children, highlights, knowledgeLinks, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink)}</h4>
    ),
    strong: ({ children }: { children?: ReactNode }) => (
      <strong>{highlightChildren(children, highlights, knowledgeLinks, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink)}</strong>
    ),
    em: ({ children }: { children?: ReactNode }) => (
      <em>{highlightChildren(children, highlights, knowledgeLinks, annotations, effectiveTempSelectedText ?? null, onOpenKnowledgeLink)}</em>
    ),
  }), [
    highlights,
    knowledgeLinks,
    annotations,
    effectiveTempSelectedText,
    onOpenKnowledgeLink,
    onGenerateTerm,
    onTermAction,
    visibleTermCandidateIds,
    termDisplayTiers,
    onGenerateLesson,
    onOpenQAReference,
    termById,
    androidRuntime,
  ]);

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
      >
        <div ref={bodyRef} className="markdown-body">
          <ReactMarkdown remarkPlugins={markdownRemarkPlugins} components={highlightedComponents}>
            {content}
          </ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
