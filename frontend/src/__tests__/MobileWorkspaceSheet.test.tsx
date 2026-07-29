import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MobileWorkspaceSheet from "../components/MobileWorkspaceSheet";

describe("MobileWorkspaceSheet", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it("routes the header close button through the sheet dismiss path", () => {
    const onDismiss = vi.fn();
    const { getByRole } = render(
      <MobileWorkspaceSheet tabKey="courses" title="课程" onDismiss={onDismiss}>
        <p>课程内容</p>
      </MobileWorkspaceSheet>,
    );

    fireEvent.click(getByRole("button", { name: "关闭课程" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps the physical sheet mounted while switching workspace content", () => {
    const onDismiss = vi.fn();
    const { getByRole, rerender } = render(
      <MobileWorkspaceSheet tabKey="courses" title="课程" onDismiss={onDismiss}>
        <p>课程内容</p>
      </MobileWorkspaceSheet>,
    );
    const sheet = getByRole("region", { name: "课程" });

    rerender(
      <MobileWorkspaceSheet tabKey="files" title="源码" onDismiss={onDismiss}>
        <p>源码内容</p>
      </MobileWorkspaceSheet>,
    );

    expect(getByRole("region", { name: "源码" })).toBe(sheet);
    expect(getByRole("button", { name: "关闭源码" })).toBeTruthy();
  });
});
