import Editor from "@monaco-editor/react";

type Props = {
  path: string | null;
  language: string;
  content: string;
};

export default function CodeViewer({ path, language, content }: Props) {
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
