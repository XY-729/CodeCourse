export const HIGHLIGHT_LANGUAGE_ALIASES: Record<string, string> = {
  bash: "shell", sh: "shell", zsh: "shell", js: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", py: "python", yml: "yaml", h: "c", hpp: "cpp",
  cs: "csharp", rb: "ruby", kt: "kotlin", kts: "kotlin", ps1: "powershell",
  text: "plaintext", txt: "plaintext",
};

export const HIGHLIGHT_LANGUAGES = new Set([
  "bash", "c", "cmake", "cpp", "csharp", "css", "dart", "diff", "dockerfile", "dos",
  "go", "gradle", "graphql", "groovy", "html", "ini", "java", "javascript", "json",
  "kotlin", "latex", "lua", "makefile", "markdown", "php", "plaintext", "powershell",
  "protobuf", "python", "r", "ruby", "rust", "scala", "scss", "shell", "sql", "swift",
  "stata", "toml", "typescript", "xml", "yaml",
]);

export function normalizeHighlightLanguage(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!key) return "plaintext";
  const normalized = HIGHLIGHT_LANGUAGE_ALIASES[key] ?? key;
  return HIGHLIGHT_LANGUAGES.has(normalized) ? normalized : "plaintext";
}
