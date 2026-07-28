import { describe, expect, it } from "vitest";
import {
  conservativeDomainState,
  mergeInference,
  parseObserverResult,
} from "../domainInference";

describe("domain inference safety", () => {
  it("never upgrades inferred confirmation to mastered", () => {
    expect(mergeInference(null, "confirmed", 0.9, false)).toEqual({
      state: "likely_prerequisite",
      confidence: 0.9,
      directEvidenceCount: 0,
      inferredEvidenceCount: 1,
    });
  });

  it("keeps direct learning evidence above later inferred relations", () => {
    const learning = mergeInference(null, "learning", 0.8, true);
    const afterInference = mergeInference(learning, "likely_prerequisite", 0.9, false);
    expect(afterInference.state).toBe("learning");
    expect(afterInference.directEvidenceCount).toBe(1);
    expect(afterInference.inferredEvidenceCount).toBe(1);
  });

  it("does not confirm a domain without direct positive evidence", () => {
    const parsed = parseObserverResult(JSON.stringify({
      knowledge_evidence: [{
        concept: "socket",
        domain: "networking",
        direction: "negative",
        confidence: 0.9,
        explanation: "用户正在询问定义",
        evidence_quote: "socket 是什么",
      }],
      concept_relations: [],
      domain_assessments: [{
        domain_key: "networking",
        state: "confirmed",
        confidence: 0.8,
        summary: "网络基础",
        concepts: ["socket"],
        evidence_quotes: ["socket 是什么"],
      }],
      survey_candidate: null,
    }));
    expect(conservativeDomainState(parsed.domainAssessments[0], parsed.knowledgeEvidence)).toEqual({
      state: "likely_prerequisite",
      direct: false,
    });
  });

  it("does not reuse positive evidence from another domain", () => {
    const parsed = parseObserverResult(JSON.stringify({
      knowledge_evidence: [{
        concept: "socket",
        domain: "networking",
        direction: "positive",
        confidence: 0.9,
        explanation: "用户正确解释了 socket 生命周期",
        evidence_quote: "socket 从创建到关闭",
      }],
      concept_relations: [],
      domain_assessments: [{
        domain_key: "concurrency",
        state: "confirmed",
        confidence: 0.82,
        summary: "线程并发能力",
        concept_keys: ["thread pool"],
        evidence_quotes: [],
      }],
      survey_candidate: null,
    }));
    expect(parsed.domainAssessments[0].concepts).toEqual(["thread pool"]);
    expect(conservativeDomainState(parsed.domainAssessments[0], parsed.knowledgeEvidence)).toEqual({
      state: "likely_prerequisite",
      direct: false,
    });
  });

  it("parses dynamic surveys from model output instead of a fixed question", () => {
    const parsed = parseObserverResult(`\`\`\`json
{"knowledge_evidence":[],"concept_relations":[],"domain_assessments":[],"survey_candidate":{"question":"讲网络 API 时，你更希望先看调用示例还是生命周期？","dimension":"explanation_order","options":[{"value":"examples","label":"先看调用示例"},{"value":"principles","label":"先讲生命周期"}],"rationale":"本轮顺序偏好不明确","confidence":0.8}}
\`\`\``);
    expect(parsed.surveyCandidate?.question).toContain("网络 API");
    expect(parsed.surveyCandidate?.options).toHaveLength(2);
  });

  it("accepts a sourced diagnostic with one unambiguous answer", () => {
    const parsed = parseObserverResult(JSON.stringify({
      knowledge_evidence: [],
      concept_relations: [],
      domain_assessments: [],
      survey_candidate: null,
      diagnostic_candidate: {
        concept_keys: ["global:network:bind"],
        dimension: "conceptual",
        item_type: "single_choice",
        prompt: "bind 主要完成什么？",
        options: [
          { value: "address", label: "把本地地址关联到 socket" },
          { value: "connect", label: "建立远端连接" },
        ],
        answer_key: "address",
        source_refs: [{
          source_type: "course",
          source_path: "lessons/lesson_1.md",
          excerpt: "bind associates a local address with a socket.",
        }],
        rationale: "答案可由当前课件唯一确定",
        difficulty: 0.4,
      },
    }));
    expect(parsed.diagnosticCandidate?.answerKey).toBe("address");
  });

  it("drops diagnostics with duplicate or source-less answers", () => {
    const parsed = parseObserverResult(JSON.stringify({
      knowledge_evidence: [],
      concept_relations: [],
      domain_assessments: [],
      survey_candidate: null,
      diagnostic_candidate: {
        concept_keys: ["global:network:bind"],
        dimension: "conceptual",
        item_type: "single_choice",
        prompt: "哪个选项正确？",
        options: [
          { value: "same", label: "选项 A" },
          { value: "same", label: "选项 B" },
        ],
        answer_key: "same",
        source_refs: [{
          source_type: "course",
          source_path: "",
          excerpt: "",
        }],
        rationale: "答案不唯一",
        difficulty: 0.4,
      },
    }));
    expect(parsed.diagnosticCandidate).toBeNull();
  });
});
