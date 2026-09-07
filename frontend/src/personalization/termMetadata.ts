import { validateTermCandidate, type StructuredTermCandidate, type TermCandidateInput } from "./termCandidate";

export const TERM_SELECTION_RULES = `陌生术语由你结合当前学习画像、问题和正文语境自主选择。
已确认掌握的概念不要标；未记录不等于不会，问过或讲过不等于掌握。只选择理解当前内容确有帮助、用户可能需要解释的独立技术名词。
不要选择整句、强调句、标题、临时变量、示例输出、函数调用/签名、命令、路径或代码块中的词。行内代码中的技术名词可以选择。
正文原词必须逐字出现在普通正文或行内代码中，不能仅出现在标题、已有链接或代码块。不要为了凑数量选择术语，允许 0 个。`;

export function termMetadataInstruction(limit = 12): string {
  return `<term_output_contract>\n${TERM_SELECTION_RULES}\n在 Markdown 正文前输出单行 TERMS: [...]，最多 ${limit} 项，数组项为 {"display_name":"正文原词","canonical_name":"规范名称","category":"concept","confidence":0.9,"source_span":{"text":"正文原词"}}。没有合适术语时输出 TERMS: []。元数据后再输出正文标题，正文中不要重复元数据。\n</term_output_contract>`;
}

/** Strip reserved metadata outside code examples, even when its JSON is invalid. */
export function parseTermMetadata(raw: string): { content: string; terms: TermCandidateInput[]; valid: boolean } {
  const lines = raw.split(/\r?\n/);
  const visible: string[] = [];
  const terms: TermCandidateInput[] = [];
  let valid = false;
  let fence: { marker: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      visible.push(line);
      if (fenceMatch && fenceMatch[1][0] === fence.marker && fenceMatch[1].length >= fence.length
        && line.slice(fenceMatch[0].length).trim() === "") fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
      visible.push(line);
      continue;
    }
    const metadata = line.match(/^ {0,3}TERMS\s*:\s*(.*)$/i);
    if (!metadata) { visible.push(line); continue; }
    let json = metadata[1].trim();
    const metadataFence = json.match(/^(`{3,}|~{3,})(?:json)?\s*$/i);
    if (metadataFence) {
      const collected: string[] = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (next.trim() === metadataFence[1]) { index += 1; break; }
        if (!/^\s*(?:[\[\]{}",]|$)/.test(next)) break;
        collected.push(next); index += 1;
      }
      json = collected.join("\n");
    } else if (!json || (json.startsWith("[") && !json.endsWith("]"))) {
      while (index + 1 < lines.length && /^\s*(?:[\[\]{}",]|$)/.test(lines[index + 1])) {
        json += `\n${lines[++index]}`;
        if (lines[index].trim() === "]") break;
      }
    }
    if (json.length > 16_000) continue;
    try {
      const parsed: unknown = JSON.parse(json);
      if (Array.isArray(parsed) && parsed.length <= 12) {
        valid ||= parsed.length === 0 || parsed.some((item) => typeof item === "string" || (item != null && typeof item === "object" && !Array.isArray(item)));
        terms.push(...parsed.filter((item): item is TermCandidateInput => typeof item === "string"
          || (item != null && typeof item === "object" && !Array.isArray(item))));
      }
    } catch { /* Invalid metadata must neither become prose nor create candidates. */ }
  }
  return { content: visible.join("\n").trim(), terms, valid };
}

/** Final document assembly can add headings; locate approved original words again. */
export function anchorModelTerms(inputs: TermCandidateInput[], content: string): StructuredTermCandidate[] {
  const seen = new Set<string>();
  return inputs.map((input) => validateTermCandidate(input, content, { source: "model", confidence: 0.94 }))
    .filter((term): term is StructuredTermCandidate => term !== null)
    .filter((term) => {
      const key = term.canonical_name.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 24);
}

export function relocateModelTerms(terms: StructuredTermCandidate[], content: string): StructuredTermCandidate[] {
  return anchorModelTerms(terms.map((term) => ({ ...term, source_span: { text: term.display_name } })), content);
}

export function validatedModelSelection(parsed: ReturnType<typeof parseTermMetadata>): StructuredTermCandidate[] | undefined {
  const terms = anchorModelTerms(parsed.terms, parsed.content);
  return parsed.valid && (parsed.terms.length === 0 || terms.length > 0) ? terms : undefined;
}

export function selectTermScanContent(content: string, limit = 80_000): string {
  const lines: string[] = [];
  let fence: { marker: string; length: number } | null = null;
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (match && match[1][0] === fence.marker && match[1].length >= fence.length
        && line.slice(match[0].length).trim() === "") fence = null;
      continue;
    }
    if (match) {
      fence = { marker: match[1][0], length: match[1].length };
      lines.push("[代码示例已省略；不要从代码示例中选择术语]");
    } else lines.push(line);
  }
  const readable = lines.join("\n");
  if (readable.length <= limit) return readable;
  const sections = readable.split(/(?=^#{1,6}\s)/m).filter(Boolean);
  const budget = Math.max(1, Math.floor(limit / sections.length));
  return sections.map((section) => section.slice(0, budget)).join("\n");
}
