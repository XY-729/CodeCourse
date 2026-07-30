import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  getLLMSettings,
  getPersonalizationRuntimeSettings,
  testLLMSettings,
} from "../api/client";

import LLMSettingsDialog from "./LLMSettingsDialog";

vi.mock(
  "../api/client",
  () => ({
    getLLMSettings:
      vi.fn(),

    getLearnerPreferences:
      vi.fn(),

    getPersonalizationRuntimeSettings:
      vi.fn(),

    resetPersonalizationProfile:
      vi.fn(),

    saveLLMSettings:
      vi.fn(),

    savePersonalizationRuntimeSettings:
      vi.fn(),

    testLLMSettings:
      vi.fn(),

    updateLearnerPreferences:
      vi.fn(),
  }),
);

const getSettingsMock =
  vi.mocked(
    getLLMSettings,
  );

const getRuntimeMock =
  vi.mocked(
    getPersonalizationRuntimeSettings,
  );

const testMock =
  vi.mocked(
    testLLMSettings,
  );

beforeEach(() => {
  vi.clearAllMocks();

  getSettingsMock.mockResolvedValue({
    provider: "deepseek",
    base_url:
      "https://api.deepseek.com",
    model: "deepseek-chat",
    enabled: true,
    has_api_key: true,
    masked_api_key: "***",
  });

  getRuntimeMock.mockResolvedValue({
    supported: false,
    teacher_planner_enabled:
      false,
    observer_enabled: false,
    teacher_planner_mode:
      "assist",
    observer_mode:
      "shadow",
  });
});

describe(
  "LLMSettingsDialog lifecycle",
  () => {
    it(
      "reports busy while testing and disables close",
      async () => {
        let resolveTest:
          (
            value: {
              ok: boolean;
              provider: string;
              message: string;
            },
          ) => void =
          () => undefined;

        testMock.mockImplementationOnce(
          () =>
            new Promise(
              (resolve) => {
                resolveTest =
                  resolve;
              },
            ),
        );

        const onBusyChange =
          vi.fn();

        render(
          <LLMSettingsDialog
            open
            projectId={null}
            onClose={() =>
              undefined
            }
            onConfirm={() =>
              Promise.resolve(true)
            }
            onOpenExternal={() =>
              undefined
            }
            onBusyChange={
              onBusyChange
            }
          />,
        );

        await screen.findByDisplayValue(
          "deepseek-chat",
        );

        fireEvent.click(
          screen.getByRole(
            "button",
            { name: "测试" },
          ),
        );

        await waitFor(() => {
          expect(
            onBusyChange,
          ).toHaveBeenLastCalledWith(
            true,
          );
        });

        const closeButton =
          screen.getByRole(
            "button",
            { name: "关闭" },
          ) as HTMLButtonElement;

        expect(
          closeButton.disabled,
        ).toBe(true);

        await act(async () => {
          resolveTest({
            ok: true,
            provider:
              "deepseek",
            message: "连接成功",
          });
        });

        await waitFor(() => {
          expect(
            onBusyChange,
          ).toHaveBeenLastCalledWith(
            false,
          );
        });

        expect(
          closeButton.disabled,
        ).toBe(false);
      },
    );
  },
);
