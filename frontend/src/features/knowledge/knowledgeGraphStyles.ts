import type { StylesheetJson } from "cytoscape";

export const knowledgeGraphStyles: StylesheetJson = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)", label: "", "border-width": 2,
      "border-color": "data(borderColor)", width: "data(size)", height: "data(size)", opacity: 1,
      "transition-property": "opacity border-width border-color", "transition-duration": 220,
      "transition-timing-function": "ease-in-out-cubic",
    },
  },
  { selector: "node.focus-root", style: { "border-color": "data(focusRootColor)", "border-width": 5 } },
  { selector: "node.focus-parent", style: { "border-color": "data(focusParentColor)", "border-width": 3, opacity: 0.95 } },
  { selector: "node.focus-child", style: { opacity: 0.88 } },
  { selector: "node.graph-hidden", style: { opacity: 0, label: "", events: "no" } },
  { selector: "node:selected", style: { "border-color": "data(focusRootColor)", "border-width": 4 } },
  { selector: "node.hover-related", style: { "border-color": "data(accentColor)", "border-width": 4 } },
  { selector: "node.hover-dim", style: { opacity: 0.2 } },
  { selector: "node.graph-hidden.hover-dim", style: { opacity: 0, events: "no" } },
  {
    selector: "edge",
    style: {
      width: 2, "line-color": "data(lineColor)", "target-arrow-color": "data(lineColor)",
      "target-arrow-shape": "triangle", "curve-style": "bezier", label: "", "z-index": 8, opacity: 0.92,
      "transition-property": "opacity line-color target-arrow-color", "transition-duration": 220,
      "transition-timing-function": "ease-in-out-cubic",
    },
  },
  {
    selector: "edge.focus-edge",
    style: { "line-color": "data(accentColor)", "target-arrow-color": "data(accentColor)", width: 3, "z-index": 12, opacity: 1 },
  },
  { selector: "edge.graph-hidden", style: { opacity: 0, label: "", events: "no" } },
  {
    selector: "edge:selected",
    style: { "line-color": "data(accentColor)", "target-arrow-color": "data(accentColor)", width: 3, "z-index": 12 },
  },
  {
    selector: "edge.hover-related",
    style: { "line-color": "data(accentColor)", "target-arrow-color": "data(accentColor)", width: 3, opacity: 1 },
  },
  { selector: "edge.hover-dim", style: { opacity: 0.12 } },
  { selector: "edge.graph-hidden.hover-dim", style: { opacity: 0, events: "no" } },
];
