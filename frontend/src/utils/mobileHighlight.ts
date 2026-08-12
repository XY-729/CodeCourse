type WorkerResponse = { id: number; html?: string; error?: string };
type PendingRequest = { resolve: (html: string | null) => void; signal?: AbortSignal };

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function getWorker(): Worker | null {
  if (worker || typeof Worker === "undefined") return worker;
  worker = new Worker(new URL("./mobileHighlight.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    request.resolve(event.data.error ? null : event.data.html ?? null);
  };
  worker.onerror = () => {
    for (const request of pending.values()) request.resolve(null);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function requestMobileHighlight(code: string, language: string, signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted) return Promise.resolve(null);
  const activeWorker = getWorker();
  if (!activeWorker) {
    return import("./highlightRuntime")
      .then(({ highlightCode }) => signal?.aborted ? null : highlightCode(code, language))
      .catch(() => null);
  }
  const id = nextRequestId++;
  return new Promise((resolve) => {
    pending.set(id, { resolve, signal });
    signal?.addEventListener("abort", () => {
      if (!pending.delete(id)) return;
      resolve(null);
    }, { once: true });
    activeWorker.postMessage({ id, code, language });
  });
}
