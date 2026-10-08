import {
  act,
  renderHook,
} from "@testing-library/react";

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  askQuestionStream,
} from "../api/client";

import type {
  QAAskPayload,
  QARecord,
} from "../api/client";

import {
  useQAGenerationController,
} from "./useQAGenerationController";

vi.mock(
  "../api/client",
  () => ({
    askQuestionStream:
      vi.fn(),
  }),
);

const PAYLOAD:
  QAAskPayload = {
    source_type: "file",
    source_path:
      "src/App.tsx",

    selected_text: "",
    question:
      "这个文件做什么？",

    provider: "openai",
    base_url: "",
    model: "test-model",

    session_id: null,
    parent_qa_id: null,

    relation_type:
      "follow_up",
  };

const RECORD:
  QARecord = {
    id: 1,
    project_id: 1,

    session_id: 10,
    parent_qa_id: null,

    relation_type:
      "follow_up",

    source_type: "file",
    source_path:
      "src/App.tsx",

    display_title:
      "测试回答",

    selected_text: "",
    question:
      "这个文件做什么？",

    answer_md:
      "测试回答内容",

    provider: "openai",
    model: "test-model",

    output_path:
      "qa/1.md",

    favorite: false,

    created_at:
      "2026-07-30T00:00:00Z",

    updated_at:
      "2026-07-30T00:00:00Z",
  };

const askMock =
  vi.mocked(
    askQuestionStream,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe(
  "useQAGenerationController",
  () => {
    it(
      "allows only one operation token",
      () => {
        const { result } =
          renderHook(() =>
            useQAGenerationController(
              1,
            ),
          );

        let firstToken:
          symbol | null = null;

        act(() => {
          firstToken =
            result.current
              .beginOperation();
        });

        expect(
          firstToken,
        ).not.toBeNull();

        expect(
          result.current
            .beginOperation(),
        ).toBeNull();

        expect(
          result.current.busy,
        ).toBe(true);

        act(() => {
          result.current
            .endOperation(
              firstToken!,
            );
        });

        expect(
          result.current.busy,
        ).toBe(false);

        let secondToken:
          symbol | null = null;

        act(() => {
          secondToken =
            result.current
              .beginOperation();
        });

        expect(
          secondToken,
        ).not.toBeNull();
      },
    );

    it(
      "rejects a second streaming request",
      async () => {
        let resolveFirst:
          (
            record: QARecord,
          ) => void =
          () => undefined;

        askMock
          .mockImplementationOnce(
            () =>
              new Promise<QARecord>(
                (resolve) => {
                  resolveFirst =
                    resolve;
                },
              ),
          );

        const { result } =
          renderHook(() =>
            useQAGenerationController(
              1,
            ),
          );

        let token:
          symbol | null = null;

        act(() => {
          token =
            result.current
              .beginOperation();
        });

        let firstRequest:
          Promise<QARecord>;

        act(() => {
          firstRequest =
            result.current
              .runStreamingQuestion(
                PAYLOAD,
                "draft:1",
                token!,
              );
        });

        await expect(
          result.current
            .runStreamingQuestion(
              PAYLOAD,
              "draft:1",
              token!,
            ),
        ).rejects.toThrow(
          "已有回答正在处理",
        );

        expect(
          askMock,
        ).toHaveBeenCalledTimes(
          1,
        );

        await act(async () => {
          resolveFirst(RECORD);
          await firstRequest;
        });

        act(() => {
          result.current
            .endOperation(
              token!,
            );
        });

        expect(
          result.current.busy,
        ).toBe(false);
      },
    );

    it(
      "releases generation state after failure",
      async () => {
        askMock.mockRejectedValueOnce(
          new Error("网络失败"),
        );

        const { result } =
          renderHook(() =>
            useQAGenerationController(
              1,
            ),
          );

        let token:
          symbol | null = null;

        act(() => {
          token =
            result.current
              .beginOperation();
        });

        await act(async () => {
          await expect(
            result.current
              .runStreamingQuestion(
                PAYLOAD,
                "draft:1",
                token!,
              ),
          ).rejects.toThrow(
            "网络失败",
          );
        });

        act(() => {
          result.current
            .endOperation(
              token!,
            );
        });

        expect(
          result.current
            .anyLoading,
        ).toBe(false);

        expect(
          result.current
            .isOperationActive(),
        ).toBe(false);
      },
    );
  },
);

it("publishes the first body before completion and retains partial text on failure", async () => {
  let reject!: (error: Error) => void;
  let handlers!: NonNullable<Parameters<typeof askQuestionStream>[2]>;
  askMock.mockImplementationOnce((_project, _payload, callbacks) => {
    handlers = callbacks!;
    return new Promise((_resolve, rejectRequest) => { reject = rejectRequest; });
  });
  const onUpdate = vi.fn();
  const onError = vi.fn();
  const onComplete = vi.fn();
  const { result } = renderHook(() => useQAGenerationController(1, { onUpdate, onError, onComplete }));
  let token!: symbol;
  act(() => { token = result.current.beginOperation()!; });
  let request!: Promise<QARecord>;
  act(() => { request = result.current.runStreamingQuestion(PAYLOAD, "draft:1", token); });
  expect(askMock).toHaveBeenCalledWith(1, expect.objectContaining({ defer_metadata: true }), expect.any(Object));
  act(() => handlers.onDelta?.("首段 **正文**"));
  expect(result.current.generations["draft:1"].partial).toBe("首段 **正文**");
  expect(onComplete).not.toHaveBeenCalled();
  await act(async () => {
    handlers.onDelta?.("\n后续内容");
    reject(new Error("断流"));
    await expect(request).rejects.toThrow("断流");
  });
  expect(onUpdate).toHaveBeenLastCalledWith("draft:1", expect.objectContaining({ partial: "首段 **正文**\n后续内容" }), expect.objectContaining({ firstDeltaAt: expect.any(Number), requestId: expect.any(String) }));
  expect(onError).toHaveBeenCalledWith("draft:1", "断流");
  expect(onComplete).not.toHaveBeenCalled();
  act(() => result.current.endOperation(token));
  expect(result.current.busy).toBe(false);
});
