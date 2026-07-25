import { describe, it, expect } from "vitest";
import {
  validateBaseCheckpoint, parseOutlineCheckpoint, parseDetailedLessonCheckpoint,
  courseGroupForTaskType, buildCompletionLabel, shouldSendProgress, canRetry,
  buildSlimCheckpoint, permissionNotice,
} from "../platform/android/generationState";

// ====== checkpoint validation ======

describe("validateBaseCheckpoint", () => {
  it("rejects null", () => expect(validateBaseCheckpoint(null, "outline", "hash1")).toBeNull());
  it("rejects non-object", () => expect(validateBaseCheckpoint("string", "outline", "hash1")).toBeNull());
  it("rejects wrong version", () => {
    expect(validateBaseCheckpoint({ version: 99, taskType: "outline", inputHash: "h1", updatedAt: "now" }, "outline", "h1")).toBeNull();
  });
  it("rejects wrong taskType", () => {
    expect(validateBaseCheckpoint({ version: 1, taskType: "wrong", inputHash: "h1", updatedAt: "now" }, "outline", "h1")).toBeNull();
  });
  it("rejects wrong inputHash", () => {
    expect(validateBaseCheckpoint({ version: 1, taskType: "outline", inputHash: "wrong", updatedAt: "now" }, "outline", "h1")).toBeNull();
  });
  it("rejects missing updatedAt", () => {
    expect(validateBaseCheckpoint({ version: 1, taskType: "outline", inputHash: "h1", updatedAt: "" }, "outline", "h1")).toBeNull();
  });
  it("accepts valid checkpoint", () => {
    expect(validateBaseCheckpoint({ version: 1, taskType: "outline", inputHash: "h1", updatedAt: "2024-01-01" }, "outline", "h1")).not.toBeNull();
  });
});

const BASE = { version: 1, taskType: "outline", inputHash: "h1", updatedAt: "now" };

describe("parseOutlineCheckpoint", () => {
  it("rejects missing generated flag", () => {
    expect(parseOutlineCheckpoint({ ...BASE, generated: false, generatedContent: "x" }, "outline", "h1")).toBeNull();
  });
  it("rejects empty generatedContent", () => {
    expect(parseOutlineCheckpoint({ ...BASE, generated: true, generatedContent: " " }, "outline", "h1")).toBeNull();
  });
  it("accepts valid outline checkpoint — preserves all fields", () => {
    const cp = parseOutlineCheckpoint({ ...BASE, generated: true, generatedContent: "hello world" }, "outline", "h1");
    expect(cp).not.toBeNull();
    expect(cp!.generatedContent).toBe("hello world");
    expect(cp!.generated).toBe(true);
  });
  it("works for file_lesson taskType", () => {
    const cp = parseOutlineCheckpoint({ ...BASE, taskType: "file_lesson", generated: true, generatedContent: "x" }, "file_lesson", "h1");
    expect(cp).not.toBeNull();
  });
});

describe("parseDetailedLessonCheckpoint", () => {
  const base = { version: 1, taskType: "outline_lesson", inputHash: "h1", updatedAt: "now" };
  const validPlan = { sections: [{ title: "Ch1", items: [{ name: "fn", kind: "function" }] }] };
  it("rejects null", () => expect(parseDetailedLessonCheckpoint(null, "h1")).toBeNull());
  it("rejects missing plan", () => expect(parseDetailedLessonCheckpoint({ ...base }, "h1")).toBeNull());
  it("rejects item without name", () => {
    expect(parseDetailedLessonCheckpoint({ ...base, plan: { sections: [{ title: "T", items: [{ kind: "f" }] }] } }, "h1")).toBeNull();
  });
  it("skips non-numeric generatedByIndex key (no crash)", () => {
    const cp = parseDetailedLessonCheckpoint({ ...base, plan: validPlan, generatedByIndex: { abc: "content" } }, "h1");
    expect(Object.keys(cp!.generatedByIndex)).toHaveLength(0);
  });
  it("skips out-of-bounds index", () => {
    const cp = parseDetailedLessonCheckpoint({ ...base, plan: validPlan, generatedByIndex: { 99: "content" } }, "h1");
    expect(Object.keys(cp!.generatedByIndex)).toHaveLength(0);
  });
  it("preserves valid generatedByIndex entries", () => {
    const cp = parseDetailedLessonCheckpoint({ ...base, plan: validPlan, generatedByIndex: { 0: "section content" } }, "h1");
    expect(cp).not.toBeNull();
    expect(cp!.generatedByIndex["0"]).toBe("section content");
  });
  it("preserves repairGenerated", () => {
    const cp = parseDetailedLessonCheckpoint({ ...base, plan: validPlan, generatedByIndex: { 0: "c" }, repairGenerated: "repair" }, "h1");
    expect(cp!.repairGenerated).toBe("repair");
  });
});

// ====== course group ======

describe("courseGroupForTaskType", () => {
  it("outline → 总纲", () => expect(courseGroupForTaskType("outline")).toBe("总纲"));
  it("outline_lesson → 课件", () => expect(courseGroupForTaskType("outline_lesson")).toBe("课件"));
  it("file_lesson → 文件课件", () => expect(courseGroupForTaskType("file_lesson")).toBe("文件课件"));
  it("unknown throws", () => expect(() => courseGroupForTaskType("unknown")).toThrow());
});

// ====== buildCompletionLabel ======

describe("buildCompletionLabel", () => {
  const out = { filename: "outline.md", content: "# My Outline" };
  const fileOut = { filename: "files/Foo_java_detailed.md", content: "# Foo Analysis" };
  const lessonOut = { filename: "lessons/lesson_03.md", content: "# 第 3 课：任务队列\n\nBody" };
  it("outline uses 总纲", () => {
    expect(buildCompletionLabel("outline", "P", out)).toContain("总纲");
  });
  it("file_lesson uses filename", () => {
    expect(buildCompletionLabel("file_lesson", "P", fileOut)).toContain("Foo_java_detailed.md");
  });
  it("outline_lesson uses h1", () => {
    expect(buildCompletionLabel("outline_lesson", "P", lessonOut)).toContain("第 3 课：任务队列");
  });
  it("does not double 第", () => {
    const label = buildCompletionLabel("outline_lesson", "P", lessonOut);
    expect(label).not.toMatch(/第\s+第/);
  });
});

// ====== shouldSendProgress ======

describe("shouldSendProgress", () => {
  it("first update always sends", () => expect(shouldSendProgress(true, false, false, false, false, false)).toBe(true));
  it("label change always sends", () => expect(shouldSendProgress(false, true, false, false, false, false)).toBe(true));
  it("indeterminate change always sends", () => expect(shouldSendProgress(false, false, true, false, false, false)).toBe(true));
  it("100% complete always sends", () => expect(shouldSendProgress(false, false, false, true, false, false)).toBe(true));
  it("stale sends", () => expect(shouldSendProgress(false, false, false, false, true, false)).toBe(true));
  it("pct change sends", () => expect(shouldSendProgress(false, false, false, false, false, true)).toBe(true));
  it("nothing: no send", () => expect(shouldSendProgress(false, false, false, false, false, false)).toBe(false));
});

// ====== canRetry ======

describe("canRetry", () => {
  it("failed can retry", () => expect(canRetry("failed")).toBe(true));
  it("cancelled can retry", () => expect(canRetry("cancelled")).toBe(true));
  it("completed cannot retry", () => expect(canRetry("completed")).toBe(false));
  it("queued cannot retry", () => expect(canRetry("queued")).toBe(false));
});

// ====== buildSlimCheckpoint ======

describe("buildSlimCheckpoint", () => {
  it("contains completed metadata", () => {
    const cp = buildSlimCheckpoint("outline", "hash1", "outline.md");
    expect(cp.version).toBe(1);
    expect(cp.taskType).toBe("outline");
    expect(cp.completed).toBe(true);
    expect(cp.outputPath).toBe("outline.md");
  });
});

// ====== permissionNotice ======

describe("permissionNotice", () => {
  it("granted → null", () => {
    expect(permissionNotice({ granted: true, status: "granted", canAskAgain: false })).toBeNull();
  });
  it("not_required → null", () => {
    expect(permissionNotice({ granted: true, status: "not_required", canAskAgain: false })).toBeNull();
  });
  it("denied → notice without settings", () => {
    const n = permissionNotice({ granted: false, status: "denied", canAskAgain: true });
    expect(n?.showSettingsAction).toBe(false);
    expect(n?.message).toContain("不可见");
  });
  it("denied_permanently → notice with settings", () => {
    const n = permissionNotice({ granted: false, status: "denied_permanently", canAskAgain: false });
    expect(n?.showSettingsAction).toBe(true);
  });
  it("notifications_disabled → notice with settings", () => {
    const n = permissionNotice({ granted: false, status: "notifications_disabled", canAskAgain: false });
    expect(n?.showSettingsAction).toBe(true);
    expect(n?.message).toContain("系统已关闭");
  });
  it("no_activity → null (silent)", () => {
    expect(permissionNotice({ granted: false, status: "no_activity", canAskAgain: true })).toBeNull();
  });
  it("error → null (silent)", () => {
    expect(permissionNotice({ granted: false, status: "error", canAskAgain: false })).toBeNull();
  });
});
