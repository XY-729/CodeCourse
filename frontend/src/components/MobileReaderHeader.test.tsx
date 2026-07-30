import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MobileReaderHeader from "./MobileReaderHeader";

const TABS = [
  { id: "lesson-1", title: "项目入口", path: "lessons/lesson_01.md" },
  { id: "lesson-2", title: "状态管理", path: "lessons/lesson_02.md" },
];

describe("MobileReaderHeader", () => {
  it("marks the active document tab", () => {
    render(<MobileReaderHeader tabs={TABS} activeId="lesson-2" onActivate={() => undefined} onClose={() => undefined} />);
    expect(screen.getByRole("tab", { name: /状态管理/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("activates and closes tabs", () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    render(<MobileReaderHeader tabs={TABS} activeId="lesson-1" onActivate={onActivate} onClose={onClose} />);

    fireEvent.click(screen.getByRole("tab", { name: "状态管理" }));
    expect(onActivate).toHaveBeenCalledWith("lesson-2");

    fireEvent.click(screen.getByRole("button", { name: "关闭 状态管理" }));
    expect(onClose).toHaveBeenCalledWith("lesson-2");
  });

  it("runs lesson navigation actions", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onToggleComplete = vi.fn();

    render(
      <MobileReaderHeader
        tabs={TABS}
        activeId="lesson-2"
        onActivate={() => undefined}
        onClose={() => undefined}
        lesson={{ index: 1, total: 12, completed: false, onPrevious, onNext, onToggleComplete }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "上一课" }));
    fireEvent.click(screen.getByRole("button", { name: "下一课" }));
    fireEvent.click(screen.getByRole("button", { name: "标记本课完成" }));

    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onToggleComplete).toHaveBeenCalledTimes(1);
  });

  it("opens file search", () => {
    const onSearch = vi.fn();
    render(
      <MobileReaderHeader
        tabs={[{ id: "file", title: "App.tsx", path: "frontend/src/App.tsx" }]}
        activeId="file"
        onActivate={() => undefined}
        onClose={() => undefined}
        language="typescript"
        onSearch={onSearch}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "在当前文件中搜索" }));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("typescript")).toBeTruthy();
  });
});
