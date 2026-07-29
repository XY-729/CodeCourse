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
  const list = (items: string[]) => items.length
    ? items.map((item) => `- ${item}`).join("\n")
    : "- 无";
  return `<learner_context>
本轮相关已掌握概念：
${list(concepts.known)}

本轮相关可能陌生概念：
${list(concepts.unfamiliar)}

本轮相关不确定概念：
${list(concepts.uncertain)}

回答偏好（用语义执行，不展示数值）：
${renderPreferenceDirectives(preferences)}

要求：当前问题的明确要求优先；已掌握概念不重复入门定义；
可能陌生概念第一次出现时先用一句话解释；不要展示掌握度数值或给用户贴水平标签；
教学方式由当前问题决定：调试优先解决，学习优先建立理解。
</learner_context>`;
}

function preferenceBand(value: number): "low" | "balanced" | "high" {
  if (value < 0.34) return "low";
  if (value > 0.66) return "high";
  return "balanced";
}

export function renderPreferenceDirectives(preferences: LearnerPreferences): string {
  const depth = {
    low: "回答深度：紧凑。先给结论与必要依据，用户未要求时不扩展成完整教程。",
    balanced: "回答深度：均衡。先解决当前问题，再补足理解结论所需的机制或背景。",
    high: "回答深度：详细。说明关键机制、边界与验证方法，但避免重复已掌握内容。",
  }[preferenceBand(preferences.answerDepth)];
  const code = {
    low: "代码使用：克制。只有代码明显优于文字或当前任务必须实现时才给示例。",
    balanced: "代码使用：均衡。实现与调试问题给必要代码，概念问题按需使用短片段。",
    high: "代码使用：偏多。优先用贴合当前语言和上下文的代码展示关键机制。",
  }[preferenceBand(preferences.codeRatio)];
  const order = {
    example_first: "讲解顺序：先给具体例子或现象，再归纳原理。",
    principle_first: "讲解顺序：先说明原理和约束，再落到例子。",
    code_first: "讲解顺序：先给关键代码或修改，再解释其原因。",
    balanced: "讲解顺序：结论先行，在原理与例子之间按当前问题选择。",
  }[preferences.explanationOrder] ?? "讲解顺序：结论先行，在原理与例子之间按当前问题选择。";
  const prerequisite = {
    low: "前置知识：少量补充。只解释理解当前答案不可缺少的前置概念。",
    balanced: "前置知识：适量补充。遇到必要且证据不足的前置概念时给一句铺垫。",
    high: "前置知识：主动补足。先建立完成当前目标需要的关键前置链条。",
  }[preferenceBand(preferences.prerequisiteDetail)];
  const terminology = {
    low: "术语密度：低。优先使用通俗表达，仅保留不可替代的技术名词。",
    balanced: "术语密度：适中。使用准确术语，并简短解释当前必要的陌生词。",
    high: "术语密度：高。可以使用领域标准术语，但不要堆砌或偏离当前问题。",
  }[preferenceBand(preferences.terminologyDensity)];
  return [depth, code, order, prerequisite, terminology]
    .map((item) => `- ${item}`)
    .join("\n");
}
