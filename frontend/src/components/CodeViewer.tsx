import Editor from "@monaco-editor/react";

export type ViewerSelection = {
  sourceType: "file" | "course";
  sourcePath: string | null;
  selectedText: string;
  language?: string;
};

type Props = {
  path: string | null;
  language: string;
  content: string;
  onSelectionChange?: (selection: ViewerSelection) => void;
};

export default function CodeViewer({ path, language, content, onSelectionChange }: Props) {
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
        onMount={(editor) => {
          editor.onDidChangeCursorSelection((event) => {
            const model = editor.getModel();
            if (!model || event.selection.isEmpty()) {
              return;
            }
            const selectedText = model.getValueInRange(event.selection).trim();
            if (!selectedText) {
              return;
            }
            onSelectionChange?.({
              sourceType: "file",
              sourcePath: path,
              selectedText,
              language,
            });
          });
        }}
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
