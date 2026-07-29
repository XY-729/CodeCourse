import { describe, expect, it, vi } from "vitest";
import type { MobileDatabase } from "../platform/android/database";
import { AndroidTeachingOutcomeService } from "../platform/android/teachingOutcomeService";

describe("Android teaching outcome service", () => {
  it("stores objective diagnostics as authority 100 and policy eligible", async () => {
    const trial = {
      id: "trial:1",
      project_id: 4,
      session_id: 8,
      qa_record_id: 15,
    };
    const outcome = {
      id: "outcome:1",
      teaching_trial_id: trial.id,
      result: "successful",
      confidence: 0.95,
      evidence_type: "objective_diagnostic",
      evidence_ref_id: "diagnostic:1",
      authority: 100,
      policy_eligible: 1,
      created_at: "2026-07-29T00:00:00.000Z",
    };
    const runs: Array<{ sql: string; values: unknown[] }> = [];
    const database = {
      queryInTx: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM teaching_trials")) return [trial];
        if (sql.includes("SELECT * FROM teaching_outcomes")) return [outcome];
        if (sql.includes("SELECT result FROM teaching_outcomes")) return [{ result: "successful" }];
        return [];
      }),
      runInTx: vi.fn(async (sql: string, values: unknown[] = []) => {
        runs.push({ sql, values });
        return 0;
      }),
    } as unknown as MobileDatabase;
    const service = new AndroidTeachingOutcomeService(database);

    const saved = await service.recordOutcome({
      idempotencyKey: "diagnostic-outcome:1",
      projectId: 4,
      teachingTrialId: "trial:1",
      result: "successful",
      confidence: 0.95,
      reason: "Correct objective check",
      evidenceQuote: "\"B\"",
      evidenceType: "objective_diagnostic",
      evidenceRefId: "diagnostic:1",
      evaluationQaRecordId: 15,
      diagnosticAttemptId: "attempt:1",
    }, true);

    const insert = runs.find((entry) => entry.sql.includes("INSERT OR IGNORE INTO teaching_outcomes"));
    expect(insert).toBeDefined();
    expect(insert?.values).toContain(100);
    expect(insert?.values).toContain(1);
    expect(saved.authority).toBe(100);
    expect(saved.policyEligible).toBe(true);
  });

  it("maps saved context into the shared TeachingTrial response", async () => {
    const database = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM teaching_trials")) {
          return [{
            id: "trial:2",
            project_id: 3,
            qa_record_id: 9,
            mode: "assist",
            effective_context_json: JSON.stringify({
              teaching_goal: "Explain the control flow",
              strategies: ["execution_sequence"],
              assumed_known: ["HTTP"],
              explain_briefly: [],
              explain_in_detail: ["FastAPI"],
            }),
            target_concepts_json: "[\"fastapi\"]",
            target_dimensions_json: "[\"conceptual\"]",
            strategy_rationale: "The question asks about execution order.",
            policy_version: "teaching-trial-v2.1",
            pre_state_json: "[]",
            created_at: "2026-07-29T00:00:00.000Z",
          }];
        }
        return [];
      }),
    } as unknown as MobileDatabase;
    const service = new AndroidTeachingOutcomeService(database);

    const trial = await service.getTrial(3, 9);

    expect(trial.teachingGoal).toBe("Explain the control flow");
    expect(trial.strategies).toEqual(["execution_sequence"]);
    expect(trial.explainInDetail).toEqual(["FastAPI"]);
    expect(trial.targetDimensions).toEqual(["conceptual"]);
  });
});
