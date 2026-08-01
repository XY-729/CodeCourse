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
  getPromptMetadata,
  savePrompts,
} from "../api/client";

import PromptEditor from "./PromptEditor";

vi.mock(
  "../api/client",
  () => ({
    getPromptMetadata:
      vi.fn(),

    getPromptHistory:
      vi.fn(),

    previewPrompt:
      vi.fn(),

    savePrompts:
      vi.fn(),
  }),
);

vi.mock(
  "../personalization/promptTemplateContract",
  () => ({
    validatePromptTemplate:
      () => [],
  }),
);

const metadataMock =
  vi.mocked(
    getPromptMetadata,
  );

const saveMock =
  vi.mocked(
    savePrompts,
  );

beforeEach(() => {
  vi.clearAllMocks();

  metadataMock.mockResolvedValue({
    prompts: [
      {
        key: "prompt.system",
        label: "系统提示词",
        description:
          "测试提示词",

        required_placeholders:
          [],

        default:
          "默认内容",

        current:
          "当前内容",
        is_default: true,
        schema_version: 2,
        stored_schema_version: 2,
        upgrade_status: "current",
      },
    ],
  });
});

describe(
  "PromptEditor lifecycle",
  () => {
    it(
      "reports dirty state and delegates closing",
      async () => {
        const onClose = vi.fn();

        const onDirtyChange =
          vi.fn();

        const confirmSpy =
          vi.spyOn(
            window,
            "confirm",
          );

        render(
          <PromptEditor
            onClose={onClose}
            onDirtyChange={
              onDirtyChange
            }
          />,
        );

        const editor =
          await screen.findByRole(
            "textbox",
            {
              name:
                "系统提示词",
            },
          );

        fireEvent.change(
          editor,
          {
            target: {
              value:
                "修改后的内容",
            },
          },
        );

        await waitFor(() => {
          expect(
            onDirtyChange,
          ).toHaveBeenLastCalledWith(
            true,
          );
        });

        fireEvent.click(
          screen.getByRole(
            "button",
            { name: "关闭" },
          ),
        );

        expect(
          onClose,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          confirmSpy,
        ).not.toHaveBeenCalled();

        confirmSpy.mockRestore();
      },
    );

    it(
      "reports saving and prevents closing while saving",
      async () => {
        let resolveSave:
          (
            value: {
              ok: boolean;
            },
          ) => void =
          () => undefined;

        saveMock.mockImplementationOnce(
          () =>
            new Promise(
              (resolve) => {
                resolveSave =
                  resolve;
              },
            ),
        );

        const onClose = vi.fn();

        const onSavingChange =
          vi.fn();

        render(
          <PromptEditor
            onClose={onClose}
            onSavingChange={
              onSavingChange
            }
          />,
        );

        const editor =
          await screen.findByRole(
            "textbox",
            {
              name:
                "系统提示词",
            },
          );

        fireEvent.change(
          editor,
          {
            target: {
              value:
                "需要保存",
            },
          },
        );

        fireEvent.click(
          screen.getByRole(
            "button",
            { name: "保存" },
          ),
        );

        await waitFor(() => {
          expect(
            onSavingChange,
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

        fireEvent.click(
          closeButton,
        );

        expect(
          onClose,
        ).not.toHaveBeenCalled();

        await act(async () => {
          resolveSave({
            ok: true,
          });
        });

        await waitFor(() => {
          expect(
            onSavingChange,
          ).toHaveBeenLastCalledWith(
            false,
          );
        });
      },
    );
  },
);
