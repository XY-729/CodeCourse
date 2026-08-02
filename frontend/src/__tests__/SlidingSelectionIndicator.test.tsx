import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SlidingSelectionIndicator from "../components/SlidingSelectionIndicator";

describe("SlidingSelectionIndicator", () => {
  it("moves the same compositor layer between active items", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const { container, rerender } = render(
      <div>
        <SlidingSelectionIndicator activeKey="a" />
        <button data-selection-key="a">A</button>
        <button data-selection-key="b">B</button>
      </div>,
    );
    const host = container.firstElementChild as HTMLElement;
    const [a, b] = Array.from(host.querySelectorAll("button"));
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue({ left: 10, top: 0, width: 200, height: 30, right: 210, bottom: 30, x: 10, y: 0, toJSON: () => ({}) });
    vi.spyOn(a, "getBoundingClientRect").mockReturnValue({ left: 18, top: 2, width: 70, height: 26, right: 88, bottom: 28, x: 18, y: 2, toJSON: () => ({}) });
    vi.spyOn(b, "getBoundingClientRect").mockReturnValue({ left: 92, top: 2, width: 92, height: 26, right: 184, bottom: 28, x: 92, y: 2, toJSON: () => ({}) });

    rerender(
      <div>
        <SlidingSelectionIndicator activeKey="b" />
        <button data-selection-key="a">A</button>
        <button data-selection-key="b">B</button>
      </div>,
    );
    await act(async () => undefined);

    const indicator = host.querySelector<HTMLElement>(".sliding-selection-indicator")!;
    expect(indicator.style.getPropertyValue("--selection-x")).toBe("82px");
    expect(indicator.style.getPropertyValue("--selection-width")).toBe("92");
    expect(indicator.style.getPropertyValue("--selection-width-px")).toBe("92px");
    expect(indicator.dataset.visible).toBe("true");
  });
});
