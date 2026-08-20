import { describe, expect, it } from "vitest";
import type { TeachingHandoff } from "../../api/client";
import { parseHandoffMetadata, renderProjectLearningContext } from "../continuity";

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    engagement: "learning",
    continuity: "update",
    topic: "请求生命周期",
    progress_summary: "已经跟到服务层。",
    established_points: ["路由负责校验"],
    unresolved_points: ["事务在哪里开始"],
    next_actions: [{ kind: "follow_up", label: "继续追踪", prompt: "事务边界在哪里？" }],
    used_prior_context: true,
    ...overrides,
  };
}

describe("teaching continuity metadata", () => {
  it("strips all HANDOFF lines and returns one validated update", () => {
    const result = parseHandoffMetadata(
      `正文\nHANDOFF: ${JSON.stringify(metadata())}\nHANDOFF: {bad-json}`,
      "file",
      "src/main.ts",
    );
    expect(result.visible).toBe("正文");
    expect(result.metadata?.topic).toBe("请求生命周期");
    expect(result.metadata?.nextActions).toHaveLength(1);
  });

  it("keeps the old state for utility, malformed, oversized, and unsafe metadata", () => {
    const samples = [
      metadata({ engagement: "utility", continuity: "preserve" }),
      metadata({ topic: "长".repeat(81) }),
      metadata({ unresolved_points: ["1", "2", "3", "4"] }),
      metadata({ next_actions: [{ kind: "open_source", label: "打开" }] }),
    ];
    for (const sample of samples) {
      const result = parseHandoffMetadata(`回答\nHANDOFF: ${JSON.stringify(sample)}`, "file", "../secret.ts");
      expect(result.visible).toBe("回答");
      expect(result.metadata).toBeNull();
    }
    expect(parseHandoffMetadata("回答\nHANDOFF: {broken", "file", "main.ts").metadata).toBeNull();
  });

  it("renders project-only context with prior progress and unresolved points", () => {
    const handoff = {
      id: 1, projectId: 7, sessionId: 2, qaRecordId: 3, engagement: "learning",
      topic: "请求生命周期", progressSummary: "跟到服务层", establishedPoints: ["认识路由"],
      unresolvedPoints: ["事务边界"], nextActions: [], sourceType: "file", sourcePath: "main.ts",
      sourceAvailable: true, usedPriorContext: true, isCurrent: true,
      createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z",
    } satisfies TeachingHandoff;
    const context = renderProjectLearningContext(handoff);
    expect(context).toContain("上次学习主题：请求生命周期");
    expect(context).toContain("仍待弄清：\n- 事务边界");
    expect(context).toContain("不相关时不要提及这些内容");
  });
});
