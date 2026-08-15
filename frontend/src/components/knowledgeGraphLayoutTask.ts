import type { KnowledgeGraph } from "../api/client";
import type {
  KnowledgeGraphLayoutRequest,
  KnowledgeGraphLayoutResult,
} from "./knowledgeGraphLayout";

export type KnowledgeGraphLayoutWorker = {
  postMessage: (message: KnowledgeGraphLayoutRequest) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<KnowledgeGraphLayoutResult>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

export type KnowledgeGraphLayoutTask = {
  promise: Promise<KnowledgeGraphLayoutResult["positions"]>;
  cancel: () => void;
};

type Options = {
  timeoutMs?: number;
  createWorker?: () => KnowledgeGraphLayoutWorker;
  setTimer?: typeof window.setTimeout;
  clearTimer?: typeof window.clearTimeout;
};

function defaultWorkerFactory(): KnowledgeGraphLayoutWorker {
  return new Worker(new URL("./knowledgeGraphLayout.worker.ts", import.meta.url), { type: "module" }) as unknown as KnowledgeGraphLayoutWorker;
}

/** Owns the worker lifecycle so stale graph layouts can be cancelled atomically. */
export function startKnowledgeGraphLayoutTask(
  requestId: number,
  graph: KnowledgeGraph,
  options: Options = {},
): KnowledgeGraphLayoutTask {
  const worker = (options.createWorker ?? defaultWorkerFactory)();
  const setTimer = options.setTimer ?? window.setTimeout.bind(window);
  const clearTimer = options.clearTimer ?? window.clearTimeout.bind(window);
  let settled = false;
  let rejectTask: ((reason?: unknown) => void) | null = null;

  const promise = new Promise<KnowledgeGraphLayoutResult["positions"]>((resolve, reject) => {
    rejectTask = reject;
    const timeout = setTimer(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error("知识网络整理超时"));
    }, options.timeoutMs ?? 12_000);

    const finish = () => {
      clearTimer(timeout);
      worker.terminate();
    };

    worker.onmessage = (event: MessageEvent<KnowledgeGraphLayoutResult>) => {
      if (settled) return;
      settled = true;
      finish();
      if (event.data.requestId !== requestId) {
        reject(new Error("布局任务已过期"));
        return;
      }
      resolve(event.data.positions);
    };
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      finish();
      reject(new Error("知识网络后台布局失败"));
    };
    const request: KnowledgeGraphLayoutRequest = { requestId, graph };
    worker.postMessage(request);
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectTask?.(new Error("布局任务已取消"));
    },
  };
}
