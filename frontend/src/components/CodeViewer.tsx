import { useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";

export type ViewerRange = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

export type ViewerSelection = {
  sourceType: "file" | "course";
  sourcePath: string | null;
  selectedText: string;
  language?: string;
  range?: ViewerRange;
};

type Props = {
  path: string | null;
  language: string;
  content: string;
  selectedRange?: ViewerRange | null;
  onSelectionChange?: (selection: ViewerSelection) => void;
  onContextMenu?: (payload: { clientX: number; clientY: number; selectedText: string; sourcePath: string | null }) => void;
};

export default function CodeViewer({ path, language, content, selectedRange, onSelectionChange, onContextMenu }: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const decorationIds = useRef<string[]>([]);
  const selectedRangeRef = useRef<ViewerRange | null>(selectedRange ?? null);

  function setPersistentSelection(range: ViewerRange | null) {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) {
      return;
    }
    selectedRangeRef.current = range;
    decorationIds.current = editor.deltaDecorations(
      decorationIds.current,
      range
        ? [
            {
              range: new monaco.Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn),
              options: {
                className: "monaco-persistent-selection",
                inlineClassName: "monaco-persistent-selection-inline",
                stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
              },
            },
          ]
        : [],
    );
  }

  useEffect(() => {
    setPersistentSelection(selectedRange ?? null);
  }, [selectedRange, content, path]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setPersistentSelection(selectedRange ?? null);

    editor.onDidChangeCursorSelection((event) => {
      const model = editor.getModel();
      if (!model || event.selection.isEmpty()) {
        return;
      }
      const selectedText = model.getValueInRange(event.selection).trim();
      if (!selectedText) {
        return;
      }
      const range = {
        startLineNumber: event.selection.startLineNumber,
        startColumn: event.selection.startColumn,
        endLineNumber: event.selection.endLineNumber,
        endColumn: event.selection.endColumn,
      };
      setPersistentSelection(range);
      onSelectionChange?.({
        sourceType: "file",
        sourcePath: path,
        selectedText,
        language,
        range,
      });
    });

    editor.onContextMenu((event) => {
      const model = editor.getModel();
      if (!model) {
        return;
      }
      const liveSelection = editor.getSelection();
      let selectedText = liveSelection && !liveSelection.isEmpty() ? model.getValueInRange(liveSelection).trim() : "";
      if (!selectedText && selectedRangeRef.current) {
        const range = selectedRangeRef.current;
        selectedText = model
          .getValueInRange(new monaco.Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn))
          .trim();
      }
      if (!selectedText) {
        return;
      }
      event.event.preventDefault();
      event.event.stopPropagation();
      onContextMenu?.({
        clientX: event.event.browserEvent.clientX,
        clientY: event.event.browserEvent.clientY,
        selectedText,
        sourcePath: path,
      });
    });
  };

  return (
    <div className="viewer code-viewer">
      <div className="viewer-header">
        <span>{path ?? "代码"}</span>
        <strong>{language}</strong>
      </div>
      <Editor
        height="100%"
        language={language}
        value={content}
        theme="vs-dark"
        onMount={handleMount}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          automaticLayout: true,
          renderValidationDecorations: "off",
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
        }}
      />
    </div>
  );
}
