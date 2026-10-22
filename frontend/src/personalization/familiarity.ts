import { familiarityLabel, type FamiliarityState } from "./conceptForest";

/**
 * Minimal evidence shape needed to state what a learner actually did.
 * Probabilities, priors and model guesses are deliberately absent: they belong
 * to the retired BKT profile, not to the user's own learning record.
 */
export interface LearningFact {
  source: string;
  action: string;
  result?: "understood" | "partial" | "needs_help" | "clear" | string | null;
  kind?: "planned" | "mentioned" | "brief" | "explained" | string | null;
  voided?: boolean;
  eventTime?: string | null;
}

const FACT_ORDER: FamiliarityState[] = [
  "needs_help",
  "partially_understood",
  "self_reported_understood",
  "declared_known",
  "studied",
  "encountered",
  "unrecorded",
];

/**
 * Reduce the learner's own actions into one factual state per concept range.
 * - only explicit confirmations become "understood"; generated content does not
 * - study completion is recorded as studied, never as understood
 * - a still-open question outranks old positive evidence
 * - non-empty disagreement between ranges becomes mixed instead of being averaged
 */
export function familiarityFromFacts(facts: readonly LearningFact[]): FamiliarityState {
  const active = facts
    .filter((fact) => !fact.voided)
    .map((fact, index) => ({ fact, index }))
    .sort((left, right) => {
      const leftAt = left.fact.eventTime ?? "";
      const rightAt = right.fact.eventTime ?? "";
      if (leftAt === rightAt) return left.index - right.index;
      return leftAt.localeCompare(rightAt);
    });
  if (!active.length) return "unrecorded";

  // A later manual declaration (or its removal) replaces the previous one;
  // it is the user's own statement, so it outranks generated evidence.
  let manual: FamiliarityState | null = null;
  const states = new Set<FamiliarityState>();
  for (const { fact } of active) {
    if (fact.action === "manual_known" || fact.result === "declared_known") { manual = "declared_known"; continue; }
    if (fact.action === "manual_unknown") { manual = "needs_help"; continue; }
    if (fact.action === "manual_clear") { manual = null; continue; }
    const state = stateOf(fact);
    if (state) states.add(state);
  }
  if (manual) return manual;
  if (!states.size) return "unrecorded";
  for (const candidate of FACT_ORDER) {
    if (states.has(candidate)) {
      // Understood and partially understood at once: keep the narrower claim.
      if (candidate === "self_reported_understood" && states.has("partially_understood")) continue;
      return candidate;
    }
  }
  return "unrecorded";
}

function stateOf(fact: LearningFact): FamiliarityState | null {
  if (fact.result === "understood") return "self_reported_understood";
  if (fact.result === "partial") return "partially_understood";
  if (fact.result === "needs_help") return "needs_help";
  if (fact.result === "clear") return null;
  if (fact.source === "course_completion") return "studied";
  if (fact.action === "open_material" || fact.action === "opened") return "encountered";
  if (fact.kind === "planned" || fact.kind === "mentioned") return null;
  return null;
}

export function familiarityText(state: FamiliarityState): string {
  return familiarityLabel[state];
}

/** Never phrase an unknown range as "does not know". */
export function familiarityIsHelpfulEntry(state: FamiliarityState): boolean {
  return state !== "declared_known" && state !== "self_reported_understood";
}
