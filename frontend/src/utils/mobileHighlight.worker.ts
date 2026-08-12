import { highlightCode } from "./highlightRuntime";

type RequestMessage = { id: number; code: string; language: string };

self.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const { id, code, language } = event.data;
  try {
    const html = await highlightCode(code, language);
    self.postMessage({ id, html });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
