// Barrel export for personalization module
export * from "./types";
export * from "./observationTypes";
export * from "./termDisplayTypes";
export * from "./termDisplayDecision";
export * from "./termDisplayAllocator";
export * from "./termOccurrences";
export * from "./masteryEngine";
export * from "./termLinkScorer";
export * from "./conceptResolver";
export * from "./preferenceEngine";
export * from "./domainInference";
export * from "./knowledgeState";
export { usePersonalization } from "./usePersonalization";
export { useTermDisplay, createNeutralTermProfile } from "./useTermDisplay";
export type { UseTermDisplayParams, UseTermDisplayResult } from "./useTermDisplay";
