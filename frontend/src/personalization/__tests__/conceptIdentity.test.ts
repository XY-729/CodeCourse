import { describe, expect, it } from "vitest";
import { canonicalConceptName, mentionsConcept } from "../conceptIdentity";
import { parseObserverResult } from "../domainInference";
import { resolveKnowledgeState, type LearningEvidenceV2 } from "../knowledgeState";

describe("semantic profile identity", () => {
  it.each([
    ["std::vector<std::unique_ptr<T>>", "std::vector"],
    ["std::map<int, std::string>::iterator", "std::map::iterator"],
    ["stack", "stack"], ["最小生成树", "最小生成树"],
    ["std::vector<int>::iterator it", ""], ["下一步学习建议", ""],
    ["它要求新根必须是一个挂载点（mount point）", ""], ["std::vector<int", ""],
  ])("normalizes %s conservatively", (raw, expected) => {
    expect(canonicalConceptName(raw)).toBe(expected);
  });
  it("does not confuse embedded identifiers with concepts", () => {
    expect(mentionsConcept("kChildStackSize", "stack")).toBe(false);
    expect(mentionsConcept("character", "char")).toBe(false);
    expect(mentionsConcept("这个vector的用法", "vector")).toBe(true);
  });
  it("accepts model-derived hierarchy and conceptual understanding dimension", () => {
    const result = parseObserverResult(JSON.stringify({
      concept_relations: [{source: "std::vector", target: "STL 容器", relation_type: "is_a", confidence: .9}],
      knowledge_evidence: [{concept: "std::vector", dimension: "conceptual_understanding", direction: "negative"}],
    }));
    expect(result.conceptRelations[0].target).toBe("STL 容器");
    expect(result.knowledgeEvidence[0].dimension).toBe("conceptual");
  });
  it("neutral questions change neither mastery nor confidence or knowledge recency", () => {
    const stamp = "2026-09-05T00:00:00Z";
    const event = {id: "q", eventTime: stamp, source: "question", action: "asked_definition",
      dimension: "familiarity", direction: "neutral", strength: 0, reliability: .8} as LearningEvidenceV2;
    expect(resolveKnowledgeState("v", "global", "local-user", [event], stamp).dimensions)
      .toEqual(resolveKnowledgeState("v", "global", "local-user", [], stamp).dimensions);
  });
});
