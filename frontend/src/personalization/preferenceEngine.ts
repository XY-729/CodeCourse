export type ExplanationOrder =
  | "balanced"
  | "example_first"
  | "principle_first"
  | "code_first";

export interface LearnerPreferences {
  answerDepth: number;
  codeRatio: number;
  explanationOrder: ExplanationOrder;
  prerequisiteDetail: number;
  terminologyDensity: number;
  feedbackCount: number;
  surveyEnabled: boolean;
  lastSurveyAt?: string | null;
  surveyDue?: boolean;
}

export interface PreferenceSignal {
  dimension:
    | "answer_depth"
    | "code_ratio"
    | "explanation_order"
    | "prerequisite_detail"
    | "terminology_density";
  choice: string;
}

export const DEFAULT_LEARNER_PREFERENCES: LearnerPreferences = {
  answerDepth: 0.5,
  codeRatio: 0.5,
  explanationOrder: "balanced",
  prerequisiteDetail: 0.5,
  terminologyDensity: 0.5,
  feedbackCount: 0,
  surveyEnabled: true,
  lastSurveyAt: null,
  surveyDue: false,
};

export const STYLE_SURVEY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function inferPreferenceSignals(question: string): PreferenceSignal[] {
  const text = question.toLowerCase();
  const signals: PreferenceSignal[] = [];
  if (/(详细|一步一步|深入|展开|detail|step by step)/i.test(text)) {
    signals.push({ dimension: "answer_depth", choice: "more" });
  }
  if (/(简单|简短|一句话|直接说|concise|brief)/i.test(text)) {
    signals.push({ dimension: "answer_depth", choice: "less" });
  }
  if (/(代码|示例代码|code|实现)/i.test(text)) {
    signals.push({ dimension: "code_ratio", choice: "code" });
  }
  if (/(举例|例子|example|类比)/i.test(text)) {
    signals.push({ dimension: "explanation_order", choice: "examples" });
  }
  if (/(原理|为什么|底层|principle|why)/i.test(text)) {
    signals.push({ dimension: "explanation_order", choice: "principles" });
  }
  if (/(小白|前置|基础|从头|prerequisite)/i.test(text)) {
    signals.push({ dimension: "prerequisite_detail", choice: "more" });
  }
  return signals;
}

export function shouldOfferStyleSurvey(
  preferences: LearnerPreferences,
  now = new Date(),
): boolean {
  if (!preferences.surveyEnabled || preferences.feedbackCount < 5) return false;
  if (!preferences.lastSurveyAt) return true;
  const lastTimestamp = Date.parse(preferences.lastSurveyAt);
  const nowTimestamp = now.getTime();
  if (!Number.isFinite(lastTimestamp) || !Number.isFinite(nowTimestamp)) return true;
  const elapsed = nowTimestamp - lastTimestamp;
  return elapsed >= STYLE_SURVEY_COOLDOWN_MS;
}

export function buildLearnerContext(
  preferences: LearnerPreferences,
  concepts: {
    known: string[];
    unfamiliar: string[];
    uncertain: string[];
  },
): string {
  const depth = preferences.answerDepth < 0.35
    ? "简洁"
    : preferences.answerDepth > 0.65
      ? "深入"
      : "适中";
  const order: Record<ExplanationOrder, string> = {
    balanced: "结论、直觉、示例和原理保持平衡",
    example_first: "先给直观例子，再解释原理",
    principle_first: "先说明原因和原理，再给例子",
    code_first: "先给可读代码，再拆解概念",
  };
  const list = (items: string[]) => items.length
    ? items.map((item) => `- ${item}`).join("\n")
    : "- 无";
  return `<learner_context>
回答偏好：
- 回答深度：${depth}
- 组织顺序：${order[preferences.explanationOrder]}
- 示例比例：${preferences.codeRatio > 0.65 ? "代码较多" : preferences.codeRatio < 0.35 ? "解释较多" : "平衡"}
- 前置知识：${preferences.prerequisiteDetail > 0.6 ? "主动补充必要前置知识" : "只补充直接相关前置知识"}

本轮相关已掌握概念：
${list(concepts.known)}

本轮相关可能陌生概念：
${list(concepts.unfamiliar)}

本轮相关不确定概念：
${list(concepts.uncertain)}

要求：当前问题的明确要求优先；不要展示掌握度数值或给用户贴水平标签。
</learner_context>`;
}
