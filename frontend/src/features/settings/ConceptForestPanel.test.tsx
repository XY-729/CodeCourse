import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getKnowledgeStates,
  listConcepts,
  markConceptUnknown,
} from "../../api/client";
import ConceptForestPanel from "./ConceptForestPanel";

vi.mock("../../api/client", () => ({
  clearConceptOverride: vi.fn(),
  getKnowledgeStates: vi.fn(),
  listConcepts: vi.fn(),
  markConceptKnown: vi.fn(),
  markConceptUnknown: vi.fn(),
}));

const concepts = [
  {
    id: "concept-cpp", conceptKey: "global:cpp", canonicalName: "C++", displayName: "C++",
    domain: "cpp", conceptType: "language_feature", aliases: ["cpp"], difficulty: 0.2,
    createdAt: "2026-10-01T00:00:00Z", parent_id: null, scope: "global" as const, project_id: null,
  },
  {
    id: "concept-stl", conceptKey: "global:stl", canonicalName: "STL 容器", displayName: "STL 容器",
    domain: "cpp", conceptType: "language_feature", aliases: [], difficulty: 0.4,
    createdAt: "2026-10-01T00:00:00Z", parent_id: "concept-cpp", scope: "global" as const, project_id: null,
  },
  {
    id: "concept-vector", conceptKey: "global:vector", canonicalName: "std::vector", displayName: "std::vector",
    domain: "cpp", conceptType: "language_feature", aliases: ["vector"], difficulty: 0.5,
    createdAt: "2026-10-01T00:00:00Z", parent_id: "concept-stl", scope: "global" as const, project_id: null,
  },
];

function knowledgeState(conceptId: string, status: "confirmed" | "learning" | "uncertain", manual: "known" | "unknown" | null) {
  const dimension = {
    probability: 0.83, uncertainty: 0.1, status, evidenceCount: 2,
    directEvidenceCount: 1, objectiveAttemptCount: 0, reliableCorrectSessions: 0,
    manualStatus: manual ?? null,
  };
  return {
    conceptId,
    scopeType: "global" as const,
    scopeId: "local-user",
    dimensions: {
      familiarity: { ...dimension, manualStatus: manual }, conceptual: dimension,
      code_reading: dimension, implementation: dimension, debugging: dimension, transfer: dimension,
    },
    policyVersion: "v1",
    evidenceVersion: 1,
    updatedAt: "2026-10-20T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listConcepts).mockResolvedValue(concepts);
  vi.mocked(getKnowledgeStates).mockResolvedValue({
    policyVersion: "v1",
    states: [knowledgeState("concept-vector", "confirmed", null)],
  });
  vi.mocked(markConceptUnknown).mockResolvedValue({
    status: "ok", conceptId: "concept-vector",
  } as never);
});

describe("ConceptForestPanel", () => {
  it("shows the authoritative parent chain and the plan root state", async () => {
    render(
      <ConceptForestPanel
        projectId={7}
        projectName="C++ 学习计划"
        planRootStatus="ready"
        planRootConceptIds={["concept-cpp"]}
      />,
    );
    await screen.findByText("std::vector");
    expect(screen.getByText("计划根已识别")).toBeTruthy();
    expect(screen.getByText(/实际计划根：C\+\+/)).toBeTruthy();
    // Parent chain survives a reload because it comes from the stored tree.
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.textContent?.includes("std::vector"))).toContain(true);
    expect(rows[0].textContent).toContain("C++");
    expect(rows[2].textContent).toContain("std::vector");
  });

  it("shows factual state, never a mastery percentage", async () => {
    render(<ConceptForestPanel projectId={7} planRootStatus="ready" planRootConceptIds={["concept-cpp"]} />);
    await screen.findByText("std::vector");
    const text = document.body.textContent ?? "";
    // The disclaimer may mention mastery; no node may claim a mastery number.
    expect(text).not.toMatch(/\d+%/);
    expect(text).not.toContain("掌握 35%");
    // Evidence from the answer is described as researched ranges, not as
    // "understood"; concepts without any state stay unrecorded.
    expect(text).toContain("未确认理解");
    expect(text).toContain("有证据的范围：理解");
    expect(text).toContain("暂无学习记录");
  });

  it("reports a pending or failed root instead of pretending it exists", async () => {
    const { rerender } = render(
      <ConceptForestPanel projectId={7} planRootStatus="pending" planRootError="根识别超时" />,
    );
    await screen.findByText("std::vector");
    expect(screen.getByText("计划根待识别")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("根识别超时");
    rerender(<ConceptForestPanel projectId={7} planRootStatus="failed" planRootError={null} />);
    expect(screen.getByText("计划根识别失败，可重试")).toBeTruthy();
  });

  it("opens the evidence list for a concept", async () => {
    const onOpenEvidence = vi.fn();
    render(
      <ConceptForestPanel
        projectId={7}
        planRootStatus="ready"
        onOpenEvidence={onOpenEvidence}
      />,
    );
    await screen.findByText("std::vector");
    const rows = screen.getAllByRole("listitem");
    const vectorRow = rows.find((row) => row.textContent?.includes("std::vector"))!;
    fireEvent.click(vectorRow.querySelector("button")!);
    expect(onOpenEvidence).toHaveBeenCalledWith("concept-vector");
  });

  it("keeps manual correction available and resets on failure", async () => {
    vi.mocked(markConceptUnknown).mockRejectedValueOnce(new Error("保存失败"));
    render(<ConceptForestPanel projectId={7} planRootStatus="ready" />);
    await screen.findByText("std::vector");
    const rows = screen.getAllByRole("listitem");
    const cppRow = rows.find((row) => row.textContent?.includes("C++"))!;
    const buttons = cppRow.querySelectorAll("button");
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("保存失败"));
  });

  it("explains an empty forest instead of inventing nodes", async () => {
    vi.mocked(listConcepts).mockResolvedValue([]);
    vi.mocked(getKnowledgeStates).mockResolvedValue({ policyVersion: "v1", states: [] });
    render(<ConceptForestPanel projectId={7} planRootStatus="unassigned" />);
    await screen.findByText(/还没有概念记录/);
    expect(screen.getByText("尚未关联计划根")).toBeTruthy();
  });
});
