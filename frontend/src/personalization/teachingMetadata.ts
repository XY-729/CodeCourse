import { parseTeachingManifest, serializeTeachingManifest, type TeachingManifestV2 } from "./teachingManifest";

/**
 * Single authoritative teaching-metadata contract (Common contract §4).
 * The model streams the body first and then one line `TEACHING: {…}` whose
 * object carries concepts, coverage and the complete term candidate pool.
 * Legacy `TEACHING: [...]` and `TERMS: [...]` lines stay readable so old
 * documents keep working, but they are never mixed into a valid v2 manifest.
 */
export const TEACHING_CONTRACT = `<teaching_coverage_contract>
正文写完后，在末尾另起一行输出单行 TEACHING: {"schema_version":2,...}，不要用代码围栏，也不要在正文里解释元数据。
对象字段：concepts（本次涉及的概念及归属）、coverage（实际讲解范围）、terms（完整技术术语候选池）、可选 placement_changes（已有节点的补父或重挂提案）。
concepts 每项为 {"ref":"本次内唯一引用","existing_id":null或上下文中真实存在的概念ID,"name":"规范名","domain":"领域","scope":"global|project","parent_ref":null或同一对象内的 ref,"aliases":["别名"]}。
- 先复用上下文完整树中语义合适的已有概念并填 existing_id；不要重复创建同义概念。
- 细粒度概念缺少合理父概念时，在同一次响应里补出父概念或祖先链，直到接到已有合理祖先或合理的新领域根；不要默认新建独立根，也不要补到“知识/科学”这类无教学意义的泛层。
- 只有真实存在过的父子归属才写 parent_ref。结构祖先可以没有 coverage，不能因此算作讲过或已理解。
coverage 每项为 {"concept_ref":"ref","aspect":"具体范围","kind":"planned|mentioned|brief|explained","dimension":"conceptual|code_reading|implementation|debugging|transfer","core":true|false,"quote":"正文中逐字出现且可唯一定位的讲解片段"}。
- planned 表示计划学习，不算讲过；mention/brief/explained 必须能由 quote 在正文中定位。
- 不限 12 项，按实际讲解范围完整记录。
terms 每项为 {"concept_ref":"ref","text":"正文原词","quote":"含该原词的正文上下文"}。
- 这是完整候选池：正文里所有可能让读者卡住的技术术语都要列出，不按数量、段落或全文密度删减。
- text 必须是正文可见文本中的原词；quote 必须包含 text 且可唯一定位。
不要输出熟悉度、权重、概率或 understood 等字段，这些只由用户行为与反馈决定。
</teaching_coverage_contract>`;

export function coverageBody(content: string): string {
  return content.replace(/<!-- codecourse-teaching: (.*?) -->/gs, (match) => "\n".repeat((match.match(/\n/g) ?? []).length));
}

/**
 * Markdown kept in course files also carries internal markers: teaching
 * coverage, reuse references and outline anchors. They drive indexing,
 * evidence and lesson links, and react-markdown would otherwise print them as
 * escaped text, so every reading surface renders this body instead. Line
 * breaks are preserved so data-source-line jumps still match the file.
 */
export function readingBody(content: string): string {
  return coverageBody(content)
    .replace(/<!-- codecourse-reuse: (.*?) -->/gs, (match) => "\n".repeat((match.match(/\n/g) ?? []).length))
    .replace(/<!-- CODECOURSE_[A-Z_]+ -->/g, "");
}

function encode(items: unknown[]): string {
  return JSON.stringify(items).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

/**
 * Convert a streamed answer into the persisted Markdown: reserved `TEACHING`
 * and `REUSE` lines become hidden comments, code examples stay untouched.
 * A v2 object is preserved as a v2 object; a legacy array stays an array.
 */
export function teachingMetadata(raw: string): string {
  const lines: string[] = [];
  const entries: unknown[] = [];
  const reuse: string[] = [];
  let manifest: TeachingManifestV2 | null = null;
  let found = false;
  let fence = "";
  for (const line of raw.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
    }
    const match = fence ? null : line.match(/^\s*(TEACHING|REUSE):\s*(.*)$/);
    if (!match) { lines.push(line); continue; }
    try {
      const value: unknown = match[2].length <= 2_000_000 ? JSON.parse(match[2]) : null;
      if (match[1] === "REUSE") {
        if (!Array.isArray(value)) continue;
        reuse.push(...value.filter((v): v is string => typeof v === "string"));
        continue;
      }
      if (Array.isArray(value)) {
        found = true;
        entries.push(...value.filter((v) => v && typeof v === "object" && !Array.isArray(v)));
        continue;
      }
      if (value && typeof value === "object" && (value as { schema_version?: unknown }).schema_version === 2) {
        found = true;
        manifest = value as TeachingManifestV2;
      }
    } catch { /* Metadata is never rendered as prose. */ }
  }
  const body = lines.join("\n").trim();
  const hidden = manifest
    ? `<!-- codecourse-teaching: ${serializeTeachingManifest(manifest)} -->`
    : found ? `<!-- codecourse-teaching: ${encode(entries)} -->` : "";
  return body + (hidden ? `\n\n${hidden}` : "")
    + (reuse.length ? `\n\n<!-- codecourse-reuse: ${encode(reuse)} -->` : "");
}

export type TeachingCoverageRead =
  | { status: "ready"; manifest: TeachingManifestV2; legacy: false }
  | { status: "legacy"; manifest: null; legacy: true }
  | { status: "missing"; manifest: null; legacy: false }
  | { status: "invalid"; manifest: null; legacy: false };

/** Dual read: a valid v2 manifest wins over any legacy array in the same file. */
export function readTeachingCoverage(content: string): TeachingCoverageRead {
  const parsed = parseTeachingManifest(content, { validate_quotes: false });
  if (parsed.status === "ready" && parsed.manifest) return { status: "ready", manifest: parsed.manifest, legacy: false };
  if (parsed.status === "legacy") return { status: "legacy", manifest: null, legacy: true };
  if (parsed.status === "invalid") return { status: "invalid", manifest: null, legacy: false };
  return { status: "missing", manifest: null, legacy: false };
}

/**
 * Legacy helper kept for older readers. New code should use
 * `readTeachingCoverage`, which understands both formats.
 */
export function coverageItems(content: string): { items: Record<string, unknown>[]; valid: boolean } {
  const items: Record<string, unknown>[] = [];
  let valid = false;
  for (const match of content.matchAll(/<!-- codecourse-teaching: (.*?) -->/gs)) {
    try {
      const value: unknown = JSON.parse(match[1]);
      if (Array.isArray(value)) {
        valid = true;
        items.push(...value);
        continue;
      }
      if (value && typeof value === "object" && (value as { schema_version?: unknown }).schema_version === 2) {
        const coverage = (value as { coverage?: unknown }).coverage;
        if (!Array.isArray(coverage)) continue;
        valid = true;
        items.push(...coverage.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item)));
      }
    } catch { /* Older edited metadata is incomplete, not mastery. */ }
  }
  return { items, valid };
}
