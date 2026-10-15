import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

const native = registerPlugin<{
  addListener(name: "chunk", listener: (event: { requestId: string; data: string }) => void): Promise<PluginListenerHandle>;
  stream(options: { requestId: string; url: string; apiKey: string; body: string }): Promise<void>;
  cancel(options: { requestId: string }): Promise<void>;
}>("CodeCourseLLM");

export async function streamAndroidLLM(
  options: { url: string; apiKey: string; body: string },
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  let content = "";
  let finished = false;
  let streamError: Error | null = null;
  const listener = await native.addListener("chunk", event => {
    if (event.requestId !== requestId || signal?.aborted || streamError) return;
    try {
      if (event.data === "[DONE]") { finished = true; return; }
      const value = JSON.parse(event.data);
      if (value.error) throw new Error(String(value.error.message || "模型返回错误"));
      const choice = value.choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === "string" && delta) { content += delta; onDelta(delta); }
      if (choice?.finish_reason) {
        if (choice.finish_reason !== "stop") throw new Error(`回答未完成（${choice.finish_reason}），可重试`);
        finished = true;
      }
    } catch (error) { streamError = error instanceof Error ? error : new Error("模型流数据无效"); }
  });
  let rejectAbort: (error: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const cancel = () => {
    void native.cancel({ requestId }).catch(() => undefined);
    rejectAbort(signal?.reason ?? new DOMException("回答已停止", "AbortError"));
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    signal?.throwIfAborted();
    // Starting the native call before the abort race ensures cancel finds it.
    await Promise.race([native.stream({ ...options, requestId }), aborted]);
    signal?.throwIfAborted();
    if (streamError) throw streamError;
    if (!finished) throw new Error("模型连接中断，已保留正文，可重试");
    if (!content.trim()) throw new Error("模型返回了空内容。");
    return content;
  } finally {
    signal?.removeEventListener("abort", cancel);
    await listener.remove();
  }
}
