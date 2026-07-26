/**
 * Tests for masteryEngine.ts — pure functions.
 * Python mirror must pass identical golden vectors.
 */
import { describe, it, expect } from "vitest";
import {
  calculateMastery,
  createInitialMastery,
  applyEvent,
  replayMastery,
  applyDecay,
  getEffectiveMastery,
} from "../masteryEngine";
import { getEffectiveMastery as getEff } from "../types";
import type { LearningEvent, PersonalizationScope } from "../types";

const scope: PersonalizationScope = { type: "project", id: "test" };
const now = "2026-07-26T00:00:00Z";

function evt(overrides: Partial<LearningEvent> & { eventType: LearningEvent["eventType"] }): LearningEvent {
  return {
    eventId: overrides.eventId ?? "evt-1",
    idempotencyKey: overrides.idempotencyKey ?? "ik-1",
    schemaVersion: 1,
    conceptId: overrides.conceptId ?? "c1",
    scope: overrides.scope ?? scope,
    eventType: overrides.eventType,
    direction: overrides.direction ?? "neutral",
    strength: overrides.strength ?? 1.0,
    source: overrides.source ?? "explicit_user",
    targetEventId: overrides.targetEventId,
    isVoided: overrides.isVoided ?? false,
    createdAt: overrides.createdAt ?? now,
  };
}

// === 1. Default mastery is 0.5 ===
describe("default mastery", () => {
  it("new concept mastery = 0.5, uncertainty ≈ 0.707", () => {
    const m = createInitialMastery("c1", scope, now);
    expect(m.mastery).toBe(0.5);
    expect(m.uncertainty).toBeCloseTo(0.7071, 3);
    expect(m.manualStatus).toBeNull();
    expect(m.knownEvidence).toBe(1);
    expect(m.unknownEvidence).toBe(1);
  });
});

// === 2. manual_override_known sets status, NOT evidence ===
describe("manual_override_known", () => {
  it("sets manualStatus=known, evidence unchanged", () => {
    let m = createInitialMastery("c1", scope, now);
    m = applyEvent(evt({ eventType: "manual_override_known", direction: "known" }), m);
    expect(m.manualStatus).toBe("known");
    expect(m.knownEvidence).toBe(1); // UNCHANGED
    expect(m.unknownEvidence).toBe(1); // UNCHANGED
    expect(m.mastery).toBe(0.5); // UNCHANGED
  });

  it("effective mastery is 0.99 for display", () => {
    let m = createInitialMastery("c1", scope, now);
    m = applyEvent(evt({ eventType: "manual_override_known", direction: "known" }), m);
    const eff = getEffectiveMastery(m);
    expect(eff.mastery).toBe(0.99);
  });
});

// === 3. manual_override_unknown sets status, NOT evidence ===
describe("manual_override_unknown", () => {
  it("sets manualStatus=unknown, evidence unchanged", () => {
    let m = createInitialMastery("c1", scope, now);
    m = applyEvent(evt({ eventType: "manual_override_unknown", direction: "unknown" }), m);
    expect(m.manualStatus).toBe("unknown");
    expect(m.knownEvidence).toBe(1);
    expect(m.unknownEvidence).toBe(1);
    expect(m.mastery).toBe(0.5);
  });

  it("effective mastery is 0.01 for display", () => {
    let m = createInitialMastery("c1", scope, now);
    m = applyEvent(evt({ eventType: "manual_override_unknown", direction: "unknown" }), m);
    const eff = getEffectiveMastery(m);
    expect(eff.mastery).toBe(0.01);
  });
});

// === 4. manual_override_cleared removes status, auto evidence preserved ===
describe("manual_override_cleared", () => {
  it("restores automatic state without changing evidence", () => {
    let m = createInitialMastery("c1", scope, now);
    // Apply some auto evidence, then override, then clear
    m = applyEvent(evt({ eventType: "completed_exercise", direction: "known" }), m); // +3 known
    expect(m.knownEvidence).toBe(4);
    m = applyEvent(evt({ eventType: "manual_override_unknown", direction: "unknown" }), m);
    expect(m.manualStatus).toBe("unknown");
    m = applyEvent(evt({ eventType: "manual_override_cleared", direction: "neutral" }), m);
    expect(m.manualStatus).toBeNull();
    expect(m.knownEvidence).toBe(4); // PRESERVED
    expect(m.mastery).toBe(4 / 5); // 4 / (4+1) = 0.8
  });
});

// === 5. One misclick doesn't leave extreme auto mastery ===
describe("misclick protection", () => {
  it("clicking unknown then clearing leaves mastery near 0.5", () => {
    let m = createInitialMastery("c1", scope, now);
    m = applyEvent(evt({ eventType: "manual_override_unknown", direction: "unknown" }), m);
    m = applyEvent(evt({ eventType: "manual_override_cleared", direction: "neutral" }), m);
    // Evidence is UNCHANGED (still 1,1)
    expect(m.mastery).toBe(0.5);
    // Not 0.143 (old ±5 bug)
  });

  it("clicking known then clearing doesn't leave 0.857 mastery", () => {
    let m = createInitialMastery("c1", scope, now);
    m = applyEvent(evt({ eventType: "manual_override_known", direction: "known" }), m);
    m = applyEvent(evt({ eventType: "manual_override_cleared", direction: "neutral" }), m);
    expect(m.mastery).toBe(0.5);
  });
});

// === 6. Replay produces deterministic results ===
describe("replayMastery", () => {
  it("produces same result as sequential apply", () => {
    const events = [
      evt({ eventId: "e1", eventType: "asked_definition", direction: "unknown", strength: 0.75 }),
      evt({ eventId: "e2", eventType: "saved_learning_anchor", direction: "known" }),
    ];
    let seq = createInitialMastery("c1", scope, now);
    for (const e of events) seq = applyEvent(e, seq);
    const rep = replayMastery("c1", scope, events, undefined, now);
    expect(rep.mastery).toBe(seq.mastery);
    expect(rep.knownEvidence).toBe(seq.knownEvidence);
    expect(rep.unknownEvidence).toBe(seq.unknownEvidence);
  });

  it("excludes event_voided targets via compensation", () => {
    const events = [
      evt({ eventId: "e1", eventType: "asked_definition", direction: "unknown" }),
      evt({ eventId: "e2", eventType: "event_voided", direction: "neutral", targetEventId: "e1" }),
    ];
    const result = replayMastery("c1", scope, events, undefined, now);
    expect(result.knownEvidence).toBe(1);
    expect(result.unknownEvidence).toBe(1); // e1 was voided
  });
});

// === 7. System inference is capped at ±1 ===
describe("capped inference", () => {
  it("capped_definition from model_inference adds max +3 capped to +1", () => {
    let m = createInitialMastery("c1", scope, now);
    m = applyEvent(evt({ eventType: "asked_definition", direction: "unknown", source: "model_inference" }), m);
    expect(m.unknownEvidence).toBe(2); // 1 + 1
  });
});

// === 8. Not clicking doesn't create known evidence ===
describe("no implicit evidence", () => {
  it("no event → mastery stays 0.5", () => {
    const m = createInitialMastery("c1", scope, now);
    expect(m.mastery).toBe(0.5);
  });
});

// === 9. Manual override blocks auto events ===
describe("manual override blocks auto", () => {
  it("auto event skipped when manualStatus=known", () => {
    let m = createInitialMastery("c1", scope, now);
    m = applyEvent(evt({ eventType: "manual_override_known", direction: "known" }), m);
    m = applyEvent(evt({ eventType: "asked_definition", direction: "unknown" }), m);
    expect(m.unknownEvidence).toBe(1); // BLOCKED
  });
});

// === 10. Decay brings mastery back toward 0.5 ===
describe("decay", () => {
  it("known evidence decays toward prior after long inactivity", () => {
    let m = createInitialMastery("c1", scope, now);
    // Simulate user learned concept (many known events)
    m = applyEvent(evt({ eventType: "saved_learning_anchor", direction: "known", createdAt: "2024-07-26T00:00:00Z" }), m);
    m = applyEvent(evt({ eventType: "saved_learning_anchor", direction: "known", createdAt: "2024-07-26T00:00:00Z" }), m);
    m = applyEvent(evt({ eventType: "saved_learning_anchor", direction: "known", createdAt: "2024-07-26T00:00:00Z" }), m);
    // known = 1 + 2*3 = 7, unknown = 1, mastery = 7/8 = 0.875
    expect(m.mastery).toBeCloseTo(0.875, 2);

    // Apply decay after 2 years (~730 days)
    const futureDate = "2026-07-26T00:00:00Z";
    m = { ...m, lastSeenAt: "2024-01-01T00:00:00Z" }; // ~2.5 years ago
    const decayed = applyDecay(m, futureDate);
    // After significant decay, mastery should move toward 0.5
    expect(decayed.mastery).toBeLessThan(0.875);
    expect(decayed.mastery).toBeGreaterThan(0.5); // still above 0.5 with some residual from prior
  });

  it("unknown evidence decays toward prior too", () => {
    let m = createInitialMastery("c1", scope, now);
    m = applyEvent(evt({ eventType: "asked_definition", direction: "unknown", createdAt: "2024-01-01T00:00:00Z" }), m);
    m = applyEvent(evt({ eventType: "asked_definition", direction: "unknown", createdAt: "2024-01-01T00:00:00Z" }), m);
    // known=1, unknown=1+3+3=7, mastery=1/8=0.125
    expect(m.mastery).toBeCloseTo(0.125, 2);
    const future = "2026-07-26T00:00:00Z";
    m = { ...m, lastSeenAt: "2024-01-01T00:00:00Z" };
    const decayed = applyDecay(m, future);
    expect(decayed.mastery).toBeGreaterThan(0.125); // moved up
    expect(decayed.mastery).toBeLessThan(0.55); // but not too much
  });

  it("symmetric evidence stays at 0.5 after decay", () => {
    const m = createInitialMastery("c1", scope, now);
    const future = "2026-07-26T00:00:00Z";
    const m2 = { ...m, lastSeenAt: "2024-01-01T00:00:00Z" };
    const decayed = applyDecay(m2, future);
    expect(decayed.mastery).toBeCloseTo(0.5, 1);
  });

  it("manualStatus blocks mastery change from decay", () => {
    let m = createInitialMastery("c1", scope, now);
    m = applyEvent(evt({ eventType: "manual_override_known", direction: "known", createdAt: "2024-01-01T00:00:00Z" }), m);
    m = { ...m, lastSeenAt: "2024-01-01T00:00:00Z" };
    const decayed = applyDecay(m, "2026-07-26T00:00:00Z");
    expect(decayed.mastery).toBe(0.5); // underlying mastery unchanged by decay when manual
    expect(decayed.manualStatus).toBe("known");
    // But uncertainty should still increase
    expect(decayed.uncertainty).toBeGreaterThan(0.01);
  });
});

// === 11. Idempotency: replay produces same result twice ===
describe("replay determinism", () => {
  it("same events → same mastery (platform independent)", () => {
    const events = [
      evt({ eventId: "a", eventType: "asked_definition", direction: "unknown", strength: 0.8, source: "system_inference" }),
      evt({ eventId: "b", eventType: "saved_learning_anchor", direction: "known" }),
    ];
    const r1 = replayMastery("c1", scope, events, undefined, now);
    const r2 = replayMastery("c1", scope, events, undefined, now);
    expect(r1.mastery).toBe(r2.mastery);
    expect(r1.uncertainty).toBe(r2.uncertainty);
    expect(r1.knownEvidence).toBe(r2.knownEvidence);
    expect(r1.unknownEvidence).toBe(r2.unknownEvidence);
  });
});

// === 12. Knowing socket doesn't imply knowing related concepts ===
describe("concept independence", () => {
  it("socket mastery doesn't affect bind, listen, accept", () => {
    // Each concept is tracked independently. Marking socket as known
    // only changes socket's manualStatus, not evidence, and does not
    // affect other concepts at all.
    const socket = createInitialMastery("global:cpp-network:socket", scope, now);
    const bind = createInitialMastery("global:cpp-network:bind", scope, now);
    const listen = createInitialMastery("global:cpp-network:listen", scope, now);
    const accept = createInitialMastery("global:cpp-network:accept", scope, now);

    // Mark socket as known (only changes manualStatus, not evidence)
    const updatedSocket = applyEvent(
      evt({ conceptId: "global:cpp-network:socket", eventType: "manual_override_known", direction: "known" }),
      socket,
    );

    // Socket has manualStatus=known, others are null
    expect(updatedSocket.manualStatus).toBe("known");
    expect(bind.manualStatus).toBeNull();
    expect(listen.manualStatus).toBeNull();
    expect(accept.manualStatus).toBeNull();

    // All concepts have the same auto evidence (1,1) → mastery=0.5
    expect(bind.mastery).toBe(0.5);
    expect(listen.mastery).toBe(0.5);
    expect(accept.mastery).toBe(0.5);
    expect(updatedSocket.mastery).toBe(0.5); // evidence unchanged

    // But effective mastery for socket is 0.99 due to manualStatus
    expect(getEff(updatedSocket).mastery).toBe(0.99);
    expect(getEff(bind).mastery).toBe(0.5);
  });
});
