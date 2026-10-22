// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseCompletion } from "./courseCompletion";
import type { MobileDatabase } from "./database";
import type { TeachingDocument } from "../../personalization/teachingApi";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const sql = new DatabaseSync(":memory:"); databases.push(sql);
  sql.exec(`CREATE TABLE learning_states(id INTEGER PRIMARY KEY,project_id INTEGER,source_type TEXT,source_path TEXT,status TEXT,completed_at TEXT,
    profile_status TEXT DEFAULT 'none',profile_error TEXT,profile_concept_count INTEGER DEFAULT 0,profile_request TEXT);
    INSERT INTO learning_states(id,project_id,source_type,source_path,status,completed_at) VALUES(1,1,'course','lesson.md','completed','2026-10-15T10:00:00Z');
    CREATE TABLE concepts(id TEXT PRIMARY KEY,display_name TEXT);
    INSERT INTO concepts VALUES('borrow','借用');
    CREATE TABLE teaching_documents(id TEXT PRIMARY KEY,project_id INTEGER,source_type TEXT,source_path TEXT,content_hash TEXT);
    INSERT INTO teaching_documents VALUES('doc',1,'course','lesson.md','hash');
    CREATE TABLE learning_evidence_v2(id TEXT PRIMARY KEY,idempotency_key TEXT UNIQUE,concept_id TEXT,dimension TEXT,source TEXT,action TEXT,
      target_evidence_id TEXT,voided INTEGER DEFAULT 0,object_json TEXT,result_json TEXT,scope_type TEXT,scope_id TEXT,event_time TEXT);`);
  const query = async (statement: string, values: unknown[] = []) => sql.prepare(statement).all(...values as (string | number | null)[]);
  const run = async (statement: string, values: unknown[] = []) => Number(sql.prepare(statement).run(...values as (string | number | null)[]).lastInsertRowid);
  const db = { query, queryInTx: query, run, runInTx: run, transaction: async <T,>(work: () => Promise<T>) => {
    sql.exec("BEGIN IMMEDIATE");
    try { const result = await work(); sql.exec("COMMIT"); return result; }
    catch (error) { sql.exec("ROLLBACK"); throw error; }
  } } as unknown as MobileDatabase;
  const document = { documentId: "doc", sourceType: "course", sourcePath: "lesson.md", contentHash: "hash", indexStatus: "complete", status: "pending", coreCount: 2,
    understoodCount: 0, feedback: [], passages: [
      { id: "p1", concept_id: "borrow", display_name: "借用", aspect: "共享借用", dimension: "conceptual", kind: "explained", core: 1, quote: "共享借用允许同时读取变量。", start_line: 1, understanding: "pending" },
      { id: "p2", concept_id: "borrow", display_name: "借用", aspect: "可变借用", dimension: "code_reading", kind: "brief", core: 1, quote: "可变借用要求独占访问变量。", start_line: 2, understanding: "pending" },
    ] } as TeachingDocument;
  const evidence = vi.fn(async (_project: number, data: Record<string, unknown>) => {
    const id = crypto.randomUUID();
    await run("INSERT OR IGNORE INTO learning_evidence_v2 VALUES(?,?,?,?,?,?,?,0,?,?,?,?,?)", [id, data.idempotencyKey, data.conceptId, data.dimension,
      data.source, data.action, data.targetEvidenceId ?? null, JSON.stringify(data.object ?? {}), JSON.stringify(data.result ?? {}), "global", "local-user", data.eventTime ?? "now"]);
    return { evidence: { id } };
  });
  const stateChanged = vi.fn(async () => undefined);
  const host = { document: vi.fn(async () => document), evidence, stateChanged };
  const service = new CourseCompletion(db, host);
  const state = () => sql.prepare("SELECT * FROM learning_states WHERE id=1").get()!;
  const active = () => sql.prepare("SELECT e.* FROM learning_evidence_v2 e WHERE e.source='course_completion' AND NOT EXISTS(SELECT 1 FROM learning_evidence_v2 v WHERE v.target_evidence_id=e.id)").all();
  const runJob = async () => { service.dispatch(1); await vi.waitFor(() => expect(state().profile_status).not.toMatch(/pending|running/)); };
  return { sql, db, host, service, state, active, runJob };
}

describe("Android completed-course learning", () => {
  it("records all taught ranges once straight from the manifest index", async () => {
    const f = fixture(); await f.db.transaction(() => f.service.prepare(f.state()));
    f.service.dispatch(1); await f.runJob();
    expect(f.host.document).toHaveBeenCalledWith(1, "lesson.md");
    expect(f.active()).toHaveLength(1);
    expect(f.host.evidence).toHaveBeenCalledWith(1, expect.objectContaining({ dimension: "familiarity", strength: .25 }));
    expect(JSON.parse(String(f.active()[0].result_json)).ranges).toHaveLength(2);
    expect(f.state().profile_concept_count).toBe(1);
    expect(f.host.stateChanged).toHaveBeenCalled();
  });
  it("revokes only completion evidence and does not accumulate after re-marking", async () => {
    const f = fixture(); await f.db.transaction(() => f.service.prepare(f.state())); await f.runJob();
    await f.db.transaction(async () => {
      await f.db.runInTx("UPDATE learning_states SET status='in_progress' WHERE id=1");
      await f.service.prepare(f.state());
    });
    expect(f.active()).toHaveLength(0);
    await f.db.transaction(async () => {
      await f.db.runInTx("UPDATE learning_states SET status='completed' WHERE id=1");
      await f.service.prepare(f.state());
    });
    await f.runJob(); expect(f.active()).toHaveLength(1);
  });
  it("keeps the progress fact when knowledge metadata is not ready, then retries locally", async () => {
    const f = fixture();
    f.host.document.mockResolvedValueOnce({ ...await f.host.document(), indexStatus: "pending" });
    await f.db.transaction(() => f.service.prepare(f.state()));
    f.service.dispatch(1);
    await vi.waitFor(() => expect(f.state().profile_error).toContain("知识清单未就绪"));
    expect(f.state().status).toBe("completed");
    expect(f.state().profile_status).toBe("pending");
    expect(f.active()).toHaveLength(0);
    await f.service.retry(1, 1);
    await vi.waitFor(() => expect(f.state().profile_status).toBe("completed"));
    expect(f.active()).toHaveLength(1);
  });
  it("does not apply a late completion after cancellation", async () => {
    const f = fixture(); const original = await f.host.document();
    f.host.document.mockImplementationOnce(async () => {
      await f.db.transaction(async () => {
        await f.db.runInTx("UPDATE learning_states SET status='in_progress' WHERE id=1");
        await f.service.prepare(f.state());
      });
      return original;
    });
    await f.db.transaction(() => f.service.prepare(f.state())); await f.runJob();
    expect(f.state().profile_status).toBe("none"); expect(f.active()).toHaveLength(0);
  });
});
