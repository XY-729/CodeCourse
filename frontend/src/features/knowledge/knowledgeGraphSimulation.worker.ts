import { createKnowledgeGraphSimulation } from "./knowledgeGraphSimulation";
import type { SimulationCommand } from "./knowledgeGraphSimulationBackground";

let simulation: ReturnType<typeof createKnowledgeGraphSimulation> | null = null;
let revision = 0;
self.onmessage = ({ data }: MessageEvent<SimulationCommand>) => {
  if (data.kind === "init") {
    simulation?.destroy();
    revision = data.revision;
    simulation = createKnowledgeGraphSimulation({ ...data.options,
      onTick: (positions) => self.postMessage({ revision, positions }),
      onEnd: () => self.postMessage({ revision, ended: true }),
    });
  } else if (data.kind === "update") {
    revision = data.revision;
    simulation?.update(data.nodes, data.links);
  } else if (data.kind === "forces") simulation?.setForces(data.forces);
  else if (data.kind === "pin") simulation?.pin(data.id, data.x, data.y);
  else if (data.kind === "release") simulation?.release(data.id);
  else if (data.kind === "stop") simulation?.stop();
  else if (data.kind === "reheat") simulation?.reheat();
};
