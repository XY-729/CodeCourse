import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CommandPalette, { type CommandPaletteItem } from "./CommandPalette";

function setup() {
  const run = vi.fn();
  const items: CommandPaletteItem[] = [
    { id: "disabled", label: "无法使用", section: "命令", disabled: true, run: vi.fn() },
    { id: "lesson", label: "移动语义", section: "课程", run },
  ];
  function Harness() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>打开搜索</button><CommandPalette open={open} items={items} onClose={() => setOpen(false)} /></>;
  }
  render(<Harness />);
  const trigger = screen.getByRole("button", { name: "打开搜索" });
  trigger.focus();
  fireEvent.click(trigger);
  return { run, trigger, search: screen.getByRole("combobox", { name: "搜索命令" }) };
}

describe("CommandPalette keyboard interaction", () => {
  it("focuses immediately, skips disabled commands and runs the selected result", () => {
    const { search, run } = setup();
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const active = screen.getByRole("option", { name: /移动语义/ });
    expect(search.getAttribute("aria-activedescendant")).toBe(active.id);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Tab focus inside and restores focus immediately on Escape", () => {
    const { search, trigger } = setup();
    fireEvent.keyDown(search, { key: "Tab" });
    const close = screen.getByRole("button", { name: "关闭搜索" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("does not run a command when Enter confirms Chinese input", () => {
    const { search, run } = setup();
    fireEvent.change(search, { target: { value: "移动" } });
    fireEvent.keyDown(search, { key: "Enter", isComposing: true });
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
