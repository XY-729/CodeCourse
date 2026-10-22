import { describe, expect, it } from "vitest";
import {
  buildTeacherPlannerUserPrompt,
  effectiveTeachingPlan,
  parseTeachingPlan,
  type TeachingPlan,
} from "../teacherPlan";

function validPlan(): TeachingPlan {
  return {
    schema_version: 1,
    planner_version: "android-teacher-planner-v2",
    user_goal: "understand_mechanism",
    user_goal_summary: "理解事件循环如何调度任务",
    blocker_type: "mechanism",
    blocker_summary: "缺少调度顺序的心智模型",
    blocker_confidence: 0.8,
    teaching_goal: "建立从入队到执行的调度顺序",
    assumed_known: [{
      statement: "认识 Promise",
      confidence: 0.9,
      basis: "manual_mastery",
    }],
    uncertain_assumptions: [{
      statement: "可能理解微任务队列",
      confidence: 0.4,
      basis: "uncertain",
    }],
    strategies: ["execution_sequence", "worked_example"],
    steps: [
      { order: 1, strategy: "execution_sequence", instruction: "先画出调度顺序" },
      { order: 2, strategy: "worked_example", instruction: "再走一遍当前代码" },
    ],
    explain: [
      { concept_text: "微任务", concept_key: null, depth: "detailed", reason: "当前阻碍" },
      { concept_text: "任务队列", concept_key: "task-queue", depth: "brief", reason: "连接步骤" },
    ],
    skip_topics: ["浏览器渲染细节"],
    avoid: ["脱离当前代码的百科展开"],
    assessment: {
      needed: false,
      format: "none",
      timing: "none",
      purpose: "",
      required_information_gain: "",
    },
    needs_diagnostic_question: false,
    diagnostic_goal: "",
    plan_confidence: 0.85,
    uncertainty_notes: [],
  };
}

function rawPlan(overrides: Record<string, unknown> = {}): string {
  const { assessment: _assessment, needs_diagnostic_question: _needs, diagnostic_goal: _goal, ...rest } = validPlan();
  return JSON.stringify({ ...rest, ...overrides });
}

describe("Android structured teacher plan", () => {
  it("parses the same strict plan shape used by desktop", () => {
    const source = `\`\`\`json\n${rawPlan()}\n\`\`\``;
    expect(parseTeachingPlan(source)).toEqual(validPlan());
  });

  it("rejects extra fields instead of injecting unchecked model text", () => {
    const invalid = { ...JSON.parse(rawPlan()), answer: "直接替用户回答" };
    expect(() => parseTeachingPlan(JSON.stringify(invalid))).toThrow("字段不符合协议");
  });

  it("never carries a model-proposed assessment into the plan", () => {
    // Retired diagnosis fields stay accepted for old clients but always turn
    // into "no automatic check" so no test item is created behind the user.
    const parsed = parseTeachingPlan(rawPlan({
      assessment: { needed: true, format: "code_prediction", timing: "after" },
      needs_diagnostic_question: true,
      diagnostic_goal: "确认调度顺序",
    }));
    expect(parsed.assessment).toEqual({
      needed: false,
      format: "none",
      timing: "none",
      purpose: "",
      required_information_gain: "",
    });
    expect(parsed.needs_diagnostic_question).toBe(false);
    expect(parsed.diagnostic_goal).toBe("");
  });

  it("renders structured strategy details and keeps user wording verbatim", () => {
    const question = "先说结论，不要测试；这里的 vector 是什么？";
    const result = effectiveTeachingPlan(validPlan(), question);
    expect(result.rendered).toContain("execution_sequence：先画出调度顺序");
    expect(result.rendered).toContain("需要详细解释：\n- 微任务");
    expect(result.rendered).not.toContain("理解检查");
    expect(result.assumedKnown).toEqual(["认识 Promise"]);
    // The current question reaches the planner unedited; no keyword is turned
    // into a fixed teaching order.
    const prompt = buildTeacherPlannerUserPrompt(
      result.rendered,
      question,
      "",
      "course",
      "lesson-01.md",
    );
    expect(prompt).toContain(question);
    expect(prompt).toContain(result.rendered);
  });
});
