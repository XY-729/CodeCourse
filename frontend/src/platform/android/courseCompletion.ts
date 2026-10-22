import type { MobileDatabase } from "./database";
import type { TeachingDocument } from "../../personalization/teachingApi";

type Row = Record<string, unknown>;
type Host = {
  document: (project: number, path: string) => Promise<TeachingDocument>;
  evidence: (project: number, data: Row) => Promise<{ evidence: { id: string } }>;
  stateChanged: () => Promise<void>;
};

/**
 * Course completion publishes factual "studied" evidence straight from the
 * saved manifest-driven index. It never calls a model: an incomplete index keeps
 * the progress fact and leaves the knowledge ranges pending for a later retry.
 */
export class CourseCompletion {
  private running = new Set<string>();
  constructor(private db: MobileDatabase, private host: Host) {}

  // Caller holds the progress-write transaction.
  async revoke(project: number, path?: string) {
    const rows = await this.db.queryInTx<Row>(`SELECT e.* FROM learning_evidence_v2 e
      WHERE e.source='course_completion' AND e.voided=0 AND json_extract(e.object_json,'$.projectId')=?
      AND (? IS NULL OR json_extract(e.object_json,'$.sourcePath')=?)
      AND NOT EXISTS (SELECT 1 FROM learning_evidence_v2 v WHERE v.target_evidence_id=e.id AND v.action='void_evidence' AND v.voided=0)`,
    [project, path ?? null, path ?? null]);
    for (const row of rows) await this.host.evidence(project, {
      idempotencyKey: `course-completion:void:${row.id}`, conceptId: row.concept_id, dimension: row.dimension,
      source: "manual", action: "void_evidence", direction: "neutral", strength: 0, reliability: 1,
      targetEvidenceId: row.id, result: { reason: "课程完成已取消或来源已删除" },
    });
  }

  async prepare(row: Row) {
    await this.revoke(Number(row.project_id), String(row.source_path));
    await this.db.runInTx(`UPDATE learning_states SET profile_status=?,profile_error=NULL,profile_concept_count=0,profile_request=? WHERE id=?`,
      [row.status === "completed" ? "pending" : "none", crypto.randomUUID(), row.id]);
  }

  /** Explicit user retry; still fully local. */
  async retry(project: number, id: number) {
    await this.db.transaction(async () => {
      const row = (await this.db.queryInTx<Row>("SELECT * FROM learning_states WHERE id=? AND project_id=? AND source_type='course' AND status='completed'", [id, project]))[0];
      if (!row) throw new Error("已完成的课程不存在");
      if (!["pending", "running"].includes(String(row.profile_status))) await this.prepare(row);
    });
    const row = (await this.db.query<Row>("SELECT * FROM learning_states WHERE id=?", [id]))[0];
    this.dispatch(id);
    return row;
  }

  async recover() {
    const rows = await this.db.query<Row>("SELECT id FROM learning_states WHERE source_type='course' AND status='completed' AND profile_status IN ('pending','running')");
    for (const row of rows) this.dispatch(Number(row.id));
  }

  dispatch(id: number) { void this.run(id).catch(error => console.warn("Course profile update failed", error)); }

  private async run(id: number) {
    const row = (await this.db.query<Row>("SELECT * FROM learning_states WHERE id=? AND status='completed' AND profile_status IN ('pending','running')", [id]))[0];
    if (!row) return;
    const request = String(row.profile_request);
    const key = `${id}:${request}`;
    if (this.running.has(key)) return;
    this.running.add(key);
    try {
      await this.db.run("UPDATE learning_states SET profile_status='running' WHERE id=? AND profile_request=? AND status='completed'", [id, request]);
      const project = Number(row.project_id), path = String(row.source_path);
      const document = await this.host.document(project, path);
      if (document.indexStatus !== "complete") {
        // Knowledge ranges wait for a validated manifest; the progress fact stays.
        // Recovery retries once per start, and an explicit retry is still local.
        await this.db.run("UPDATE learning_states SET profile_status='pending',profile_error=? WHERE id=? AND profile_request=? AND status='completed'",
          ["知识清单未就绪，已保存完成进度；索引就绪后可重试", id, request]);
        return;
      }
      const groups = new Map<string, typeof document.passages>();
      for (const passage of document.passages) if (["brief", "explained"].includes(passage.kind)) {
        groups.set(passage.concept_id, [...(groups.get(passage.concept_id) ?? []), passage]);
      }
      await this.db.transaction(async () => {
        const current = (await this.db.queryInTx<Row>("SELECT * FROM learning_states WHERE id=? AND profile_request=? AND status='completed'", [id, request]))[0];
        if (!current) return;
        const source = (await this.db.queryInTx<Row>("SELECT content_hash FROM teaching_documents WHERE id=?", [document.documentId]))[0];
        if (current.source_path !== path || source?.content_hash !== document.contentHash) throw new Error("课件在画像更新期间已变更，请重试");
        for (const [conceptId, passages] of groups) await this.host.evidence(project, {
          idempotencyKey: `course-completion:${request}:${conceptId}`, conceptId, dimension: "familiarity",
          source: "course_completion", action: "course_studied", direction: "positive", strength: .25, reliability: .6,
          object: { type: "course", projectId: project, sourcePath: path, learningStateId: id, contentHash: document.contentHash },
          result: { ranges: passages.map(p => ({ aspect: p.aspect, dimension: p.dimension, kind: p.kind, passageId: p.id })),
            evidenceQuote: passages[0].quote.slice(0, 600), explanation: "用户标记本课完成，已学习这些讲解范围；仅增加熟悉度证据，不确认理解或掌握。" },
          eventTime: current.completed_at,
        });
        await this.db.runInTx("UPDATE learning_states SET profile_status='completed',profile_error=NULL,profile_concept_count=? WHERE id=? AND profile_request=?", [groups.size, id, request]);
      });
    } catch (error) {
      await this.db.run("UPDATE learning_states SET profile_status='failed',profile_error=? WHERE id=? AND profile_request=? AND status='completed'", [String(error instanceof Error ? error.message : error).slice(0, 500), id, request]);
    } finally {
      this.running.delete(key);
      await this.host.stateChanged().catch(() => undefined);
    }
  }
}
