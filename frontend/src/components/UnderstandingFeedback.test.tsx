// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import UnderstandingFeedback from "./UnderstandingFeedback";
import type { TeachingDocument } from "../personalization/teachingApi";
const calls = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("../personalization/teachingApi", async (original) => ({ ...await original<object>(), getTeachingDocument: calls.load, saveUnderstanding: calls.save }));
vi.mock("./TeachingIndexControl", () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const state: TeachingDocument = { documentId: "doc", contentHash: "hash", sourceType: "qa", sourcePath: "qa.md", indexStatus: "complete",
  status: "pending", coreCount: 2, understoodCount: 0, feedback: [], passages: ["one", "two"].map((id) => ({ id, concept_id: id, display_name: id,
    aspect: "基本原理", kind: "explained", core: 1, dimension: "conceptual", quote: "正文中的讲解段落", start_line: 1, understanding: "pending" })) };
describe("understanding feedback", () => {
  it("only submits selected coverage and can revoke its feedback", async () => {
    calls.load.mockResolvedValue(state);
    calls.save.mockResolvedValue({ ...state, status: "understood", feedback: [{ id: "f", passage_id: "one", result: "understood" }] });
    render(<UnderstandingFeedback projectId={1} sourceType="qa" sourcePath="qa.md" />);
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "已理解" }));
    await waitFor(() => expect(calls.save).toHaveBeenCalledWith(1, state, "understood", ["one"], expect.any(String)));
    calls.load.mockResolvedValue({ ...state, feedback: [{ id: "f", passage_id: "one", result: "understood" }] });
    cleanup();
    render(<UnderstandingFeedback projectId={1} sourceType="qa" sourcePath="qa.md" />);
    fireEvent.click(await screen.findByRole("button", { name: "撤销反馈" }));
    await waitFor(() => expect(calls.save.mock.calls.at(-1)?.[2]).toBe("clear"));
  });
  it("offers only one reversible understanding button in simple mode", async () => {
    calls.load.mockResolvedValue({ ...state, feedback: [{ id: "f", passage_id: "one", result: "understood" }] });
    calls.save.mockResolvedValue(state);
    render(<UnderstandingFeedback simple projectId={1} sourceType="qa" sourcePath="qa.md" />);
    const button = await screen.findByRole("button", { name: "✓ 已理解" });
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText("部分理解")).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(calls.save.mock.calls[0][2]).toBe("clear"));
  });
  it("displays errors and retries with the same idempotency key", async () => {
    calls.load.mockResolvedValue(state);
    calls.save.mockRejectedValue(new Error("保存失败"));
    render(<UnderstandingFeedback projectId={1} sourceType="qa" sourcePath="qa.md" />);
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "仍有疑问" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "仍有疑问" }));
    await waitFor(() => expect(calls.save).toHaveBeenCalledTimes(2));
    expect(calls.save.mock.calls[0][4]).toBe(calls.save.mock.calls[1][4]);
  });
});
