import type { DiagnosticItem, KnowledgeDimension } from "../../api/client";
import type { MobileDatabase } from "./database";
import type { AndroidTeachingOutcomeService } from "./teachingOutcomeService";

type Row = Record<string, unknown>;

type DiagnosticDependencies = {
  ensureProject: (projectId: number) => Promise<unknown>;
  appendEvidence: (
    projectId: number,
    payload: Record<string, unknown>,
    inTransaction: boolean,
  ) => Promise<unknown>;
  voidEvidence: (
    projectId: number,
    evidenceId: string,
    idempotencyKey: string,
    reason: string,
  ) => Promise<unknown>;
};

function now(): string {
  return new Date().toISOString();
}

function canonicalAnswer(value: unknown): string {
  const normalized = value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as object).length === 1
    && "value" in (value as Record<string, unknown>)
    ? (value as Record<string, unknown>).value
    : value;
  return JSON.stringify(normalized);
}

function fromRow(row: Row): DiagnosticItem {
  return {
    id: String(row.id),
    projectId: Number(row.project_id),
    sessionId: row.session_id == null ? null : String(row.session_id),
    sourceQaRecordId: row.source_qa_record_id == null ? null : Number(row.source_qa_record_id),
    teachingTrialId: row.teaching_trial_id == null ? null : String(row.teaching_trial_id),
    conceptIds: JSON.parse(String(row.concept_ids_json || "[]")),
    dimension: String(row.dimension) as KnowledgeDimension,
    itemType: String(row.item_type) as DiagnosticItem["itemType"],
    prompt: String(row.prompt),
    options: JSON.parse(String(row.options_json || "[]")),
    sourceRefs: JSON.parse(String(row.source_refs_json || "[]")),
    rationale: String(row.rationale || ""),
    difficulty: Number(row.difficulty),
    createdAt: String(row.created_at),
  };
}

export class AndroidDiagnosticService {
  constructor(
    private readonly db: MobileDatabase,
    private readonly teachingOutcomes: AndroidTeachingOutcomeService,
    private readonly dependencies: DiagnosticDependencies,
  ) {}

  async getPending(projectId: number): Promise<{ item: DiagnosticItem | null }> {
    await this.dependencies.ensureProject(projectId);
    const row = (await this.db.query<Row>(
      `SELECT * FROM diagnostic_items
       WHERE project_id=? AND status='pending'
       ORDER BY created_at DESC LIMIT 1`,
      [projectId],
    ))[0];
    return { item: row ? fromRow(row) : null };
  }

  async answer(
    projectId: number,
    itemId: string,
    answer: unknown,
  ): Promise<{
    status: string;
    correct: boolean;
    attemptId: string;
    teachingOutcome: unknown;
  }> {
    return this.db.transaction(async () => {
      const item = (await this.db.queryInTx<Row>(
        `SELECT * FROM diagnostic_items
         WHERE id=? AND project_id=? AND status='pending'`,
        [itemId, projectId],
      ))[0];
      if (!item) throw new Error("Diagnostic item is not available");
      const expected = JSON.parse(String(item.answer_key_json));
      const correct = canonicalAnswer(answer) === canonicalAnswer(expected);
      const attemptId = `diagnostic-attempt:${crypto.randomUUID()}`;
      const evidenceIds: string[] = [];
      for (const conceptId of JSON.parse(String(item.concept_ids_json || "[]")) as string[]) {
        const evidenceId = `${attemptId}:${conceptId}`;
        await this.dependencies.appendEvidence(projectId, {
          id: evidenceId,
          idempotencyKey: evidenceId,
          conceptId,
          dimension: item.dimension,
          direction: correct ? "positive" : "negative",
          strength: 1,
          reliability: 0.9,
          source: "diagnostic",
          action: "answered",
          object: { diagnosticItemId: itemId },
          result: { answer },
          sessionId: item.session_id,
          qaRecordId: item.source_qa_record_id,
          diagnosticAttemptId: attemptId,
          objectiveCorrect: correct,
        }, true);
        evidenceIds.push(evidenceId);
      }
      await this.db.runInTx(
        `INSERT INTO diagnostic_attempts
         (id,item_id,project_id,session_id,teaching_trial_id,answer_json,
          is_correct,evidence_ids_json,answered_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [
          attemptId,
          itemId,
          projectId,
          item.session_id,
          item.teaching_trial_id ?? null,
          JSON.stringify(answer),
          correct ? 1 : 0,
          JSON.stringify(evidenceIds),
          now(),
        ],
      );
      const teachingOutcome = item.teaching_trial_id
        ? await this.teachingOutcomes.recordOutcome({
          idempotencyKey: `diagnostic-outcome:${attemptId}`,
          projectId,
          teachingTrialId: String(item.teaching_trial_id),
          result: correct ? "successful" : "unsuccessful",
          confidence: 0.95,
          reason: correct
            ? "The learner answered an objective understanding check correctly."
            : "The learner answered an objective understanding check incorrectly.",
          evidenceQuote: JSON.stringify(answer),
          evidenceType: "objective_diagnostic",
          evidenceRefId: itemId,
          evaluationQaRecordId: Number(item.source_qa_record_id),
          diagnosticAttemptId: attemptId,
        }, true)
        : null;
      await this.db.runInTx(
        `UPDATE diagnostic_items
         SET status='answered',shown_at=COALESCE(shown_at,?)
         WHERE id=?`,
        [now(), itemId],
      );
      return { status: "answered", correct, attemptId, teachingOutcome };
    });
  }

  async dismiss(projectId: number, itemId: string): Promise<{ status: string }> {
    await this.db.run(
      `UPDATE diagnostic_items
       SET status='dismissed',dismissed_at=?
       WHERE id=? AND project_id=? AND status='pending'`,
      [now(), itemId, projectId],
    );
    return { status: "dismissed" };
  }

  async flag(projectId: number, itemId: string): Promise<{ status: string }> {
    const attempt = (await this.db.query<Row>(
      `SELECT * FROM diagnostic_attempts
       WHERE item_id=? AND project_id=?
       ORDER BY answered_at DESC LIMIT 1`,
      [itemId, projectId],
    ))[0];
    if (attempt) {
      for (const evidenceId of JSON.parse(String(attempt.evidence_ids_json || "[]")) as string[]) {
        await this.dependencies.voidEvidence(
          projectId,
          evidenceId,
          `diagnostic-flag:${itemId}:${evidenceId}`,
          "user_flagged_item",
        );
      }
      await this.db.run(
        "UPDATE diagnostic_attempts SET user_flagged=1 WHERE id=?",
        [attempt.id],
      );
    }
    await this.db.run(
      "UPDATE diagnostic_items SET status='flagged' WHERE id=? AND project_id=?",
      [itemId, projectId],
    );
    return { status: "flagged" };
  }
}
