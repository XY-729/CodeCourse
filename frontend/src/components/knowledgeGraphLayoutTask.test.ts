import { describe, expect, it, vi } from "vitest";
import type { KnowledgeGraph } from "../api/client";
import {
  startKnowledgeGraphLayoutTask,
  type KnowledgeGraphLayoutWorker,
} from "./knowledgeGraphLayoutTask";

const graph: KnowledgeGraph = { nodes: [], edges: [] };

function fakeWorker() {
  const worker: KnowledgeGraphLayoutWorker = {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
  return worker;
}

describe("knowledge graph layout task", () => {
  it("returns matching worker results and terminates the worker", async () => {
    const worker = fakeWorker();
    const task = startKnowledgeGraphLayoutTask(7, graph, { createWorker: () => worker });
    worker.onmessage?.({ data: { requestId: 7, positions: [{ id: 1, x: 10, y: 20 }] } } as MessageEvent);

    await expect(task.promise).resolves.toEqual([{ id: 1, x: 10, y: 20 }]);
    expect(worker.postMessage).toHaveBeenCalledWith({ requestId: 7, graph });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects stale results", async () => {
    const worker = fakeWorker();
    const task = startKnowledgeGraphLayoutTask(8, graph, { createWorker: () => worker });
    worker.onmessage?.({ data: { requestId: 9, positions: [] } } as MessageEvent);

    await expect(task.promise).rejects.toThrow("布局任务已过期");
  });

  it("cancels an in-flight worker", async () => {
    const worker = fakeWorker();
    const task = startKnowledgeGraphLayoutTask(10, graph, { createWorker: () => worker });
    task.cancel();

    await expect(task.promise).rejects.toThrow("布局任务已取消");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
