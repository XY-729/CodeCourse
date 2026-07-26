// ============================================================
// Shared personalization types — Desktop + Android + tests
// No runtime dependencies (no React, no Node, no Capacitor, no DOM)
// ============================================================

// ---- Identifiers ----

export type EventId = string;
export type ConceptId = string;

// ---- Scope ----

export type ScopeType = "global" | "project" | "session";

export interface PersonalizationScope {
  type: ScopeType;
  id: string;
}

export function scopeKey(scope: PersonalizationScope): string {
  return `${scope.type}:${scope.id}`;
}

// ---- Concepts ----

export type ConceptType =
  | "language_feature"
  | "framework_api"
  | "pattern"
  | "tool"
  | "theory"
  | "project_symbol";

/**
 * Concept with stable namespaced identifier.
 *
 * conceptKey format:
 *   global:<domain>:<name>       e.g. global:cpp-network:socket
 *   project:<projectId>:symbol:<name>  e.g. project:12:symbol:UserService
 */
export interface Concept {
  id: ConceptId;
  conceptKey: string;
  canonicalName: string;
  displayName: string;
  domain: string;
  conceptType: ConceptType;
  aliases: string[];
  difficulty: number;
  createdAt: string;
}

// ---- Learning Events ----

export type EventType =
  // Automatic evidence (system/model inference only, capped at ±1)
  | "asked_definition"
  | "asked_clarification"
  | "used_correctly"
  | "opened_explanation"
  | "completed_exercise"
  | "saved_learning_anchor"
  // Manual override (changes manualStatus, does NOT affect evidence counts)
  | "manual_override_known"
  | "manual_override_unknown"
  | "manual_override_cleared"
  // Compensation for undo (appended, not update-in-place)
  | "event_voided";

export type EventDirection = "known" | "unknown" | "neutral";

export type EventSource = "explicit_user" | "system_inference" | "model_inference";

export interface LearningEvent {
  eventId: EventId;
  idempotencyKey: string;
  schemaVersion: number;
  conceptId: ConceptId;
  scope: PersonalizationScope;
  eventType: EventType;
  direction: EventDirection;
  strength: number; // 0–1
  source: EventSource;
  /** For event_voided: the eventId of the event being voided */
  targetEventId?: string;
  evidenceText?: string;
  sessionId?: string;
  qaRecordId?: number;
  /** True only for privacy-deletion, never for business undo */
  isVoided: boolean;
  createdAt: string;
}

// ---- Concept Mastery ----

export type ManualStatus = "known" | "unknown" | null;

export interface ConceptMastery {
  id: string;
  conceptId: ConceptId;
  scope: PersonalizationScope;
  /** Raw evidence counts (only from automatic events, manual override events do NOT affect these) */
  knownEvidence: number;
  unknownEvidence: number;
  /** Computed automatic mastery (may differ from effective mastery used for display) */
  mastery: number;
  uncertainty: number;
  manualStatus: ManualStatus;
  /** Monotonic sequence for concurrency safety */
  sequence: number;
  lastSeenAt: string;
  updatedAt: string;
}

// ---- Constants ----

export const PRIOR_KNOWN = 1;
export const PRIOR_UNKNOWN = 1;
export const DEFAULT_MASTERY = 0.5;
export const DEFAULT_UNCERTAINTY = 1 / Math.sqrt(2); // ≈0.707

export const CURRENT_SCHEMA_VERSION = 1;

// ---- Pure helpers ----

/**
 * Get the effective mastery used for display decisions.
 *
 * manualStatus=known → very high effective mastery (term not highlighted)
 * manualStatus=unknown → very low effective mastery (term always shown)
 * manualStatus=null → use automatic mastery
 *
 * The underlying automatic mastery is NOT changed by this function.
 */
export function getEffectiveMastery(m: ConceptMastery): { mastery: number; uncertainty: number } {
  if (m.manualStatus === "known") {
    return { mastery: 0.99, uncertainty: 0.01 };
  }
  if (m.manualStatus === "unknown") {
    return { mastery: 0.01, uncertainty: 0.01 };
  }
  return { mastery: m.mastery, uncertainty: m.uncertainty };
}

// ---- Evidence deltas (automatic events only) ----

export interface EvidenceDelta {
  known: number;
  unknown: number;
}

/**
 * Automatic evidence deltas.
 * Manual override events (manual_override_*) are NOT in this map —
 * they change manualStatus, not evidence.
 */
export const AUTO_EVIDENCE_DELTAS: Record<EventType, EvidenceDelta> = {
  asked_definition:          { known: 0, unknown: 3 },
  asked_clarification:       { known: 0, unknown: 2 },
  used_correctly:            { known: 1, unknown: 0 },
  opened_explanation:        { known: 0, unknown: 1 },
  completed_exercise:        { known: 3, unknown: 0 },
  saved_learning_anchor:     { known: 2, unknown: 0 },
  manual_override_known:     { known: 0, unknown: 0 },
  manual_override_unknown:   { known: 0, unknown: 0 },
  manual_override_cleared:   { known: 0, unknown: 0 },
  event_voided:              { known: 0, unknown: 0 },
};

// ---- Repository Interface (Dependency Inversion) ----

export interface PersonalizationRepository {
  // Concepts — lookup/upsert by conceptKey
  getConcept(conceptId: ConceptId): Promise<Concept | null>;
  getConceptByKey(key: string): Promise<Concept | null>;
  searchConcepts(query: string): Promise<Concept[]>;
  upsertConcept(concept: Omit<Concept, "id" | "createdAt">): Promise<Concept>;

  // Atomic explicit feedback (event + mastery in one tx)
  markConceptKnown(conceptId: ConceptId, scope: PersonalizationScope, idempotencyKey: string, evidenceText?: string): Promise<ConceptMastery>;
  markConceptUnknown(conceptId: ConceptId, scope: PersonalizationScope, idempotencyKey: string, evidenceText?: string): Promise<ConceptMastery>;
  clearConceptOverride(conceptId: ConceptId, scope: PersonalizationScope, idempotencyKey: string): Promise<ConceptMastery>;

  // Mastery
  getMastery(conceptId: ConceptId, scope: PersonalizationScope): Promise<ConceptMastery | null>;
  getMasteryBatch(conceptIds: ConceptId[], scope: PersonalizationScope): Promise<Map<ConceptId, ConceptMastery>>;

  // Events (append-only business operations)
  insertEvent(event: Omit<LearningEvent, "eventId" | "createdAt"> & { eventId?: EventId }): Promise<LearningEvent>;
  getEventsForConcept(conceptId: ConceptId, scope: PersonalizationScope): Promise<LearningEvent[]>;
  getEventByIdempotencyKey(key: string): Promise<LearningEvent | null>;

  // Undo (appends event_voided, does NOT UPDATE existing rows)
  voidEvent(targetEventId: EventId, conceptId: ConceptId, scope: PersonalizationScope, idempotencyKey: string, reason?: string): Promise<LearningEvent>;

  // Profile management (privacy — allowed to physically delete)
  deleteMasteryByScope(scope: PersonalizationScope): Promise<void>;
  deleteEventsByScope(scope: PersonalizationScope): Promise<void>;
}

// ---- Term Link Scoring (kept for cross-reference) ----

export interface TermCandidate {
  text: string;
  conceptId?: ConceptId;
  source: "model" | "code" | "dictionary" | "project" | "graph";
  termConfidence: number;
  contextRelevance: number;
  generalDifficulty: number;
}

export interface ScoredTerm extends TermCandidate {
  mastery: number;
  uncertainty: number;
  manualStatus: ManualStatus;
  linkScore: number;
  displayTier: DisplayTier;
}

export type DisplayTier = "prominent" | "subtle" | "none";
