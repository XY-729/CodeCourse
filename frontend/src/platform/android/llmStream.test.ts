import { beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ addListener: vi.fn(), stream: vi.fn(), cancel: vi.fn(), remove: vi.fn() }));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => native }));
import { streamAndroidLLM } from "./llmStream";
let emit: (event: { requestId: string; data: string }) => void;
beforeEach(() => {
  vi.clearAllMocks();
  native.cancel.mockResolvedValue(undefined);
  native.remove.mockResolvedValue(undefined);
  native.addListener.mockImplementation(async (_name, handler) => { emit = handler; return { remove: native.remove }; });
});
const options = { url: "https://example.test/chat/completions", apiKey: "test-only", body: "{}" };

it("delivers Chinese and inline code before completion and ignores other request IDs", async () => {
  let finish!: () => void;
  native.stream.mockImplementation(({ requestId }) => {
    emit({ requestId: "other", data: '{"choices":[{"delta":{"content":"错误请求"}}]}' });
    emit({ requestId, data: JSON.stringify({ choices: [{ delta: { content: "中文 `return`" } }] }) });
    return new Promise<void>(resolve => { finish = () => { emit({ requestId, data: "[DONE]" }); resolve(); }; });
  });
  const onDelta = vi.fn();
  const pending = streamAndroidLLM(options, onDelta);
  await vi.waitFor(() => expect(onDelta).toHaveBeenCalledWith("中文 `return`"));
  finish();
  await expect(pending).resolves.toBe("中文 `return`");
  expect(onDelta).toHaveBeenCalledTimes(1);
  expect(native.remove).toHaveBeenCalledTimes(1);
});

it("cancels the native request promptly and detaches its listener", async () => {
  native.stream.mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const pending = streamAndroidLLM(options, vi.fn(), controller.signal);
  const result = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(native.stream).toHaveBeenCalledTimes(1));
  controller.abort();
  await result;
  expect(native.cancel).toHaveBeenCalledWith({ requestId: expect.any(String) });
  expect(native.remove).toHaveBeenCalledTimes(1);
});

it.each(["abrupt", "length", "invalid"])("rejects %s streams while keeping previously emitted text", async kind => {
  native.stream.mockImplementation(async ({ requestId }) => {
    emit({ requestId, data: '{"choices":[{"delta":{"content":"保留正文"}}]}' });
    if (kind === "length") emit({ requestId, data: '{"choices":[{"finish_reason":"length"}]}' });
    if (kind === "invalid") emit({ requestId, data: "malformed" });
  });
  const onDelta = vi.fn();
  await expect(streamAndroidLLM(options, onDelta)).rejects.toThrow();
  expect(onDelta).toHaveBeenCalledWith("保留正文");
  expect(native.remove).toHaveBeenCalledTimes(1);
});
