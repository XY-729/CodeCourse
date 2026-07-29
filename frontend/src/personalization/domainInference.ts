export type InferenceState =
  | "confirmed"
  | "learning"
  | "likely_prerequisite"
  | "insufficient";

export type ObserverKnowledgeEvidence = {
  concept: string;
  domain: string;
  direction: "positive" | "negative" | "uncertain";
  confidence: number;
  explanation: string;
  evidenceQuote: string;
  dimension?: "familiarity" | "conceptual" | "code_reading" | "implementation" | "debugging" | "transfer";
};

export type ObserverConceptRelation = {
  source: string;
  target: string;
  relationType: "prerequisite" | "component" | "application" | "sibling" | "alias";
  domain: string;
  confidence: number;
  rationale: string;
};

export type ObserverDomainAssessment = {
  domainKey: string;
  state: InferenceState;
  confidence: number;
  summary: string;
  concepts: string[];
  evidenceQuotes: string[];
};

export type ObserverSurveyCandidate = {
  question: string;
  dimension: string;
  options: Array<{ value: string; label: string }>;
  rationale: string;
  confidence: number;
};

export type ObserverDiagnosticCandidate = {
  concepts: string[];
  dimension: "familiarity" | "conceptual" | "code_reading" | "implementation" | "debugging" | "transfer";
  itemType: "single_choice" | "true_false" | "code_output" | "error_location" | "step_order";
  prompt: string;
  options: Array<{ value: unknown; label: string }>;
  answerKey: unknown;
  sourceRefs: Array<Record<string, unknown>>;
  rationale: string;
  difficulty: number;
};

export type ObserverTeachingOutcome = {
  result:
    | "successful"
    | "partially_successful"
    | "unsuccessful"
    | "advanced_followup"
    | "topic_changed"
    | "unknown";
  confidence: number;
  reason: string;
  evidenceQuote: string;
};

export type ObserverResult = {
  knowledgeEvidence: ObserverKnowledgeEvidence[];
  conceptRelations: ObserverConceptRelation[];
  domainAssessments: ObserverDomainAssessment[];
  surveyCandidate: ObserverSurveyCandidate | null;
  diagnosticCandidate: ObserverDiagnosticCandidate | null;
  previousTeachingOutcome: ObserverTeachingOutcome | null;
};

function canonicalDiagnosticValue(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => String(item)));
  return JSON.stringify(value);
}

export function isObjectiveDiagnosticCandidate(
  candidate: ObserverDiagnosticCandidate,
): boolean {
  if (!candidate.concepts.length || !candidate.prompt.trim() || !candidate.sourceRefs.length) {
    return false;
  }
  if (!candidate.sourceRefs.every((ref) => (
    ["course", "file", "qa"].includes(String(ref.source_type ?? ref.sourceType ?? ""))
    &&
    String(ref.source_path ?? ref.sourcePath ?? "").trim()
    && String(ref.excerpt ?? "").trim()
  ))) {
    return false;
  }
  const answer = canonicalDiagnosticValue(candidate.answerKey);
  if (!answer || answer === "null" || answer === "\"\"" || answer === "[]") return false;
  const optionValues = candidate.options.map((option) => canonicalDiagnosticValue(option.value));
  if (new Set(optionValues).size !== optionValues.length) return false;
  if (candidate.itemType === "step_order") {
    if (!Array.isArray(candidate.answerKey) || candidate.options.length < 2) return false;
    const answerValues = candidate.answerKey.map((value) => canonicalDiagnosticValue(value));
    return (
      answerValues.length === optionValues.length
      && new Set(answerValues).size === answerValues.length
      && answerValues.every((value) => optionValues.includes(value))
    );
  }
  if (candidate.itemType === "code_output" && candidate.options.length === 0) {
    return !Array.isArray(candidate.answerKey);
  }
  return candidate.options.length >= 2 && optionValues.filter((value) => value === answer).length === 1;
}

export type InferenceAggregate = {
  state: InferenceState;
  confidence: number;
  directEvidenceCount: number;
  inferredEvidenceCount: number;
};

const DIRECT_CONFIDENCE = 0.68;
const RELATION_CONFIDENCE = 0.58;

function finiteScore(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}

function cleanText(value: unknown, limit = 500): string {
  return String(value ?? "").trim().slice(0, limit);
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const parsed = JSON.parse(candidate) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Observer did not return a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function parseObserverResult(raw: string): ObserverResult {
  const value = extractJsonObject(raw);
  const knowledgeEvidence = arrayOfRecords(value.knowledge_evidence ?? value.knowledgeEvidence)
    .slice(0, 12)
    .map((item): ObserverKnowledgeEvidence | null => {
      const concept = cleanText(item.concept ?? item.concept_text, 120);
      const direction = cleanText(item.direction);
      if (!concept || !["positive", "negative", "uncertain"].includes(direction)) return null;
      return {
        concept,
        domain: cleanText(item.domain, 80) || "general",
        direction: direction as ObserverKnowledgeEvidence["direction"],
        confidence: finiteScore(item.confidence),
        explanation: cleanText(item.explanation),
        evidenceQuote: cleanText(item.evidence_quote ?? item.evidenceQuote, 260),
        dimension: ([
          "familiarity", "conceptual", "code_reading", "implementation", "debugging", "transfer",
        ].includes(cleanText(item.dimension))
          ? cleanText(item.dimension)
          : "familiarity") as ObserverKnowledgeEvidence["dimension"],
      };
    })
    .filter((item): item is ObserverKnowledgeEvidence => item !== null);

  const conceptRelations = arrayOfRecords(value.concept_relations ?? value.conceptRelations)
    .slice(0, 16)
    .map((item): ObserverConceptRelation | null => {
      const relationType = cleanText(item.relation_type ?? item.relationType);
      const source = cleanText(item.source ?? item.source_concept_text, 120);
      const target = cleanText(item.target ?? item.target_concept_text, 120);
      if (
        !source
        || !target
        || source.toLocaleLowerCase() === target.toLocaleLowerCase()
        || !["prerequisite", "component", "application", "sibling", "alias"].includes(relationType)
      ) return null;
      return {
        source,
        target,
        relationType: relationType as ObserverConceptRelation["relationType"],
        domain: cleanText(item.domain, 80) || "general",
        confidence: finiteScore(item.confidence),
        rationale: cleanText(item.rationale),
      };
    })
    .filter((item): item is ObserverConceptRelation => item !== null);

  const domainAssessments = arrayOfRecords(value.domain_assessments ?? value.domainAssessments)
    .slice(0, 8)
    .map((item): ObserverDomainAssessment | null => {
      const domainKey = cleanText(item.domain_key ?? item.domainKey, 80);
      const state = cleanText(item.state);
      if (!domainKey || !["confirmed", "learning", "likely_prerequisite", "insufficient"].includes(state)) {
        return null;
      }
      return {
        domainKey,
        state: state as InferenceState,
        confidence: finiteScore(item.confidence),
        summary: cleanText(item.summary),
        concepts: (Array.isArray(item.concepts ?? item.concept_keys)
          ? (item.concepts ?? item.concept_keys) as unknown[]
          : [])
          .map((entry) => cleanText(entry, 120))
          .filter(Boolean)
          .slice(0, 12),
        evidenceQuotes: (Array.isArray(item.evidence_quotes ?? item.evidenceQuotes)
          ? (item.evidence_quotes ?? item.evidenceQuotes) as unknown[]
          : [])
          .map((entry) => cleanText(entry, 260))
          .filter(Boolean)
          .slice(0, 8),
      };
    })
    .filter((item): item is ObserverDomainAssessment => item !== null);

  const surveyValue = value.survey_candidate ?? value.surveyCandidate;
  let surveyCandidate: ObserverSurveyCandidate | null = null;
  if (surveyValue && typeof surveyValue === "object" && !Array.isArray(surveyValue)) {
    const item = surveyValue as Record<string, unknown>;
    const options = arrayOfRecords(item.options)
      .map((option) => ({
        value: cleanText(option.value, 80),
        label: cleanText(option.label, 120),
      }))
      .filter((option) => option.value && option.label)
      .slice(0, 3);
    const question = cleanText(item.question, 240);
    if (question && options.length >= 2) {
      surveyCandidate = {
        question,
        dimension: cleanText(item.dimension, 80),
        options,
        rationale: cleanText(item.rationale),
        confidence: finiteScore(item.confidence),
      };
    }
  }

  const diagnosticValue = value.diagnostic_candidate ?? value.diagnosticCandidate;
  let diagnosticCandidate: ObserverDiagnosticCandidate | null = null;
  if (diagnosticValue && typeof diagnosticValue === "object" && !Array.isArray(diagnosticValue)) {
    const item = diagnosticValue as Record<string, unknown>;
    const dimension = cleanText(item.dimension);
    const itemType = cleanText(item.item_type ?? item.itemType);
    const prompt = cleanText(item.prompt, 1200);
    const concepts = (Array.isArray(item.concept_keys ?? item.concepts)
      ? (item.concept_keys ?? item.concepts) as unknown[]
      : []).map((entry) => cleanText(entry, 120)).filter(Boolean).slice(0, 4);
    const sourceRefs = arrayOfRecords(item.source_refs ?? item.sourceRefs).slice(0, 4);
    const answerKey = item.answer_key ?? item.answerKey;
    if (
      concepts.length
      && prompt
      && sourceRefs.length
      && answerKey != null
      && ["familiarity", "conceptual", "code_reading", "implementation", "debugging", "transfer"].includes(dimension)
      && ["single_choice", "true_false", "code_output", "error_location", "step_order"].includes(itemType)
    ) {
      const parsedCandidate: ObserverDiagnosticCandidate = {
        concepts,
        dimension: dimension as ObserverDiagnosticCandidate["dimension"],
        itemType: itemType as ObserverDiagnosticCandidate["itemType"],
        prompt,
        options: arrayOfRecords(item.options).slice(0, 8).map((option) => ({
          value: option.value,
          label: cleanText(option.label, 180),
        })).filter((option) => option.label),
        answerKey,
        sourceRefs,
        rationale: cleanText(item.rationale),
        difficulty: finiteScore(item.difficulty),
      };
      if (isObjectiveDiagnosticCandidate(parsedCandidate)) {
        diagnosticCandidate = parsedCandidate;
      }
    }
  }

  const outcomeValue = value.previous_teaching_outcome ?? value.previousTeachingOutcome;
  let previousTeachingOutcome: ObserverTeachingOutcome | null = null;
  if (outcomeValue && typeof outcomeValue === "object" && !Array.isArray(outcomeValue)) {
    const item = outcomeValue as Record<string, unknown>;
    const result = cleanText(item.result);
    const reason = cleanText(item.reason);
    const evidenceQuote = cleanText(item.evidence_quote ?? item.evidenceQuote, 300);
    if (
      [
        "successful",
        "partially_successful",
        "unsuccessful",
        "advanced_followup",
        "topic_changed",
        "unknown",
      ].includes(result)
      && reason
      && evidenceQuote
    ) {
      previousTeachingOutcome = {
        result: result as ObserverTeachingOutcome["result"],
        confidence: finiteScore(item.confidence),
        reason,
        evidenceQuote,
      };
    }
  }

  return {
    knowledgeEvidence,
    conceptRelations,
    domainAssessments,
    surveyCandidate,
    diagnosticCandidate,
    previousTeachingOutcome,
  };
}

export function mergeInference(
  current: InferenceAggregate | null,
  incomingState: InferenceState,
  confidence: number,
  direct: boolean,
): InferenceAggregate {
  const safeConfidence = finiteScore(confidence);
  let nextState = incomingState;
  if (!direct && incomingState === "confirmed") nextState = "likely_prerequisite";
  if (!direct && current && ["confirmed", "learning"].includes(current.state)) {
    nextState = current.state;
  }
  const directEvidenceCount = (current?.directEvidenceCount ?? 0) + (direct ? 1 : 0);
  const inferredEvidenceCount = (current?.inferredEvidenceCount ?? 0) + (direct ? 0 : 1);
  const weight = current
    ? Math.min(0.35, 1 / Math.max(2, directEvidenceCount + inferredEvidenceCount))
    : 1;
  const mergedConfidence = current
    ? current.confidence * (1 - weight) + safeConfidence * weight
    : safeConfidence;
  return {
    state: nextState,
    confidence: Math.min(1, Math.max(0, mergedConfidence)),
    directEvidenceCount,
    inferredEvidenceCount,
  };
}

export function isAcceptedDirectEvidence(evidence: ObserverKnowledgeEvidence): boolean {
  return evidence.direction !== "uncertain" && evidence.confidence >= DIRECT_CONFIDENCE;
}

export function isAcceptedRelation(relation: ObserverConceptRelation): boolean {
  return relation.confidence >= RELATION_CONFIDENCE;
}

export function conservativeDomainState(
  assessment: ObserverDomainAssessment,
  evidence: ObserverKnowledgeEvidence[],
): { state: InferenceState; direct: boolean } {
  const normalize = (value: string) => value.trim().toLocaleLowerCase();
  const domainKey = normalize(assessment.domainKey);
  const conceptKeys = new Set(assessment.concepts.map(normalize).filter(Boolean));
  const relevantEvidence = evidence.filter((item) => {
    if (conceptKeys.size > 0) return conceptKeys.has(normalize(item.concept));
    return normalize(item.domain) === domainKey;
  });
  const hasPositive = relevantEvidence.some(
    (item) => isAcceptedDirectEvidence(item) && item.direction === "positive",
  );
  const hasNegative = relevantEvidence.some(
    (item) => isAcceptedDirectEvidence(item) && item.direction === "negative",
  );
  if (assessment.state === "confirmed") {
    return { state: "likely_prerequisite", direct: false };
  }
  if (assessment.state === "learning") {
    return { state: "learning", direct: hasNegative };
  }
  return { state: assessment.state, direct: false };
}

export function buildObserverPrompt(input: {
  question: string;
  selectedText: string;
  parentQuestion?: string;
  parentAnswer?: string;
  knownConcepts: string[];
  unfamiliarConcepts: string[];
  completedAnswerCount: number;
  sourceType?: string;
  sourcePath?: string;
  sourceExcerpt?: string;
  previousAppliedTeaching?: {
    qaRecordId: number;
    teachingGoal: string;
    strategies: string[];
  } | null;
}): string {
  return `你是 CodeCourse 的 Observer。只分析用户本轮表达提供的学习证据，不评价回答质量。

安全与推断规则：
- 只描述技术领域中的 confirmed、learning、likely_prerequisite、insufficient。
- 用户询问定义或追问通常是 learning 证据，不是掌握证据。
- 只有用户明确说明、正确总结或练习表现，才可输出 positive 掌握证据。
- 先修关系只能形成 likely_prerequisite，不能推断 confirmed。
- sibling/同领域关系绝不能传播掌握状态。
- 不推断年龄、学历、智力、人格或其他敏感属性。
- socket、bind 等网络概念的证据不能扩散为数据结构、线程池等其他领域已掌握。
- 只有提供了上一轮教学策略时才评估 previous_teaching_outcome；证据必须逐字来自当前用户消息。
- 动态偏好问题必须针对本轮暴露出的真实不确定项，不使用固定问卷。回答数少于 5 时 survey_candidate 必须为 null。
- 理解检查只能在已完成回答数是 5 的倍数时提出，并且必须完全依据下方真实来源摘录。
- 理解检查必须有唯一、可本地判定的答案；没有可靠来源、答案存在歧义或当前已有检查时，diagnostic_candidate 必须为 null。

用户问题：
${input.question}

用户选区：
${input.selectedText || "(无)"}

父问题：
${input.parentQuestion || "(无)"}

父回答摘要：
${input.parentAnswer?.slice(0, 1600) || "(无)"}

上一轮已应用教学策略：
${input.previousAppliedTeaching
    ? JSON.stringify(input.previousAppliedTeaching)
    : "(无；previous_teaching_outcome 必须为 null)"}

人工确认认识：
${input.knownConcepts.join("、") || "(无)"}

人工确认陌生：
${input.unfamiliarConcepts.join("、") || "(无)"}

已完成回答数：${input.completedAnswerCount}

当前真实来源：${input.sourceType || "(无)"} ${input.sourcePath || "(无)"}
来源摘录：
${input.sourceExcerpt?.slice(0, 2200) || "(无可靠来源，diagnostic_candidate 必须为 null)"}

只输出 JSON：
{
  "knowledge_evidence": [{
    "concept": "概念名",
    "domain": "技术领域",
    "direction": "positive|negative|uncertain",
    "confidence": 0.0,
    "explanation": "判断原因",
    "evidence_quote": "必须来自用户本轮或父问题的原文"
  }],
  "concept_relations": [{
    "source": "概念",
    "target": "相关概念",
    "relation_type": "prerequisite|component|application|sibling|alias",
    "domain": "技术领域",
    "confidence": 0.0,
    "rationale": "关系依据"
  }],
  "domain_assessments": [{
    "domain_key": "领域",
    "state": "confirmed|learning|likely_prerequisite|insufficient",
    "confidence": 0.0,
    "summary": "保守、可解释的自然语言边界",
    "concepts": ["概念"],
    "evidence_quotes": ["用户原文"]
  }],
  "survey_candidate": null,
  "previous_teaching_outcome": ${input.previousAppliedTeaching ? `{
    "result": "successful|partially_successful|unsuccessful|advanced_followup|topic_changed|unknown",
    "confidence": 0.0,
    "reason": "只根据当前用户消息判断上一轮讲解效果",
    "evidence_quote": "当前用户消息中的原文"
  }` : "null"},
  "diagnostic_candidate": {
    "concept_keys": ["概念名"],
    "dimension": "familiarity|conceptual|code_reading|implementation|debugging|transfer",
    "item_type": "single_choice|true_false|code_output|error_location|step_order",
    "prompt": "基于当前来源、答案唯一的问题",
    "options": [{"value": "稳定答案键", "label": "用户看到的选项"}],
    "answer_key": "与唯一正确选项 value 完全一致；步骤排序时为 value 数组",
    "source_refs": [{
      "source_type": "course|file|qa",
      "source_path": "${input.sourcePath || "实际来源路径"}",
      "excerpt": "上方来源摘录中的原文",
      "start_line": 1
    }],
    "rationale": "为什么答案可由来源唯一确定",
    "difficulty": 0.0
  }
}`;
}
