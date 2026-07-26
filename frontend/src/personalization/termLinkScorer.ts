// ============================================================
// Pure-function term link scorer — no side effects, no I/O
// Reference implementation (TypeScript).
// ============================================================

import type { ConceptMastery, ScoredTerm, TermCandidate, DisplayTier, ManualStatus } from "./types";
import { getEffectiveMastery } from "./types";
import { applyDecay } from "./masteryEngine";

// ---- Weights ----
const W_UNFAMILIARITY = 0.50;
const W_DIFFICULTY = 0.20;
const W_CONTEXT = 0.20;
const W_EXPLORATION = 0.10;

// ---- Thresholds ----
const PROMINENT_THRESHOLD = 0.72;
const SUBTLE_THRESHOLD = 0.55;

// ---- Density caps ----
const MAX_PER_PARAGRAPH = 2;
const MAX_PER_1000_CHARS = 6;

// ---- Exploration ----
const EXPLORATION_UNCERTAINTY_MIN = 0.3;
const EXPLORATION_MASTERY_LOW = 0.4;
const EXPLORATION_MASTERY_HIGH = 0.6;
const EXPLORATION_MIN = 0.05;
const EXPLORATION_MAX = 0.10;

/**
 * Score a single term candidate against the user's mastery state.
 * Uses getEffectiveMastery() so manualStatus controls display
 * without polluting automatic evidence.
 */
export function scoreTermLink(
  candidate: TermCandidate,
  mastery: ConceptMastery | null,
  now: string,
  explorationSeed: number,
): ScoredTerm {
  // Decay the mastery (affects automatic mastery only, manual status blocks it)
  const decayed = mastery ? applyDecay(mastery, now) : null;

  const rawMastery = decayed ? decayed.mastery : 0.5;
  const rawUncertainty = decayed ? decayed.uncertainty : (1 / Math.sqrt(2));
  const manualStatus: ManualStatus = decayed?.manualStatus ?? null;

  // Effective mastery for display
  const effective = decayed ? getEffectiveMastery(decayed) : { mastery: 0.5, uncertainty: rawUncertainty };
  const unfamiliarity = 1 - effective.mastery;

  // ---- Exploration bonus ----
  let explorationBonus = 0;
  if (explorationSeed > 0 && rawUncertainty > EXPLORATION_UNCERTAINTY_MIN &&
      rawMastery >= EXPLORATION_MASTERY_LOW && rawMastery <= EXPLORATION_MASTERY_HIGH) {
    explorationBonus = EXPLORATION_MIN + explorationSeed * (EXPLORATION_MAX - EXPLORATION_MIN);
  }

  const linkScore =
    W_UNFAMILIARITY * unfamiliarity +
    W_DIFFICULTY * candidate.generalDifficulty +
    W_CONTEXT * candidate.contextRelevance +
    W_EXPLORATION * explorationBonus;

  // A high-confidence cold-start candidate should still be discoverable even
  // before the learner has accumulated mastery evidence.
  const displayTier = (
    !mastery && candidate.termConfidence >= 0.78 && manualStatus !== "known"
      ? (linkScore >= PROMINENT_THRESHOLD ? "prominent" : "subtle")
      : getDisplayTier(linkScore, manualStatus)
  );

  return {
    ...candidate,
    mastery: effective.mastery,
    uncertainty: effective.uncertainty,
    manualStatus,
    linkScore: clamp(linkScore, 0, 1),
    displayTier,
  };
}

/**
 * Determine display tier from linkScore.
 * manualStatus=known → "none" (suppress)
 * manualStatus=unknown → floor at "subtle"
 */
export function getDisplayTier(linkScore: number, manualStatus: ManualStatus): DisplayTier {
  if (manualStatus === "known") return "none";
  if (manualStatus === "unknown") {
    if (linkScore >= PROMINENT_THRESHOLD) return "prominent";
    return "subtle";
  }
  if (linkScore >= PROMINENT_THRESHOLD) return "prominent";
  if (linkScore >= SUBTLE_THRESHOLD) return "subtle";
  return "none";
}

/**
 * Score a batch of term candidates against mastery data.
 */
export function scoreTermLinks(
  candidates: TermCandidate[],
  masteryMap: Map<string, ConceptMastery>,
  now: string,
  explorationSeed: number,
): ScoredTerm[] {
  return candidates
    .map((c) => {
      const m = c.conceptId ? (masteryMap.get(c.conceptId) ?? null) : null;
      return scoreTermLink(c, m, now, explorationSeed);
    })
    .sort((a, b) => b.linkScore - a.linkScore);
}

/**
 * Apply density caps and deduplication.
 * - First occurrence only per concept
 * - density limit per text length
 * - Explicitly asked concepts always get "prominent"
 */
export function selectTopTerms(
  scoredTerms: ScoredTerm[],
  textLength: number,
  explicitlyAskedConceptIds: Set<string> = new Set(),
  terminologyDensity = 0.5,
): ScoredTerm[] {
  // Boost explicitly asked concepts to prominent
  const withOverrides = scoredTerms.map((t) => {
    if (t.conceptId && explicitlyAskedConceptIds.has(t.conceptId)) {
      return { ...t, displayTier: "prominent" as DisplayTier, linkScore: 1.0 };
    }
    return t;
  });

  const visible = withOverrides.filter((t) => t.displayTier !== "none");

  // Deduplicate by conceptId (first occurrence wins)
  const seenConceptIds = new Set<string>();
  const deduped: ScoredTerm[] = [];
  for (const t of visible) {
    const key = t.conceptId ?? t.text.toLowerCase();
    if (seenConceptIds.has(key)) continue;
    seenConceptIds.add(key);
    deduped.push(t);
  }

  deduped.sort((a, b) => b.linkScore - a.linkScore);

  // Keep the historical default at six terms per 1000 characters while
  // allowing the learner preference to move the cap between four and eight.
  const densityRate = MAX_PER_1000_CHARS + Math.round((clamp(terminologyDensity, 0, 1) - 0.5) * 4);
  const maxTerms = Math.min(
    24,
    Math.max(2, Math.ceil((textLength / 1000) * densityRate)),
  );
  return deduped.slice(0, maxTerms);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
