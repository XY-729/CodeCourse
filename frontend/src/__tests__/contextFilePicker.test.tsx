import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ContextFilePickerDialog from "../components/ContextFilePickerDialog";

const FILES = ["src/main.py", "src/scheduler.py", "src/worker/task.py", "README.md"];

function renderPicker(overrides: Partial<Parameters<typeof ContextFilePickerDialog>[0]> = {}) {
  const props = {
    open: true,
    files: FILES,
    selected: ["src/main.py"],
    currentPath: "src/main.py",
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ContextFilePickerDialog {...props} />);
  return props;
}

describe("ContextFilePickerDialog", () => {
  it("searches files by name and path", () => {
    renderPicker();
    const input = screen.getByLabelText("搜索文件");
    fireEvent.change(input, { target: { value: "scheduler" } });
    expect(screen.getByText("scheduler.py")).toBeTruthy();
    expect(screen.queryByText("main.py")).toBeNull();
    fireEvent.change(input, { target: { value: "worker" } });
    expect(screen.getByText("task.py")).toBeTruthy();
    expect(screen.queryByText("README.md")).toBeNull();
  });

  it("toggles checkboxes and confirms the draft", () => {
    const props = renderPicker();
    fireEvent.click(screen.getByLabelText("src/worker/task.py"));
    fireEvent.click(screen.getByLabelText("src/scheduler.py"));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(props.onConfirm).toHaveBeenCalledWith(["src/main.py", "src/worker/task.py", "src/scheduler.py"]);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("unchecks an initially selected file", () => {
    const props = renderPicker();
    fireEvent.click(screen.getByLabelText("src/main.py"));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(props.onConfirm).toHaveBeenCalledWith([]);
  });

  it("closes via Escape and backdrop without confirming", () => {
    const props = renderPicker();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("marks the current file with a badge", () => {
    renderPicker();
    expect(screen.getByText("当前")).toBeTruthy();
  });

  it("shows an empty state when nothing matches", () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText("搜索文件"), { target: { value: "zzz" } });
    expect(screen.getByText("没有匹配的文件")).toBeTruthy();
  });
});
