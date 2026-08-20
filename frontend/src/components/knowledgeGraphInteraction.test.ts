import { describe, expect, it } from "vitest";
import {
  createKnowledgeGraphInteractionState,
  isKnowledgeGraphInteractionActive,
  isUserGraphViewportEvent,
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

  it("does not treat programmatic pan and zoom animation frames as user interaction", () => {
    expect(isUserGraphViewportEvent({})).toBe(false);
    expect(isUserGraphViewportEvent({ originalEvent: null })).toBe(false);
    expect(isUserGraphViewportEvent({ originalEvent: new Event("pointermove") })).toBe(true);
  });
});
