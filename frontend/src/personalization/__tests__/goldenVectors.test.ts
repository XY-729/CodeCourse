/**
 * Golden vector tests — TypeScript reference implementation.
 * Python must produce identical results for every vector.
 */
import { describe, it, expect } from "vitest";
import { calculateMastery, createInitialMastery, replayMastery, applyEvent, applyDecay } from "../masteryEngine";
import type { LearningEvent, PersonalizationScope } from "../types";
import vectors from "./goldenVectors.json";

const EPSILON = 1e-9;
const scope: PersonalizationScope = { type: "project", id: "golden" };
const baseNow = "2026-07-26T00:00:00Z";

interface VectorEvent {
  eventType: string;
  direction: string;
  strength: number;
  source: string;
  eventId?: string;
  targetEventId?: string;
  createdAt?: string;
}

function toLearningEvent(e: VectorEvent, idx: number): LearningEvent {
  return {
    eventId: e.eventId ?? `evt-${idx}`,
    idempotencyKey: e.eventId ?? `ik-${idx}`,
    schemaVersion: 1,
    conceptId: "golden-concept",
    scope,
    eventType: e.eventType as LearningEvent["eventType"],
    direction: e.direction as LearningEvent["direction"],
    strength: e.strength,
    source: e.source as LearningEvent["source"],
    targetEventId: e.targetEventId,
    isVoided: false,
    createdAt: e.createdAt ?? baseNow,
  };
}

describe("Golden Vectors — TypeScript", () => {
  for (const v of vectors.vectors) {
    it(`${v.id}: ${v.name}`, () => {
      const events: LearningEvent[] = (v.events ?? []).map((e, i) => toLearningEvent(e as VectorEvent, i));

      // Deduplicate by eventId for idempotency test
      const seenIds = new Set<string>();
      const dedupedEvents = events.filter((e) => {
        if (seenIds.has(e.eventId)) return false;
        seenIds.add(e.eventId);
        return true;
      });

      if (v.decay) {
        // Decay test: build mastery then apply decay
        const init = createInitialMastery("golden-concept", scope, baseNow);
        const initWithEvidence = {
          ...init,
          knownEvidence: v.initialEvidence.known,
          unknownEvidence: v.initialEvidence.unknown,
          mastery: calculateMastery(v.initialEvidence.known, v.initialEvidence.unknown).mastery,
          uncertainty: calculateMastery(v.initialEvidence.known, v.initialEvidence.unknown).uncertainty,
        };
        const pastDate = new Date(baseNow);
        pastDate.setDate(pastDate.getDate() - (v.daysSince as number));
        const withOldSeen = { ...initWithEvidence, lastSeenAt: pastDate.toISOString() };
        const decayed = applyDecay(withOldSeen, baseNow);

        if (v.expectedDecay!.knownEvidence !== undefined) {
          expect(decayed.knownEvidence).toBeCloseTo(v.expectedDecay!.knownEvidence, 5);
        }
        if (v.expectedDecay!.unknownEvidence !== undefined) {
          expect(decayed.unknownEvidence).toBeCloseTo(v.expectedDecay!.unknownEvidence, 5);
        }
        if (v.expectedDecay!.mastery !== undefined) {
          expect(decayed.mastery).toBeCloseTo(v.expectedDecay!.mastery, 5);
        }
        if (v.expectedDecay!.masteryLessThan !== undefined) {
          expect(decayed.mastery).toBeLessThan(v.expectedDecay!.masteryLessThan);
        }
        if (v.expectedDecay!.masteryGreaterThan !== undefined) {
          expect(decayed.mastery).toBeGreaterThan(v.expectedDecay!.masteryGreaterThan);
        }
        return;
      }

      // Standard replay test
      const exp = v.expected as Record<string, number | string | null>;
      const initial = createInitialMastery("golden-concept", scope, baseNow);
      const result = replayMastery("golden-concept", scope, dedupedEvents, initial, baseNow);

      expect(result.knownEvidence).toBeCloseTo(exp.knownEvidence as number, 5);
      expect(result.unknownEvidence).toBeCloseTo(exp.unknownEvidence as number, 5);
      expect(result.mastery).toBeCloseTo(exp.mastery as number, 7);
      expect(result.uncertainty).toBeCloseTo(exp.uncertainty as number, 7);
      expect(result.manualStatus).toBe((exp.manualStatus as string | null) ?? null);
    });
  }
});
