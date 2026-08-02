import { describe, expect, it } from "vitest";
import {
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
      needed: true,
      format: "code_prediction",
      timing: "after",
      purpose: "确认调度顺序",
      required_information_gain: "能否区分同步与微任务",
    },
    needs_diagnostic_question: false,
    diagnostic_goal: "",
    plan_confidence: 0.85,
    uncertainty_notes: [],
  };
}

describe("Android structured teacher plan", () => {
  it("parses the same strict plan shape used by desktop", () => {
    const source = `\`\`\`json\n${JSON.stringify(validPlan())}\n\`\`\``;
    expect(parseTeachingPlan(source)).toEqual(validPlan());
  });

  it("rejects extra fields instead of injecting unchecked model text", () => {
    const invalid = { ...validPlan(), answer: "直接替用户回答" };
    expect(() => parseTeachingPlan(JSON.stringify(invalid))).toThrow("字段不符合协议");
  });

  it("renders structured strategy details and honors no-test requests", () => {
    const result = effectiveTeachingPlan(validPlan(), "直接回答，不要测试");
    expect(result.rendered).toContain("execution_sequence：先画出调度顺序");
    expect(result.rendered).toContain("需要详细解释：\n- 微任务");
    expect(result.rendered).toContain("理解检查：不需要");
    expect(result.assumedKnown).toEqual(["认识 Promise"]);
  });
});
