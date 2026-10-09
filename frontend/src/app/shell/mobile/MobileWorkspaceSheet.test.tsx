import {
  render,
} from "@testing-library/react";

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import MobileWorkspaceSheet from "./MobileWorkspaceSheet";

describe(
  "MobileWorkspaceSheet",
  () => {
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

    it(
      "applies the me variant",
      () => {
        const { container } =
          render(
            <MobileWorkspaceSheet
              tabKey="me"
              title="我的"
              variant="me"
              onDismiss={() =>
                undefined
              }
            >
              <div>我的内容</div>
            </MobileWorkspaceSheet>,
          );

        expect(
          container.querySelector(
            ".mobile-workspace-sheet.is-me",
          ),
        ).not.toBeNull();
      },
    );

    it(
      "applies the generation variant",
      () => {
        const { container } =
          render(
            <MobileWorkspaceSheet
              tabKey="generation"
              title="生成中心"
              variant="generation"
              onDismiss={() =>
                undefined
              }
            >
              <div>生成内容</div>
            </MobileWorkspaceSheet>,
          );

        expect(
          container.querySelector(
            ".mobile-workspace-sheet.is-generation",
          ),
        ).not.toBeNull();
      },
    );
  },
);
