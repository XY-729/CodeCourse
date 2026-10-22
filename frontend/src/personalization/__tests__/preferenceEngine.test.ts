import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_LEARNER_PREFERENCES,
  buildLearnerContext,
  inferPreferenceSignals,
  renderPreferenceDirectives,
  shouldOfferStyleSurvey,
} from "../preferenceEngine";

describe("inferPreferenceSignals", () => {
  it("no longer turns keywords into stored preferences", () => {
    // Questions are kept verbatim; "详细/原理/例子" no longer trains a
    // long-term style profile behind the user's back.
    expect(inferPreferenceSignals("请详细讲原理，再给一段示例代码")).toEqual([]);
    expect(inferPreferenceSignals("简单说，一行代码就够")).toEqual([]);
    expect(inferPreferenceSignals("FastAPI 的路由在哪里？")).toEqual([]);
  });
});

describe("shouldOfferStyleSurvey", () => {
  it("never offers an automatic style questionnaire", () => {
    const now = new Date("2026-07-26T12:00:00+08:00");
    expect(shouldOfferStyleSurvey({ ...DEFAULT_LEARNER_PREFERENCES, feedbackCount: 4 }, now)).toBe(false);
    expect(shouldOfferStyleSurvey({ ...DEFAULT_LEARNER_PREFERENCES, feedbackCount: 5 }, now)).toBe(false);
    expect(shouldOfferStyleSurvey({
      ...DEFAULT_LEARNER_PREFERENCES,
      feedbackCount: 8,
      lastSurveyAt: "2026-07-25T03:59:59Z",
    }, now)).toBe(false);
  });
});

describe("buildLearnerContext", () => {
  it("describes recorded facts without fixed style directives", () => {
    const context = buildLearnerContext(
      DEFAULT_LEARNER_PREFERENCES,
      { known: ["HTTP"], unfamiliar: ["FastAPI"], uncertain: ["依赖注入"] },
    );
    expect(context).toContain("HTTP");
    expect(context).toContain("FastAPI");
    expect(context).toContain("依赖注入");
    expect(context).toContain("当前用户原文要求优先");
    expect(context).not.toContain("回答深度");
    expect(context).not.toContain("代码使用");
    expect(context).not.toContain("讲解顺序");
    expect(context).not.toContain("术语密度");
    expect(context).not.toMatch(/掌握度|分数|\d+%/);
  });

  it("renders no directive at all for every legacy preference vector", () => {
    const vectors = JSON.parse(readFileSync(
      resolve(process.cwd(), "../shared/preference-directive-vectors.json"),
      "utf8",
    )) as Array<{
      name: string;
      preferences: {
        answer_depth: number;
        code_ratio: number;
        explanation_order: "balanced" | "example_first" | "principle_first" | "code_first";
        prerequisite_detail: number;
        terminology_density: number;
      };
      expected: string[];
    }>;

    expect(vectors.length).toBeGreaterThan(0);
    for (const vector of vectors) {
      const rendered = renderPreferenceDirectives({
        ...DEFAULT_LEARNER_PREFERENCES,
        answerDepth: vector.preferences.answer_depth,
        codeRatio: vector.preferences.code_ratio,
        explanationOrder: vector.preferences.explanation_order,
        prerequisiteDetail: vector.preferences.prerequisite_detail,
        terminologyDensity: vector.preferences.terminology_density,
      });
      expect(rendered, vector.name).toBe("");
    }
  });
});
