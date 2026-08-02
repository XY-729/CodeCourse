import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SelectionQuickBar from "../components/SelectionQuickBar";

describe("SelectionQuickBar", () => {
  it("coalesces scroll positioning into one animation frame", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(7);
    const { container } = render(
      <SelectionQuickBar
        canHighlight
        highlighted={false}
        anchorRect={{ left: 120, top: 180, right: 220, bottom: 204, width: 100, height: 24 }}
        onAsk={() => undefined}
        onExplainTerm={() => undefined}
        onToggleHighlight={() => undefined}
        onCopy={() => undefined}
        onClose={() => undefined}
      />,
    );
    const bar = container.querySelector<HTMLElement>(".selection-quick-bar")!;
    expect(bar.dataset.anchored).toBe("true");

    fireEvent.scroll(document);
    fireEvent.scroll(document);

    expect(raf).toHaveBeenCalledTimes(1);
  });
});
