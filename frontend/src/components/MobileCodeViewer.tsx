import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import type { ViewerRange, ViewerSelection } from "./CodeViewer";

const languages = { bash, shell: bash, c, cpp, css, go, java, javascript, json, markdown, python, rust, typescript, html: xml, xml };
Object.entries(languages).forEach(([name, definition]) => { if (!hljs.getLanguage(name)) hljs.registerLanguage(name, definition); });

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
  const lines = useMemo(() => {
    const supported = hljs.getLanguage(language) ? language : "plaintext";
    return content.split("\n").map((line) => supported === "plaintext"
      ? line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      : hljs.highlight(line, { language: supported, ignoreIllegals: true }).value);
  }, [content, language]);
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

  function captureVisibleLine() {
    if (scrollFrameRef.current) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = 0;
      const container = scrollRef.current;
      const firstRow = container?.querySelector<HTMLElement>("[data-line]");
      if (!container || !firstRow) return;
      const rowHeight = Math.max(1, firstRow.offsetHeight);
      const visibleLine = Math.min(lines.length, Math.max(1, Math.floor(container.scrollTop / rowHeight) + 1));
      visibleLineCallbackRef.current?.(visibleLine);
    });
  }

  function moveMatch(delta: number) {
    if (!matches.length) return;
    const next = (activeMatch + delta + matches.length) % matches.length;
    setActiveMatch(next);
    scrollRef.current?.querySelector<HTMLElement>(`[data-line="${matches[next]}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function captureSelection() {
    const selection = window.getSelection(); const selectedText = selection?.toString().trim() || ""; if (!selectedText || !selection?.anchorNode || !selection.focusNode) return;
    const anchor = (selection.anchorNode.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentElement : selection.anchorNode as Element)?.closest<HTMLElement>("[data-line]");
    const focus = (selection.focusNode.nodeType === Node.TEXT_NODE ? selection.focusNode.parentElement : selection.focusNode as Element)?.closest<HTMLElement>("[data-line]");
    const start = Number(anchor?.dataset.line || 1); const end = Number(focus?.dataset.line || start);
    onSelectionChange?.({ sourceType: "file", sourcePath: path, selectedText, language, range: { startLineNumber: Math.min(start, end), startColumn: 1, endLineNumber: Math.max(start, end), endColumn: 1 } });
  }

  return <div className="viewer mobile-code-viewer"><div className="viewer-header"><span>{path ?? "代码"}</span><div className="viewer-actions"><strong>{language}</strong><button className="icon-button" onClick={() => setSearchOpen((open) => !open)} title="在文件中搜索"><Search size={15} /></button></div></div>{searchOpen ? <div className="mobile-code-search"><Search size={14} /><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActiveMatch(0); }} placeholder="搜索当前文件" /><span>{matches.length ? `${activeMatch + 1}/${matches.length}` : "0/0"}</span><button className="icon-button" onClick={() => moveMatch(-1)} disabled={!matches.length} title="上一个"><ChevronUp size={15} /></button><button className="icon-button" onClick={() => moveMatch(1)} disabled={!matches.length} title="下一个"><ChevronDown size={15} /></button><button className="icon-button" onClick={() => { setSearchOpen(false); setQuery(""); }} title="关闭搜索"><X size={15} /></button></div> : null}<div ref={scrollRef} className="mobile-code-scroll" onScroll={captureVisibleLine} onPointerUp={captureSelection}>{lines.map((line, index) => {
    const lineNumber = index + 1;
    const anchored = selectedRange && lineNumber >= selectedRange.startLineNumber && lineNumber <= selectedRange.endLineNumber;
    const matched = matchSet.has(lineNumber);
    return <div className={`mobile-code-line ${anchored ? "selection-anchor" : ""} ${matched ? "search-match" : ""}`} data-line={lineNumber} key={index}><span className="mobile-line-number">{lineNumber}</span><code dangerouslySetInnerHTML={{ __html: line || " " }} /></div>;
  })}</div></div>;
}
