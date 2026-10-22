import type { FamiliarityState } from "./conceptForest";

export const KNOWLEDGE_POLICY_VERSION = "knowledge-facts-v1";

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

export interface KnowledgeRangeSource {
  source_type: string | null;
  source_path: string | null;
  project_id: unknown;
  content_hash: string | null;
}

export interface KnowledgeRangeState {
  aspect: string;
  dimension: KnowledgeDimension;
  familiarity: FamiliarityState;
  evidence_ids: string[];
  source_count: number;
  sources: KnowledgeRangeSource[];
  last_evidence_at: string | null;
}

export interface ConceptKnowledgeState {
  conceptId: string;
  scopeType: "global" | "project";
  scopeId: string;
  dimensions: Record<KnowledgeDimension, DimensionKnowledgeState>;
  familiarity: FamiliarityState;
  ranges: KnowledgeRangeState[];
  evidence_ids: string[];
  source_count: number;
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
  // A caller may pass a shared ledger. Concept and scope are part of identity,
  // including for void markers, and must be checked before replay.
  evidence = evidence.filter((item) => (
    String(item.conceptId ?? conceptId) === conceptId
    && (item.scopeType ?? scopeType) === scopeType
    && String(item.scopeId ?? scopeId) === scopeId
  ));
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
      resolveDimension(
        dimension,
        active.filter((item) => item.dimension === dimension && !(
          ["implementation", "debugging", "transfer"].includes(dimension)
          && ["summary", "course_completion", "question"].includes(item.source)
        )),
        now,
      ),
    ]),
  ) as Record<KnowledgeDimension, DimensionKnowledgeState>;
  const facts = resolveFamiliarity(active);

  return {
    conceptId,
    scopeType,
    scopeId,
    dimensions,
    ...facts,
    policyVersion: KNOWLEDGE_POLICY_VERSION,
    evidenceVersion: active.length,
    updatedAt: now,
  };
}

/** Maps observable actions, never a model score or an inferred direction. */
export function evidenceFamiliarity(event: LearningEvidenceV2): FamiliarityState | null {
  if (event.source === "manual") {
    return ({ manual_known: "declared_known", manual_unknown: "needs_help" } as const)[event.action as "manual_known"] ?? null;
  }
  if (event.source === "question" && [
    "asked_definition", "asked_clarification", "asked_question", "observed",
    "selected_range", "located_range", "encountered",
  ].includes(event.action)) return "encountered";
  if (event.source === "course_completion" && ["course_studied", "studied"].includes(event.action)) return "studied";
  if (event.source === "summary") {
    const result = (event.result ?? {}) as Record<string, unknown>;
    const hasRange = String(result.aspect ?? "").trim().length > 0
      || Boolean(result.ranges) || Boolean(result.range);
    if (!hasRange) return null;
    return ({
      self_understood: "self_reported_understood",
      saved_understanding: "self_reported_understood",
      self_partial: "partially_understood",
      self_needs_help: "needs_help",
    } as const)[event.action as "self_understood"] ?? null;
  }
  return null;
}

type RangeEvent = { event: LearningEvidenceV2; state: FamiliarityState | null };

function eventRanges(event: LearningEvidenceV2): Array<[string, KnowledgeDimension]> {
  const result = (event.result ?? {}) as Record<string, unknown>;
  const raw = result.ranges !== undefined && result.ranges !== null
    ? result.ranges
    : [result.range ?? { aspect: result.aspect ?? "", dimension: event.dimension }];
  if (!Array.isArray(raw)) return [];
  const ranges = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const dimension = String(record.dimension ?? event.dimension ?? "familiarity");
    if (!(KNOWLEDGE_DIMENSIONS as readonly string[]).includes(dimension)) continue;
    if (record.kind === "planned" || record.kind === "mentioned") continue;
    ranges.add(JSON.stringify([String(record.aspect ?? "").trim(), dimension]));
  }
  return [...ranges].map((key) => JSON.parse(key) as [string, KnowledgeDimension]);
}

function sourceRef(event: LearningEvidenceV2): KnowledgeRangeSource {
  const object = (event.object ?? {}) as Record<string, unknown>;
  const context = (event.context ?? {}) as Record<string, unknown>;
  const result = (event.result ?? {}) as Record<string, unknown>;
  return {
    source_type: (object.sourceType ?? object.type ?? context.sourceType ?? event.source) as string | null,
    source_path: (object.sourcePath ?? context.sourcePath ?? null) as string | null,
    project_id: object.projectId ?? context.projectId ?? null,
    content_hash: (object.contentHash ?? result.contentHash ?? null) as string | null,
  };
}

/** Deterministic factual reduction by aspect and dimension. */
export function resolveFamiliarity(active: LearningEvidenceV2[]): {
  familiarity: FamiliarityState;
  ranges: KnowledgeRangeState[];
  evidence_ids: string[];
  source_count: number;
} {
  const grouped = new Map<string, RangeEvent[]>();
  for (const event of active) {
    const state = evidenceFamiliarity(event);
    const isClear = event.source === "manual" && event.action === "manual_clear";
    if (state === null && !isClear) continue;
    for (const [aspect, dimension] of eventRanges(event)) {
      const key = JSON.stringify([aspect, dimension]);
      grouped.set(key, [...(grouped.get(key) ?? []), { event, state }]);
    }
  }
  const ranges: KnowledgeRangeState[] = [];
  const keys = [...grouped.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const key of keys) {
    const [aspect, dimension] = JSON.parse(key) as [string, KnowledgeDimension];
    const events = grouped.get(key)!;
    let manual: FamiliarityState | null = null;
    let explicit: FamiliarityState | null = null;
    let exposure: FamiliarityState | "unrecorded" = "unrecorded";
    for (const { event, state } of events) {
      if (event.source === "manual") manual = state;
      else if (state && ["self_reported_understood", "partially_understood", "needs_help"].includes(state)) explicit = state;
      else if (state === "studied" || exposure === "unrecorded") exposure = state ?? exposure;
    }
    const current = manual ?? explicit ?? exposure;
    const effective = events.filter(({ event, state }) => Boolean(state) && (
      event.source !== "manual" || manual !== null
    ));
    if (!effective.length) continue;
    const sources: KnowledgeRangeSource[] = [];
    for (const { event } of effective) {
      const source = sourceRef(event);
      const seen = sources.some((item) => JSON.stringify(item) === JSON.stringify(source));
      if (!seen) sources.push(source);
    }
    const sortKey = (item: KnowledgeRangeSource) => [
      item.source_type, item.source_path, item.project_id, item.content_hash,
    ].map((value) => String(value ?? ""));
    sources.sort((a, b) => {
      const left = sortKey(a), right = sortKey(b);
      for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
      }
      return 0;
    });
    ranges.push({
      aspect,
      dimension,
      familiarity: current,
      evidence_ids: [...new Set(effective.map(({ event }) => String(event.id)))].sort(),
      source_count: sources.length,
      sources,
      last_evidence_at: effective.map(({ event }) => event.eventTime ?? "")
        .reduce<string | null>((latest, value) => (latest === null || value > latest ? value : latest), null),
    });
  }
  const distinct = new Set(ranges.map((range) => range.familiarity));
  return {
    familiarity: distinct.size === 1 ? [...distinct][0] : distinct.size > 1 ? "mixed" : "unrecorded",
    ranges,
    evidence_ids: [...new Set(ranges.flatMap((range) => range.evidence_ids))].sort(),
    source_count: new Set(ranges.flatMap((range) => range.sources.map((source) =>
      JSON.stringify([source.source_type, source.source_path, source.project_id, source.content_hash]),
    ))).size,
  };
}

function resolveDimension(
  _dimension: KnowledgeDimension,
  events: LearningEvidenceV2[],
  now: string,
): DimensionKnowledgeState {
  events = events.filter((event) => event.source === "manual" || (
    event.direction !== "neutral" && event.strength > 0
  ));
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
