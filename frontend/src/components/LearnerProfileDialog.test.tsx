import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  getPersonalizationProfile: vi.fn(async () => ({
    concepts: [], knowledgeStates: [], domainProfiles: [],
    inferences: [{id: "topic", subjectType: "domain", subjectKey: "C++ 标准库", scopeType: "project",
      scopeId: "1", summary: "正在比较容器用途，尚缺少独立选型的证据。", state: "insufficient",
      confidence: .8, updatedAt: "2026-09-05T00:00:00Z", evidence: []}],
    relations: [{id: "edge", sourceConceptId: "v", targetConceptId: "stl", sourceName: "std::vector",
      targetName: "STL 容器", relationType: "is_a", domain: "C++ 标准库"}],
    learningEvidence: [{id: "e", conceptId: "v", dimension: "conceptual", source: "observer", action: "candidate_accepted",
      direction: "negative", reliability: .6, eventTime: "2026-09-05T00:00:00Z", object: {}, context: {},
      result: {explanation: "迭代器失效的条件仍需澄清", evidenceQuote: "我不确定扩容后是否有效"}}],
    modelCalls: [], surveyCandidate: null,
  })),
  getLearnerPreferences: vi.fn(async () => ({})),
}));
import LearnerProfileDialog from "./LearnerProfileDialog";

afterEach(cleanup);
describe("learning profile semantic presentation", () => {
  it("shows a project topic and named hierarchy without claiming mastery", async () => {
    render(<LearnerProfileDialog open projectId={1} onClose={vi.fn()} />);
    expect(await screen.findByText("正在比较容器用途，尚缺少独立选型的证据。")).toBeTruthy();
    expect(screen.getByText("知识联系（不代表已掌握）")).toBeTruthy();
    expect(screen.getByText("std::vector 属于 STL 容器")).toBeTruthy();
  });
  it("separates interpreted progress from the original supporting quote", async () => {
    render(<LearnerProfileDialog open projectId={1} onClose={vi.fn()} />);
    await screen.findByText("正在比较容器用途，尚缺少独立选型的证据。");
    fireEvent.click(screen.getByRole("button", {name: "判断依据"}));
    expect(screen.getByText("迭代器失效的条件仍需澄清")).toBeTruthy();
    expect(screen.getByText("依据：我不确定扩容后是否有效")).toBeTruthy();
  });
});
