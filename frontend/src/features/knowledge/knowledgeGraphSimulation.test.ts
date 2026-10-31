// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createKnowledgeGraphSimulation,
  DEFAULT_GRAPH_FORCES,
  type SimulationNode,
} from "./knowledgeGraphSimulation";

describe("knowledge graph force simulation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("draws connected nodes together, cools to rest, and emits independent snapshots", () => {
    const nodes = [{ id: 1, x: -300, y: 0 }, { id: 2, x: 300, y: 0 }];
    const onTick = vi.fn<(positions: SimulationNode[]) => void>();
    const onEnd = vi.fn();
    const simulation = createKnowledgeGraphSimulation({
      nodes,
      links: [{ source: 1, target: 2 }],
      forces: { ...DEFAULT_GRAPH_FORCES, center: 0, repel: 0 },
      onTick,
      onEnd,
    });
    vi.advanceTimersByTime(20_000);
    const positions = onTick.mock.lastCall![0];
    expect(Math.abs(positions[1].x - positions[0].x)).toBeCloseTo(100, 0);
    expect(nodes).toEqual([{ id: 1, x: -300, y: 0 }, { id: 2, x: 300, y: 0 }]);
    expect(onTick.mock.calls[0][0]).not.toBe(positions);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    simulation.destroy();
  });

  it("keeps dragged nodes fixed, pulls their neighbors, and resumes released nodes", () => {
    let positions: SimulationNode[] = [];
    const simulation = createKnowledgeGraphSimulation({
      nodes: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 100, y: 0 }],
      links: [{ source: 1, target: 2 }],
      forces: { center: 0, repel: 0, link: 1, distance: 100 },
      onTick: (next) => { positions = next; },
    });
    simulation.pin(1, 400, 0);
    vi.advanceTimersByTime(2000);
    expect(positions[0]).toEqual({ id: 1, x: 400, y: 0 });
    expect(positions[1].x).toBeGreaterThan(250);
    simulation.release(1);
    simulation.setForces({ center: 0, repel: 0, link: 1, distance: 50 });
    vi.advanceTimersByTime(2000);
    expect(positions[0].x).toBeLessThan(390);
    expect(Math.abs(positions[0].x - positions[1].x)).toBeCloseTo(50, 0);
    simulation.destroy();
  });

  it("separates coincident disconnected nodes without invalid coordinates", () => {
    let positions: SimulationNode[] = [];
    const simulation = createKnowledgeGraphSimulation({
      nodes: Array.from({ length: 40 }, (_, id) => ({ id, x: 0, y: 0 })),
      links: [],
      forces: DEFAULT_GRAPH_FORCES,
      onTick: (next) => { positions = next; },
    });
    vi.advanceTimersByTime(1000);
    expect(positions).toHaveLength(40);
    expect(positions.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(new Set(positions.map(({ x, y }) => `${x}:${y}`)).size).toBe(40);
    expect(Math.max(...positions.map(({ x, y }) => Math.hypot(x, y)))).toBeGreaterThan(60);
    simulation.destroy();
  });

  it("updates graph topology without losing pins or retaining removed nodes", () => {
    let positions: SimulationNode[] = [];
    const simulation = createKnowledgeGraphSimulation({
      nodes: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 100, y: 0 }],
      links: [{ source: 1, target: 2 }],
      forces: DEFAULT_GRAPH_FORCES,
      onTick: (next) => { positions = next; },
    });
    simulation.pin(1, 240, 80);
    simulation.update(
      [{ id: 1, x: 0, y: 0 }, { id: 3, x: 400, y: 0 }],
      [{ source: 1, target: 3 }, { source: 2, target: 3 }, { source: 3, target: 3 }],
    );
    vi.advanceTimersByTime(100);
    expect(positions.map(({ id }) => id)).toEqual([1, 3]);
    expect(positions[0]).toEqual({ id: 1, x: 240, y: 80 });
    expect(positions[1].x).toBeLessThan(400);
    simulation.update([], []);
    expect(vi.getTimerCount()).toBe(0);
    simulation.destroy();
  });

  it("limits rendering to 30fps, pauses, reheats, and cancels work permanently on destroy", () => {
    const onTick = vi.fn();
    const onEnd = vi.fn();
    const nodes = [{ id: 1, x: 0, y: 0 }, { id: 2, x: 10, y: 0 }];
    const simulation = createKnowledgeGraphSimulation({ nodes, links: [], forces: DEFAULT_GRAPH_FORCES, onTick, onEnd });
    vi.advanceTimersByTime(1000);
    expect(onTick.mock.calls.length).toBeGreaterThan(20);
    expect(onTick.mock.calls.length).toBeLessThanOrEqual(30);
    simulation.stop();
    const beforePause = onTick.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(beforePause);
    expect(onEnd).not.toHaveBeenCalled();
    simulation.reheat();
    vi.advanceTimersByTime(100);
    expect(onTick.mock.calls.length).toBeGreaterThan(beforePause);
    simulation.destroy();
    const beforeDestroy = onTick.mock.calls.length;
    simulation.reheat();
    simulation.update(nodes, []);
    simulation.setForces(DEFAULT_GRAPH_FORCES);
    simulation.pin(1, 2, 3);
    simulation.release(1);
    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(beforeDestroy);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("moves a large graph with finite coordinates and no per-node scheduled tasks", () => {
    const nodes = Array.from({ length: 2500 }, (_, id) => ({ id, x: (id % 50) * 12, y: Math.floor(id / 50) * 12 }));
    const onTick = vi.fn<(positions: SimulationNode[]) => void>();
    const simulation = createKnowledgeGraphSimulation({ nodes, links: [], forces: DEFAULT_GRAPH_FORCES, onTick });
    vi.advanceTimersByTime(100);
    expect(onTick.mock.lastCall![0]).toHaveLength(2500);
    expect(onTick.mock.lastCall![0].every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    simulation.destroy();
  });

  it("settles a connected network near its link-distance scale rather than exploding apart", () => {
    const nodes = Array.from({ length: 100 }, (_, id) => ({
      id, x: Math.cos(id * 2.39996) * 45 * Math.sqrt(id), y: Math.sin(id * 2.39996) * 45 * Math.sqrt(id),
    }));
    const links = Array.from({ length: 99 }, (_, id) => ({ source: id, target: id + 1 }));
    let positions = nodes;
    const onEnd = vi.fn();
    const simulation = createKnowledgeGraphSimulation({
      nodes, links, forces: DEFAULT_GRAPH_FORCES, onEnd,
      onTick: (next) => { positions = next; },
    });
    vi.advanceTimersByTime(20_000);
    const meanLinkLength = links.reduce((sum, { source, target }) => sum + Math.hypot(
      positions[source].x - positions[target].x, positions[source].y - positions[target].y,
    ), 0) / links.length;
    expect(meanLinkLength).toBeGreaterThan(60);
    expect(meanLinkLength).toBeLessThan(200);
    expect(onEnd).toHaveBeenCalledOnce();
    simulation.destroy();
  });
});
