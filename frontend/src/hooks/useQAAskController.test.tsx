import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LLMSettings, QARecord } from "../api/client";
import { useQAAskController } from "./useQAAskController";
import type { QAOperationToken } from "./useQAGenerationController";

const settings = {
  enabled: true,
  has_api_key: true,
  provider: "openai",
  base_url: "https://example.test/v1",
  model: "test-model",
} as LLMSettings;

const record = { id: 42, session_id: 9, display_title: "回答" } as QARecord;

function setup(overrides: Record<string, unknown> = {}) {
  const token = Symbol("qa") as QAOperationToken;
  const callbacks = {
    beginOperation: vi.fn(() => token as QAOperationToken | null),
    endOperation: vi.fn(),
    isOperationActive: vi.fn(() => false),
    runStreamingQuestion: vi.fn(async () => record),
    buildContext: vi.fn(() => ({
      source_type: "file" as const,
      source_path: "src/main.ts",
      selected_text: "run()",
      context_files: ["src/helper.ts"],
    })),
    confirm: vi.fn(async () => true),
    onToast: vi.fn(),
    onPanelError: vi.fn(),
    onAnswerComplete: vi.fn(async () => undefined),
  };
  const options = {
    projectId: 7,
    settings,
    sessionId: 8,
    parentQAId: 3,
    selectionRange: {
      startLineNumber: 10,
      startColumn: 2,
      endLineNumber: 10,
      endColumn: 7,
    },
    generationKey: "session:8",
    interactionBusy: false,
    ...callbacks,
    ...overrides,
  };
  const hook = renderHook(() => useQAAskController(options));
  return { ...callbacks, token, hook };
}

describe("useQAAskController", () => {
  it("asks only after confirmation and preserves the exact context range", async () => {
    const test = setup();
    await act(() => test.hook.result.current.ask("  为什么？  "));

    expect(test.confirm).toHaveBeenCalledOnce();
    expect(test.runStreamingQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "为什么？",
        source_path: "src/main.ts",
        context_files: ["src/helper.ts"],
        session_id: 8,
        parent_qa_id: 3,
        relation_type: "follow_up",
        selection_range: {
          start_line: 10,
          start_column: 2,
          end_line: 10,
          end_column: 7,
        },
      }),
      "session:8",
      test.token,
    );
    expect(test.onAnswerComplete).toHaveBeenCalledWith(record, 7);
    expect(test.endOperation).toHaveBeenCalledWith(test.token);
  });

  it("does not call the model when the learner declines", async () => {
    const test = setup({ confirm: vi.fn(async () => false) });
    await act(() => test.hook.result.current.ask("为什么？"));
    expect(test.runStreamingQuestion).not.toHaveBeenCalled();
    expect(test.endOperation).toHaveBeenCalledWith(test.token);
  });

  it("rejects concurrent work and project mutation synchronously", async () => {
    const test = setup({ beginOperation: vi.fn(() => null), isOperationActive: vi.fn(() => true) });
    await act(() => test.hook.result.current.ask("为什么？"));
    expect(test.runStreamingQuestion).not.toHaveBeenCalled();
    expect(test.hook.result.current.rejectProjectMutationWhileBusy()).toBe(true);
    expect(test.onToast).toHaveBeenCalledTimes(2);
  });

  it("reports failures and always releases the operation", async () => {
    const failure = new Error("stream failed");
    const test = setup({ runStreamingQuestion: vi.fn(async () => { throw failure; }) });
    await act(() => test.hook.result.current.ask("为什么？"));
    expect(test.onPanelError).toHaveBeenLastCalledWith("stream failed");
    expect(test.endOperation).toHaveBeenCalledWith(test.token);
  });
});
