// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { TeachingIndex } from "./teachingIndex";
import { TEACHING_SCHEMA } from "./teachingSchema";
import { KNOWLEDGE_MAINTENANCE_SCHEMA } from './knowledgeForestSchema';
import { appendTeachingManifest, type TeachingManifest } from "./teachingManifest";
import type { SavedManifest } from "./knowledgeForest";
import type { MobileDatabase } from "./database";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fixture() {
  const sql = new DatabaseSync(":memory:"); databases.push(sql);
  sql.exec(TEACHING_SCHEMA + `
    CREATE TABLE projects(id INTEGER PRIMARY KEY);
    INSERT INTO projects VALUES(1),(2);
    CREATE TABLE concepts(id TEXT PRIMARY KEY,canonical_name TEXT,display_name TEXT,concept_key TEXT,domain TEXT);
    CREATE TABLE knowledge_states_v2(concept_id TEXT,scope_type TEXT,scope_id TEXT,state_json TEXT);
    CREATE TABLE learning_evidence_v2(id TEXT PRIMARY KEY,concept_id TEXT,dimension TEXT,action TEXT,target_evidence_id TEXT,voided INTEGER DEFAULT 0);
    CREATE TABLE qa_records(id INTEGER PRIMARY KEY,project_id INTEGER,output_path TEXT);
    CREATE TABLE teaching_manifests(project_id INTEGER,source_type TEXT,source_path TEXT);
  `);
  const query = async (statement: string, values: unknown[] = []) => sql.prepare(statement).all(...values as (string | number | null)[]);
  sql.exec(KNOWLEDGE_MAINTENANCE_SCHEMA);
  const run = async (statement: string, values: unknown[] = []) => Number(sql.prepare(statement).run(...values as (string | number | null)[]).lastInsertRowid);
  const db = { query, queryInTx: query, run, runInTx: run, transaction: async <T,>(work: () => Promise<T>) => {
    sql.exec("BEGIN IMMEDIATE");
    try { const result = await work(); sql.exec("COMMIT"); return result; }
    catch (e) { sql.exec("ROLLBACK"); throw e; }
  } } as unknown as MobileDatabase;
  const files = new Map<string, string>();
  const manifests = new Map<string, SavedManifest>();
  const key = (project: number, path: string) => `${project}:${path}`;
  const index = new TeachingIndex(db, {
    read: async (project, _type, path) => {
      const content = files.get(key(project, path));
      if (!content) throw new Error("missing");
      return content;
    },
    manifest: async (project, _type, path) => manifests.get(key(project, path)) ?? null,
    evidence: async (_project, data) => {
      const id = crypto.randomUUID();
      await run("INSERT INTO learning_evidence_v2 VALUES (?,?,?,?,?,0)", [id, data.conceptId, data.dimension, data.action ?? "", data.targetEvidenceId ?? null]);
      return { evidence: { id } };
    },
    stateChanged: async () => undefined,
  });
  /** Writes a document whose persisted manifest matches the persisted hash. */
  async function write(path = "lesson.md", scope: "global" | "project" = "global") {
    const names = ["闭包", "作用域"];
    const concepts = names.map((name, position) => ({
      ref: `c${position}`, existing_id: null, name, domain: "general", scope, parent_ref: null, aliases: [] as string[],
    }));
    const coverage = concepts.map((concept) => ({
      concept_ref: concept.ref, aspect: "基本原理", kind: "explained" as const,
      dimension: "conceptual" as const, core: true, quote: `${concept.name}用于组织程序中的变量关系。`,
    }));
    const manifest: TeachingManifest = { schema_version: 2, concepts, coverage, terms: [], placement_changes: [] };
    const content = appendTeachingManifest(`# 课程\n\n${coverage.map(item => item.quote).join("\n\n")}`, manifest);
    files.set(key(1, path), content);
    const conceptMap: Record<string, string> = {};
    for (const concept of concepts) {
      const id = scope === "project" ? `project:1:${concept.name}` : `global:${concept.name}`;
      conceptMap[concept.ref] = id;
      await run("INSERT OR IGNORE INTO concepts VALUES (?,?,?,?,?)", [id, concept.name, concept.name, id, "general"]);
    }
    manifests.set(key(1, path), {
      status: "complete", error: null, artifactKind: "lesson", contentHash: await sha256(content),
      generationId: "gen", conceptMap, manifest, topologyVersion: 1, stateVersion: 1,
    });
    return content;
  }
  return { index, sql, files, manifests, write };
}

describe("Android teaching index SQL contract", () => {
  it("records coverage from the manifest, aggregates understanding by range and reverses feedback", async () => {
    const f = fixture();
    await f.write();
    const doc = await f.index.document(1, "course", "lesson.md");
    expect(doc.indexStatus).toBe("complete");
    expect(doc.passages).toHaveLength(2);
    const payload = { sourceType: "course", sourcePath: "lesson.md", contentHash: doc.contentHash, passageIds: doc.passages.map(p => p.id), result: "understood", requestKey: "first" };
    expect((await f.index.feedback(1, payload)).status).toBe("understood");
    await f.index.feedback(1, payload);
    expect((await f.index.document(1, "course", "lesson.md")).feedback).toHaveLength(2);
    const partial = await f.index.feedback(1, { ...payload, result: "needs_help", requestKey: "second", passageIds: [doc.passages[0].id] });
    expect(partial.understoodCount).toBe(1);
    expect(partial.status).toBe("partial");
    expect((await f.index.feedback(1, { ...payload, result: "clear", requestKey: "undo" })).status).toBe("pending");
  });
  it("refuses understanding when no validated manifest was published", async () => {
    const f = fixture();
    const content = await f.write();
    f.manifests.delete("1:lesson.md");
    const doc = await f.index.document(1, "course", "lesson.md");
    expect(doc.indexStatus).toBe("pending");
    expect(doc.passages).toHaveLength(0);
    await expect(f.index.feedback(1, { sourceType: "course", sourcePath: "lesson.md", contentHash: doc.contentHash, passageIds: [], result: "understood", requestKey: "x" }))
      .rejects.toThrow("知识清单未就绪");
    expect(content.length).toBeGreaterThan(0);
  });
  it("reuses exact coverage and preserves explicit reteaching", async () => {
    const f = fixture(); const original = await f.write();
    const doc = await f.index.document(1, "course", "lesson.md");
    expect(await f.index.prepare(1, original)).toContain(`https://codecourse.local/teaching/${doc.passages[0].id}`);
    expect(await f.index.prepare(1, original, "从头讲解")).toBe(original);
  });
  it("isolates private symbols and refuses changed excerpts", async () => {
    const f = fixture(); await f.write("lesson.md", "project");
    const doc = await f.index.document(1, "course", "lesson.md");
    await expect(f.index.reference(2, doc.passages[0].id)).rejects.toThrow("不存在");
    f.files.set("1:lesson.md", "已经修改的内容");
    await expect(f.index.reference(1, doc.passages[0].id)).rejects.toThrow("无法准确定位");
  });
  it("concurrent indexing retains one stable document identity", async () => {
    const f = fixture(); const content = await f.write();
    const ids = await Promise.all([f.index.index(1, "course", "lesson.md", content), f.index.index(1, "course", "lesson.md", content)]);
    expect(ids[0]).toBe(ids[1]);
    expect(f.sql.prepare("SELECT * FROM teaching_documents").all()).toHaveLength(1);
    expect(f.sql.prepare("SELECT * FROM teaching_passages WHERE active=1").all()).toHaveLength(2);
    await f.index.remove(1, "lesson.md");
    expect(f.sql.prepare("SELECT * FROM teaching_passages").all()).toHaveLength(0);
  });
});
