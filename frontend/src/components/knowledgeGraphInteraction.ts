export type KnowledgeGraphInteractionState = {
  graphInteracting: boolean;
  workbenchResizing: boolean;
};

export function createKnowledgeGraphInteractionState(): KnowledgeGraphInteractionState {
  return { graphInteracting: false, workbenchResizing: false };
}

export function isKnowledgeGraphInteractionActive(state: KnowledgeGraphInteractionState) {
  return state.graphInteracting || state.workbenchResizing;
}

export function setGraphInteraction(state: KnowledgeGraphInteractionState, active: boolean) {
  state.graphInteracting = active;
}

export function setWorkbenchResize(state: KnowledgeGraphInteractionState, active: boolean) {
  state.workbenchResizing = active;
}
