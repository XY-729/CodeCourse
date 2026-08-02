import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import hljs from "highlight.js";
import { isAndroidRuntime } from "../platform/runtime";
import type { CodeJumpRequest, ViewerRange, ViewerSelection } from "./CodeViewer";

type Props = {
  path: string | null; language: string; content: string;
  selectedRange?: ViewerRange | null; onSelectionChange?: (selection: ViewerSelection) => void;
  restoreLine?: number;
  jumpRequest?: CodeJumpRequest | null;
  onJumpConsumed?: (requestId: string) => void;
  onVisibleLineChange?: (line: number) => void;
  mobileSearchRequestId?: number;
};

const LARGE_FILE_BYTES = 400_000;
const LARGE_FILE_LINES = 8_000;
const VIRTUAL_FILE_LINES = 1_000;
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

export function calculateVisibleLine(scrollTop: number, rowHeight: number, totalLines: number): number {
  return clamp(Math.floor(Math.max(0, scrollTop) / rowHeight) + 1, 1, Math.max(1, totalLines));
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
  onSelectionChange,
  restoreLine = 1,
  jumpRequest,
  onJumpConsumed,
  onVisibleLineChange,
  mobileSearchRequestId,
}: Props) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const progressFillRef = useRef<HTMLDivElement | null>(null);
  const progressRafRef = useRef(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(-1);
  const [selectionAnchorLine, setSelectionAnchorLine] = useState<number | null>(null);
  const [selectionActive, setSelectionActive] = useState(false);
  const pendingSelectionRef = useRef<ViewerSelection | null>(null);
  const searchTimerRef = useRef<number>(0);
  const prevSearchRequestRef = useRef<number | undefined>(mobileSearchRequestId);
  const androidRuntime = isAndroidRuntime();

  const plainLines = useMemo(() => content.split("\n"), [content]);
  const totalLines = plainLines.length;
  const shouldVirtualize = totalLines > VIRTUAL_FILE_LINES;
  const shouldSkipHighlight = content.length > LARGE_FILE_BYTES || totalLines > LARGE_FILE_LINES;

  // search debounce
  useEffect(() => {
    if (!searchInput.trim()) { window.clearTimeout(searchTimerRef.current); setDebouncedQuery(""); setActiveMatch(-1); return; }
    const t = window.setTimeout(() => setDebouncedQuery(searchInput), 200);
    searchTimerRef.current = t;
    return () => window.clearTimeout(t);
  }, [searchInput]);

  // reset on file switch
  useEffect(() => {
    setSearchInput(""); setDebouncedQuery(""); setActiveMatch(-1); setSelectionAnchorLine(null); setSelectionActive(false);
  }, [content, path]);

  // external search trigger from unified reader header
  useEffect(() => {
    if (mobileSearchRequestId === undefined || mobileSearchRequestId === prevSearchRequestRef.current) return;
    prevSearchRequestRef.current = mobileSearchRequestId;
    setSearchOpen(true);
  }, [mobileSearchRequestId]);

  // Keep the native selection anchor mounted while a learner drags Android's
  // handles across a virtualized file. Only that anchor row is pinned; the
  // remaining 50,000-line document stays virtual.
  //
  // On Android, however, the WebView's native ActionMode (selection toolbar)
  // is destroyed by ANY React state update while a selection is in progress —
  // re-rendering the line DOM clears the Range and the toolbar vanishes. So the
  // Android branch only reads getSelection() into a ref, never calls setState
  // and never notifies the parent. The selected text is flushed up once the
  // selection is no longer active (user dismissed the toolbar), matching the
  // desktop "report after mouseup" semantics.
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const viewer = viewerRef.current;
      const active =
        viewer !== null
        && selection !== null
        && selection.anchorNode !== null
        && !selection.isCollapsed
        && viewer.contains(selection.anchorNode);

      if (!active) {
        // Selection dismissed, cleared, or never started.
        setSelectionAnchorLine(null);
        setSelectionActive(false);
        if (androidRuntime) {
          const pending = pendingSelectionRef.current;
          pendingSelectionRef.current = null;
          if (pending) {
            onSelectionChangeRef.current?.(pending);
          }
        }
        return;
      }

      const anchorElement = (selection.anchorNode.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode as Element
        : selection.anchorNode.parentElement)?.closest<HTMLElement>(".mobile-code-line");
      if (!anchorElement) {
        setSelectionActive(false);
        setSelectionAnchorLine(null);
        return;
      }
      const anchorLine = Number(anchorElement.dataset.line);
      if (!Number.isFinite(anchorLine)) return;

      if (androidRuntime) {
        // Read-only capture: do not setState, do not notify parent. Deferred
        // until the selection collapses to keep the native ActionMode alive.
        pendingSelectionRef.current = buildViewerSelection(
          selection,
          anchorLine,
          plainLines,
          language,
          path,
        );
        return;
      }

      setSelectionActive(true);
      setSelectionAnchorLine(shouldVirtualize ? anchorLine : null);

      const focusElement = selection.focusNode
        ? (selection.focusNode.nodeType === Node.ELEMENT_NODE
            ? selection.focusNode as Element
            : selection.focusNode.parentElement)?.closest<HTMLElement>(".mobile-code-line")
        : null;
      const focusLine = Number(focusElement?.dataset.line || anchorLine);
      const startLine = Math.min(anchorLine, focusLine);
      const endLine = Math.max(anchorLine, focusLine);
      const selectedText = selection.toString().trim();
      if (selectedText) {
        onSelectionChangeRef.current?.({
          sourceType: "file",
          sourcePath: path,
          selectedText,
          language,
          range: {
            startLineNumber: startLine,
            startColumn: 1,
            endLineNumber: endLine,
            endColumn: Math.max(1, plainLines[endLine - 1]?.length ?? 1),
          },
        });
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [androidRuntime, language, path, plainLines, shouldVirtualize]);

  // Helper shared by the desktop immediate-report and Android deferred paths.
  const onSelectionChangeRef = useRef(onSelectionChange);
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  function buildViewerSelection(
    selection: Selection,
    anchorLine: number,
    lines: string[],
    lang: string | undefined,
    sourcePath: string | null,
  ): ViewerSelection | null {
    const focusElement = selection.focusNode
      ? (selection.focusNode.nodeType === Node.ELEMENT_NODE
          ? selection.focusNode as Element
          : selection.focusNode.parentElement)?.closest<HTMLElement>(".mobile-code-line")
      : null;
    const focusLine = Number(focusElement?.dataset.line || anchorLine);
    const startLine = Math.min(anchorLine, focusLine);
    const endLine = Math.max(anchorLine, focusLine);
    const selectedText = selection.toString().trim();
    if (!selectedText) return null;
    return {
      sourceType: "file",
      sourcePath,
      selectedText,
      language: lang,
      range: {
        startLineNumber: startLine,
        startColumn: 1,
        endLineNumber: endLine,
        endColumn: Math.max(1, lines[endLine - 1]?.length ?? 1),
      },
    };
  }

  // highlighting
  const highlightedLines = useMemo(() => {
    if (shouldSkipHighlight) return null;
    const valid = language && hljs.getLanguage(language) ? language : undefined;
    if (!valid) return null;
    try {
      const lines = splitHighlightedToLines(hljs.highlight(content, { language: valid, ignoreIllegals: true }).value);
      while (lines.length < totalLines) lines.push(" ");
      return lines;
    } catch { return null; }
  }, [content, language, shouldSkipHighlight, totalLines]);

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

  // Reading-position progress bar: one rAF-throttled DOM write per frame,
  // never a React state update (Android ActionMode would be destroyed).
  const refreshScrollProgress = useCallback(() => {
    if (progressRafRef.current) return;
    progressRafRef.current = window.requestAnimationFrame(() => {
      progressRafRef.current = 0;
      const el = scrollRef.current;
      const fill = progressFillRef.current;
      if (!el || !fill) return;
      const range = el.scrollHeight - el.clientHeight;
      const p = range > 0 ? Math.min(1, Math.max(0, el.scrollTop / range)) : 0;
      fill.style.transform = `scaleX(${p})`;
      fill.style.opacity = range <= 0 ? "0" : "1";
    });
  }, []);

  // Initial progress refresh: content may not have laid out yet at mount,
  // so re-run whenever content/path changes and on mount.
  useEffect(() => {
    refreshScrollProgress();
  }, [content, path, refreshScrollProgress]);

  const scheduleVisibleLine = useCallback(() => {
    if (visLineRafRef.current) return;
    visLineRafRef.current = window.requestAnimationFrame(() => {
      visLineRafRef.current = 0;
      const el = scrollRef.current; if (!el) return;
      const vl = calculateVisibleLine(el.scrollTop, ROW_HEIGHT, totalLines);
      if (vl !== lastReportedRef.current) { lastReportedRef.current = vl; visibleLineCallbackRef.current?.(vl); }
    });
  }, [totalLines]);

  // SINGLE unified scroll handler
  const handleCodeScroll = useCallback(() => {
    const el = scrollRef.current; if (!el) return;
    if (shouldVirtualize) updateRange(el.scrollTop, el.clientHeight);
    scheduleVisibleLine();
    refreshScrollProgress();
  }, [shouldVirtualize, updateRange, scheduleVisibleLine, refreshScrollProgress]);

  type ScrollReason = "initial-restore" | "explicit-jump" | "search-result";
  const restoreLineAtMountRef = useRef(restoreLine);
  const restoreConsumedRef = useRef(false);
  const consumedJumpIdsRef = useRef(new Set<string>());

  const performProgrammaticScroll = useCallback((
    reason: ScrollReason,
    line: number,
    requestId?: string,
  ): boolean => {
    // A live native selection must not be disturbed: programmatic scrolling
    // while Android's drag handles are active would collapse the Range.
    // Android never sets selectionActive state (would re-render and kill the
    // ActionMode), so check the live DOM selection there.
    const nativeSelectionActive = androidRuntime
      ? Boolean(window.getSelection() && !window.getSelection()?.isCollapsed)
      : selectionActive;
    if (nativeSelectionActive && reason !== "search-result") return false;
    if (reason === "search-result" && nativeSelectionActive) {
      window.getSelection()?.removeAllRanges();
      setSelectionActive(false);
      setSelectionAnchorLine(null);
    }
    const el = scrollRef.current;
    if (!el) return false;
    scrollToLine(line, reason === "search-result" ? "center" : "start", el);
    if (reason !== "initial-restore") scheduleVisibleLine();
    if (import.meta.env.DEV) {
      console.debug("programmatic-scroll", {
        reason,
        path,
        line,
        requestId,
        timestamp: Date.now(),
      });
    }
    return true;
  }, [androidRuntime, path, scheduleVisibleLine, scrollToLine, selectionActive]);

  const performProgrammaticScrollRef = useRef(performProgrammaticScroll);
  performProgrammaticScrollRef.current = performProgrammaticScroll;

  // The restore position is a mount-time snapshot. Parent rerenders, content
  // refreshes and persisted learning-state updates cannot replay it.
  useEffect(() => {
    if (restoreConsumedRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (restoreConsumedRef.current) return;
      if (performProgrammaticScrollRef.current("initial-restore", restoreLineAtMountRef.current)) {
        restoreConsumedRef.current = true;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Explicit navigation is ID-based: the same line may be requested again
  // with a new ID, while content/theme rerenders cannot replay an old ID.
  useEffect(() => {
    if (!jumpRequest || consumedJumpIdsRef.current.has(jumpRequest.id)) return;
    if (!performProgrammaticScroll("explicit-jump", jumpRequest.line, jumpRequest.id)) return;
    // An explicit navigation on mount supersedes the passive restore snapshot.
    restoreConsumedRef.current = true;
    consumedJumpIdsRef.current.add(jumpRequest.id);
    onJumpConsumed?.(jumpRequest.id);
  }, [jumpRequest, onJumpConsumed, performProgrammaticScroll]);

  useEffect(() => () => {
    window.cancelAnimationFrame(visLineRafRef.current);
    window.cancelAnimationFrame(progressRafRef.current);
  }, []);

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
    performProgrammaticScroll("search-result", matches[next], `search:${next}`);
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
        {highlightedLines ? (
          <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightedLines[index] || " " }} />
        ) : (
          <code>{plainLines[index] || " "}</code>
        )}
      </div>
    );
  }

  return (
    <div ref={viewerRef} className="viewer mobile-code-viewer">
      <div className="mobile-code-progress" aria-hidden="true">
        <div ref={progressFillRef} className="mobile-code-progress-fill" />
      </div>
      {shouldVirtualize && <div className="mobile-code-notice">大文件：虚拟列表仅渲染可见行</div>}
      {searchOpen && (
        <div className="mobile-code-search">
          <Search size={14} /><input autoFocus value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="搜索" aria-label="在代码中搜索" />
          <span>{matches.length ? (activeMatch < 0 ? `0/${matches.length}` : `${activeMatch + 1}/${matches.length}`) : "0/0"}</span>
          <button className="icon-button" onClick={() => moveMatch(-1)} disabled={!matches.length} aria-label="上一个匹配"><ChevronUp size={15} /></button>
          <button className="icon-button" onClick={() => moveMatch(1)} disabled={!matches.length} aria-label="下一个匹配"><ChevronDown size={15} /></button>
          <button className="icon-button" onClick={() => { setSearchOpen(false); setSearchInput(""); setDebouncedQuery(""); }} aria-label="关闭搜索"><X size={15} /></button>
        </div>
      )}
      <div ref={scrollRef} className="mobile-code-scroll" onScroll={handleCodeScroll}>
        {shouldVirtualize ? (
          <div className="mobile-code-virtual-spacer" style={{ height: virt.totalHeight, position: "relative" }}>
            {[
              ...Array.from({ length: virt.end - virt.start }, (_, i) => virt.start + i),
              ...(selectionAnchorLine != null
                && (selectionAnchorLine - 1 < virt.start || selectionAnchorLine - 1 >= virt.end)
                ? [selectionAnchorLine - 1]
                : []),
            ].map((idx) => {
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
