import { computeTreeForestPositions, type KnowledgeGraphLayoutRequest, type KnowledgeGraphLayoutResult } from "./knowledgeGraphLayout";

self.onmessage = (event: MessageEvent<KnowledgeGraphLayoutRequest>) => {
  const result: KnowledgeGraphLayoutResult = {
    requestId: event.data.requestId,
    positions: computeTreeForestPositions(event.data.graph),
  };
  self.postMessage(result);
};
