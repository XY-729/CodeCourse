import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Split highlighted HTML into per-line safe HTML fragments using DOMParser.
 * Ensures balanced tags across line boundaries by tracking the node stack.
 */
function splitHighlightedHtml(html: string): string[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;

  // Walk text nodes and <br> elements to find line boundaries, collecting
  // the ancestor span stack at each boundary.
  const lines: string[] = [];
  let currentLine = "";
  const nodeStack: string[] = []; // open tags for current line prefix

  function flushLine() {
    // Close any open tags
    let suffix = "";
    for (let j = nodeStack.length - 1; j >= 0; j--) {
      suffix += `</span>`;
    }
    lines.push(currentLine + suffix);
    // Reopen tags for next line prefix
    currentLine = "";
    for (let j = 0; j < nodeStack.length; j++) {
      currentLine += nodeStack[j];
    }
  }

  function walkTextNodes(node: Node, openTags: string[]) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      const parts = text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        currentLine += parts[i];
        if (i < parts.length - 1) {
          flushLine();
        }
      }
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.tagName === "BR") {
        flushLine();
        return;
      }
      const tagName = el.tagName.toLowerCase();
      if (tagName === "span") {
        const cls = el.getAttribute("class") ?? "";
        const openTag = cls ? `<span class="${cls}">` : "<span>";
        currentLine += openTag;
        openTags.push(openTag);
        for (const child of Array.from(el.childNodes)) {
          walkTextNodes(child, openTags);
        }
        openTags.pop();
        currentLine += "</span>";
      } else {
        // Non-span elements: emit as raw HTML
        const outer = el.outerHTML;
        const parts = outer.split("\n");
        for (let i = 0; i < parts.length; i++) {
          currentLine += parts[i];
          if (i < parts.length - 1) {
            flushLine();
          }
        }
      }
    }
  }

  for (const child of Array.from(body.childNodes)) {
    walkTextNodes(child, []);
  }
  flushLine();

  return lines;
}

export default function MobileCodeViewer({ path, language, content, selectedRange, onSelectionChange, initialLine, onVisibleLineChange }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef(0);
  const visibleLineCallbackRef = useRef(onVisibleLineChange);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const searchTimerRef = useRef<number>(0);

  const isLargeFile = content.length > LARGE_FILE_BYTES || content.split("\n").length > LARGE_FILE_LINES;
  const plainLines = useMemo(() => content.split("\n"), [content]);

  const highlightedLines = useMemo(() => {
    if (isLargeFile) return plainLines.map((line) => escapeHtml(line || " "));
    const validLang = language && hljs.getLanguage(language) ? language : undefined;
    if (!validLang) return plainLines.map((line) => escapeHtml(line || " "));
    try {
      const result = hljs.highlight(content, { language: validLang, ignoreIllegals: true });
      const lines = splitHighlightedHtml(result.value);
      // Pad to match plainLines length
      while (lines.length < plainLines.length) lines.push(" ");
      return lines;
    } catch {
      return plainLines.map((line) => escapeHtml(line || " "));
    }
  }, [content, language, isLargeFile, plainLines]);

  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return plainLines.flatMap((line, index) => line.toLocaleLowerCase().includes(needle) ? [index + 1] : []);
  }, [plainLines, query]);
  const matchSet = useMemo(() => new Set(matches), [matches]);

  useEffect(() => {
    visibleLineCallbackRef.current = onVisibleLineChange;
  }, [onVisibleLineChange]);

  useEffect(() => {
    if (!initialLine || initialLine < 1) return;
    const frame = window.requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`[data-line="${initialLine}"]`)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [content, initialLine, path]);

  useEffect(() => () => {
    window.cancelAnimationFrame(scrollFrameRef.current);
    window.clearTimeout(searchTimerRef.current);
  }, []);

  function captureVisibleLine() {
    if (scrollFrameRef.current) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = 0;
      const container = scrollRef.current;
      const firstRow = container?.querySelector<HTMLElement>("[data-line]");
      if (!container || !firstRow) return;
      const rowHeight = Math.max(1, firstRow.offsetHeight);
      const visibleLine = Math.min(plainLines.length, Math.max(1, Math.floor(container.scrollTop / rowHeight) + 1));
      visibleLineCallbackRef.current?.(visibleLine);
    });
  }

  function moveMatch(delta: number) {
    if (!matches.length) return;
    const next = (activeMatch + delta + matches.length) % matches.length;
    setActiveMatch(next);
    scrollRef.current?.querySelector<HTMLElement>(`[data-line="${matches[next]}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // Debounced search input
  const handleSearchChange = useCallback((value: string) => {
    window.clearTimeout(searchTimerRef.current);
    setQuery(value);
    // If clearing, reset immediately
    if (!value.trim()) {
      setActiveMatch(0);
      return;
    }
    // For typing, debounce the match recalculation
    searchTimerRef.current = window.setTimeout(() => {
      // query is already set, matches will recompute via useMemo
    }, 200);
  }, []);

  return <div className="viewer mobile-code-viewer">
    <div className="viewer-header">
      <span>{path ?? "代码"}</span>
      <div className="viewer-actions">
        <strong>{isLargeFile ? `${language} · 大文件` : language}</strong>
        <button className="icon-button" onClick={() => setSearchOpen((open) => !open)} title="搜索"><Search size={15} /></button>
      </div>
    </div>
    {isLargeFile ? <div className="mobile-code-notice">为保证性能，已关闭大文件高亮</div> : null}
    {searchOpen ? <div className="mobile-code-search">
      <Search size={14} />
      <input autoFocus value={query} onChange={(e) => handleSearchChange(e.target.value)} placeholder="搜索当前文件" />
      <span>{matches.length ? `${activeMatch + 1}/${matches.length}` : "0/0"}</span>
      <button className="icon-button" onClick={() => moveMatch(-1)} disabled={!matches.length}><ChevronUp size={15} /></button>
      <button className="icon-button" onClick={() => moveMatch(1)} disabled={!matches.length}><ChevronDown size={15} /></button>
      <button className="icon-button" onClick={() => { setSearchOpen(false); setQuery(""); }}><X size={15} /></button>
    </div> : null}
    <div ref={scrollRef} className="mobile-code-scroll" onScroll={captureVisibleLine}>
      {highlightedLines.map((lineHtml, index) => {
        const lineNumber = index + 1;
        const anchored = selectedRange && lineNumber >= selectedRange.startLineNumber && lineNumber <= selectedRange.endLineNumber;
        const matched = matchSet.has(lineNumber);
        return <div className={`mobile-code-line ${anchored ? "selection-anchor" : ""} ${matched ? "search-match" : ""}`} data-line={lineNumber} key={index}><span className="mobile-line-number">{lineNumber}</span><code className="hljs" dangerouslySetInnerHTML={{ __html: lineHtml || " " }} /></div>;
      })}
    </div>
  </div>;
}
