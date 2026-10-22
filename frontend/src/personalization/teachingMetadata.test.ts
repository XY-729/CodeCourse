import { describe, expect, it } from "vitest";
import { coverageBody, coverageItems, readTeachingCoverage, readingBody, teachingMetadata } from "./teachingMetadata";

const manifest = {
  schema_version: 2 as const,
  concepts: [
    { ref: "cpp", existing_id: "concept-cpp", name: "C++", domain: "cpp", scope: "global" as const, parent_ref: null, aliases: ["cpp"] },
    { ref: "stl", existing_id: null, name: "STL 容器", domain: "cpp", scope: "global" as const, parent_ref: "cpp", aliases: [] },
    { ref: "vector", existing_id: null, name: "std::vector", domain: "cpp", scope: "global" as const, parent_ref: "stl", aliases: ["vector"] },
  ],
  coverage: [{
    concept_ref: "vector", aspect: "连续存储与扩容", kind: "explained" as const,
    dimension: "conceptual" as const, core: true, quote: "vector 在连续内存中保存元素，扩容时重新分配。",
  }],
  terms: [{ concept_ref: "vector", text: "vector", quote: "vector 在连续内存中保存元素" }],
  placement_changes: [],
};

describe("teaching coverage metadata", () => {
  it("keeps every taught item independently of the twelve term limit", () => {
    const items = Array.from({ length: 24 }, (_, i) => ({ concept: `知识${i}`, quote: `这是知识${i}的完整解释。` }));
    const raw = `TEACHING: ${JSON.stringify(items)}\n# 内容\n${items.map((v) => v.quote).join("\n")}`;
    const content = teachingMetadata(raw);
    expect(coverageItems(content).items).toHaveLength(24);
    expect(content).not.toContain("TEACHING:");
    expect(coverageBody(content)).not.toContain("codecourse-teaching");
  });

  it("persists a v2 manifest object instead of an array", () => {
    const body = "vector 在连续内存中保存元素，扩容时重新分配。";
    const content = teachingMetadata(`TEACHING: ${JSON.stringify(manifest)}\n${body}`);
    expect(content).toContain("<!-- codecourse-teaching: {");
    expect(content).toContain('"schema_version":2');
    const read = readTeachingCoverage(content);
    expect(read.status).toBe("ready");
    expect(read.manifest?.concepts.map((c) => c.ref)).toEqual(["cpp", "stl", "vector"]);
    expect(read.manifest?.terms).toHaveLength(1);
    expect(readTeachingCoverage(content).legacy).toBe(false);
    // Reading surfaces still hide the machine data.
    expect(readingBody(content)).toContain(body);
    expect(readingBody(content)).not.toContain("schema_version");
  });

  it("prefers a valid v2 manifest over a legacy array in the same body", () => {
    const content = [
      '<!-- codecourse-teaching: [{"concept":"x","quote":"旧数据。"}] -->',
      `<!-- codecourse-teaching: ${JSON.stringify(manifest)} -->`,
      "旧数据。",
    ].join("\n");
    const read = readTeachingCoverage(content);
    expect(read.status).toBe("ready");
    expect(read.manifest?.schema_version).toBe(2);
  });

  it("reports legacy and invalid metadata instead of silently mixing them", () => {
    expect(readTeachingCoverage('<!-- codecourse-teaching: [{"concept":"x"}] -->').status).toBe("legacy");
    expect(readTeachingCoverage('<!-- codecourse-teaching: {"schema_version":2,"concepts":[]} -->').status).toBe("invalid");
    expect(readTeachingCoverage("# 无元数据").status).toBe("missing");
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

  it("does not treat a fenced TEACHING example as metadata", () => {
    const raw = ["正文", "```text", `TEACHING: ${JSON.stringify(manifest)}`, "```"].join("\n");
    expect(readTeachingCoverage(teachingMetadata(raw)).status).toBe("missing");
  });

  it("removes every internal marker from the reading body without moving lines", () => {
    const content = [
      "## 按课生成课件",
      "<!-- CODECOURSE_LESSON_LINKS_START -->",
      "- [生成第 1 课](https://codecourse.local/generate-lesson/1?title=x)",
      "<!-- CODECOURSE_LESSON_LINKS_END -->",
      "<!-- CODECOURSE_OUTLINE -->",
      '<!-- codecourse-reuse: ["passage-1"] -->',
      `<!-- codecourse-teaching: ${JSON.stringify(manifest)} -->`,
      "vector 在连续内存中保存元素，扩容时重新分配。",
    ].join("\n");
    const body = readingBody(content);
    expect(body).not.toContain("CODECOURSE_");
    expect(body).not.toContain("codecourse-reuse");
    expect(body).not.toContain("codecourse-teaching");
    expect(body).not.toContain('"concept"');
    expect(body.split("\n")).toHaveLength(content.split("\n").length);
    expect(body).toContain("vector 在连续内存中保存元素，扩容时重新分配。");
    expect(body).toContain("按课生成课件");
  });
});
