import type {
  PreliminaryTermDecision,
  TermDisplayDecision,
} from "./termDisplayTypes";

function makeDefault(decision: PreliminaryTermDecision): TermDisplayDecision {
  return {
    candidateId: decision.candidateId,
    conceptKey: decision.conceptKey,
    paragraphId: decision.paragraphId,
    occurrenceIndex: decision.occurrenceIndex,
    visible: false,
    score: decision.score,
    tier: "none",
    reason: decision.reason,
  };
}

export function allocateTermDisplays(params: {
  preliminary: PreliminaryTermDecision[];
  paragraphCount?: number;
  /** Accepted for legacy callers; density no longer affects annotation. */
  terminologyDensity?: number;
  profileAvailable?: boolean;
}): TermDisplayDecision[] {
  const { preliminary } = params;

  const finalById = new Map<string, TermDisplayDecision>();
  for (const item of preliminary) {
    finalById.set(item.candidateId, makeDefault(item));
  }

  // Explicitly created links are user content, not automatic annotations.
  // They must not disappear when knowledge state changes.
  for (const item of preliminary) {
    if (item.eligible && item.reason === "explicit_manual_link") {
      finalById.set(item.candidateId, { ...makeDefault(item), visible: true, tier: item.tier });
    }
  }
  const ranked = preliminary.filter((item) => item.eligible && item.reason !== "explicit_manual_link").sort((left, right) => {
    if (left.manualUnknown !== right.manualUnknown) return left.manualUnknown ? -1 : 1;
    if (right.score !== left.score) return right.score - left.score;
    if (left.occurrenceIndex !== right.occurrenceIndex) return left.occurrenceIndex - right.occurrenceIndex;
    return left.conceptKey.localeCompare(right.conceptKey);
  });

  const displayedConcepts = new Set<string>();

  for (const item of ranked) {
    if (displayedConcepts.has(item.conceptKey)) {
      finalById.set(item.candidateId, { ...makeDefault(item), reason: "duplicate_concept" });
      continue;
    }
    displayedConcepts.add(item.conceptKey);
    finalById.set(item.candidateId, {
      candidateId: item.candidateId,
      conceptKey: item.conceptKey,
      paragraphId: item.paragraphId,
      occurrenceIndex: item.occurrenceIndex,
      visible: true,
      score: item.score,
      tier: item.tier,
      reason: item.reason,
    });
  }

  return preliminary.map((item) => finalById.get(item.candidateId)!);
}
