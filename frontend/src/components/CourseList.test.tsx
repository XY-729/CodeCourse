import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CourseList from "./CourseList";
import { TEACHING_CHANGED, type TeachingDocument } from "../personalization/teachingApi";
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../personalization/teachingApi", async (original) => ({ ...await original<object>(), getCourseUnderstanding: api.get }));
vi.mock("./TeachingIndexControl", () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const doc = { sourcePath: "qa/1.md", sourceType: "qa", status: "pending", indexStatus: "pending", documentConfirmed: false } as TeachingDocument;
const files = [{ filename: "qa/1.md", title: "回答", group: "问答" }];
it("hides pending labels, updates immediately after saving and clears on undo", async () => {
  api.get.mockResolvedValue([doc]);
  render(<CourseList projectId={1} files={files} selected={null} onSelect={() => {}} />);
  await act(async () => {});
  expect(screen.queryByText("待确认")).toBeNull();
  expect(screen.queryByRole("img", { name: "已理解" })).toBeNull();
  api.get.mockImplementation(() => new Promise(() => {}));
  act(() => { window.dispatchEvent(new CustomEvent(TEACHING_CHANGED, { detail: { projectId: 1, document: { ...doc, documentConfirmed: true } } })); });
  expect(screen.getByRole("img", { name: "已理解" })).toBeTruthy();
  act(() => { window.dispatchEvent(new CustomEvent(TEACHING_CHANGED, { detail: { projectId: 1, document: doc } })); });
  expect(screen.queryByRole("img", { name: "已理解" })).toBeNull();
});
it("restores the mark for legacy answers without pretending the index is complete", async () => {
  api.get.mockResolvedValue([{ ...doc, documentConfirmed: true }]);
  render(<CourseList projectId={1} files={files} selected={null} onSelect={() => {}} />);
  expect(await screen.findByRole("img", { name: "已理解" })).toBeTruthy();
});
