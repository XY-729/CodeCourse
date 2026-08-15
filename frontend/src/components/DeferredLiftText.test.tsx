import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeferredLiftInput, DeferredLiftTextarea } from "./DeferredLiftText";

afterEach(() => {
  vi.useRealTimers();
});

describe("DeferredLiftTextarea", () => {
  it("keeps the draft local while typing (no parent lift per keystroke)", () => {
    const onLift = vi.fn();
    render(<DeferredLiftTextarea value="" onLift={onLift} aria-label="草稿" />);
    const textbox = screen.getByRole("textbox", { name: "草稿" }) as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: "你好" } });
    expect(textbox.value).toBe("你好");
    expect(onLift).not.toHaveBeenCalled();
  });

  it("lifts the draft on blur", () => {
    const onLift = vi.fn();
    render(<DeferredLiftTextarea value="" onLift={onLift} aria-label="草稿" />);
    const textbox = screen.getByRole("textbox", { name: "草稿" }) as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: "提交内容" } });
    fireEvent.blur(textbox);
    expect(onLift).toHaveBeenCalledWith("提交内容");
  });

  it("lifts the final draft on unmount so it survives tab switches", () => {
    const onLift = vi.fn();
    const { unmount } = render(<DeferredLiftTextarea value="" onLift={onLift} aria-label="草稿" />);
    const textbox = screen.getByRole("textbox", { name: "草稿" }) as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: "未失焦的草稿" } });
    unmount();
    expect(onLift).toHaveBeenCalledWith("未失焦的草稿");
  });

  it("resets the draft when the parent bumps resetToken", () => {
    const onLift = vi.fn();
    const { rerender } = render(<DeferredLiftTextarea value="" onLift={onLift} resetToken={0} aria-label="草稿" />);
    const textbox = screen.getByRole("textbox", { name: "草稿" }) as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: "旧草稿" } });
    rerender(<DeferredLiftTextarea value="" onLift={onLift} resetToken={1} aria-label="草稿" />);
    expect(textbox.value).toBe("");
  });

  it("syncs external value changes down (e.g. suggestion fill)", () => {
    const onLift = vi.fn();
    const { rerender } = render(<DeferredLiftTextarea value="" onLift={onLift} aria-label="草稿" />);
    rerender(<DeferredLiftTextarea value="建议问题" onLift={onLift} aria-label="草稿" />);
    expect((screen.getByRole("textbox", { name: "草稿" }) as HTMLTextAreaElement).value).toBe("建议问题");
  });
});

describe("DeferredLiftInput debounce", () => {
  it("lifts once after the silence window", () => {
    vi.useFakeTimers();
    const onLift = vi.fn();
    render(<DeferredLiftInput value="" onLift={onLift} liftDelayMs={250} aria-label="搜索" />);
    const input = screen.getByRole("textbox", { name: "搜索" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    expect(onLift).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(onLift).toHaveBeenCalledTimes(1);
    expect(onLift).toHaveBeenCalledWith("ab");
  });
});
