import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CommandPalette from "./CommandPalette";
import AppDialog from "./AppDialog";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("command palette keyboard interaction", () => {
  it("skips disabled commands, scrolls selection and ignores composition Enter", async () => {
    const run = vi.fn();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<CommandPalette open onClose={vi.fn()} items={[
      { id: "disabled", label: "不可用", section: "命令", disabled: true, run },
      { id: "first", label: "打开课程", section: "命令", run },
      { id: "last", label: "打开文件", section: "命令", run },
    ]} />);
    const input = screen.getByRole("combobox");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(screen.getByRole("option", { name: /打开课程/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(run).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    const last = screen.getByRole("option", { name: /打开文件/ });
    expect(input.getAttribute("aria-activedescendant")).toBe(last.id);
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(run).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "没有这个命令" } });
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("没有匹配项");
  });

  it("contains Tab navigation and restores launcher focus on close", () => {
    const launcher = document.createElement("button");
    document.body.append(launcher);
    launcher.focus();
    const props = { items: [], onClose: vi.fn() };
    const view = render(<CommandPalette {...props} open />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭搜索" }));
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(input);
    view.rerender(<CommandPalette {...props} open={false} />);
    expect(document.activeElement).toBe(launcher);
    launcher.remove();
  });
});

describe("app dialog interaction", () => {
  it("focuses cancel for confirmation and handles Escape locally", () => {
    const cancel = vi.fn();
    const confirm = vi.fn();
    render(<AppDialog state={{ kind: "confirm", title: "删除项目", message: "确定删除？", danger: true }} value="" onValueChange={vi.fn()} onCancel={cancel} onConfirm={confirm} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "取消" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape", isComposing: true });
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("focuses the input and rejects blank form submission", () => {
    const confirm = vi.fn();
    render(<AppDialog state={{ kind: "input", title: "重命名" }} value="  " onValueChange={vi.fn()} onCancel={vi.fn()} onConfirm={confirm} />);
    const input = screen.getByRole("textbox");
    expect(document.activeElement).toBe(input);
    fireEvent.submit(input.closest("form")!);
    expect(confirm).not.toHaveBeenCalled();
    const event = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
