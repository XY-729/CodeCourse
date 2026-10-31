import type { StylesheetJson } from "cytoscape";

export const knowledgeGraphStyles: StylesheetJson = [
  { selector: "node", style: {
    "background-color": "data(color)", label: "", "border-width": 0.7,
    "border-color": "data(borderColor)", width: "data(size)", height: "data(size)",
    "overlay-opacity": 0, opacity: 1,
    "transition-property": "opacity", "transition-duration": 140,
  } },
  { selector: "node.focus-root, node.selected-node", style: { "border-color": "data(accentColor)", "border-width": 1.5 } },
  { selector: "node.hover-related", style: { "border-width": 1 } },
  { selector: "node.hover-dim", style: { opacity: 0.16 } },
  { selector: "edge", style: {
    width: 1, "line-color": "data(lineColor)", "target-arrow-color": "data(lineColor)",
    "target-arrow-shape": "none", "arrow-scale": 0.65, "curve-style": "straight",
    label: "", opacity: 0.45, "overlay-opacity": 0,
    "transition-property": "opacity line-color", "transition-duration": 140,
  } },
  { selector: "edge.hover-related", style: {
    "line-color": "data(accentColor)", "target-arrow-color": "data(accentColor)", opacity: 0.9,
  } },
  { selector: "edge.hover-dim", style: { opacity: 0.055 } },
  { selector: ".graph-hidden", style: { display: "none", events: "no" } },
];
