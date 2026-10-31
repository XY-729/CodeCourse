import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackgroundKnowledgeGraphSimulation } from "./knowledgeGraphSimulationBackground";
import { DEFAULT_GRAPH_FORCES } from "./knowledgeGraphSimulation";

class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.latest = this; }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("background graph simulation", () => {
  it("runs in a worker and rejects stale topology frames and late callbacks", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const onTick = vi.fn();
    const onEnd = vi.fn();
    const nodes = [{ id: 1, x: 0, y: 0 }];
    const simulation = createBackgroundKnowledgeGraphSimulation({ nodes, links: [], forces: DEFAULT_GRAPH_FORCES, onTick, onEnd });
    const worker = FakeWorker.latest;
    expect(worker.postMessage.mock.calls[0][0].kind).toBe("init");
    simulation.update([{ id: 2, x: 10, y: 20 }], []);
    worker.onmessage?.({ data: { revision: 0, positions: nodes } } as MessageEvent);
    expect(onTick).not.toHaveBeenCalled();
    worker.onmessage?.({ data: { revision: 1, positions: [{ id: 2, x: 11, y: 20 }] } } as MessageEvent);
    expect(onTick).toHaveBeenCalledOnce();
    simulation.stop();
    worker.onmessage?.({ data: { revision: 1, ended: true } } as MessageEvent);
    expect(onEnd).not.toHaveBeenCalled();
    simulation.destroy();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
  });
  it("falls back locally after worker failure and preserves a pinned drag", () => {
    vi.useFakeTimers(); vi.stubGlobal("Worker", FakeWorker);
    const onTick = vi.fn();
    const simulation = createBackgroundKnowledgeGraphSimulation({ nodes: [{ id: 1, x: 0, y: 0 }], links: [], forces: DEFAULT_GRAPH_FORCES, onTick });
    simulation.pin(1, 80, 40);
    FakeWorker.latest.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent);
    vi.advanceTimersByTime(100);
    expect(onTick.mock.lastCall?.[0]).toEqual([{ id: 1, x: 80, y: 40 }]);
    simulation.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
