import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEARNER_PREFERENCES,
  buildLearnerContext,
  inferPreferenceSignals,
  shouldOfferStyleSurvey,
} from "../preferenceEngine";

describe("inferPreferenceSignals", () => {
  it("extracts only explicit style requests from a question", () => {
    expect(inferPreferenceSignals("请详细讲原理，再给一段示例代码")).toEqual([
      { dimension: "answer_depth", choice: "more" },
      { dimension: "code_ratio", choice: "code" },
      { dimension: "explanation_order", choice: "principles" },
    ]);
  });

  it("does not infer mastery from merely using a technical term", () => {
    expect(inferPreferenceSignals("FastAPI 的路由在哪里？")).toEqual([]);
  });
});

describe("shouldOfferStyleSurvey", () => {
  it("waits for five answers and asks at most once per day", () => {
    const now = new Date("2026-07-26T12:00:00+08:00");
    expect(shouldOfferStyleSurvey({ ...DEFAULT_LEARNER_PREFERENCES, feedbackCount: 4 }, now)).toBe(false);
    expect(shouldOfferStyleSurvey({ ...DEFAULT_LEARNER_PREFERENCES, feedbackCount: 5 }, now)).toBe(true);
    expect(shouldOfferStyleSurvey({
      ...DEFAULT_LEARNER_PREFERENCES,
      feedbackCount: 8,
      lastSurveyAt: "2026-07-26T01:00:00+08:00",
    }, now)).toBe(false);
    expect(shouldOfferStyleSurvey({
      ...DEFAULT_LEARNER_PREFERENCES,
      feedbackCount: 8,
      lastSurveyAt: "2026-07-25T03:59:59Z",
    }, now)).toBe(true);
  });
});

describe("buildLearnerContext", () => {
  it("contains only relevant concepts and never exposes mastery scores", () => {
    const context = buildLearnerContext(
      { ...DEFAULT_LEARNER_PREFERENCES, explanationOrder: "example_first" },
      { known: ["HTTP"], unfamiliar: ["FastAPI"], uncertain: ["依赖注入"] },
    );
    expect(context).toContain("HTTP");
    expect(context).toContain("FastAPI");
    expect(context).toContain("依赖注入");
    expect(context).toContain("先给直观例子");
    expect(context).not.toMatch(/0\.\d|掌握度分数/);
  });
});
