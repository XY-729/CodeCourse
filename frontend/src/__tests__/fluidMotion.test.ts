import { describe, expect, it, vi } from "vitest";
import {
  animateSpringY,
  project,
  rubberband,
  sheetBackdropProgress,
  sheetOpenProgress,
} from "../gestures/fluidMotion";

describe("fluid motion helpers", () => {
  it("projects release velocity in the direction of travel", () => {
    expect(project(1000, 0.99)).toBeCloseTo(99, 6);
    expect(project(-1000, 0.99)).toBeCloseTo(-99, 6);
    expect(project(0, 0.99)).toBe(0);
  });

  it("rubber-bands continuously with increasing resistance", () => {
    const first = rubberband(20, 400);
    const second = rubberband(80, 400);
    const reverse = rubberband(-80, 400);

    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(second).toBeLessThan(80);
    expect(reverse).toBeCloseTo(-second, 6);
  });

  it("clears the backdrop by the halfway drag position", () => {
    expect(sheetOpenProgress(0, 600)).toBe(1);
    expect(sheetOpenProgress(300, 600)).toBe(0.5);
    expect(sheetOpenProgress(600, 600)).toBe(0);

    expect(sheetBackdropProgress(0, 600)).toBe(1);
    expect(sheetBackdropProgress(150, 600)).toBe(0.5);
    expect(sheetBackdropProgress(300, 600)).toBe(0);
    expect(sheetBackdropProgress(600, 600)).toBe(0);
  });

  it("moves monotonically upward during the opening frames", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
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
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const element = document.createElement("div");
    element.style.transform = "translate3d(0, 600px, 0)";
    document.body.appendChild(element);
    const positions: number[] = [];

    animateSpringY(element, 0, {
      damping: 1,
      response: 0.32,
      onUpdate: (position) => positions.push(position),
    });
    frames.shift()?.(16);
    frames.shift()?.(32);
    frames.shift()?.(48);

    expect(positions[0]).toBe(600);
    expect(positions[1]).toBeLessThan(positions[0]);
    expect(positions[2]).toBeLessThan(positions[1]);
    expect(positions[3]).toBeLessThan(positions[2]);

    element.remove();
    now.mockRestore();
    requestFrame.mockRestore();
  });
});
