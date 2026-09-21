import { describe, expect, it } from "vitest";
import { coverageBody, coverageItems, teachingMetadata } from "./teachingMetadata";

describe("teaching coverage metadata", () => {
  it("keeps every taught item independently of the twelve term limit", () => {
    const items = Array.from({ length: 24 }, (_, i) => ({ concept: `知识${i}`, quote: `这是知识${i}的完整解释。` }));
    const raw = `TEACHING: ${JSON.stringify(items)}\n# 内容\n${items.map((v) => v.quote).join("\n")}`;
    const content = teachingMetadata(raw);
    expect(coverageItems(content).items).toHaveLength(24);
    expect(content).not.toContain("TEACHING:");
    expect(coverageBody(content)).not.toContain("codecourse-teaching");
  });
  it("preserves code examples and strips invalid reserved metadata", () => {
    const raw = "TEACHING: invalid\n```text\nTEACHING: []\n```\n正文";
    expect(teachingMetadata(raw)).toBe("```text\nTEACHING: []\n```\n正文");
    expect(coverageItems(teachingMetadata(raw)).valid).toBe(false);
  });
  it("escapes HTML comment terminators in machine data", () => {
    const content = teachingMetadata('TEACHING: [{"concept":"x","quote":"--> <script>"}]\n正文');
    expect(content.match(/-->/g)).toHaveLength(1);
    expect(coverageItems(content).items[0].quote).toBe("--> <script>");
  });
});
