export type ExplanationOrder =
  | "balanced"
  | "example_first"
  | "principle_first"
  | "code_first";

/** @deprecated Historical import shape only; fixed style values are ignored. */
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
  surveyEnabled: false,
  lastSurveyAt: null,
  surveyDue: false,
};

export const STYLE_SURVEY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** @deprecated Questions are retained verbatim; no keyword preference learning. */
export function inferPreferenceSignals(_question: string): PreferenceSignal[] {
  return [];
}

/** @deprecated Automatic preference questionnaires have been retired. */
export function shouldOfferStyleSurvey(
  _preferences: LearnerPreferences,
  _now = new Date(),
): boolean {
  return false;
}

export function buildLearnerContext(
  _legacyPreferences: LearnerPreferences,
  concepts: { known: string[]; unfamiliar: string[]; uncertain: string[] },
): string {
  const list = (items: string[]) => items.length
    ? items.map((item) => `- ${item}`).join("\n")
    : "- 无记录";
  return `<learner_context>
用户明确记录的已知概念：
${list(concepts.known)}

当前需要帮助的概念：
${list(concepts.unfamiliar)}

熟悉情况无充分记录的概念：
${list(concepts.uncertain)}

当前用户原文要求优先。以上记录仅描述已有证据，不推断实现、调试或迁移能力，不沿概念关系传播状态。
</learner_context>`;
}

/** @deprecated Numeric preferences no longer produce teaching directives. */
export function renderPreferenceDirectives(_preferences: LearnerPreferences): string {
  return "";
}
