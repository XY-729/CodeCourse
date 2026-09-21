import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DesktopGenerationStatus, { desktopTaskProgress } from "./DesktopGenerationStatus";
import { getGenerationPreview, type GenerationPreview, type GenerationTask } from "../api/client";

vi.mock("../api/client", () => ({ getGenerationPreview: vi.fn() }));
const task = {
  id: 12, project_id: 1, task_type: "outline_lesson", status: "running",
  progress_current: 2, progress_total: 7, stage_label: "正在生成章节", progress_phase: "sections",
  completed_sections: 1, total_sections: 4, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
} as GenerationTask;
const snapshot = (markdown: string, version = "one", status = "running"): GenerationPreview => ({
  task_id: 12, status, version, total_sections: 4, completed_sections: 1, readable_sections: 1, markdown,
});
function props(value = task) {
  return { task: value, stream: null, starting: false, message: "", onOpenTask: vi.fn(), onOpenStream: vi.fn(), onRetry: vi.fn() };
}
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); window.localStorage.clear(); });

describe("desktop lesson progress and preview", () => {
  it("keeps one completed action, remains on open failure, and dismisses after success", async () => {
    const options = props({ ...task, status: "completed" });
    options.onOpenTask.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<DesktopGenerationStatus {...options} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText("查看生成内容")).toBeNull();
    await act(async () => fireEvent.click(screen.getByText("打开课件")));
    expect(screen.getByText("打开课件")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("打开课件")));
    expect(screen.queryByLabelText("课程生成进度")).toBeNull();
  });

  it("shows indeterminate planning and reserves 100% for saved completion", () => {
    expect(desktopTaskProgress({ ...task, progress_phase: "planning", progress_total: 0 })).toBeNull();
    expect(desktopTaskProgress({ ...task, progress_current: 7, progress_phase: "saving" })).toBe(99);
    expect(desktopTaskProgress({ ...task, status: "completed" })).toBe(100);
    const view = render(<DesktopGenerationStatus {...props({ ...task, progress_phase: "planning" })} />);
    expect(screen.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false);
    view.rerender(<DesktopGenerationStatus {...props()} />);
    expect(screen.getByText("28%")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("28");
    expect(screen.queryByText("已完成 1/4 章")).toBeNull();
    expect(screen.getByLabelText("课程生成进度").textContent).toBe("正在生成章节28%");
  });

  it("polls only when open, types the snapshot in without moving scroll, and never auto-opens the final course", async () => {
    vi.useFakeTimers();
    vi.mocked(getGenerationPreview).mockResolvedValue(snapshot("## 第一章\n\n先读这一章"));
    const options = props();
    const view = render(<DesktopGenerationStatus {...options} />);
    expect(getGenerationPreview).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "查看生成内容" })));
    const content = view.container.querySelector(".lesson-preview-content") as HTMLElement;
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(screen.getByText("先读这一章")).toBeTruthy();
    content.scrollTop = 150;
    vi.mocked(getGenerationPreview).mockResolvedValue(snapshot("## 第一章\n\n先读这一章\n\n## 第二章", "two"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(content.scrollTop).toBe(150);
    expect(screen.getByText("第二章")).toBeTruthy();
    vi.mocked(getGenerationPreview).mockResolvedValue(snapshot("## 第一章\n\n先读这一章\n\n## 第二章", "two", "completed"));
    await act(async () => view.rerender(<DesktopGenerationStatus {...options} task={{ ...task, status: "completed" }} />));
    expect(options.onOpenTask).not.toHaveBeenCalled();
    expect(content.scrollTop).toBe(150);
    await act(async () => fireEvent.click(screen.getByText("查看完整版")));
    expect(options.onOpenTask).toHaveBeenCalledOnce();
    const calls = vi.mocked(getGenerationPreview).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(getGenerationPreview).toHaveBeenCalledTimes(calls);
  });

  it("reveals the snapshot gradually while generating", async () => {
    vi.useFakeTimers();
    const section = "甲".repeat(400);
    vi.mocked(getGenerationPreview).mockResolvedValue(snapshot(section));
    const view = render(<DesktopGenerationStatus {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "查看生成内容" }));
    const typed = () => view.container.querySelector(".lesson-preview-content")?.textContent ?? "";
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    const partial = typed();
    expect(partial.length).toBeGreaterThan(0);
    expect(partial).not.toBe(section);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(typed()).toBe(section);
  });

  it("uses fast preview speed even with an old slow preference and hides speed controls", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("codecourse.desktop.previewSpeed", "slow");
    const section = "乙".repeat(400);
    vi.mocked(getGenerationPreview).mockResolvedValue(snapshot(section));
    const view = render(<DesktopGenerationStatus {...props()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "查看生成内容" })));
    for (const name of ["慢", "标准", "快", "立即显示"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    const partial = view.container.querySelector(".lesson-preview-content")?.textContent ?? "";
    expect(partial.length).toBeGreaterThanOrEqual(200);
    expect(partial.length).toBeLessThan(400);
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(screen.getByText(section)).toBeTruthy();
  });

  it("shows the snapshot at once when the reader asked for reduced motion", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
    try {
      vi.mocked(getGenerationPreview).mockResolvedValue(snapshot("## 第一章\n\n立刻可读"));
      render(<DesktopGenerationStatus {...props()} />);
      fireEvent.click(screen.getByRole("button", { name: "查看生成内容" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(screen.getByText("立刻可读")).toBeTruthy();
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: undefined });
    }
  });

  it("ignores late results after changing project and keeps failed preview readable", async () => {
    let resolve!: (value: GenerationPreview) => void;
    vi.mocked(getGenerationPreview).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const view = render(<DesktopGenerationStatus key={1} {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "查看生成内容" }));
    view.rerender(<DesktopGenerationStatus key={2} {...props({ ...task, project_id: 2 })} />);
    await act(async () => resolve(snapshot("旧项目绝不显示")));
    expect(screen.queryByText("旧项目绝不显示")).toBeNull();
    vi.mocked(getGenerationPreview).mockResolvedValue(snapshot("保留的第一章", "retained", "failed"));
    await act(async () => view.rerender(<DesktopGenerationStatus key={2} {...props({ ...task, project_id: 2, status: "failed", retry_available: true })} />));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "查看生成内容" })));
    expect(screen.getByText("保留的第一章")).toBeTruthy();
    expect(screen.getAllByText("重试").length).toBeGreaterThan(0);
  });

  it("keeps the revealed progress when the panel is closed and reopened", async () => {
    vi.useFakeTimers();
    const first = "甲".repeat(200);
    vi.mocked(getGenerationPreview).mockResolvedValue(snapshot(first));
    const view = render(<DesktopGenerationStatus {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "查看生成内容" }));
    const typed = () => view.container.querySelector(".lesson-preview-content")?.textContent ?? "";
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(typed()).toBe(first);
    fireEvent.click(screen.getByLabelText("关闭课件预读"));
    expect(view.container.querySelector(".lesson-preview-content")).toBeNull();
    const grown = `${first}${"乙".repeat(100)}`;
    vi.mocked(getGenerationPreview).mockResolvedValue(snapshot(grown, "two"));
    fireEvent.click(screen.getByRole("button", { name: "查看生成内容" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    // 已显示的部分直接在场（不重打），此时还在打这次新增的那 100 字
    expect(typed().startsWith(first)).toBe(true);
    expect(typed()).not.toBe(grown);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(typed()).toBe(grown);
  });

  it("does not overlap requests on slow responses and stops on close", async () => {
    vi.useFakeTimers();
    let resolve!: (value: GenerationPreview) => void;
    vi.mocked(getGenerationPreview).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render(<DesktopGenerationStatus {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "查看生成内容" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(getGenerationPreview).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText("关闭课件预读"));
    await act(async () => { resolve(snapshot("已关闭")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(getGenerationPreview).toHaveBeenCalledOnce();
  });
});
