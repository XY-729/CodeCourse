export const TEACHING_CONTRACT = `<teaching_coverage_contract>
在正文前另输出单行 TEACHING: [...]，与 TERMS 独立，记录所有实际讲解的知识点及具体范围，不受 12 个术语限制。
每项为 {"concept":"规范知识点","aspect":"具体覆盖范围","kind":"explained","core":true,"dimension":"conceptual","scope":"global","quote":"正文中逐字出现的唯一完整讲解段落"}。
kind 为 mentioned/brief/explained/planned；总纲中待学习目标为 planned，不算讲过。
dimension 为 conceptual/code_reading/implementation/debugging/transfer。scope 通用知识用 global，项目私有符号用 project。
core 只标本次核心目标。复用历史讲解时输出 REUSE: ["提供的历史记录id"]，程序会验证并附链接。
同范围已有解释只用一句承接；用户仍有疑问、要求重讲或新范围则正常解释。元数据不在正文解释。
</teaching_coverage_contract>`;

export function coverageBody(content: string): string {
  return content.replace(/<!-- codecourse-teaching: (.*?) -->/gs, (match) => "\n".repeat((match.match(/\n/g) ?? []).length));
}
export function teachingMetadata(raw: string): string {
  const lines: string[] = [];
  const entries: unknown[] = [];
  const reuse: string[] = [];
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
      const value: unknown = match[2].length <= 250_000 ? JSON.parse(match[2]) : null;
      if (!Array.isArray(value)) continue;
      if (match[1] === "TEACHING") { found = true; entries.push(...value.filter((v) => v && typeof v === "object" && !Array.isArray(v))); }
      else reuse.push(...value.filter((v): v is string => typeof v === "string"));
    } catch { /* Metadata is never rendered as prose. */ }
  }
  const encode = (items: unknown[]) => JSON.stringify(items).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return lines.join("\n").trim() + (found ? `\n\n<!-- codecourse-teaching: ${encode(entries)} -->` : "")
    + (reuse.length ? `\n\n<!-- codecourse-reuse: ${encode(reuse)} -->` : "");
}

export function coverageItems(content: string): { items: Record<string, unknown>[]; valid: boolean } {
  const items: Record<string, unknown>[] = [];
  let valid = false;
  for (const match of content.matchAll(/<!-- codecourse-teaching: (.*?) -->/gs)) {
    try {
      const value: unknown = JSON.parse(match[1]);
      if (Array.isArray(value)) { valid = true; items.push(...value); }
    } catch { /* Older edited metadata is incomplete, not mastery. */ }
  }
  return { items, valid };
}
