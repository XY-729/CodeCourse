import { useCallback, useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import type { CodeJumpRequest, ViewerRange, ViewerSelection } from "./CodeViewer";

type Props = {
  path: string | null;
  language: string;
  content: string;
  selectedRange?: ViewerRange | null;
  onSelectionChange?: (selection: ViewerSelection) => void;
  restoreLine?: number;
  jumpRequest?: CodeJumpRequest | null;
  onJumpConsumed?: (requestId: string) => void;
  onVisibleLineChange?: (line: number) => void;
};

const CODE_FONT_SIZE_KEY = "codecourse.desktop.codeFontSize";
const CODE_FONT_SIZE_BOUNDS = { min: 8, max: 36 };

function loadCodeFontSize(): number {
  try {
    const v = localStorage.getItem(CODE_FONT_SIZE_KEY);
    if (v != null) return Math.max(CODE_FONT_SIZE_BOUNDS.min, Math.min(CODE_FONT_SIZE_BOUNDS.max, Number(v) || 14));
  } catch { /* noop */ }
  return 14;
}

function saveCodeFontSize(size: number) {
  try { localStorage.setItem(CODE_FONT_SIZE_KEY, String(size)); } catch { /* noop */ }
}

function currentEditorTheme() {
  return document.documentElement.dataset.theme === "dark" ? "vs-dark" : "vs";
}

export default function MonacoCodeViewer({
  path,
  language,
  content,
  selectedRange,
  onSelectionChange,
  restoreLine = 1,
  jumpRequest,
  onJumpConsumed,
  onVisibleLineChange,
}: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const decorationIds = useRef<string[]>([]);
  const [editorTheme, setEditorTheme] = useState(currentEditorTheme);
  const [codeFontSize, setCodeFontSize] = useState(loadCodeFontSize);
  const fontSizeRef = useRef(codeFontSize);
  fontSizeRef.current = codeFontSize;

  const handleFontSizeChange = useCallback((size: number) => {
    const clamped = Math.max(CODE_FONT_SIZE_BOUNDS.min, Math.min(CODE_FONT_SIZE_BOUNDS.max, Math.round(size)));
    setCodeFontSize(clamped);
    saveCodeFontSize(clamped);
    fontSizeRef.current = clamped;
  }, []);

  useEffect(() => {
    const updateTheme = () => setEditorTheme(currentEditorTheme());
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  function setPersistentSelection(range: ViewerRange | null) {
    const editor = editorRef.current; const monaco = monacoRef.current; if (!editor || !monaco) return;
    decorationIds.current = editor.deltaDecorations(decorationIds.current, range ? [{
      range: new monaco.Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn),
      options: { className: "monaco-persistent-selection", inlineClassName: "monaco-persistent-selection-inline", stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
    }] : []);
  }

  useEffect(() => { setPersistentSelection(selectedRange ?? null); }, [selectedRange, content, path]);
  const consumedJumpIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !jumpRequest || consumedJumpIdsRef.current.has(jumpRequest.id)) return;
    const line = Math.max(1, Math.round(jumpRequest.line));
    if (jumpRequest.align === "center") editor.revealLineInCenter(line);
    else editor.revealLine(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    consumedJumpIdsRef.current.add(jumpRequest.id);
    onJumpConsumed?.(jumpRequest.id);
  }, [jumpRequest, onJumpConsumed]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor; monacoRef.current = monaco; setPersistentSelection(selectedRange ?? null);
    const line = Math.max(1, Math.round(restoreLine));
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.onDidScrollChange((event) => {
      if (!event.scrollTopChanged) return;
      const visible = editor.getVisibleRanges()[0];
      if (visible) onVisibleLineChange?.(visible.startLineNumber);
    });
    editor.onDidChangeCursorSelection((event) => {
      const model = editor.getModel(); if (!model || event.selection.isEmpty()) return;
      const selectedText = model.getValueInRange(event.selection).trim(); if (!selectedText) return;
      const range = { startLineNumber: event.selection.startLineNumber, startColumn: event.selection.startColumn, endLineNumber: event.selection.endLineNumber, endColumn: event.selection.endColumn };
      const editorRect = editor.getDomNode()?.getBoundingClientRect();
      const endPosition = editor.getScrolledVisiblePosition({ lineNumber: range.endLineNumber, column: range.endColumn });
      const anchorRect = editorRect && endPosition ? {
        left: editorRect.left + endPosition.left,
        top: editorRect.top + endPosition.top,
        right: editorRect.left + endPosition.left + 2,
        bottom: editorRect.top + endPosition.top + endPosition.height,
        width: 2,
        height: endPosition.height,
      } : undefined;
      setPersistentSelection(range); onSelectionChange?.({ sourceType: "file", sourcePath: path, selectedText, language, range, anchorRect });
    });
    editor.onDidChangeConfiguration((event) => {
      if (event.hasChanged(monaco.editor.EditorOption.fontSize)) {
        const fs = editor.getOption(monaco.editor.EditorOption.fontSize);
        handleFontSizeChange(fs);
      }
    });
  };

  return <div className="viewer code-viewer"><div className="viewer-header"><span>{path ?? "代码"}</span><strong>{language}</strong></div><Editor height="100%" language={language} value={content} theme={editorTheme} onMount={handleMount} options={{ readOnly: true, minimap: { enabled: false }, fontSize: codeFontSize, mouseWheelZoom: true, lineNumbers: "on", scrollBeyondLastLine: false, wordWrap: "on", automaticLayout: true, renderValidationDecorations: "off", quickSuggestions: false, suggestOnTriggerCharacters: false }} /></div>;
}
