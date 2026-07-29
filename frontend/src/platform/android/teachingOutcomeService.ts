import type {
  KnowledgeDimension,
  KnowledgeStateV2,
  TeachingEvidenceSummary,
  TeachingTrial,
} from "../../api/client";
import type { MobileDatabase } from "./database";

type Row = Record<string, unknown>;

export const TEACHING_TRIAL_POLICY_VERSION = "teaching-trial-v2.1";
export const TEACHING_OUTCOME_POLICY_VERSION = "teaching-outcome-v2.1";

const EVIDENCE_AUTHORITY = {
  objective_diagnostic: 100,
  manual_feedback: 90,
  user_artifact: 75,
  followup_behavior: 45,
  observer_inference: 20,
} as const;

const POLICY_ELIGIBLE_EVIDENCE = new Set<keyof typeof EVIDENCE_AUTHORITY>([
  "objective_diagnostic",
  "manual_feedback",
  "user_artifact",
]);

type TeachingEvidenceType = keyof typeof EVIDENCE_AUTHORITY;
type TeachingResult =
  | "successful"
  | "partially_successful"
  | "unsuccessful"
  | "advanced_followup"
  | "topic_changed"
  | "unknown";

export type SaveTeachingTrialInput = {
  projectId: number;
  sessionId: number | null;
  qaRecordId: number;
  answerModel: string;
  mode: "assist" | "default";
  context: {
    schemaVersion: 1;
    mode: "planned" | "default";
    userGoal: string;
    teachingGoal: string;
    strategies: string[];
    assumedKnown?: string[];
    explainBriefly?: string[];
    explainInDetail?: string[];
  };
  preState: KnowledgeStateV2[];
  targetConceptIds: string[];
  targetDimensions: KnowledgeDimension[];
  strategyRationale: string;
};

export type RecordTeachingOutcomeInput = {
  idempotencyKey: string;
  projectId: number;
  teachingTrialId: string;
  result: TeachingResult;
  confidence: number;
  reason: string;
  evidenceQuote: string;
  evidenceType: TeachingEvidenceType;
  evidenceRefId?: string | null;
  evaluationQaRecordId?: number | null;
  diagnosticAttemptId?: string | null;
  sourceObservationId?: string | null;
  observerRunId?: string | null;
};

function now(): string {
  return new Date().toISOString();
}

function parseObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseArray<T>(value: unknown): T[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export class AndroidTeachingOutcomeService {
  constructor(private readonly db: MobileDatabase) {}

  async saveTrial(input: SaveTeachingTrialInput): Promise<string> {
    const trialId = `android-trial:${input.qaRecordId}`;
    const context = {
      schema_version: input.context.schemaVersion,
      mode: input.context.mode,
      user_goal: input.context.userGoal,
      teaching_goal: input.context.teachingGoal,
      strategies: input.context.strategies.slice(0, 5),
      assumed_known: (input.context.assumedKnown || []).slice(0, 8),
      explain_briefly: (input.context.explainBriefly || []).slice(0, 8),
      explain_in_detail: (input.context.explainInDetail || []).slice(0, 6),
    };
    await this.db.run(
      `INSERT OR IGNORE INTO teaching_trials
       (id,project_id,session_id,qa_record_id,planner_run_id,snapshot_id,
        teaching_plan_id,effective_context_json,mode,was_applied,
        fallback_reason,answer_model,previous_outcome,pre_state_json,
        target_concepts_json,target_dimensions_json,strategy_rationale,
        policy_version,created_at)
       VALUES(?,?,?,?,NULL,'',NULL,?,?,1,NULL,?,NULL,?,?,?,?,?,?)`,
      [
        trialId,
        input.projectId,
        input.sessionId,
        input.qaRecordId,
        JSON.stringify(context),
        input.mode,
        input.answerModel,
        JSON.stringify(input.preState),
        JSON.stringify(input.targetConceptIds),
        JSON.stringify(input.targetDimensions),
        input.strategyRationale.slice(0, 1200),
        TEACHING_TRIAL_POLICY_VERSION,
        now(),
      ],
    );
    return trialId;
  }

  async findTrialForQa(projectId: number, qaRecordId: number): Promise<Row | null> {
    return (await this.db.query<Row>(
      `SELECT * FROM teaching_trials
       WHERE project_id=? AND qa_record_id=?
       ORDER BY created_at DESC LIMIT 1`,
      [projectId, qaRecordId],
    ))[0] ?? null;
  }

  async getTrial(projectId: number, qaRecordId: number): Promise<TeachingTrial> {
    const trial = await this.findTrialForQa(projectId, qaRecordId);
    if (!trial) throw new Error("Teaching trial not found for this answer");
    const context = parseObject(trial.effective_context_json);
    const outcomes = await this.db.query<Row>(
      `SELECT * FROM teaching_outcomes
       WHERE teaching_trial_id=?
       ORDER BY authority DESC,created_at DESC`,
      [trial.id],
    );
    return {
      id: String(trial.id),
      qaRecordId: Number(trial.qa_record_id),
      mode: String(trial.mode),
      teachingGoal: String(context.teaching_goal || ""),
      strategies: parseArray<string>(JSON.stringify(context.strategies || [])),
      assumedKnown: parseArray<string>(JSON.stringify(context.assumed_known || [])),
      explainBriefly: parseArray<string>(JSON.stringify(context.explain_briefly || [])),
      explainInDetail: parseArray<string>(JSON.stringify(context.explain_in_detail || [])),
      targetConceptIds: parseArray<string>(trial.target_concepts_json),
      targetDimensions: parseArray<KnowledgeDimension>(trial.target_dimensions_json),
      strategyRationale: String(trial.strategy_rationale || ""),
      policyVersion: String(trial.policy_version || TEACHING_TRIAL_POLICY_VERSION),
      preState: parseArray<KnowledgeStateV2>(trial.pre_state_json),
      outcomes: outcomes.map((row) => ({
        id: String(row.id),
        result: String(row.result),
        confidence: Number(row.confidence),
        reason: String(row.reason || ""),
        evidenceQuote: String(row.evidence_quote || ""),
        evidenceType: String(row.evidence_type),
        authority: Number(row.authority),
        policyEligible: bool(row.policy_eligible),
        createdAt: String(row.created_at),
      })),
      createdAt: String(trial.created_at),
    };
  }

  async recordOutcome(
    input: RecordTeachingOutcomeInput,
    inTransaction = false,
  ): Promise<{
    id: string;
    teachingTrialId: string;
    result: string;
    confidence: number;
    evidenceType: string;
    evidenceRefId: string | null;
    authority: number;
    policyEligible: boolean;
    createdAt: string;
  }> {
    const query = inTransaction
      ? this.db.queryInTx.bind(this.db)
      : this.db.query.bind(this.db);
    const run = inTransaction
      ? this.db.runInTx.bind(this.db)
      : this.db.run.bind(this.db);
    const trial = (await query<Row>(
      "SELECT * FROM teaching_trials WHERE id=? AND project_id=?",
      [input.teachingTrialId, input.projectId],
    ))[0];
    if (!trial) throw new Error("Teaching trial not found");
    const authority = EVIDENCE_AUTHORITY[input.evidenceType];
    const policyEligible = POLICY_ELIGIBLE_EVIDENCE.has(input.evidenceType);
    const outcomeId = `teaching-outcome:${crypto.randomUUID()}`;
    const createdAt = now();
    await run(
      `INSERT OR IGNORE INTO teaching_outcomes
       (id,idempotency_key,project_id,session_id,teaching_trial_id,
        taught_qa_record_id,evaluation_qa_record_id,result,confidence,reason,
        evidence_quote,source_observation_id,observer_run_id,evidence_type,
        evidence_ref_id,authority,policy_eligible,diagnostic_attempt_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        outcomeId,
        input.idempotencyKey,
        input.projectId,
        trial.session_id ?? null,
        input.teachingTrialId,
        trial.qa_record_id,
        input.evaluationQaRecordId ?? Number(trial.qa_record_id),
        input.result,
        Math.max(0, Math.min(1, input.confidence)),
        input.reason.slice(0, 1000),
        input.evidenceQuote.slice(0, 1000),
        input.sourceObservationId ?? null,
        input.observerRunId ?? null,
        input.evidenceType,
        input.evidenceRefId ?? null,
        authority,
        policyEligible ? 1 : 0,
        input.diagnosticAttemptId ?? null,
        createdAt,
      ],
    );
    const row = (await query<Row>(
      "SELECT * FROM teaching_outcomes WHERE idempotency_key=?",
      [input.idempotencyKey],
    ))[0];
    const strongest = (await query<Row>(
      `SELECT result FROM teaching_outcomes
       WHERE teaching_trial_id=?
       ORDER BY authority DESC,created_at DESC LIMIT 1`,
      [input.teachingTrialId],
    ))[0];
    await run(
      "UPDATE teaching_trials SET previous_outcome=? WHERE id=?",
      [strongest?.result ?? null, input.teachingTrialId],
    );
    return {
      id: String(row.id),
      teachingTrialId: String(row.teaching_trial_id),
      result: String(row.result),
      confidence: Number(row.confidence),
      evidenceType: String(row.evidence_type),
      evidenceRefId: row.evidence_ref_id == null ? null : String(row.evidence_ref_id),
      authority: Number(row.authority),
      policyEligible: bool(row.policy_eligible),
      createdAt: String(row.created_at),
    };
  }

  async recordManualFeedback(
    projectId: number,
    qaRecordId: number,
    result: "successful" | "partially_successful" | "unsuccessful",
    idempotencyKey: string,
    reason = "",
  ) {
    const trial = await this.findTrialForQa(projectId, qaRecordId);
    if (!trial) throw new Error("Teaching trial not found for this answer");
    return this.recordOutcome({
      idempotencyKey,
      projectId,
      teachingTrialId: String(trial.id),
      result,
      confidence: 1,
      reason: reason || "User directly evaluated this explanation",
      evidenceQuote: reason || result,
      evidenceType: "manual_feedback",
      evidenceRefId: `qa:${qaRecordId}`,
      evaluationQaRecordId: qaRecordId,
    });
  }

  async evidenceSummary(projectId: number, limit = 40): Promise<TeachingEvidenceSummary> {
    const rows = await this.db.query<Row>(
      `SELECT t.*,o.result,o.confidence,o.reason,o.evidence_type,
              o.authority,o.policy_eligible,o.created_at AS outcome_created_at
       FROM teaching_trials t
       LEFT JOIN teaching_outcomes o ON o.id=(
         SELECT candidate.id FROM teaching_outcomes candidate
         WHERE candidate.teaching_trial_id=t.id
         ORDER BY candidate.authority DESC,candidate.created_at DESC LIMIT 1
       )
       WHERE t.project_id=?
       ORDER BY t.created_at DESC LIMIT ?`,
      [projectId, Math.max(1, Math.min(limit, 100))],
    );
    const strategyStats = new Map<string, TeachingEvidenceSummary["effectiveStrategies"][number]>();
    let verifiedTrialCount = 0;
    let awaitingEvidenceCount = 0;
    const recentTrials = rows.map((row) => {
      const context = parseObject(row.effective_context_json);
      const strategies = Array.isArray(context.strategies)
        ? context.strategies.map(String).filter(Boolean).slice(0, 5)
        : [];
      if (row.result == null) awaitingEvidenceCount += 1;
      if (bool(row.policy_eligible)) {
        verifiedTrialCount += 1;
        for (const strategy of strategies.slice(0, 2)) {
          const stats = strategyStats.get(strategy) || {
            strategy,
            successful: 0,
            partiallySuccessful: 0,
            unsuccessful: 0,
            evidenceCount: 0,
          };
          stats.evidenceCount += 1;
          if (row.result === "successful") stats.successful += 1;
          if (row.result === "partially_successful") stats.partiallySuccessful += 1;
          if (row.result === "unsuccessful") stats.unsuccessful += 1;
          strategyStats.set(strategy, stats);
        }
      }
      return {
        id: String(row.id),
        qaRecordId: Number(row.qa_record_id),
        teachingGoal: String(context.teaching_goal || ""),
        strategies,
        result: row.result == null ? null : String(row.result),
        evidenceType: row.evidence_type == null ? null : String(row.evidence_type),
        policyEligible: bool(row.policy_eligible),
        createdAt: String(row.created_at),
      };
    });
    const effectiveStrategies = [...strategyStats.values()]
      .sort((left, right) => {
        const rightScore = right.successful + 0.5 * right.partiallySuccessful - right.unsuccessful;
        const leftScore = left.successful + 0.5 * left.partiallySuccessful - left.unsuccessful;
        return rightScore - leftScore || right.evidenceCount - left.evidenceCount;
      })
      .slice(0, 6);
    return {
      verifiedTrialCount,
      awaitingEvidenceCount,
      effectiveStrategies,
      recentTrials: recentTrials.slice(0, 20),
      policyVersion: TEACHING_OUTCOME_POLICY_VERSION,
    };
  }
}
