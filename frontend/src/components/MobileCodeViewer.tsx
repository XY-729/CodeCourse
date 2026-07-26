import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import hljs from "highlight.js";
import type { ViewerRange, ViewerSelection } from "./CodeViewer";

type Props = {
  path: string | null; language: string; content: string;
  selectedRange?: ViewerRange | null; onSelectionChange?: (selection: ViewerSelection) => void;
  initialLine?: number; onVisibleLineChange?: (line: number) => void;
};

const LARGE_FILE_BYTES = 400_000;
const LARGE_FILE_LINES = 8_000;
const VIRTUAL_OVERSCAN = 20;
const ROW_HEIGHT = 24;
const ALLOWED_SPAN_CLASS_RE = /^hljs-/;

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// ====================================================================
//  Safe highlight → per-line HTML strings
// ====================================================================

export function splitHighlightedToLines(html: string): string[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const lines: string[] = []; let cur = ""; const tagStack: string[] = [];

  function flush() {
    let suffix = "";
    for (let j = tagStack.length - 1; j >= 0; j--) suffix += `</span>`;
    lines.push(cur + suffix); cur = "";
    for (let j = 0; j < tagStack.length; j++) cur += tagStack[j];
  }
  function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function walk(n: Node) {
    if (n.nodeType === Node.TEXT_NODE) {
      const parts = (n.textContent ?? "").split("\n");
      for (let i = 0; i < parts.length; i++) { cur += esc(parts[i]); if (i < parts.length - 1) flush(); }
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    if (el.tagName === "BR") { flush(); return; }
    if (el.tagName === "SPAN") {
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(c => ALLOWED_SPAN_CLASS_RE.test(c)).join(" ");
      const tag = cls ? `<span class="${cls}">` : "<span>";
      cur += tag; tagStack.push(tag);
      for (const c of Array.from(el.childNodes)) walk(c);
      tagStack.pop(); cur += "</span>";
      return;
    }
    for (const c of Array.from(el.childNodes)) walk(c);
  }
  for (const c of Array.from(doc.body.childNodes)) walk(c);
  flush();
  return lines;
}

// ====================================================================
//  Render one highlighted line to ReactNode
// ====================================================================

function renderHighlightedLine(html: string): ReactNode[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const nodes: ReactNode[] = []; let idx = 0;
  function walk(el: Node, out: ReactNode[]) {
    if (el.nodeType === Node.TEXT_NODE) { out.push(el.textContent ?? ""); return; }
    if (el.nodeType !== Node.ELEMENT_NODE) return;
    const e = el as Element;
    if (e.tagName === "SPAN") {
      const cls = (e.getAttribute("class") ?? "").split(/\s+/).filter(c => ALLOWED_SPAN_CLASS_RE.test(c)).join(" ");
      const ch: ReactNode[] = [];
      for (const c of Array.from(e.childNodes)) walk(c, ch);
      out.push(<span key={idx++} className={cls || undefined}>{ch}</span>);
    } else { for (const c of Array.from(e.childNodes)) walk(c, out); }
  }
  walk(doc.body, nodes);
  return nodes.length > 0 ? nodes : [html || " "];
}

// ====================================================================
//  Exported virtual list helpers (tests import these)
// ====================================================================

export function computeVirtualRange(scrollTop: number, clientHeight: number, totalLines: number, rowH: number, overscan: number) {
  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const visible = Math.ceil(clientHeight / rowH);
  const end = clamp(start + visible + overscan * 2, 0, totalLines);
  return { start, end };
}

export function calcScrollTop(lineNum: number, align: "start" | "center", clientHeight: number, totalLines: number, rowH: number) {
  const zero = clamp(lineNum - 1, 0, totalLines - 1);
  let targetTop: number;
  if (align === "center") targetTop = zero * rowH - clientHeight / 2 + rowH / 2;
  else targetTop = zero * rowH;
  return clamp(targetTop, 0, Math.max(0, totalLines * rowH - clientHeight));
}

// ====================================================================
//  Virtual list hook
// ====================================================================

type VirtualState = { start: number; end: number; totalHeight: number };

function useVirtualLines(totalLines: number, rowH: number) {
  const [state, setState] = useState<VirtualState>(() => {
    const visible = Math.ceil(600 / rowH);
    return { start: 0, end: visible + VIRTUAL_OVERSCAN * 2, totalHeight: totalLines * rowH };
  });
  const rafRef = useRef(0);

  const updateRange = useCallback((scrollTop: number, clientHeight: number) => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      const r = computeVirtualRange(scrollTop, clientHeight, totalLines, rowH, VIRTUAL_OVERSCAN);
      setState({ ...r, totalHeight: totalLines * rowH });
    });
  }, [totalLines, rowH]);

  const scrollToLine = useCallback((lineNum: number, align: "start" | "center", el: HTMLDivElement) => {
    el.scrollTop = calcScrollTop(lineNum, align, el.clientHeight, totalLines, rowH);
    // Force immediate range update so the target line is actually rendered
    const r = computeVirtualRange(el.scrollTop, el.clientHeight, totalLines, rowH, VIRTUAL_OVERSCAN);
    setState({ ...r, totalHeight: totalLines * rowH });
  }, [totalLines, rowH]);

  useEffect(() => () => window.cancelAnimationFrame(rafRef.current), []);

  return { state, updateRange, scrollToLine };
}

// ====================================================================
//  Component
// ====================================================================

export default function MobileCodeViewer({
  path, language, content, selectedRange,
  onSelectionChange: _onSelectionChange,
  initialLine, onVisibleLineChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(-1);
  const searchTimerRef = useRef<number>(0);

  const plainLines = useMemo(() => content.split("\n"), [content]);
  const totalLines = plainLines.length;
  const isLargeFile = content.length > LARGE_FILE_BYTES || totalLines > LARGE_FILE_LINES;

  // search debounce
  useEffect(() => {
    if (!searchInput.trim()) { window.clearTimeout(searchTimerRef.current); setDebouncedQuery(""); setActiveMatch(-1); return; }
    const t = window.setTimeout(() => setDebouncedQuery(searchInput), 200);
    searchTimerRef.current = t;
    return () => window.clearTimeout(t);
  }, [searchInput]);

  // reset on file switch
  useEffect(() => {
    setSearchInput(""); setDebouncedQuery(""); setActiveMatch(-1);
  }, [content, path]);

  // highlighting
  const highlightedLines = useMemo(() => {
    if (isLargeFile) return null;
    const valid = language && hljs.getLanguage(language) ? language : undefined;
    if (!valid) return null;
    try {
      const lines = splitHighlightedToLines(hljs.highlight(content, { language: valid, ignoreIllegals: true }).value);
      while (lines.length < totalLines) lines.push(" ");
      return lines;
    } catch { return null; }
  }, [content, language, isLargeFile, totalLines]);

  // search matches
  const matches = useMemo(() => {
    const n = debouncedQuery.trim().toLocaleLowerCase();
    if (!n) return [];
    return plainLines.flatMap((l, i) => l.toLocaleLowerCase().includes(n) ? [i + 1] : []);
  }, [plainLines, debouncedQuery]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  useEffect(() => {
    if (!matches.length) setActiveMatch(-1);
  }, [matches.length]);

  // virtual list
  const { state: virt, updateRange, scrollToLine } = useVirtualLines(totalLines, ROW_HEIGHT);

  // visible line reporting (rAF throttled)
  const visibleLineCallbackRef = useRef(onVisibleLineChange);
  useEffect(() => { visibleLineCallbackRef.current = onVisibleLineChange; }, [onVisibleLineChange]);
  const lastReportedRef = useRef(0);
  const visLineRafRef = useRef(0);

  const scheduleVisibleLine = useCallback(() => {
    if (visLineRafRef.current) return;
    visLineRafRef.current = window.requestAnimationFrame(() => {
      visLineRafRef.current = 0;
      const el = scrollRef.current; if (!el) return;
      const vl = clamp(Math.floor(el.scrollTop / ROW_HEIGHT) + 1, 1, totalLines);
      if (vl !== lastReportedRef.current) { lastReportedRef.current = vl; visibleLineCallbackRef.current?.(vl); }
    });
  }, [totalLines]);

  // SINGLE unified scroll handler
  const handleCodeScroll = useCallback(() => {
    const el = scrollRef.current; if (!el) return;
    if (isLargeFile) updateRange(el.scrollTop, el.clientHeight);
    scheduleVisibleLine();
  }, [isLargeFile, updateRange, scheduleVisibleLine]);

  // initialLine jump
  const initialJumpedRef = useRef(false);
  useEffect(() => {
    if (initialJumpedRef.current) return;
    if (!initialLine || initialLine < 1) return;
    const frame = window.requestAnimationFrame(() => {
      const el = scrollRef.current; if (!el) return;
      if (isLargeFile) scrollToLine(initialLine, "start", el);
      else el.querySelector<HTMLElement>(`[data-line="${initialLine}"]`)?.scrollIntoView({ block: "start" });
      initialJumpedRef.current = true;
      scheduleVisibleLine();
    });
    return () => { window.cancelAnimationFrame(frame); initialJumpedRef.current = false; };
  }, [content, initialLine, path, isLargeFile, scrollToLine, scheduleVisibleLine]);

  // moveMatch
  function moveMatch(delta: number) {
    if (!matches.length) return;
    let next: number;
    if (activeMatch < 0) {
      next = delta > 0 ? 0 : matches.length - 1;
    } else {
      next = (activeMatch + delta + matches.length) % matches.length;
    }
    setActiveMatch(next);
    const el = scrollRef.current; if (!el) return;
    if (isLargeFile) scrollToLine(matches[next], "center", el);
    else el.querySelector<HTMLElement>(`[data-line="${matches[next]}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    scheduleVisibleLine();
  }

  // renderLine
  function renderLine(index: number, pos?: { position: "absolute"; top: number; left: 0; right: 0; height: number }) {
    const ln = index + 1;
    const anchored = selectedRange && ln >= selectedRange.startLineNumber && ln <= selectedRange.endLineNumber;
    const matched = matchSet.has(ln);
    const active = activeMatch >= 0 && matches.length > 0 && ln === matches[activeMatch];
    return (
      <div className={`mobile-code-line ${anchored ? "selection-anchor" : ""} ${matched ? "search-match" : ""} ${active ? "search-match-active" : ""}`}
        data-line={ln} key={index} style={pos}>
        <span className="mobile-line-number">{ln}</span>
        <code className={highlightedLines ? "hljs" : ""}>
          {highlightedLines ? renderHighlightedLine(highlightedLines[index] || " ") : [plainLines[index] || " "]}
        </code>
      </div>
    );
  }

  return (
    <div className="viewer mobile-code-viewer">
      <div className="viewer-header">
        <span>{path ?? "代码"}</span>
        <div className="viewer-actions">
          <strong>{isLargeFile ? `${language} · 大文件` : language}</strong>
          <button className="icon-button" onClick={() => setSearchOpen(o => !o)} title="搜索"><Search size={15} /></button>
        </div>
      </div>
      {isLargeFile && <div className="mobile-code-notice">大文件：虚拟列表仅渲染可见行</div>}
      {searchOpen && (
        <div className="mobile-code-search">
          <Search size={14} /><input autoFocus value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="搜索" />
          <span>{matches.length ? (activeMatch < 0 ? `0/${matches.length}` : `${activeMatch + 1}/${matches.length}`) : "0/0"}</span>
          <button className="icon-button" onClick={() => moveMatch(-1)} disabled={!matches.length}><ChevronUp size={15} /></button>
          <button className="icon-button" onClick={() => moveMatch(1)} disabled={!matches.length}><ChevronDown size={15} /></button>
          <button className="icon-button" onClick={() => { setSearchOpen(false); setSearchInput(""); setDebouncedQuery(""); }}><X size={15} /></button>
        </div>
      )}
      <div ref={scrollRef} className="mobile-code-scroll" onScroll={handleCodeScroll}>
        {isLargeFile ? (
          <div style={{ height: virt.totalHeight, position: "relative" }}>
            {Array.from({ length: virt.end - virt.start }, (_, i) => {
              const idx = virt.start + i;
              return renderLine(idx, { position: "absolute", top: idx * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT });
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
