export type GraphSettings = {
  showOrphans: boolean;
  hiddenTypes: string[];
  arrows: boolean;
  textFade: number;
  nodeSize: number;
  linkWidth: number;
  forces: { center: number; repel: number; link: number; distance: number };
};

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  showOrphans: true,
  hiddenTypes: [],
  arrows: false,
  textFade: 0.5,
  nodeSize: 1,
  linkWidth: 1,
  forces: { center: 0.5, repel: 10, link: 1, distance: 90 },
};

const STORAGE_KEY = "codecourse.graph.settings.v1";

function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function normalizeSettings(value: unknown): GraphSettings {
  const candidate = value && typeof value === "object" ? value as Partial<GraphSettings> : {};
  const forces = candidate.forces && typeof candidate.forces === "object" ? candidate.forces : {} as Partial<GraphSettings["forces"]>;
  return {
    showOrphans: typeof candidate.showOrphans === "boolean" ? candidate.showOrphans : DEFAULT_GRAPH_SETTINGS.showOrphans,
    hiddenTypes: Array.isArray(candidate.hiddenTypes) ? [...new Set(candidate.hiddenTypes.filter((type): type is string => typeof type === "string"))] : [],
    arrows: typeof candidate.arrows === "boolean" ? candidate.arrows : DEFAULT_GRAPH_SETTINGS.arrows,
    textFade: bounded(candidate.textFade, DEFAULT_GRAPH_SETTINGS.textFade, 0, 1),
    nodeSize: bounded(candidate.nodeSize, DEFAULT_GRAPH_SETTINGS.nodeSize, 0.5, 3),
    linkWidth: bounded(candidate.linkWidth, DEFAULT_GRAPH_SETTINGS.linkWidth, 0.2, 3),
    forces: {
      center: bounded(forces.center, DEFAULT_GRAPH_SETTINGS.forces.center, 0, 1),
      repel: bounded(forces.repel, DEFAULT_GRAPH_SETTINGS.forces.repel, 0, 20),
      link: bounded(forces.link, DEFAULT_GRAPH_SETTINGS.forces.link, 0, 1),
      distance: bounded(forces.distance, DEFAULT_GRAPH_SETTINGS.forces.distance, 30, 200),
    },
  };
}

export function readGraphSettings(): GraphSettings {
  try { return normalizeSettings(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")); }
  catch { return normalizeSettings(null); }
}

export function writeGraphSettings(settings: GraphSettings) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings))); }
  catch { /* The graph remains usable when browser storage is unavailable or full. */ }
}
