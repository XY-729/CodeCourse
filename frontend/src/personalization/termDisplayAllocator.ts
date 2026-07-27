import type {
  PreliminaryTermDecision,
  TermDisplayDecision,
} from "./termDisplayTypes";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function documentCap(
  paragraphCount: number,
  densityValue: number,
  profileAvailable: boolean,
): number {
  const density = clamp01(densityValue);
  const paragraphs = Math.max(1, paragraphCount);
  const ratio = 0.12 + density * 0.22;
  const calculated = Math.ceil(paragraphs * ratio);
  let hardCap: number;
  if (density < 0.34) {
    hardCap = 6;
  } else if (density < 0.75) {
    hardCap = 12;
  } else {
    hardCap = 20;
  }
  if (!profileAvailable) {
    hardCap = Math.min(hardCap, 6);
  }
  return Math.max(2, Math.min(calculated, hardCap));
}

function occurrencePreference(decision: PreliminaryTermDecision): number {
  if (decision.manualUnknown) return 100;
  return decision.score * 10;
}

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
  paragraphCount: number;
  terminologyDensity: number;
  profileAvailable: boolean;
}): TermDisplayDecision[] {
  const { preliminary, paragraphCount, terminologyDensity, profileAvailable } = params;

  const finalById = new Map<string, TermDisplayDecision>();
  for (const item of preliminary) {
    finalById.set(item.candidateId, makeDefault(item));
  }

  const eligible = preliminary.filter((item) => item.eligible);

  const bestByConcept = new Map<string, PreliminaryTermDecision>();
  for (const item of eligible) {
    const existing = bestByConcept.get(item.conceptKey);
    if (!existing) {
      bestByConcept.set(item.conceptKey, item);
      continue;
    }
    const itemPref = occurrencePreference(item);
    const existingPref = occurrencePreference(existing);
    const shouldReplace =
      itemPref > existingPref ||
      (itemPref === existingPref && item.occurrenceIndex < existing.occurrenceIndex);
    if (shouldReplace) {
      bestByConcept.set(item.conceptKey, item);
    }
  }

  const selectedOccurrenceIds = new Set(
    [...bestByConcept.values()].map((item) => item.candidateId),
  );

  for (const item of eligible) {
    if (!selectedOccurrenceIds.has(item.candidateId)) {
      finalById.set(item.candidateId, {
        ...makeDefault(item),
        reason: "duplicate_concept",
      });
    }
  }

  const ranked = [...bestByConcept.values()].sort((left, right) => {
    if (left.manualUnknown !== right.manualUnknown) return left.manualUnknown ? -1 : 1;
    if (right.score !== left.score) return right.score - left.score;
    if (left.occurrenceIndex !== right.occurrenceIndex) return left.occurrenceIndex - right.occurrenceIndex;
    return left.conceptKey.localeCompare(right.conceptKey);
  });

  const density = clamp01(terminologyDensity);
  const perParagraphCap = density >= 0.82 ? 2 : 1;
  const maxVisible = documentCap(paragraphCount, density, profileAvailable);

  const paragraphCounts = new Map<string, number>();
  let visibleCount = 0;

  for (const item of ranked) {
    const currentParagraphCount = paragraphCounts.get(item.paragraphId) ?? 0;
    if (currentParagraphCount >= perParagraphCap) {
      finalById.set(item.candidateId, {
        ...makeDefault(item),
        reason: "paragraph_density_limit",
      });
      continue;
    }
    if (visibleCount >= maxVisible) {
      finalById.set(item.candidateId, {
        ...makeDefault(item),
        reason: "document_density_limit",
      });
      continue;
    }
    paragraphCounts.set(item.paragraphId, currentParagraphCount + 1);
    visibleCount += 1;
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
