import { createKnowledgeGraphSimulation, type GraphForces, type KnowledgeGraphSimulation, type SimulationNode, type SimulationLink } from "./knowledgeGraphSimulation";

type Options = Parameters<typeof createKnowledgeGraphSimulation>[0];
export type SimulationCommand =
  | { kind: "init"; revision: number; options: Pick<Options, "nodes" | "links" | "forces"> }
  | { kind: "update"; revision: number; nodes: SimulationNode[]; links: SimulationLink[] }
  | { kind: "forces"; forces: GraphForces }
  | { kind: "pin"; id: number; x: number; y: number }
  | { kind: "release"; id: number }
  | { kind: "stop" | "reheat" };

/** Keep layout computation off the renderer, with a local fallback for WebViews. */
export function createBackgroundKnowledgeGraphSimulation(options: Options): KnowledgeGraphSimulation {
  if (typeof Worker === "undefined") return createKnowledgeGraphSimulation(options);
  let worker: Worker;
  try { worker = new Worker(new URL("./knowledgeGraphSimulation.worker.ts", import.meta.url), { type: "module" }); }
  catch { return createKnowledgeGraphSimulation(options); }
  let revision = 0;
  let destroyed = false;
  let stopped = false;
  let nodes = options.nodes;
  let links = options.links;
  let forces = options.forces;
  const pinned = new Map<number, { x: number; y: number }>();
  let fallback: KnowledgeGraphSimulation | null = null;
  const post = (command: SimulationCommand) => { if (!destroyed) worker.postMessage(command); };
  worker.onmessage = ({ data }: MessageEvent<{ revision: number; positions?: SimulationNode[]; ended?: boolean }>) => {
    if (destroyed || stopped || data.revision !== revision) return;
    if (data.positions) { nodes = data.positions; options.onTick(data.positions); }
    if (data.ended) options.onEnd?.();
  };
  worker.onerror = (event) => {
    event.preventDefault();
    if (destroyed || fallback) return;
    worker.terminate();
    fallback = createKnowledgeGraphSimulation({ ...options, nodes, links, forces });
    for (const [id, position] of pinned) fallback.pin(id, position.x, position.y);
    if (stopped) fallback.stop();
  };
  post({ kind: "init", revision, options: { nodes, links, forces } });
  return {
    update(nextNodes, nextLinks) {
      if (destroyed) return;
      nodes = nextNodes; links = nextLinks; stopped = false;
      if (fallback) fallback.update(nodes, links);
      else post({ kind: "update", revision: ++revision, nodes, links });
    },
    setForces(next) {
      if (destroyed || Object.keys(forces).every((key) => forces[key as keyof GraphForces] === next[key as keyof GraphForces])) return;
      forces = next; stopped = false;
      if (fallback) fallback.setForces(next); else post({ kind: "forces", forces });
    },
    pin(id, x, y) { pinned.set(id, { x, y }); stopped = false; if (fallback) fallback.pin(id, x, y); else post({ kind: "pin", id, x, y }); },
    release(id) { pinned.delete(id); stopped = false; if (fallback) fallback.release(id); else post({ kind: "release", id }); },
    stop() { stopped = true; if (fallback) fallback.stop(); else post({ kind: "stop" }); },
    reheat() { stopped = false; if (fallback) fallback.reheat(); else post({ kind: "reheat" }); },
    destroy() {
      if (destroyed) return;
      destroyed = true; worker.onmessage = null; worker.onerror = null;
      worker.terminate(); fallback?.destroy(); pinned.clear();
    },
  };
}
