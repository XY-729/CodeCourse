import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import GenerationSheet from "./GenerationSheet";
import type { Project } from "../api/client";
afterEach(cleanup);
function props() {
  return { open: true, intent: "outline" as const, project: { id: 1, project_type: "repository" } as Project, scope: "files" as const,
    selectedFileCount: 0, instructions: "", running: false, activeTask: null, taskMessage: "",
    onClose: vi.fn(), onScopeChange: vi.fn(), onInstructionsChange: vi.fn(), onOpenPrompts: vi.fn(), onOpenFiles: vi.fn(), onGenerate: vi.fn() };
}
it("offers file selection without closing the sheet and validates missing files", () => {
  const options = props();
  const view = render(<GenerationSheet {...options} />);
  expect((screen.getByRole("button", { name: "生成总纲" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
  expect(options.onOpenFiles).toHaveBeenCalledOnce();
  expect(options.onClose).not.toHaveBeenCalled();
  view.rerender(<GenerationSheet {...options} selectedFileCount={2} />);
  fireEvent.click(screen.getByRole("button", { name: "生成总纲" }));
  expect(options.onGenerate).toHaveBeenCalledOnce();
});
it("requires a learning goal and submits the latest draft without waiting for debounce", () => {
  const options = props();
  render(<GenerationSheet {...options} scope="learning_plan" project={{ ...options.project, project_type: "learning_plan" }} />);
  expect((screen.getByRole("button", { name: "生成总纲" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "学习移动语义" } });
  fireEvent.click(screen.getByRole("button", { name: "生成总纲" }));
  expect(options.onGenerate).toHaveBeenCalledWith("学习移动语义");
});
