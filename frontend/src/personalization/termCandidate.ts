export const TERM_CATEGORIES = [
  "concept",
  "api",
  "library",
  "framework",
  "protocol",
  "type",
  "symbol",
  "tool",
  "configuration",
  "algorithm",
  "data_structure",
  "other",
] as const;

export type TermCategory = typeof TERM_CATEGORIES[number];

export type TermSourceSpan = {
  text: string;
  start: number;
  end: number;
};

export type StructuredTermCandidate = {
  display_name: string;
  canonical_name: string;
  category: TermCategory;
  confidence: number;
  source_span: TermSourceSpan;
  source: string;
};

export type TermCandidateInput =
  | string
  | {
      display_name?: unknown;
      canonical_name?: unknown;
      category?: unknown;
      confidence?: unknown;
      source_span?: unknown;
      text?: unknown;
    };

const STOP_TERMS = new Set([
  "markdown", "github", "codecourse", "readme", "todo", "true", "false", "null",
  "项目", "文件", "代码", "课件", "回答", "问题", "学习", "用户", "模型", "内容",
]);
const COMMAND_RE = /^(?:sudo\s+|(?:apt|apt-get|npm|pnpm|yarn|pip|pip3|git|cmake|gradle|mvn|cargo|docker|kubectl|adb)\s+)/i;
const FILE_PATH_RE = /(?:[A-Za-z]:[\\/]|(?:^|[\s`])(?:\.\.?[\\/]|[/\\])|\.(?:py|pyi|ts|tsx|js|jsx|java|kt|cpp|cc|cxx|c|h|hpp|cs|go|rs|json|ya?ml|toml|md|txt|sh|bat|ps1)(?:$|[\s`]))/i;
const ERROR_RE = /(?:\b(?:fatal\s+)?error\s*:|\bwarning\s*:|traceback|exception\s*:|unrecognized command line option|undefined reference)/i;
const MARKDOWN_RE = /(?:```|^\s{0,3}(?:#{1,6}|[-+*>])\s|\[[^\]]*\]\([^)]*\)|!\[[^\]]*\])/m;
const SENTENCE_PUNCTUATION_RE = /[。！？!?；;，,]\s*$|[。！？!?；;]/;
const CODE_FENCE_RE = /```[\s\S]*?```/g;
const MARKDOWN_LINK_RE = /!?\[[^\]\n]+\]\([^)]+\)/g;

function balancedDelimiters(value: string): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{", ">": "<" };
  for (const char of value) {
    if ("([{<".includes(char)) stack.push(char);
    else if (pairs[char] && stack.pop() !== pairs[char]) return false;
  }
  return stack.length === 0;
}

export function cleanTermText(value: unknown): string {
  const original = String(value ?? "");
  const term = original
    .trim()
    .replace(/^[`*_#，。；：、]+|[`*_#，。；：、]+$/g, "")
    .replace(/\s+/g, " ");
  if (
    term.length < 2
    || term.length > 64
    || /^\d+$/.test(term)
    || STOP_TERMS.has(term.toLocaleLowerCase())
    || /[\r\n]/.test(original)
    || !balancedDelimiters(term)
    || SENTENCE_PUNCTUATION_RE.test(term)
    || COMMAND_RE.test(term)
    || FILE_PATH_RE.test(term)
    || /[\\/]/.test(term)
    || ERROR_RE.test(term)
    || MARKDOWN_RE.test(term)
    || /[=|$]/.test(term)
    || /[()]/.test(term)
    || /^(?:template|class|struct|def)\s/i.test(term)
  ) return "";
  const latinWords = term.match(/[A-Za-z][A-Za-z0-9_.:+#-]*/g) || [];
  if (latinWords.length > 5) return "";
  const chineseCount = (term.match(/[\u4e00-\u9fff]/g) || []).length;
  return chineseCount <= 16 ? term : "";
}

function excludedRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const regex of [CODE_FENCE_RE, MARKDOWN_LINK_RE]) {
    regex.lastIndex = 0;
    for (const match of content.matchAll(regex)) {
      const start = match.index ?? -1;
      if (start >= 0) ranges.push([start, start + match[0].length]);
    }
  }
  return ranges.sort((left, right) => left[0] - right[0]);
}

function isVisible(start: number, end: number, excluded: Array<[number, number]>): boolean {
  return excluded.every(([left, right]) => end <= left || start >= right);
}

function visibleSpan(
  content: string,
  text: string,
  requested?: Record<string, unknown>,
): TermSourceSpan | null {
  const excluded = excludedRanges(content);
  if (requested && ("start" in requested || "end" in requested)) {
    const start = Number(requested.start);
    const end = Number(requested.end);
    if (
      !Number.isInteger(start)
      || !Number.isInteger(end)
      || start < 0
      || end !== start + text.length
      || content.slice(start, end) !== text
      || !isVisible(start, end, excluded)
    ) return null;
    return { text, start, end };
  }
  let start = content.indexOf(text);
  while (start >= 0) {
    const end = start + text.length;
    if (isVisible(start, end, excluded)) return { text, start, end };
    start = content.indexOf(text, start + 1);
  }
  return null;
}

export function validateTermCandidate(
  input: TermCandidateInput,
  content: string,
  defaults: { source?: string; confidence?: number } = {},
): StructuredTermCandidate | null {
  const record = typeof input === "string" ? null : input;
  const rawDisplay = typeof input === "string"
    ? input
    : String(record?.display_name ?? record?.text ?? "");
  const displayName = cleanTermText(rawDisplay);
  const canonicalName = cleanTermText(
    typeof input === "string"
      ? input
      : String(record?.canonical_name ?? rawDisplay),
  );
  if (!displayName || !canonicalName) return null;

  const rawSpan = record?.source_span;
  const requestedSpan = rawSpan && typeof rawSpan === "object"
    ? rawSpan as Record<string, unknown>
    : undefined;
  if (requestedSpan && String(requestedSpan.text ?? "") !== rawDisplay.trim()) return null;
  const sourceSpan = visibleSpan(content, displayName, requestedSpan);
  if (!sourceSpan) return null;

  const requestedCategory = String(record?.category ?? "other").toLocaleLowerCase();
  const category = (TERM_CATEGORIES as readonly string[]).includes(requestedCategory)
    ? requestedCategory as TermCategory
    : "other";
  const rawConfidence = Number(record?.confidence ?? defaults.confidence ?? 0.7);
  if (!Number.isFinite(rawConfidence)) return null;

  return {
    display_name: displayName,
    canonical_name: canonicalName,
    category,
    confidence: Math.max(0, Math.min(1, rawConfidence)),
    source_span: sourceSpan,
    source: defaults.source ?? "model",
  };
}

export function isMalformedTermText(value: unknown): boolean {
  return !cleanTermText(value);
}
