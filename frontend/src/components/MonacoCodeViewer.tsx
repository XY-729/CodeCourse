import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import type { ViewerRange, ViewerSelection } from "./CodeViewer";

type Props = {
  path: string | null;
  language: string;
  content: string;
  selectedRange?: ViewerRange | null;
  onSelectionChange?: (selection: ViewerSelection) => void;
  onContextMenu?: (payload: { clientX: number; clientY: number; selectedText: string; sourcePath: string | null }) => void;
  initialLine?: number;
  onVisibleLineChange?: (line: number) => void;
};

function currentEditorTheme() {
  return document.documentElement.dataset.theme === "dark" ? "vs-dark" : "vs";
}

export default function MonacoCodeViewer({ path, language, content, selectedRange, onSelectionChange, onContextMenu, initialLine = 1, onVisibleLineChange }: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const decorationIds = useRef<string[]>([]);
  const selectedRangeRef = useRef<ViewerRange | null>(selectedRange ?? null);
  const [editorTheme, setEditorTheme] = useState(currentEditorTheme);

  useEffect(() => {
    const updateTheme = () => setEditorTheme(currentEditorTheme());
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  function setPersistentSelection(range: ViewerRange | null) {
    const editor = editorRef.current; const monaco = monacoRef.current; if (!editor || !monaco) return;
    selectedRangeRef.current = range;
    decorationIds.current = editor.deltaDecorations(decorationIds.current, range ? [{
      range: new monaco.Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn),
      options: { className: "monaco-persistent-selection", inlineClassName: "monaco-persistent-selection-inline", stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
    }] : []);
  }

  useEffect(() => { setPersistentSelection(selectedRange ?? null); }, [selectedRange, content, path]);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const line = Math.max(1, Math.round(initialLine));
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
  }, [initialLine, path]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor; monacoRef.current = monaco; setPersistentSelection(selectedRange ?? null);
    editor.revealLineInCenter(Math.max(1, Math.round(initialLine)));
    editor.setPosition({ lineNumber: Math.max(1, Math.round(initialLine)), column: 1 });
    editor.onDidScrollChange((event) => {
      if (!event.scrollTopChanged) return;
      const visible = editor.getVisibleRanges()[0];
      if (visible) onVisibleLineChange?.(visible.startLineNumber);
    });
    editor.onDidChangeCursorSelection((event) => {
      const model = editor.getModel(); if (!model || event.selection.isEmpty()) return;
      const selectedText = model.getValueInRange(event.selection).trim(); if (!selectedText) return;
      const range = { startLineNumber: event.selection.startLineNumber, startColumn: event.selection.startColumn, endLineNumber: event.selection.endLineNumber, endColumn: event.selection.endColumn };
      setPersistentSelection(range); onSelectionChange?.({ sourceType: "file", sourcePath: path, selectedText, language, range });
    });
    editor.onContextMenu((event) => {
      const model = editor.getModel(); if (!model) return;
      const liveSelection = editor.getSelection();
      let selectedText = liveSelection && !liveSelection.isEmpty() ? model.getValueInRange(liveSelection).trim() : "";
      if (!selectedText && selectedRangeRef.current) selectedText = model.getValueInRange(new monaco.Range(selectedRangeRef.current.startLineNumber, selectedRangeRef.current.startColumn, selectedRangeRef.current.endLineNumber, selectedRangeRef.current.endColumn)).trim();
      if (!selectedText) return; event.event.preventDefault(); event.event.stopPropagation();
      onContextMenu?.({ clientX: event.event.browserEvent.clientX, clientY: event.event.browserEvent.clientY, selectedText, sourcePath: path });
    });
  };

  return <div className="viewer code-viewer"><div className="viewer-header"><span>{path ?? "代码"}</span><strong>{language}</strong></div><Editor height="100%" language={language} value={content} theme={editorTheme} onMount={handleMount} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 14, lineNumbers: "on", scrollBeyondLastLine: false, wordWrap: "on", automaticLayout: true, renderValidationDecorations: "off", quickSuggestions: false, suggestOnTriggerCharacters: false }} /></div>;
}
