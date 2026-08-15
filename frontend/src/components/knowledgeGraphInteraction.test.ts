import { describe, expect, it } from "vitest";
import {
  createKnowledgeGraphInteractionState,
  isKnowledgeGraphInteractionActive,
  setGraphInteraction,
  setWorkbenchResize,
} from "./knowledgeGraphInteraction";

describe("knowledge graph interaction state", () => {
  it("stays active until both graph and workbench interactions finish", () => {
    const state = createKnowledgeGraphInteractionState();
    setGraphInteraction(state, true);
    setWorkbenchResize(state, true);
    setGraphInteraction(state, false);
    expect(isKnowledgeGraphInteractionActive(state)).toBe(true);
    setWorkbenchResize(state, false);
    expect(isKnowledgeGraphInteractionActive(state)).toBe(false);
  });
});
