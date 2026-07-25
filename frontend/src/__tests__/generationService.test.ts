import { describe, it, expect } from "vitest";
import {
  validateBaseCheckpoint, validateOutlineCheckpoint, validateDetailedLessonCheckpoint,
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

describe("validateOutlineCheckpoint", () => {
  const base = { version: 1, taskType: "outline", inputHash: "h1", updatedAt: "now" };
  it("rejects missing generated flag", () => {
    expect(validateOutlineCheckpoint(base as any)).toBe(false);
  });
  it("rejects generated=false", () => {
    expect(validateOutlineCheckpoint({ ...base, generated: false, generatedContent: "x" } as any)).toBe(false);
  });
  it("rejects empty generatedContent", () => {
    expect(validateOutlineCheckpoint({ ...base, generated: true, generatedContent: "" } as any)).toBe(false);
  });
  it("accepts valid outline checkpoint", () => {
    expect(validateOutlineCheckpoint({ ...base, generated: true, generatedContent: "hello" } as any)).toBe(true);
  });
});

describe("validateDetailedLessonCheckpoint", () => {
  const validPlan = { sections: [{ title: "Ch1", items: [{ name: "fn", kind: "function" }] }] };
  it("rejects null", () => expect(validateDetailedLessonCheckpoint(null)).toBeNull());
  it("rejects missing plan", () => expect(validateDetailedLessonCheckpoint({})).toBeNull());
  it("rejects plan without sections", () => expect(validateDetailedLessonCheckpoint({ plan: {} })).toBeNull());
  it("rejects section without title", () => {
    expect(validateDetailedLessonCheckpoint({ plan: { sections: [{ items: [{ name: "x", kind: "f" }] }] } })).toBeNull();
  });
  it("rejects item without name", () => {
    expect(validateDetailedLessonCheckpoint({ plan: { sections: [{ title: "T", items: [{ kind: "f" }] }] } })).toBeNull();
  });
  it("rejects non-numeric generatedByIndex key", () => {
    const cp = { plan: validPlan, generatedByIndex: { abc: "content" } };
    expect(validateDetailedLessonCheckpoint(cp)).toBeNull();
  });
  it("rejects non-string generatedByIndex value", () => {
    const cp = { plan: validPlan, generatedByIndex: { 0: 123 } };
    expect(validateDetailedLessonCheckpoint(cp)).toBeNull();
  });
  it("accepts valid sections (no generatedByIndex)", () => {
    expect(validateDetailedLessonCheckpoint({ plan: validPlan })).not.toBeNull();
  });
  it("accepts valid generatedByIndex", () => {
    const cp = { plan: validPlan, generatedByIndex: { 0: "content", 1: "content2" } };
    expect(validateDetailedLessonCheckpoint(cp)).not.toBeNull();
  });
  it("accepts optional repairGenerated as string", () => {
    const cp = { plan: validPlan, generatedByIndex: { 0: "c" }, repairGenerated: "repair" };
    expect(validateDetailedLessonCheckpoint(cp)).not.toBeNull();
  });
  it("accepts missing repairGenerated", () => {
    const cp = { plan: validPlan, generatedByIndex: { 0: "c" } };
    expect(validateDetailedLessonCheckpoint(cp)).not.toBeNull();
  });
  it("accepts null repairGenerated", () => {
    const cp = { plan: validPlan, generatedByIndex: { 0: "c" }, repairGenerated: null };
    expect(validateDetailedLessonCheckpoint(cp)).not.toBeNull();
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
