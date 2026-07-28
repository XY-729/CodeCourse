export const KNOWLEDGE_POLICY_VERSION = "knowledge-v2.1";

export const KNOWLEDGE_DIMENSIONS = [
  "familiarity",
  "conceptual",
  "code_reading",
  "implementation",
  "debugging",
  "transfer",
] as const;

export type KnowledgeDimension = (typeof KNOWLEDGE_DIMENSIONS)[number];
export type KnowledgeEvidenceDirection = "positive" | "negative" | "neutral";
export type KnowledgeStatus = "confirmed" | "learning" | "uncertain";
export type KnowledgeEvidenceSource =
  | "manual"
  | "diagnostic"
  | "question"
  | "summary"
  | "observer"
  | "course_completion"
  | "migration";

export interface LearningEvidenceV2 {
  id: string;
  idempotencyKey: string;
  schemaVersion: 2;
  conceptId: string;
  scopeType: "global" | "project";
  scopeId: string;
  dimension: KnowledgeDimension;
  direction: KnowledgeEvidenceDirection;
  strength: number;
  reliability: number;
  source: KnowledgeEvidenceSource;
  action: string;
  object: Record<string, unknown>;
  result: Record<string, unknown>;
  context: Record<string, unknown>;
  eventTime: string;
  sessionId?: string | null;
  qaRecordId?: number | null;
  diagnosticAttemptId?: string | null;
  objectiveCorrect?: boolean | null;
  targetEvidenceId?: string | null;
  voided: boolean;
  modelVersion?: string | null;
  policyVersion: string;
}

export interface BktParameters {
  prior: number;
  guess: number;
  slip: number;
  learn: number;
}

export interface DimensionKnowledgeState {
  probability: number;
  uncertainty: number;
  status: KnowledgeStatus;
  evidenceCount: number;
  directEvidenceCount: number;
  objectiveAttemptCount: number;
  reliableCorrectSessions: number;
  manualStatus: "known" | "unknown" | null;
  lastEvidenceAt: string | null;
}

export interface ConceptKnowledgeState {
  conceptId: string;
  scopeType: "global" | "project";
  scopeId: string;
  dimensions: Record<KnowledgeDimension, DimensionKnowledgeState>;
  policyVersion: string;
  evidenceVersion: number;
  updatedAt: string;
}

export const DEFAULT_BKT_PARAMETERS: BktParameters = {
  prior: 0.35,
  guess: 0.2,
  slip: 0.1,
  learn: 0.12,
};

const HIGH_RELIABILITY = 0.72;
const SOFT_CONFIRMATION_CEILING = 0.74;

export function updateBkt(
  prior: number,
  correct: boolean,
  parameters: BktParameters = DEFAULT_BKT_PARAMETERS,
): number {
  const p = clamp(prior);
  const numerator = correct
    ? p * (1 - parameters.slip)
    : p * parameters.slip;
  const denominator = correct
    ? numerator + (1 - p) * parameters.guess
    : numerator + (1 - p) * (1 - parameters.guess);
  const posterior = denominator > 0 ? numerator / denominator : p;
  return round6(posterior + (1 - posterior) * parameters.learn);
}

export function resolveKnowledgeState(
  conceptId: string,
  scopeType: "global" | "project",
  scopeId: string,
  evidence: LearningEvidenceV2[],
  now = new Date().toISOString(),
): ConceptKnowledgeState {
  const voidedTargets = new Set(
    evidence
      .filter((item) => item.targetEvidenceId && !item.voided)
      .map((item) => item.targetEvidenceId as string),
  );
  const active = evidence
    .filter((item) => (
      !item.voided
      && item.action !== "void_evidence"
      && !voidedTargets.has(item.id)
    ))
    .sort((a, b) => a.eventTime.localeCompare(b.eventTime) || a.id.localeCompare(b.id));

  const dimensions = Object.fromEntries(
    KNOWLEDGE_DIMENSIONS.map((dimension) => [
      dimension,
      resolveDimension(dimension, active.filter((item) => item.dimension === dimension), now),
    ]),
  ) as Record<KnowledgeDimension, DimensionKnowledgeState>;

  return {
    conceptId,
    scopeType,
    scopeId,
    dimensions,
    policyVersion: KNOWLEDGE_POLICY_VERSION,
    evidenceVersion: active.length,
    updatedAt: now,
  };
}

function resolveDimension(
  _dimension: KnowledgeDimension,
  events: LearningEvidenceV2[],
  now: string,
): DimensionKnowledgeState {
  let probability = DEFAULT_BKT_PARAMETERS.prior;
  let manualStatus: "known" | "unknown" | null = null;
  let manualEvidenceAt: string | null = null;
  let objectiveAttemptCount = 0;
  let directEvidenceCount = 0;
  let softOnly = true;
  const reliableCorrectSessions = new Set<string>();

  for (const event of events) {
    if (event.source === "manual") {
      if (event.action === "manual_known") {
        manualStatus = "known";
        manualEvidenceAt = event.eventTime;
      } else if (event.action === "manual_unknown") {
        manualStatus = "unknown";
        manualEvidenceAt = event.eventTime;
      } else if (event.action === "manual_clear") {
        manualStatus = null;
        manualEvidenceAt = null;
      }
      continue;
    }

    const strength = clamp(event.strength);
    const reliability = clamp(event.reliability);
    if (event.source !== "observer" && event.source !== "migration") {
      directEvidenceCount += 1;
    }

    if (event.source === "diagnostic" && event.objectiveCorrect != null) {
      objectiveAttemptCount += 1;
      softOnly = false;
      const configured = event.context.bkt as Partial<BktParameters> | undefined;
      probability = updateBkt(probability, event.objectiveCorrect, {
        ...DEFAULT_BKT_PARAMETERS,
        ...configured,
      });
      if (event.objectiveCorrect && reliability >= HIGH_RELIABILITY) {
        reliableCorrectSessions.add(event.sessionId || `attempt:${event.id}`);
      }
      continue;
    }

    // Model observations and self-reports are intentionally weak. They can
    // guide teaching order, but cannot independently confirm mastery.
    const magnitude = strength * reliability;
    if (event.direction === "positive") {
      probability += (1 - probability) * 0.16 * magnitude;
    } else if (event.direction === "negative") {
      probability -= probability * 0.22 * magnitude;
    }
    probability = clamp(probability);
  }

  if (softOnly) probability = Math.min(probability, SOFT_CONFIRMATION_CEILING);
  if (manualStatus === "known") probability = 0.99;
  if (manualStatus === "unknown") probability = 0.01;

  const knowledgeEvents = events.filter((event) => event.source !== "manual");
  const lastEvidenceAt = manualStatus
    ? manualEvidenceAt
    : knowledgeEvents.at(-1)?.eventTime ?? null;
  const ageUncertainty = lastEvidenceAt
    ? Math.min(0.22, Math.max(0, daysBetween(lastEvidenceAt, now) - 30) / 365)
    : 0.2;
  const information = knowledgeEvents.reduce(
    (sum, event) => sum + clamp(event.reliability) * clamp(event.strength),
    0,
  );
  let uncertainty = clamp(0.72 - Math.min(0.55, information * 0.1) + ageUncertainty, 0.05, 0.95);
  if (manualStatus) uncertainty = 0.02;

  const confirmed =
    manualStatus === "known"
    || (reliableCorrectSessions.size >= 2 && probability >= 0.72);
  const learning =
    manualStatus === "unknown"
    || events.some((event) => event.direction === "negative")
    || (objectiveAttemptCount > 0 && probability < 0.58);

  return {
    probability: round6(probability),
    uncertainty: round6(uncertainty),
    status: confirmed ? "confirmed" : learning ? "learning" : "uncertain",
    evidenceCount: knowledgeEvents.length + (manualStatus ? 1 : 0),
    directEvidenceCount,
    objectiveAttemptCount,
    reliableCorrectSessions: reliableCorrectSessions.size,
    manualStatus,
    lastEvidenceAt,
  };
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 86_400_000;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
