import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
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

export function splitHighlightedToLines(html: string): string[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;
  const lines: string[] = [];
  let currentLine = "";
  const tagStack: string[] = [];

  function flushLine() {
    let suffix = "";
    for (let j = tagStack.length - 1; j >= 0; j--) suffix += `</span>`;
    lines.push(currentLine + suffix);
    currentLine = "";
    for (let j = 0; j < tagStack.length; j++) currentLine += tagStack[j];
  }

  function escapeForHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      const parts = text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        currentLine += escapeForHtml(parts[i]);
        if (i < parts.length - 1) flushLine();
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tagName = el.tagName.toLowerCase();
    if (tagName === "br") { flushLine(); return; }
    if (tagName === "span") {
      const safeClasses = (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => ALLOWED_SPAN_CLASS_RE.test(c)).join(" ");
      const openTag = safeClasses ? `<span class="${safeClasses}">` : "<span>";
      currentLine += openTag; tagStack.push(openTag);
      for (const child of Array.from(el.childNodes)) walk(child);
      tagStack.pop(); currentLine += "</span>";
      return;
    }
    for (const child of Array.from(el.childNodes)) walk(child);
  }

  for (const child of Array.from(body.childNodes)) walk(child);
  flushLine();
  return lines;
}

function renderHighlightedLine(html: string): ReactNode[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const nodes: ReactNode[] = [];
  let idx = 0;

  function walkInner(el: Node, out: ReactNode[]) {
    if (el.nodeType === Node.TEXT_NODE) { out.push(el.textContent ?? ""); return; }
    if (el.nodeType !== Node.ELEMENT_NODE) return;
    const element = el as Element;
    if (element.tagName.toLowerCase() === "span") {
      const cls = (element.getAttribute("class") ?? "").split(/\s+/).filter((c) => ALLOWED_SPAN_CLASS_RE.test(c)).join(" ");
      const children: ReactNode[] = [];
      for (const child of Array.from(element.childNodes)) walkInner(child, children);
      out.push(<span key={idx++} className={cls || undefined}>{children}</span>);
    } else {
      for (const child of Array.from(element.childNodes)) walkInner(child, out);
    }
  }

  walkInner(doc.body, nodes);
  return nodes.length > 0 ? nodes : [html || " "];
}

// ==================================================================
//  Virtual list
// ==================================================================

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

type VirtualState = { start: number; end: number; totalHeight: number };

function useVirtualLines(totalLines: number, containerRef: React.RefObject<HTMLDivElement | null>, rowH: number) {
  const [state, setState] = useState<VirtualState>({ start: 0, end: 50, totalHeight: totalLines * rowH });
  const rafRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      setState((s) => ({ ...s, totalHeight: totalLines * rowH, end: clamp(s.start + Math.ceil(h / rowH) + VIRTUAL_OVERSCAN * 2, 1, totalLines) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, totalLines, rowH]);

  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = containerRef.current; if (!el) return;
      const st = el.scrollTop; const h = el.clientHeight;
      const start = Math.max(0, Math.floor(st / rowH) - VIRTUAL_OVERSCAN);
      const end = clamp(start + Math.ceil(h / rowH) + VIRTUAL_OVERSCAN * 2, 1, totalLines);
      setState({ start, end, totalHeight: totalLines * rowH });
    });
  }, [containerRef, totalLines, rowH]);

  // scrollToLine — unified jump for both initialLine and search
  const scrollToLine = useCallback((lineNum: number, align: "start" | "center" = "start") => {
    const el = containerRef.current; if (!el) return;
    const zeroBased = clamp(lineNum - 1, 0, totalLines - 1);
    let targetTop: number;
    if (align === "center") {
      targetTop = zeroBased * rowH - el.clientHeight / 2 + rowH / 2;
    } else {
      targetTop = zeroBased * rowH;
    }
    el.scrollTop = clamp(targetTop, 0, Math.max(0, totalLines * rowH - el.clientHeight));
  }, [containerRef, totalLines, rowH]);

  useEffect(() => () => window.cancelAnimationFrame(rafRef.current), []);

  return { state, onScroll, scrollToLine };
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const searchTimerRef = useRef<number>(0);

  const plainLines = useMemo(() => content.split("\n"), [content]);
  const totalLines = plainLines.length;
  const isLargeFile = content.length > LARGE_FILE_BYTES || totalLines > LARGE_FILE_LINES;

  // search debounce
  useEffect(() => {
    if (!searchInput.trim()) { window.clearTimeout(searchTimerRef.current); setDebouncedQuery(""); setActiveMatch(0); return; }
    const timer = window.setTimeout(() => setDebouncedQuery(searchInput), 200);
    searchTimerRef.current = timer;
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // reset on file switch
  useEffect(() => {
    setSearchInput(""); setDebouncedQuery(""); setActiveMatch(0);
  }, [content, path]);

  // highlighting
  const highlightedLines = useMemo(() => {
    if (isLargeFile) return null;
    const validLang = language && hljs.getLanguage(language) ? language : undefined;
    if (!validLang) return null;
    try {
      const result = hljs.highlight(content, { language: validLang, ignoreIllegals: true });
      const lines = splitHighlightedToLines(result.value);
      while (lines.length < totalLines) lines.push(" ");
      return lines;
    } catch { return null; }
  }, [content, language, isLargeFile, totalLines]);

  // search matches
  const matches = useMemo(() => {
    const needle = debouncedQuery.trim().toLocaleLowerCase();
    if (!needle) return [];
    return plainLines.flatMap((line, i) => line.toLocaleLowerCase().includes(needle) ? [i + 1] : []);
  }, [plainLines, debouncedQuery]);
  const matchSet = useMemo(() => new Set(matches), [matches]);

  useEffect(() => {
    if (!matches.length) setActiveMatch(0);
    else if (activeMatch >= matches.length) setActiveMatch(0);
  }, [matches.length, activeMatch]);

  // virtual list
  const { state: virt, scrollToLine } = useVirtualLines(totalLines, scrollRef, ROW_HEIGHT_ESTIMATE);

  // initialLine jump — use virtual scrollToLine for large files
  const initialLineJumpedRef = useRef(false);
  useEffect(() => {
    if (initialLineJumpedRef.current) return;
    if (!initialLine || initialLine < 1) return;
    const frame = window.requestAnimationFrame(() => {
      if (isLargeFile) scrollToLine(initialLine, "start");
      else scrollRef.current?.querySelector<HTMLElement>(`[data-line="${initialLine}"]`)?.scrollIntoView({ block: "start" });
      initialLineJumpedRef.current = true;
    });
    return () => { window.cancelAnimationFrame(frame); initialLineJumpedRef.current = false; };
  }, [content, initialLine, path, isLargeFile, scrollToLine]);

  // onVisibleLineChange
  const visibleLineCallbackRef = useRef(onVisibleLineChange);
  useEffect(() => { visibleLineCallbackRef.current = onVisibleLineChange; }, [onVisibleLineChange]);
  const lastReportedLineRef = useRef(0);

  const reportVisibleLine = useCallback(() => {
    const el = scrollRef.current; if (!el) return;
    const visibleLine = clamp(Math.floor(el.scrollTop / ROW_HEIGHT_ESTIMATE) + 1, 1, totalLines);
    if (visibleLine === lastReportedLineRef.current) return;
    lastReportedLineRef.current = visibleLine;
    visibleLineCallbackRef.current?.(visibleLine);
  }, [totalLines]);

  const onScroll = useCallback(() => {
    if (isLargeFile) (virt as VirtualState & { onScroll?: () => void }); // handled by useVirtualLines internally
    reportVisibleLine();
  }, [reportVisibleLine, isLargeFile, virt]);

  // For large files, use virtual list scroll + visible reporting together
  useEffect(() => {
    if (!isLargeFile) return;
    const el = scrollRef.current; if (!el) return;
    const handler = () => {
      (virt as VirtualState & { _on?: unknown }); // useVirtualLines handles its own scroll
      reportVisibleLine();
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [isLargeFile, reportVisibleLine]);

  // moveMatch with virtual list support
  function moveMatch(delta: number) {
    if (!matches.length) return;
    const next = (activeMatch + delta + matches.length) % matches.length;
    setActiveMatch(next);
    if (isLargeFile) scrollToLine(matches[next], "center");
    else scrollRef.current?.querySelector<HTMLElement>(`[data-line="${matches[next]}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function renderLine(index: number, positionStyle?: { position: "absolute"; top: number; left: 0; right: 0; height: number }) {
    const lineNum = index + 1;
    const anchored = selectedRange && lineNum >= selectedRange.startLineNumber && lineNum <= selectedRange.endLineNumber;
    const matched = matchSet.has(lineNum);
    const content = highlightedLines
      ? renderHighlightedLine(highlightedLines[index] || " ")
      : [plainLines[index] || " "];

    return (
      <div className={`mobile-code-line ${anchored ? "selection-anchor" : ""} ${matched ? "search-match" : ""}`}
        data-line={lineNum} key={index} style={positionStyle}>
        <span className="mobile-line-number">{lineNum}</span>
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
          <button className="icon-button" onClick={() => setSearchOpen((o) => !o)} title="搜索"><Search size={15} /></button>
        </div>
      </div>
      {isLargeFile && <div className="mobile-code-notice">大文件模式：虚拟列表仅渲染可见行</div>}
      {searchOpen && (
        <div className="mobile-code-search">
          <Search size={14} />
          <input autoFocus value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="搜索当前文件" />
          <span>{matches.length ? `${activeMatch + 1}/${matches.length}` : "0/0"}</span>
          <button className="icon-button" onClick={() => moveMatch(-1)} disabled={!matches.length}><ChevronUp size={15} /></button>
          <button className="icon-button" onClick={() => moveMatch(1)} disabled={!matches.length}><ChevronDown size={15} /></button>
          <button className="icon-button" onClick={() => { setSearchOpen(false); setSearchInput(""); setDebouncedQuery(""); }}>
            <X size={15} /></button>
        </div>
      )}
      <div ref={scrollRef} className="mobile-code-scroll" onScroll={onScroll}>
        {isLargeFile ? (
          <div style={{ height: virt.totalHeight, position: "relative" }}>
            {Array.from({ length: virt.end - virt.start }, (_, i) => {
              const idx = virt.start + i;
              return renderLine(idx, { position: "absolute", top: idx * ROW_HEIGHT_ESTIMATE, left: 0, right: 0, height: ROW_HEIGHT_ESTIMATE });
            })}
          </div>
        ) : highlightedLines
          ? highlightedLines.map((_, i) => renderLine(i))
          : plainLines.map((_, i) => renderLine(i))
        }
      </div>
    </div>
  );
}
