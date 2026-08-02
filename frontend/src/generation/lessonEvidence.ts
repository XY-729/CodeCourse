export type LessonEvidenceRange = {
  path: string;
  startLine: number;
  endLine: number;
};

export type ReadableEvidenceFile = {
  path: string;
  content: string;
  language?: string;
};

export type LessonEvidenceAssembly = {
  content: string;
  included: string[];
  truncated: string[];
  read_failed: string[];
  budget_skipped: string[];
};

const DEFAULT_BUDGET = 24_000;
const PER_FILE_CAP = 12_000;
const MIN_FILE_SAMPLE = 1_600;

function compactCode(content: string, cap: number): string {
  if (cap <= 0) return "";
  if (content.length <= cap) return content;
  const effectiveCap = Math.max(0, cap - 1);
  const marker = "\n# ... 省略 ...\n";
  if (effectiveCap <= marker.length + 2) return content.slice(0, effectiveCap);
  const available = effectiveCap - marker.length;
  const head = Math.max(1, Math.floor(available * 0.58));
  return `${content.slice(0, head)}${marker}${content.slice(-(available - head))}`;
}

function rangeExcerpt(content: string, ranges: LessonEvidenceRange[], cap: number): string {
  const lines = content.split(/\r?\n/);
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const range of ranges) {
    const start = Math.max(1, range.startLine);
    const end = Math.min(lines.length, Math.max(start, range.endLine));
    const key = `${start}:${end}`;
    if (seen.has(key) || start > lines.length) continue;
    seen.add(key);
    const part = `# lines ${start}-${end}\n${lines.slice(start - 1, end).join("\n")}`;
    const candidate = [...parts, part].join("\n\n");
    if (candidate.length > cap) {
      if (!parts.length) return compactCode(part, cap);
      break;
    }
    parts.push(part);
  }
  return parts.join("\n\n");
}

/** Pure evidence renderer shared by Android generation and contract tests. */
export function assembleLessonFileEvidence(
  files: ReadableEvidenceFile[],
  ranges: LessonEvidenceRange[] = [],
  readFailed: string[] = [],
  budget = DEFAULT_BUDGET,
): LessonEvidenceAssembly {
  const result: LessonEvidenceAssembly = {
    content: "",
    included: [],
    truncated: [],
    read_failed: [...readFailed],
    budget_skipped: [],
  };
  if (!files.length || budget <= 0) {
    result.budget_skipped.push(...files.map((file) => file.path));
    return result;
  }

  const framing = files.reduce(
    (total, file) => total + `### ${file.path}\n\`\`\`${file.language || ""}\n\n\`\`\`\n\n`.length,
    0,
  );
  const available = budget - framing;
  if (available <= 0) {
    result.budget_skipped.push(...files.map((file) => file.path));
    return result;
  }

  const base = Math.min(MIN_FILE_SAMPLE, Math.max(1, Math.floor(available / files.length)));
  const allocations = files.map((file) => Math.min(file.content.length, base, PER_FILE_CAP));
  let remaining = available - allocations.reduce((total, value) => total + value, 0);
  for (let index = 0; index < files.length && remaining > 0; index += 1) {
    const extra = Math.min(
      Math.max(0, files[index].content.length - allocations[index]),
      PER_FILE_CAP - allocations[index],
      remaining,
    );
    allocations[index] += extra;
    remaining -= extra;
  }

  const rangesByPath = new Map<string, LessonEvidenceRange[]>();
  for (const range of ranges) {
    const current = rangesByPath.get(range.path) || [];
    current.push(range);
    rangesByPath.set(range.path, current);
  }

  const blocks: string[] = [];
  let used = 0;
  files.forEach((file, index) => {
    const cap = allocations[index];
    if (cap <= 0) {
      result.budget_skipped.push(file.path);
      return;
    }
    const matchedRanges = rangesByPath.get(file.path) || [];
    const excerpt = rangeExcerpt(file.content, matchedRanges, cap) || compactCode(file.content, cap);
    const block = `### ${file.path}\n\`\`\`${file.language || ""}\n${excerpt}\n\`\`\``;
    const separator = blocks.length ? 2 : 0;
    if (used + separator + block.length > budget) {
      result.budget_skipped.push(file.path);
      return;
    }
    blocks.push(block);
    used += separator + block.length;
    result.included.push(file.path);
    if (excerpt.length < file.content.length) result.truncated.push(file.path);
  });
  result.content = blocks.join("\n\n");
  return result;
}
