import { useEffect, useMemo, useRef, useState } from "react";
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default function MobileCodeViewer({ path, language, content, selectedRange, onSelectionChange, initialLine, onVisibleLineChange }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef(0);
  const visibleLineCallbackRef = useRef(onVisibleLineChange);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const plainLines = useMemo(() => content.split("\n"), [content]);
  const highlightedLines = useMemo(() => {
    const validLang = language && hljs.getLanguage(language) ? language : undefined;
    const rawLines = content.split("\n");
    if (!validLang) return rawLines.map((line) => escapeHtml(line || " "));
    try {
      const fullResult = hljs.highlight(content, { language: validLang, ignoreIllegals: true });
      // Split highlighted HTML by newlines, tracking open tags across lines
      const htmlLines = fullResult.value.split("\n");
      // Match any unclosed span tags and carry them across line breaks
      const openTags: string[] = [];
      return htmlLines.map((lineHtml, i) => {
        // Close any currently open tags
        let prefix = "";
        for (let j = openTags.length - 1; j >= 0; j--) {
          prefix += `<span class="${openTags[j]}">`;
        }
        // Track open/close spans in this line
        const opens = lineHtml.match(/<span class="([^"]*)">/g) ?? [];
        const closes = lineHtml.match(/<\/span>/g) ?? [];
        const diff = opens.length - closes.length;
        if (diff > 0) {
          for (let k = opens.length - diff; k < opens.length; k++) {
            const cls = opens[k].match(/class="([^"]*)"/)?.[1] ?? "";
            openTags.push(cls);
          }
        } else if (diff < 0) {
          openTags.splice(openTags.length + diff);
        }
        // Close open tags at end of line
        let suffix = "";
        for (let j = 0; j < openTags.length; j++) {
          suffix += "</span>";
        }
        return prefix + (lineHtml || " ") + suffix;
      });
    } catch {
      return rawLines.map((line) => escapeHtml(line || " "));
    }
  }, [content, language]);
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
      {plainLines.map((_line, index) => {
        const lineNumber = index + 1;
        const anchored = selectedRange && lineNumber >= selectedRange.startLineNumber && lineNumber <= selectedRange.endLineNumber;
        const matched = matchSet.has(lineNumber);
        return <div className={`mobile-code-line ${anchored ? "selection-anchor" : ""} ${matched ? "search-match" : ""}`} data-line={lineNumber} key={index}><span className="mobile-line-number">{lineNumber}</span><code className="hljs" dangerouslySetInnerHTML={{ __html: highlightedLines[index] || " " }} /></div>;
      })}
    </div>
  </div>;
}
