import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ReaderLearningToolbar from "./ReaderLearningToolbar";

describe("ReaderLearningToolbar completion feedback", () => {
  const props = { title: "移动语义", index: 1, total: 6, completed: false, onToggleComplete: vi.fn() };

  it("celebrates only after the requested completion is confirmed", () => {
    const onToggleComplete = vi.fn();
    const { rerender } = render(<ReaderLearningToolbar {...props} onToggleComplete={onToggleComplete} actions={<button>标注术语</button>} />);
    expect(screen.getByRole("button", { name: "标注术语" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "标记完成" }));
    expect(onToggleComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("");
    rerender(<ReaderLearningToolbar {...props} completed onToggleComplete={onToggleComplete} />);
    expect(screen.getByRole("status").textContent).toContain("又点亮了一颗星");
    expect(screen.getByRole("button", { name: "已完成" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "已完成" }));
    rerender(<ReaderLearningToolbar {...props} onToggleComplete={onToggleComplete} />);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("does not celebrate a completed lesson restored from storage", () => {
    render(<ReaderLearningToolbar {...props} completed />);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.getByRole("button", { name: "已完成" })).toBeTruthy();
  });
});
