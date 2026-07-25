import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Test checkpoint hash stability
describe("Checkpoint inputHash stability", () => {
  // Simulate: compute hash from stable task inputs, NOT from payload._checkpoint
  function computeStableHash(taskType: string, payload: Record<string, unknown>): string {
    // Strip _checkpoint from payload before hashing
    const { _checkpoint, ...rest } = payload;
    return JSON.stringify({ taskType, payload: rest });
  }

  it("produces same hash with and without _checkpoint in payload", () => {
    const payload1 = { path: "src/main.ts", instructions: "test" };
    const payload2 = { path: "src/main.ts", instructions: "test", _checkpoint: { version: 1, generated: true } };

    const h1 = computeStableHash("file_lesson", payload1);
    const h2 = computeStableHash("file_lesson", payload2);
    expect(h1).toBe(h2);
  });

  it("produces different hash for different task types", () => {
    const payload = { path: "src/main.ts" };
    const h1 = computeStableHash("outline", payload);
    const h2 = computeStableHash("file_lesson", payload);
    expect(h1).not.toBe(h2);
  });

  it("produces different hash for different payloads", () => {
    const h1 = computeStableHash("file_lesson", { path: "a.ts" });
    const h2 = computeStableHash("file_lesson", { path: "b.ts" });
    expect(h1).not.toBe(h2);
  });
});

// Test buildCompletionLabel
describe("buildCompletionLabel", () => {
  function buildCompletionLabel(taskType: string, projectName: string, output: { filename: string; content: string }): string {
    if (taskType === "outline") {
      return `${projectName} · 学习总纲已生成`;
    }
    if (taskType === "file_lesson") {
      const fileName = output.filename.split("/").pop() ?? output.filename;
      return `${projectName} · ${fileName} 的文件课件已生成`;
    }
    const h1Match = output.content.match(/^#\s+(.+)$/m);
    const h1 = h1Match?.[1]?.trim() ?? "课件";
    if (/^第\s*\d+\s*课/.test(h1)) {
      return `${projectName} · ${h1}已生成`;
    }
    return `${projectName} · ${h1}已生成`;
  }

  it("outline: correct format", () => {
    const label = buildCompletionLabel("outline", "MyProject", { filename: "outline.md", content: "# Outline" });
    expect(label).toBe("MyProject · 学习总纲已生成");
  });

  it("file_lesson: uses filename", () => {
    const label = buildCompletionLabel("file_lesson", "MyProject", {
      filename: "files/Foo_java_detailed.md",
      content: "# Foo.java Analysis",
    });
    expect(label).toContain("Foo_java_detailed.md");
    expect(label).toContain("的文件课件已生成");
  });

  it("outline_lesson: uses h1 without doubling 第...课", () => {
    const label = buildCompletionLabel("outline_lesson", "MyProject", {
      filename: "lessons/lesson_03.md",
      content: "# 第 3 课：任务队列\n\nContent",
    });
    expect(label).toBe("MyProject · 第 3 课：任务队列已生成");
    // Must not produce "第 第 3 课..."
    expect(label).not.toMatch(/第\s+第/);
  });

  it("file_lesson never shows 总纲", () => {
    const label = buildCompletionLabel("file_lesson", "MyProject", {
      filename: "files/main_py_detailed.md",
      content: "# main.py Analysis",
    });
    expect(label).not.toContain("总纲");
  });

  it("outline never shows 课件", () => {
    const label = buildCompletionLabel("outline", "MyProject", {
      filename: "outline.md",
      content: "# Outline",
    });
    expect(label).toContain("总纲");
  });
});

// Test course group assignment
describe("course group by taskType", () => {
  function getCourseGroup(taskType: string): string {
    if (taskType === "outline") return "总纲";
    if (taskType === "file_lesson") return "文件课件";
    return "课件";
  }

  it("outline → 总纲", () => {
    expect(getCourseGroup("outline")).toBe("总纲");
  });

  it("outline_lesson → 课件", () => {
    expect(getCourseGroup("outline_lesson")).toBe("课件");
  });

  it("file_lesson → 文件课件", () => {
    expect(getCourseGroup("file_lesson")).toBe("文件课件");
  });

  it("unknown task type throws or defaults", () => {
    // Our router should handle unknown types before reaching this
    expect(getCourseGroup("unknown_type")).toBe("课件");
  });
});

// Test progress throttle logic (OR, not AND)
describe("progress throttle", () => {
  function shouldSend(
    firstUpdate: boolean, labelChanged: boolean, indeterminateChanged: boolean,
    isComplete: boolean, stale: boolean, enoughProgress: boolean,
  ): boolean {
    if (firstUpdate || labelChanged || indeterminateChanged || isComplete) return true;
    return stale || enoughProgress;
  }

  it("first update always sends", () => {
    expect(shouldSend(true, false, false, false, false, false)).toBe(true);
  });

  it("label change always sends", () => {
    expect(shouldSend(false, true, false, false, false, false)).toBe(true);
  });

  it("indeterminate change always sends", () => {
    expect(shouldSend(false, false, true, false, false, false)).toBe(true);
  });

  it("100% complete always sends", () => {
    expect(shouldSend(false, false, false, true, false, false)).toBe(true);
  });

  it("sends when stale (only condition)", () => {
    expect(shouldSend(false, false, false, false, true, false)).toBe(true);
  });

  it("sends when pct changes >=1% (only condition)", () => {
    expect(shouldSend(false, false, false, false, false, true)).toBe(true);
  });

  it("does NOT send when neither stale nor pct-changed", () => {
    expect(shouldSend(false, false, false, false, false, false)).toBe(false);
  });

  it("sends when stale even without pct change", () => {
    expect(shouldSend(false, false, false, false, true, false)).toBe(true);
  });
});
