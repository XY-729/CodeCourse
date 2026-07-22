import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
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

export default function MobileCodeViewer({ path, language, content, selectedRange, onSelectionChange, initialLine, onVisibleLineChange }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef(0);
  const visibleLineCallbackRef = useRef(onVisibleLineChange);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const plainLines = useMemo(() => content.split("\n"), [content]);
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

  useEffect(() => () => window.cancelAnimationFrame(scrollFrameRef.current), []);

  // Android relies entirely on native WebView ActionMode for text selection.
  // No onPointerUp / selectionchange listener — React state updates during
  // selection would re-render <code> children and destroy the native Range.
  // MainActivity reads window.getSelection() when the user taps "Ask".

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

  return <div className="viewer mobile-code-viewer">
    <div className="viewer-header">
      <span>{path ?? "代码"}</span>
      <div className="viewer-actions">
        <strong>{language}</strong>
        <button className="icon-button" onClick={() => setSearchOpen((open) => !open)} title="搜索"><Search size={15} /></button>
      </div>
    </div>
    {searchOpen ? <div className="mobile-code-search">
      <Search size={14} />
      <input autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setActiveMatch(0); }} placeholder="搜索当前文件" />
      <span>{matches.length ? `${activeMatch + 1}/${matches.length}` : "0/0"}</span>
      <button className="icon-button" onClick={() => moveMatch(-1)} disabled={!matches.length}><ChevronUp size={15} /></button>
      <button className="icon-button" onClick={() => moveMatch(1)} disabled={!matches.length}><ChevronDown size={15} /></button>
      <button className="icon-button" onClick={() => { setSearchOpen(false); setQuery(""); }}><X size={15} /></button>
    </div> : null}
    <div ref={scrollRef} className="mobile-code-scroll" onScroll={captureVisibleLine}>
      {plainLines.map((line, index) => {
        const lineNumber = index + 1;
        const anchored = selectedRange && lineNumber >= selectedRange.startLineNumber && lineNumber <= selectedRange.endLineNumber;
        const matched = matchSet.has(lineNumber);
        return <div className={`mobile-code-line ${anchored ? "selection-anchor" : ""} ${matched ? "search-match" : ""}`} data-line={lineNumber} key={index}><span className="mobile-line-number">{lineNumber}</span><code>{line || " "}</code></div>;
      })}
    </div>
  </div>;
}
