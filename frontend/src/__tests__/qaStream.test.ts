import { afterEach, expect, it, vi } from "vitest";
import { askQuestionStream, type QAAskPayload } from "../api/client";

vi.mock("../platform/runtime", () => ({ isAndroidRuntime: () => false }));
afterEach(() => vi.unstubAllGlobals());
const payload = { source_type: "selection", selected_text: "x", question: "解释", provider: "test", base_url: "", model: "test" } as QAAskPayload;

it("decodes Chinese split at every byte and delivers body before completion", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: value => { controller = value; } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } })));
  const onDelta = vi.fn();
  const request = askQuestionStream(1, payload, { onDelta });
  const encoder = new TextEncoder();
  for (const byte of encoder.encode('event: delta\r\ndata: {"text":"中文首段"}\r\n\r\n')) controller.enqueue(new Uint8Array([byte]));
  await vi.waitFor(() => expect(onDelta).toHaveBeenCalledWith("中文首段"));
  controller.enqueue(encoder.encode('event: completed\ndata: {"id":1,"answer_md":"中文首段"}\n\n'));
  controller.close();
  await expect(request).resolves.toMatchObject({ id: 1, answer_md: "中文首段" });
});

it("does not accept an abruptly ended stream as a saved answer", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response('event: delta\ndata: {"text":"部分正文"}\n\n')));
  const onDelta = vi.fn();
  await expect(askQuestionStream(1, payload, { onDelta })).rejects.toThrow("未收到保存结果");
  expect(onDelta).toHaveBeenCalledWith("部分正文");
});
