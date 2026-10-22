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
  concept_ref?: string;
  concept_id?: string;
  quote?: string;
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
      concept_ref?: unknown;
      concept_id?: unknown;
      quote?: unknown;
      source?: unknown;
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
    .replace(/^[`*_，。；：、]+|[`*_，。；：、]+$/g, "")
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

type LocationNode = { type: string; value?: string; children?: LocationNode[];
  position?: { start: { offset?: number }; end: { offset?: number } } };

/** All matching and anchoring uses Markdown locations, including headings and tables. */
export function visibleTermRanges(content: string, text: string): Array<[number, number]> {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(content) as LocationNode;
  const ranges: Array<[number, number]> = [];
  const visit = (node: LocationNode): void => {
    if (["code", "html", "link", "linkReference", "definition", "image", "imageReference"].includes(node.type)) return;
    if (node.type === "text" || node.type === "inlineCode") {
      if (node.type === "inlineCode" && node.value !== text) return;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start != null && end != null) ranges.push([start, end]);
      return;
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  return ranges;
}

function visibleSpan(
  content: string,
  text: string,
  requested?: Record<string, unknown>,
  quote?: string,
): TermSourceSpan | null {
  const allowed = visibleTermRanges(content, text);
  const quoteStart = quote ? content.indexOf(quote) : -1;
  if (quote && (quoteStart < 0 || content.indexOf(quote, quoteStart + 1) >= 0 || !quote.includes(text))) return null;
  const isVisible = (start: number, end: number) => allowed.some(([left, right]) => start >= left && end <= right)
    && (!quote || (start >= quoteStart && end <= quoteStart + quote.length));
  const wholeWord = (start: number, end: number) => !(
    (/[A-Za-z0-9_]/.test(text[0]) && /[A-Za-z0-9_]/.test(content[start - 1] || ""))
    || (/[A-Za-z0-9_]/.test(text[text.length - 1]) && /[A-Za-z0-9_]/.test(content[end] || ""))
  );
  if (requested && ("start" in requested || "end" in requested)) {
    const start = Number(requested.start);
    const end = Number(requested.end);
    if (
      !Number.isInteger(start)
      || !Number.isInteger(end)
      || start < 0
      || end !== start + text.length
      || content.slice(start, end) !== text
      || !isVisible(start, end)
      || !wholeWord(start, end)
    ) return null;
    return { text, start, end };
  }
  let start = content.indexOf(text);
  while (start >= 0) {
    const end = start + text.length;
    if (isVisible(start, end) && wholeWord(start, end)) return { text, start, end };
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
  const source = defaults.source ?? (typeof record?.source === "string" ? record.source : "model");
  // A validated manifest already carries semantic selection. Local legacy
  // heuristics must not discard names such as R, Markdown or C# from it.
  const clean = source === "manifest"
    ? (value: string) => value.trim() && !/[\r\n]/.test(value) ? value.trim() : ""
    : cleanTermText;
  const displayName = clean(rawDisplay);
  const canonicalName = clean(
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
  const quote = typeof record?.quote === "string" ? record.quote : undefined;
  const sourceSpan = visibleSpan(content, displayName, requestedSpan, quote);
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
    source,
    ...(typeof record?.concept_ref === "string" ? { concept_ref: record.concept_ref } : {}),
    ...(typeof record?.concept_id === "string" ? { concept_id: record.concept_id } : {}),
    ...(quote ? { quote } : {}),
  };
}

export function isMalformedTermText(value: unknown): boolean {
  return !cleanTermText(value);
}
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

