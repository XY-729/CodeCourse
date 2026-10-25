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
  getLearningSettings,
  saveLLMSettings,
  saveLearningSettings,
  testLLMSettings,
} from "../../api/client";

import LLMSettingsDialog from "./LLMSettingsDialog";

vi.mock(
  "../../api/client",
  () => ({
    getLLMSettings:
      vi.fn(),
    getLearningSettings: vi.fn(),

    resetPersonalizationProfile:
      vi.fn(),

    saveLLMSettings:
      vi.fn(),
    saveLearningSettings: vi.fn(),

    testLLMSettings:
      vi.fn(),
  }),
);

const getSettingsMock =
  vi.mocked(
    getLLMSettings,
  );

const saveSettingsMock =
  vi.mocked(
    saveLLMSettings,
  );

const testMock =
  vi.mocked(
    testLLMSettings,
  );

function renderDialog(
  onBusyChange = vi.fn(),
) {
  return render(
    <LLMSettingsDialog
      open
      projectId={1}
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
}

beforeEach(() => {
  vi.clearAllMocks();
  let savedLanguage = "";
  vi.mocked(getLearningSettings).mockImplementation(async () => ({ primary_programming_language: savedLanguage }));
  vi.mocked(saveLearningSettings).mockImplementation(async (payload) => {
    savedLanguage = payload.primary_programming_language;
    return { primary_programming_language: savedLanguage };
  });

  getSettingsMock.mockResolvedValue({
    provider: "deepseek",
    base_url:
      "https://api.deepseek.com",
    model: "deepseek-chat",
    enabled: true,
    has_api_key: true,
    masked_api_key: "***",
  });

  saveSettingsMock.mockResolvedValue({
    provider: "deepseek",
    base_url:
      "https://api.deepseek.com",
    model: "deepseek-chat",
    enabled: true,
    has_api_key: true,
    masked_api_key: "***",
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

        renderDialog(onBusyChange);

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

    it(
      "no longer offers personalization switches or term density controls",
      async () => {
        renderDialog();

        await screen.findByDisplayValue(
          "deepseek-chat",
        );

        // Teaching and evidence analysis are always on, so the retired
        // switches and the term-density selector must be gone from the UI.
        expect(
          screen.queryByText(
            "使用个性化教学",
          ),
        ).toBeNull();
        expect(
          screen.queryByText(
            "分析学习过程",
          ),
        ).toBeNull();
        expect(
          screen.queryByText(
            "陌生术语提示",
          ),
        ).toBeNull();
        // Model configuration, chapter thinking effort, and the free-text language suggestions.
        expect(
          screen.getAllByRole(
            "combobox",
          ),
        ).toHaveLength(3);
      },
    );

    it(
      "saves model and learning settings without retired preferences",
      async () => {
        renderDialog();

        await screen.findByDisplayValue(
          "deepseek-chat",
        );

        fireEvent.click(
          screen.getByRole(
            "button",
            { name: "保存" },
          ),
        );

        await waitFor(() => {
          expect(
            saveSettingsMock,
          ).toHaveBeenCalledTimes(1);
        });

        // A saved dialog must not reach for the removed personalization and
        // preference endpoints, which are no longer exported at all.
        expect(
          saveSettingsMock.mock
            .calls[0][0],
        ).toMatchObject({
          provider: "deepseek",
          model: "deepseek-chat",
          section_reasoning_effort: "low",
        });
        expect(saveLearningSettings).toHaveBeenCalledWith({ primary_programming_language: "" });
      },
    );

    it("saves a custom language, reloads it on reopen, and allows clearing it", async () => {
      const first = renderDialog();
      const input = await screen.findByLabelText("你的主要编程语言是：");
      fireEvent.change(input, { target: { value: "  Elixir  " } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await screen.findByText(/已保存：模型 API、学习设置/);
      expect(saveLearningSettings).toHaveBeenLastCalledWith({ primary_programming_language: "Elixir" });
      first.unmount();

      const second = renderDialog();
      await screen.findByDisplayValue("Elixir");
      fireEvent.change(screen.getByLabelText("你的主要编程语言是："), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await screen.findByText(/已保存：模型 API、学习设置/);
      expect(saveLearningSettings).toHaveBeenLastCalledWith({ primary_programming_language: "" });
      second.unmount();

      renderDialog();
      await waitFor(() => expect((screen.getByLabelText("你的主要编程语言是：") as HTMLInputElement).value).toBe(""));
    });

    it("keeps save disabled if the saved language could not be loaded", async () => {
      vi.mocked(getLearningSettings).mockRejectedValueOnce(new Error("读取学习设置失败"));
      renderDialog();
      await screen.findByText("读取学习设置失败");
      expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
      expect(saveLearningSettings).not.toHaveBeenCalled();
    });
  },
);
