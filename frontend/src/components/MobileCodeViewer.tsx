import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import hljs from "highlight.js";
import type { ViewerRange, ViewerSelection } from "./CodeViewer";

type Props = {
  path: string | null;
  language: string;
  content: string;
  selectedRange?: ViewerRange | null;
  onSelectionChange?: (selection: ViewerSelection) => void;
  initialLine?: number;
  onVisibleLineChange?: (line: number) => void;
};

const LARGE_FILE_BYTES = 400_000;
const LARGE_FILE_LINES = 8_000;
const VIRTUAL_OVERSCAN = 20;
const ROW_HEIGHT_ESTIMATE = 24;

const ALLOWED_SPAN_CLASS_RE = /^hljs-/;

// ==================================================================
//  Safe React node conversion from highlight.js HTML
// ==================================================================

/**
 * Parse highlight.js HTML output and split into per-line ReactNode arrays
 * with balanced span stacks. Text is re-escaped; only hljs-* span classes
 * are preserved. No dangerouslySetInnerHTML anywhere.
 */
export function splitHighlightedToLines(html: string): string[] {
  // Parse once into DOM tree
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;

  const lines: string[] = [];
  let currentLine = "";

  // Single true tag stack — push/pop on the same array
  const tagStack: string[] = [];

  function flushLine() {
    // Close all open tags in reverse order
    let suffix = "";
    for (let j = tagStack.length - 1; j >= 0; j--) {
      suffix += `</span>`;
    }
    lines.push(currentLine + suffix);

    // Start next line with all open tags
    currentLine = "";
    for (let j = 0; j < tagStack.length; j++) {
      currentLine += tagStack[j];
    }
  }

  function escapeForHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      const parts = text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        currentLine += escapeForHtml(parts[i]);
        if (i < parts.length - 1) {
          flushLine();
        }
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tagName = el.tagName.toLowerCase();

    if (tagName === "br") {
      flushLine();
      return;
    }

    if (tagName === "span") {
      // Only keep hljs-* classes
      const rawClass = el.getAttribute("class") ?? "";
      const safeClasses = rawClass
        .split(/\s+/)
        .filter((c) => ALLOWED_SPAN_CLASS_RE.test(c))
        .join(" ");

      const openTag = safeClasses
        ? `<span class="${safeClasses}">`
        : "<span>";

      currentLine += openTag;
      tagStack.push(openTag);

      for (const child of Array.from(el.childNodes)) {
        walk(child);
      }

      tagStack.pop();
      currentLine += "</span>";
      return;
    }

    // For other elements (code, pre, etc): render as escaped text only,
    // but recurse into children to find text and newlines
    for (const child of Array.from(el.childNodes)) {
      walk(child);
    }
  }

  for (const child of Array.from(body.childNodes)) {
    walk(child);
  }
  flushLine();

  return lines;
}

/**
 * Render a single highlighted HTML string line into ReactNodes.
 * Uses DOMParser to convert each line back — but the line is guaranteed
 * balanced at this point, so it's safe.
 */
function renderHighlightedLine(html: string, key: number): ReactNode[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const nodes: ReactNode[] = [];
  let idx = 0;

  function walk(el: Node) {
    if (el.nodeType === Node.TEXT_NODE) {
      const text = el.textContent ?? "";
      // React automatically escapes text content
      nodes.push(text);
      return;
    }
    if (el.nodeType !== Node.ELEMENT_NODE) return;
    const element = el as Element;
    const tag = element.tagName.toLowerCase();

    if (tag === "span") {
      const cls = (element.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter((c) => ALLOWED_SPAN_CLASS_RE.test(c))
        .join(" ");
      const children: ReactNode[] = [];
      for (const child of Array.from(element.childNodes)) {
        walk(child);
        // Extract content from children array
        while (children.length < nodes.length) {
          children.push(nodes.pop()!);
        }
      }
      // Actually, let me simplify: just recurse and wrap in span
      const childNodes: ReactNode[] = [];
      for (const child of Array.from(element.childNodes)) {
        walkInner(child, childNodes);
      }
      nodes.push(
        <span key={idx++} className={cls || undefined}>
          {childNodes}
        </span>
      );
    } else {
      for (const child of Array.from(element.childNodes)) {
        walk(child);
      }
    }
  }

  function walkInner(el: Node, out: ReactNode[]) {
    if (el.nodeType === Node.TEXT_NODE) {
      out.push(el.textContent ?? "");
      return;
    }
    if (el.nodeType !== Node.ELEMENT_NODE) return;
    const element = el as Element;
    const tag = element.tagName.toLowerCase();

    if (tag === "span") {
      const cls = (element.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter((c) => ALLOWED_SPAN_CLASS_RE.test(c))
        .join(" ");
      const children: ReactNode[] = [];
      for (const child of Array.from(element.childNodes)) {
        walkInner(child, children);
      }
      out.push(
        <span key={idx++} className={cls || undefined}>
          {children}
        </span>
      );
    } else {
      for (const child of Array.from(element.childNodes)) {
        walkInner(child, out);
      }
    }
  }

  walkInner(doc.body, nodes);
  return nodes.length > 0 ? nodes : [html || " "];
}

// ==================================================================
//  Virtual list for large files
// ==================================================================

function useVirtualLines(
  totalLines: number,
  containerRef: React.RefObject<HTMLDivElement | null>,
  rowHeight = ROW_HEIGHT_ESTIMATE,
) {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setContainerHeight(el.clientHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  const handleScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = containerRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  }, [containerRef]);

  useEffect(() => () => window.cancelAnimationFrame(rafRef.current), []);

  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - VIRTUAL_OVERSCAN);
    const visible = Math.ceil(containerHeight / rowHeight);
    const end = Math.min(totalLines, start + visible + VIRTUAL_OVERSCAN * 2);
    return { start, end };
  }, [scrollTop, containerHeight, totalLines, rowHeight]);

  return { visibleRange, handleScroll, totalHeight: totalLines * rowHeight };
}

// ==================================================================
//  Component
// ==================================================================

export default function MobileCodeViewer({
  path, language, content, selectedRange,
  onSelectionChange: _onSelectionChange,
  initialLine, onVisibleLineChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const visibleLineCallbackRef = useRef(onVisibleLineChange);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const searchTimerRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  const plainLines = useMemo(() => content.split("\n"), [content]);
  const totalLines = plainLines.length;
  const isLargeFile = content.length > LARGE_FILE_BYTES || totalLines > LARGE_FILE_LINES;

  // ---- search debounce ----
  useEffect(() => {
    if (!searchInput.trim()) {
      window.clearTimeout(searchTimerRef.current);
      setDebouncedQuery("");
      setActiveMatch(0);
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchInput);
    }, 200);
    searchTimerRef.current = timer;
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Clear search on file change
  useEffect(() => {
    setSearchInput("");
    setDebouncedQuery("");
    setActiveMatch(0);
    window.cancelAnimationFrame(0); // clear any pending rAF
    // Abort any pending highlight
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, [content, path]);

  // ---- highlighting ----
  const highlightedLines = useMemo(() => {
    if (isLargeFile) return null; // No highlighting for large files

    const validLang = language && hljs.getLanguage(language) ? language : undefined;
    if (!validLang) return null;

    try {
      const result = hljs.highlight(content, { language: validLang, ignoreIllegals: true });
      const lines = splitHighlightedToLines(result.value);
      while (lines.length < totalLines) lines.push(" ");
      return lines;
    } catch {
      return null;
    }
  }, [content, language, isLargeFile, totalLines]);

  // ---- search matches ----
  const matches = useMemo(() => {
    const needle = debouncedQuery.trim().toLocaleLowerCase();
    if (!needle) return [];
    return plainLines.flatMap(
      (line, index) => line.toLocaleLowerCase().includes(needle) ? [index + 1] : [],
    );
  }, [plainLines, debouncedQuery]);

  const matchSet = useMemo(() => new Set(matches), [matches]);

  // Fix activeMatch if out of bounds
  useEffect(() => {
    if (matches.length === 0) {
      setActiveMatch(0);
    } else if (activeMatch >= matches.length) {
      setActiveMatch(0);
    }
  }, [matches.length, activeMatch]);

  // ---- visible line tracking ----
  useEffect(() => {
    visibleLineCallbackRef.current = onVisibleLineChange;
  }, [onVisibleLineChange]);

  // ---- initial line scroll ----
  useEffect(() => {
    if (!initialLine || initialLine < 1) return;
    const frame = window.requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`[data-line="${initialLine}"]`)
        ?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [content, initialLine, path]);

  // ---- virtual list for large files ----
  const { visibleRange, handleScroll, totalHeight } = useVirtualLines(
    totalLines,
    scrollRef,
    ROW_HEIGHT_ESTIMATE,
  );

  // ---- move search match ----
  function moveMatch(delta: number) {
    if (!matches.length) return;
    const next = (activeMatch + delta + matches.length) % matches.length;
    setActiveMatch(next);
    scrollRef.current?.querySelector<HTMLElement>(`[data-line="${matches[next]}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // ---- render a single line ----
  function renderLine(index: number) {
    const lineNumber = index + 1;
    const anchored = selectedRange
      && lineNumber >= selectedRange.startLineNumber
      && lineNumber <= selectedRange.endLineNumber;
    const matched = matchSet.has(lineNumber);

    let content: ReactNode;
    if (highlightedLines) {
      content = renderHighlightedLine(highlightedLines[index] || " ", lineNumber);
    } else {
      content = plainLines[index] || " ";
    }

    return (
      <div
        className={`mobile-code-line ${anchored ? "selection-anchor" : ""} ${matched ? "search-match" : ""}`}
        data-line={lineNumber}
        key={index}
      >
        <span className="mobile-line-number">{lineNumber}</span>
        <code className={highlightedLines ? "hljs" : ""}>{content}</code>
      </div>
    );
  }

  return (
    <div className="viewer mobile-code-viewer">
      <div className="viewer-header">
        <span>{path ?? "代码"}</span>
        <div className="viewer-actions">
          <strong>{isLargeFile ? `${language} · 大文件模式` : language}</strong>
          <button className="icon-button" onClick={() => setSearchOpen((o) => !o)} title="搜索">
            <Search size={15} />
          </button>
        </div>
      </div>

      {isLargeFile && (
        <div className="mobile-code-notice">
          大文件模式：已关闭语法高亮，使用虚拟列表仅渲染可见行
        </div>
      )}

      {searchOpen && (
        <div className="mobile-code-search">
          <Search size={14} />
          <input
            autoFocus
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索当前文件"
          />
          <span>{matches.length ? `${activeMatch + 1}/${matches.length}` : "0/0"}</span>
          <button className="icon-button" onClick={() => moveMatch(-1)} disabled={!matches.length}>
            <ChevronUp size={15} />
          </button>
          <button className="icon-button" onClick={() => moveMatch(1)} disabled={!matches.length}>
            <ChevronDown size={15} />
          </button>
          <button
            className="icon-button"
            onClick={() => {
              setSearchOpen(false);
              setSearchInput("");
              setDebouncedQuery("");
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      <div
        ref={scrollRef}
        className="mobile-code-scroll"
        onScroll={isLargeFile ? handleScroll : undefined}
      >
        {isLargeFile ? (
          // Virtual list mode: only render visible + overscan lines
          <div style={{ height: totalHeight, position: "relative" }}>
            {Array.from(
              { length: visibleRange.end - visibleRange.start },
              (_, i) => {
                const idx = visibleRange.start + i;
                return (
                  <div
                    key={idx}
                    style={{
                      position: "absolute",
                      top: idx * ROW_HEIGHT_ESTIMATE,
                      left: 0,
                      right: 0,
                      height: ROW_HEIGHT_ESTIMATE,
                    }}
                  >
                    {renderLine(idx)}
                  </div>
                );
              },
            )}
          </div>
        ) : (
          // Normal mode: render all lines
          highlightedLines
            ? highlightedLines.map((_, i) => renderLine(i))
            : plainLines.map((_, i) => renderLine(i))
        )}
      </div>
    </div>
  );
}
