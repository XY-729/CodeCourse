import type { MobileDatabase } from "./database";
import type { TeachingDocument } from "../../personalization/teachingApi";

type Row = Record<string, unknown>;
type Host = {
  document: (project: number, path: string) => Promise<TeachingDocument>;
  scan: (project: number, path: string) => Promise<TeachingDocument>;
  evidence: (project: number, data: Row) => Promise<{ evidence: { id: string } }>;
};

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
      let document = await this.host.document(project, path);
      if (document.indexStatus !== "complete") document = await this.host.scan(project, path);
      if (document.indexStatus !== "complete") throw new Error("课件知识索引未完整通过校验，请重试");
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
    } finally { this.running.delete(key); }
  }

  async context(project: number) {
    const rows = await this.db.query<Row>(`SELECT e.result_json,e.object_json,c.display_name FROM learning_evidence_v2 e
      JOIN concepts c ON c.id=e.concept_id JOIN learning_states l ON l.id=json_extract(e.object_json,'$.learningStateId')
      JOIN teaching_documents d ON d.project_id=l.project_id AND d.source_type='course' AND d.source_path=l.source_path
      WHERE e.source='course_completion' AND e.voided=0 AND l.status='completed' AND d.content_hash=json_extract(e.object_json,'$.contentHash')
      AND ((e.scope_type='global' AND e.scope_id='local-user') OR (e.scope_type='project' AND e.scope_id=?))
      AND NOT EXISTS (SELECT 1 FROM learning_evidence_v2 v WHERE v.target_evidence_id=e.id AND v.action='void_evidence' AND v.voided=0)
      ORDER BY e.event_time DESC LIMIT 60`, [String(project)]);
    const records: Row[] = [];
    for (const row of rows) {
      const result = JSON.parse(String(row.result_json)), object = JSON.parse(String(row.object_json));
      const ranges = result.ranges ?? [];
      const item = { concept: row.display_name, ranges: ranges.slice(0, 12), rangeCount: ranges.length, sourcePath: object.sourcePath, status: "studied_not_verified" };
      if (JSON.stringify([...records, item]).length > 7000) break;
      records.push(item);
      if (records.length === 30) break;
    }
    return `\n<completed_course_learning>\n${JSON.stringify(records).replace(/</g, "\\u003c")}\n</completed_course_learning>\n以上仅表示用户已学过的具体范围，不确认理解或掌握。相同基础简短衔接并优先引用原讲解；保留新范围、进阶应用和必要示例。明确困惑、不会或要求重讲时正常展开；未列出不等于不会。\n`;
  }
}
