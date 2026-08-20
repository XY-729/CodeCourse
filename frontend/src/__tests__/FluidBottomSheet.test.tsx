import { createRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FluidBottomSheet, { type FluidBottomSheetHandle } from "../components/FluidBottomSheet";

describe("FluidBottomSheet", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  });

  it("uses a non-native draggable 44pt grabber with a readable label", () => {
    const { getByRole } = render(
      <FluidBottomSheet label="生成课程" onDismiss={vi.fn()}>
        <p>内容</p>
      </FluidBottomSheet>,
    );

    const grabber = getByRole("button", { name: "下拉关闭生成课程" });
    expect(grabber.getAttribute("draggable")).toBe("false");
    expect(grabber.classList.contains("fluid-sheet-grabber")).toBe(true);
  });

  it("dismisses after a decisive downward pointer gesture", () => {
    const onDismiss = vi.fn();
    const { getByRole } = render(
      <FluidBottomSheet label="生成课程" onDismiss={onDismiss}>
        <p>内容</p>
      </FluidBottomSheet>,
    );
    const grabber = getByRole("button", { name: "下拉关闭生成课程" });

    fireEvent.pointerDown(grabber, { button: 0, clientY: 100, pointerId: 7 });
    fireEvent.pointerMove(grabber, { clientY: 300, pointerId: 7 });
    fireEvent.pointerUp(grabber, { clientY: 300, pointerId: 7 });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("exposes the same animated dismiss path to close buttons and backdrops", () => {
    const onDismiss = vi.fn();
    const ref = createRef<FluidBottomSheetHandle>();
    const { getByRole } = render(
      <FluidBottomSheet ref={ref} label="生成课程" onDismiss={onDismiss}>
        <p>内容</p>
      </FluidBottomSheet>,
    );

    ref.current?.dismiss();
    expect(getByRole("region", { name: "生成课程" }).dataset.contentSuspended).toBe("true");
    expect(onDismiss).toHaveBeenCalledTimes(1);

    ref.current?.dismiss();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("adjusts scrim alpha when the sheet is dragged halfway down", () => {
    // Capture rAF callbacks so we can flush the coalesced paint
    const rafCb: { current: null | ((t: number) => void) } = { current: null };
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: any) => {
      rafCb.current = cb;
      return 1;
    });
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 360,
      height: 600,
      top: 0,
      right: 360,
      bottom: 600,
      left: 0,
      toJSON: () => ({}),
    });
    const { getByRole } = render(
      <div>
        <FluidBottomSheet label="课程" onDismiss={vi.fn()}>
          <p>内容</p>
        </FluidBottomSheet>
      </div>,
    );
    const grabber = getByRole("button", { name: "下拉关闭课程" });
    const sheet = getByRole("region", { name: "课程" });
    const layer = sheet.parentElement;

    expect(layer?.style.getPropertyValue("--sheet-scrim-alpha")).toBe("0.24");
    fireEvent.pointerDown(grabber, { button: 0, clientY: 100, pointerId: 8 });
    fireEvent.pointerMove(grabber, { clientY: 399, pointerId: 8 });
    // Flush the coalesced rAF paint
    rafCb.current?.(16);

    expect(sheet.style.transform).toContain("299px");
    expect(layer?.style.getPropertyValue("--sheet-scrim-alpha")).toBe("0");
    bounds.mockRestore();
  });

  it("starts below the viewport before springing upward", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const clientHeight = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(620);

    const { getByRole } = render(
      <FluidBottomSheet label="生成课程" onDismiss={vi.fn()}>
        <p>内容</p>
      </FluidBottomSheet>,
    );
    const sheet = getByRole("region", { name: "生成课程" });

    expect(sheet.dataset.entryEdge).toBe("bottom");
    expect(Number(sheet.dataset.entryStartY)).toBe(618);
    expect(sheet.dataset.motionPhase).toBeUndefined();
    expect(sheet.style.transform).toContain("618px");
    expect(sheet.parentElement?.style.getPropertyValue("--sheet-scrim-alpha")).toBe("0");

    frames.shift()?.(16);
    expect(sheet.dataset.motionPhase).toBe("entering");
    expect(sheet.style.transform).toBe("translate3d(0, 0, 0)");

    requestFrame.mockRestore();
    clientHeight.mockRestore();
  });
});
