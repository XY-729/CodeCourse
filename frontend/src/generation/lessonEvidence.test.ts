import { describe, expect, it } from "vitest";

import { assembleLessonFileEvidence } from "./lessonEvidence";

describe("assembleLessonFileEvidence", () => {
  it("reserves evidence space for every ranked file", () => {
    const files = ["a.ts", "b.ts", "c.ts"].map((path) => ({
      path,
      language: "typescript",
      content: `// ${path}\n${"const value = 1;\n".repeat(500)}`,
    }));
    const result = assembleLessonFileEvidence(files, [], [], 1800);
    expect(result.included).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(result.truncated).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(result.content.length).toBeLessThanOrEqual(1800);
  });

  it("prefers indexed line ranges and reports read failures", () => {
    const content = Array.from({ length: 400 }, (_, index) => `line_${index + 1}`).join("\n");
    const result = assembleLessonFileEvidence(
      [{ path: "large.ts", language: "typescript", content }],
      [{ path: "large.ts", startLine: 250, endLine: 252 }],
      ["missing.ts"],
      240,
    );
    expect(result.content).toContain("# lines 250-252");
    expect(result.content).toContain("line_250");
    expect(result.content).not.toContain("line_1\n");
    expect(result.read_failed).toEqual(["missing.ts"]);
  });
});
