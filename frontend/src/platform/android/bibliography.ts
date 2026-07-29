import rawBibliography from "./curated-bibliography.json";

export type CuratedBook = {
  id: string;
  title: string;
  edition: string;
  authors: string[];
  topics: string[];
};

export type BibliographySelection = CuratedBook & {
  topics: string[];
};

const BOOKS = rawBibliography as CuratedBook[];
const BOOKS_BY_ID = new Map(BOOKS.map((book) => [book.id, book]));

export function bibliographyForPrompt(): string {
  return BOOKS
    .map((book) => `- ${book.id}: ${book.title} | allowed topics: ${book.topics.join(", ")}`)
    .join("\n");
}

export function bibliographyMetadataInstruction(): string {
  return `

教材元数据要求：
- 正文中不要自行写书名、作者、章节号、页码或版次。
- 在正文最后输出一行 \`BIBLIOGRAPHY: [...]\`。
- 数组元素格式为 \`{"id":"允许书目 ID","topics":["该书允许主题中的原文"]}\`。
- 只能从下列目录逐字选择 ID 和主题；没有匹配时输出 \`BIBLIOGRAPHY: []\`。

${bibliographyForPrompt()}`;
}

export function validateBibliographySelections(value: unknown): BibliographySelection[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: BibliographySelection[] = [];
  for (const raw of value.slice(0, 8)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const id = String(entry.id || "").trim();
    const book = BOOKS_BY_ID.get(id);
    if (!book || seen.has(id)) continue;
    const allowed = new Map(book.topics.map((topic) => [topic.toLocaleLowerCase(), topic]));
    const requested = Array.isArray(entry.topics)
      ? entry.topics.map(String)
      : typeof entry.topics === "string" ? [entry.topics] : [];
    const topics = requested
      .map((topic) => allowed.get(topic.trim().toLocaleLowerCase()))
      .filter((topic): topic is string => Boolean(topic))
      .slice(0, 4);
    result.push({ ...book, topics });
    seen.add(id);
  }
  return result;
}

export function bibliographyMarkdown(value: unknown): string {
  const selections = validateBibliographySelections(value);
  if (!selections.length) {
    return "## 教材参照\n\n本课未列出能够由内置书目确认的教材。";
  }
  const lines = [
    "## 教材参照",
    "",
    "> 书名、作者和主题来自 CodeCourse 内置校验书目；课件未读取教材原文。",
    "",
  ];
  for (const book of selections) {
    const edition = book.edition ? `，${book.edition}` : "";
    const topics = book.topics.length ? `；相关主题：${book.topics.join("、")}` : "";
    lines.push(`- 《${book.title}》${edition} — ${book.authors.join(", ")}${topics}`);
  }
  return lines.join("\n");
}

export function parseBibliographyMetadata(
  rawContent: string,
): { content: string; selections: BibliographySelection[] } {
  let rawSelections: unknown = [];
  const kept: string[] = [];
  for (const line of rawContent.split(/\r?\n/)) {
    const match = line.match(/^\s*BIBLIOGRAPHY\s*[:：]\s*(\[.*\])\s*$/i);
    if (!match) {
      kept.push(line);
      continue;
    }
    try {
      rawSelections = JSON.parse(match[1]);
    } catch {
      rawSelections = [];
    }
  }
  return {
    content: kept.join("\n").trim(),
    selections: validateBibliographySelections(rawSelections),
  };
}

export function appendValidatedBibliography(
  markdown: string,
  selections: unknown,
): string {
  const lines: string[] = [];
  let skipLevel: number | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.trim().match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      if (heading[2].includes("教材") || heading[2].includes("参考书")) {
        skipLevel = level;
        continue;
      }
      if (skipLevel !== null && level <= skipLevel) skipLevel = null;
    }
    if (skipLevel !== null) continue;
    if (line.includes("《") && line.includes("》")) continue;
    lines.push(line);
  }
  const section = bibliographyMarkdown(selections)
    .replace("## 教材参照", "## 总体教材参照");
  return `${lines.join("\n").trim()}\n\n${section}\n`;
}
