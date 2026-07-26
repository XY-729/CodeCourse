// ============================================================
// Pure-function mastery engine — no side effects, no I/O
// Reference implementation (TypeScript).
// Python mirror must produce identical results verified by golden vectors.
// ============================================================

import type {
  ConceptMastery,
  LearningEvent,
  PersonalizationScope,
  ManualStatus,
} from "./types";
import {
  PRIOR_KNOWN,
  PRIOR_UNKNOWN,
  DEFAULT_MASTERY,
  DEFAULT_UNCERTAINTY,
  AUTO_EVIDENCE_DELTAS,
  getEffectiveMastery,
} from "./types";

export { getEffectiveMastery } from "./types";

// ---- Pure calculations ----

export interface MasteryResult {
  mastery: number;
  uncertainty: number;
}

/**
 * Calculate mastery and uncertainty from evidence counts.
 * Pure function: same inputs → same outputs everywhere.
 */
export function calculateMastery(knownEvidence: number, unknownEvidence: number): MasteryResult {
  const total = knownEvidence + unknownEvidence;
  if (total <= 0) {
    return { mastery: DEFAULT_MASTERY, uncertainty: DEFAULT_UNCERTAINTY };
  }
  const mastery = knownEvidence / total;
  const uncertainty = 1 / Math.sqrt(total);
  return { mastery: clamp(mastery, 0, 1), uncertainty: clamp(uncertainty, 0, 1) };
}

/**
 * Create initial mastery state for a concept the user has never encountered.
 */
export function createInitialMastery(
  conceptId: string,
  scope: PersonalizationScope,
  now: string,
): ConceptMastery {
  const { mastery, uncertainty } = calculateMastery(PRIOR_KNOWN, PRIOR_UNKNOWN);
  return {
    id: "",
    conceptId,
    scope,
    knownEvidence: PRIOR_KNOWN,
    unknownEvidence: PRIOR_UNKNOWN,
    mastery,
    uncertainty,
    manualStatus: null,
    sequence: 0,
    lastSeenAt: now,
    updatedAt: now,
  };
}

/**
 * Apply decay to evidence, bringing mastery back toward 0.5 over time.
 *
 * Only the "excess" evidence (above prior) is decayed.
 * Prior (1, 1) is fixed — it never decays.
 * Manual status blocks decay on mastery but uncertainty still increases.
 *
 * Decay rate: 10% per 30 days of inactivity.
 */
export function applyDecay(
  m: ConceptMastery,
  now: string,
): ConceptMastery {
  const lastSeen = new Date(m.lastSeenAt).getTime();
  const nowMs = new Date(now).getTime();
  if (isNaN(lastSeen) || isNaN(nowMs) || nowMs <= lastSeen) {
    return m;
  }

  const daysSince = (nowMs - lastSeen) / (1000 * 60 * 60 * 24);
  const decayPeriods = Math.floor(daysSince / 30);
  if (decayPeriods <= 0) return m;

  // Each period decays 10% of the excess above prior
  const decayFactor = Math.pow(0.9, decayPeriods);

  const excessKnown = Math.max(0, m.knownEvidence - PRIOR_KNOWN);
  const excessUnknown = Math.max(0, m.unknownEvidence - PRIOR_UNKNOWN);

  const decayedKnown = PRIOR_KNOWN + excessKnown * decayFactor;
  const decayedUnknown = PRIOR_UNKNOWN + excessUnknown * decayFactor;

  const { mastery, uncertainty } = calculateMastery(decayedKnown, decayedUnknown);

  // Manual status blocks mastery change from decay, but uncertainty still increases
  const effectiveUncertainty = clamp(
    Math.max(uncertainty, m.uncertainty * 0.5 + uncertainty * 0.5),
    0, 1,
  );

  if (m.manualStatus !== null) {
    return {
      ...m,
      uncertainty: effectiveUncertainty,
    };
  }

  return {
    ...m,
    knownEvidence: decayedKnown,
    unknownEvidence: decayedUnknown,
    mastery,
    uncertainty: effectiveUncertainty,
  };
}

/**
 * Apply a single learning event to the current mastery state.
 * Returns the updated state (does NOT mutate input).
 *
 * Rules:
 * - manual_override_known: sets manualStatus="known", evidence UNCHANGED
 * - manual_override_unknown: sets manualStatus="unknown", evidence UNCHANGED
 * - manual_override_cleared: sets manualStatus=null, evidence UNCHANGED
 * - event_voided: compensation event, the VOIDED event is identified by targetEventId
 * - Other events: update evidence if manualStatus is null (automatic mode)
 * - System/model inference events are capped at ±1
 */
export function applyEvent(
  event: LearningEvent,
  current: ConceptMastery,
): ConceptMastery {
  let known = current.knownEvidence;
  let unknown = current.unknownEvidence;
  let manualStatus: ManualStatus = current.manualStatus;

  // ---- Manual override events (do NOT touch evidence) ----
  if (event.eventType === "manual_override_known") {
    manualStatus = "known";
    return {
      ...current,
      manualStatus,
      lastSeenAt: event.createdAt,
      updatedAt: event.createdAt,
    };
  }
  if (event.eventType === "manual_override_unknown") {
    manualStatus = "unknown";
    return {
      ...current,
      manualStatus,
      lastSeenAt: event.createdAt,
      updatedAt: event.createdAt,
    };
  }
  if (event.eventType === "manual_override_cleared") {
    manualStatus = null;
    return {
      ...current,
      manualStatus,
      lastSeenAt: event.createdAt,
      updatedAt: event.createdAt,
    };
  }

  // ---- Compensation: event_voided ----
  if (event.eventType === "event_voided") {
    // event_voided itself doesn't change evidence.
    // The caller must replay all events (excluding the voided target)
    // to recompute evidence correctly.
    return { ...current, lastSeenAt: event.createdAt, updatedAt: event.createdAt };
  }

  // ---- Skip if manual override is active (automatic events are blocked) ----
  if (current.manualStatus !== null) {
    return { ...current, lastSeenAt: event.createdAt, updatedAt: event.createdAt };
  }

  // ---- Apply automatic evidence deltas ----
  const delta = AUTO_EVIDENCE_DELTAS[event.eventType];
  if (!delta || (delta.known === 0 && delta.unknown === 0)) {
    return { ...current, lastSeenAt: event.createdAt, updatedAt: event.createdAt };
  }

  let dKnown = delta.known;
  let dUnknown = delta.unknown;

  // Cap non-explicit events at ±1
  if (event.source !== "explicit_user") {
    dKnown = Math.min(dKnown, 1);
    dUnknown = Math.min(dUnknown, 1);
  }

  const strength = clamp(event.strength, 0, 1);
  known += dKnown * strength;
  unknown += dUnknown * strength;

  // Floor at base prior
  known = Math.max(PRIOR_KNOWN, known);
  unknown = Math.max(PRIOR_UNKNOWN, unknown);

  const { mastery, uncertainty } = calculateMastery(known, unknown);

  return {
    ...current,
    knownEvidence: known,
    unknownEvidence: unknown,
    mastery,
    uncertainty,
    manualStatus,
    sequence: current.sequence + 1,
    lastSeenAt: event.createdAt,
    updatedAt: event.createdAt,
  };
}

/**
 * Replay all events for a concept to produce the current mastery state.
 * Events are applied in chronological order: first by createdAt, then by id.
 *
 * Voided events (isVoided=true) are excluded.
 * Events whose targetEventId is event_voided in the list are also excluded.
 */
export function replayMastery(
  conceptId: string,
  scope: PersonalizationScope,
  events: LearningEvent[],
  startingMastery?: ConceptMastery,
  now?: string,
): ConceptMastery {
  const base = startingMastery ?? createInitialMastery(conceptId, scope, now ?? new Date().toISOString());

  // Collect targetEventIds from event_voided events
  const voidedTargetIds = new Set<string>();
  for (const e of events) {
    if (e.eventType === "event_voided" && e.targetEventId) {
      voidedTargetIds.add(e.targetEventId);
    }
  }

  // Filter: exclude isVoided and events targeted by event_voided
  const active = events
    .filter((e) => !e.isVoided && !voidedTargetIds.has(e.eventId))
    .sort((a, b) => {
      const dateCmp = a.createdAt.localeCompare(b.createdAt);
      if (dateCmp !== 0) return dateCmp;
      return a.eventId.localeCompare(b.eventId);
    });

  return active.reduce((current, event) => applyEvent(event, current), { ...base });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
