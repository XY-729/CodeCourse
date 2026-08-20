import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QARecord, QAThreadSummary, TeachingHandoff } from "../api/client";
import { groupQARecordsByThreads, TeachingClosureCard, TeachingResumeCard } from "./TeachingContinuityCards";

const HANDOFF: TeachingHandoff = {
  id: 1, projectId: 1, sessionId: 10, qaRecordId: 2, engagement: "learning",
  topic: "状态管理", progressSummary: "理解了状态更新入口", establishedPoints: ["入口统一"],
  unresolvedPoints: ["异步更新顺序"],
  nextActions: [{ kind: "follow_up", label: "继续理解顺序", prompt: "异步更新按什么顺序发生？" }],
  sourceType: "file", sourcePath: "src/App.tsx", sourceAvailable: true,
  usedPriorContext: true, isCurrent: true, createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z",
};

function record(id: number, sessionId: number): QARecord {
  return {
    id, project_id: 1, session_id: sessionId, parent_qa_id: null, relation_type: "follow_up",
    source_type: "file", source_path: "src/App.tsx", selected_text: "", question: `问题 ${id}`,
    answer_md: `回答 ${id}`, provider: "test", model: "test", favorite: false,
    created_at: `2026-08-20T00:00:0${id}Z`, updated_at: `2026-08-20T00:00:0${id}Z`,
  };
}

describe("TeachingContinuityCards", () => {
  it("requires a user click for resume and next actions", () => {
    const resume = vi.fn();
    const next = vi.fn();
    const ask = vi.fn();
    const { rerender } = render(<TeachingResumeCard handoff={HANDOFF} onResume={resume} onOpenSource={vi.fn()} onDismiss={vi.fn()} />);
    expect(resume).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "继续学习" }));
    expect(resume).toHaveBeenCalledWith(HANDOFF);
    expect(ask).not.toHaveBeenCalled();

    rerender(<TeachingClosureCard handoff={HANDOFF} onAction={next} />);
    fireEvent.click(screen.getByRole("button", { name: "继续理解顺序" }));
    expect(next).toHaveBeenCalledWith(HANDOFF.nextActions[0], HANDOFF);
    expect(ask).not.toHaveBeenCalled();
  });

  it("groups records by topic, keeps current first, and supplies a legacy fallback", () => {
    const current = record(2, 10);
    const legacy = record(3, 20);
    const threads: QAThreadSummary[] = [{
      sessionId: 10, topic: "状态管理", progressSummary: "理解入口", unresolvedPoints: [], turnCount: 1,
      latestQaRecordId: 2, sourceType: "file", sourcePath: "src/App.tsx", isCurrent: true,
      updatedAt: current.updated_at, records: [2],
    }];
    const groups = groupQARecordsByThreads(threads, [legacy, current]);
    expect(groups.map((group) => group.summary.topic)).toEqual(["状态管理", "问题 3"]);
    expect(groups[0].records).toEqual([current]);
  });
});
