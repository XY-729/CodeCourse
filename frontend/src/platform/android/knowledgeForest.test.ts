// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeForest } from "./knowledgeForest";
import { KNOWLEDGE_FOREST_SCHEMA } from "./knowledgeForestSchema";
import { TEACHING_SCHEMA } from "./teachingSchema";
import type { TeachingManifestV2 } from "../../personalization/teachingManifest";
import type { MobileDatabase } from "./database";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

type Row = Record<string, any>;

function manifest(concepts: TeachingManifestV2["concepts"], extra: Partial<TeachingManifestV2> = {}): TeachingManifestV2 {
  return { schema_version: 2, concepts, coverage: [], terms: [], placement_changes: [], ...extra };
}

function concept(ref: string, name: string, parent: string | null = null, options: Partial<TeachingManifestV2["concepts"][number]> = {}) {
  return { ref, existing_id: null, name, domain: "cpp", scope: "global" as const, parent_ref: parent, aliases: [] as string[], ...options };
}

function fixture() {
  const sql = new DatabaseSync(":memory:"); databases.push(sql);
  sql.exec(`
    CREATE TABLE projects(id INTEGER PRIMARY KEY, name TEXT NOT NULL, project_type TEXT NOT NULL);
    INSERT INTO projects VALUES (1,'C++ 计划','learning_plan'),(2,'另一个计划','learning_plan');
    CREATE TABLE concepts(id TEXT PRIMARY KEY, concept_key TEXT NOT NULL UNIQUE, canonical_name TEXT NOT NULL,
      display_name TEXT NOT NULL, domain TEXT NOT NULL DEFAULT 'general', concept_type TEXT NOT NULL DEFAULT 'theory',
      aliases_json TEXT NOT NULL DEFAULT '[]', difficulty REAL NOT NULL DEFAULT 0.5, created_at TEXT NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'global', scope_id TEXT NOT NULL DEFAULT 'local-user');
    CREATE TABLE learning_evidence_v2(id TEXT PRIMARY KEY, idempotency_key TEXT, concept_id TEXT NOT NULL,
      scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, dimension TEXT NOT NULL, direction TEXT NOT NULL,
      strength REAL NOT NULL DEFAULT 0, reliability REAL NOT NULL DEFAULT 0, source TEXT NOT NULL,
      action TEXT NOT NULL, object_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}',
      context_json TEXT NOT NULL DEFAULT '{}', event_time TEXT NOT NULL, session_id TEXT,
      qa_record_id INTEGER, target_evidence_id TEXT, voided INTEGER NOT NULL DEFAULT 0, policy_version TEXT);
    CREATE TABLE knowledge_states_v2(concept_id TEXT, scope_type TEXT, scope_id TEXT, state_json TEXT);
  `);
  sql.exec(TEACHING_SCHEMA);
  sql.exec(KNOWLEDGE_FOREST_SCHEMA);
  const query = async (statement: string, values: unknown[] = []) => sql.prepare(statement).all(...values as never[]) as Row[];
  const run = async (statement: string, values: unknown[] = []) => Number(sql.prepare(statement).run(...values as never[]).lastInsertRowid);
  const db = {
    query, queryInTx: query, run, runInTx: run,
    transaction: async <T,>(work: () => Promise<T>) => {
      sql.exec("BEGIN IMMEDIATE");
      try { const result = await work(); sql.exec("COMMIT"); return result; }
      catch (error) { sql.exec("ROLLBACK"); throw error; }
    },
  } as unknown as MobileDatabase;
  const get = (statement: string, values: unknown[] = []): Row => sql.prepare(statement).get(...values as never[]) as Row;
  const count = (statement: string): number => Number(get(statement).count);
  return { sql, db, get, count, forest: new KnowledgeForest(db) };
}

describe("Android concept forest", () => {
  it("keeps archived history hidden and permits a future valid identity with that name", async () => {
    const f = fixture();
    f.sql.exec("INSERT INTO concepts(id,concept_key,canonical_name,display_name,domain,concept_type,created_at) VALUES('old','global:cpp:vector','vector','vector','cpp','archived','old')");
    const ids = await f.forest.applyManifest(1, manifest([concept("vector", "vector")]));
    expect(ids.get("vector")).not.toBe("old");
    expect(f.get("SELECT concept_type FROM concepts WHERE id='old'").concept_type).toBe("archived");
    const snapshot = await f.forest.snapshot(1);
    expect(snapshot.concepts.some(node => node.id === "old")).toBe(false);
    expect(snapshot.concepts.filter(node => node.name === "vector")).toHaveLength(1);
  });

  it("allocates identity, parent edges and ancestors, and reuses them on retry", async () => {
    const f = fixture();
    const ids = await f.forest.applyManifest(1, manifest([
      concept("cpp", "C++"),
      concept("stl", "STL 容器", "cpp"),
      concept("vector", "std::vector", "stl", { aliases: ["vector"] }),
    ]));
    expect(ids.size).toBe(3);
    const idByName = (name: string) => String(f.get(
      "SELECT concept_id FROM concept_placements p JOIN concepts c ON c.id=p.concept_id WHERE c.canonical_name=?", [name],
    ).concept_id);
    const cpp = idByName("C++"), stl = idByName("STL 容器"), vector = idByName("std::vector");
    expect(f.get("SELECT parent_concept_id FROM concept_placements WHERE concept_id=?", [cpp]).parent_concept_id).toBeNull();
    expect(f.get("SELECT parent_concept_id FROM concept_placements WHERE concept_id=?", [stl]).parent_concept_id).toBe(cpp);
    expect(f.get("SELECT parent_concept_id FROM concept_placements WHERE concept_id=?", [vector]).parent_concept_id).toBe(stl);
    const topology = Number(f.get("SELECT topology_version FROM knowledge_tree_versions").topology_version);
    expect(topology).toBeGreaterThan(0);
    // Retrying the same manifest must not duplicate identities or bump topology.
    const again = await f.forest.applyManifest(1, manifest([
      concept("cpp", "C++"),
      concept("stl", "STL 容器", "cpp"),
      concept("vector", "std::vector", "stl", { aliases: ["vector"] }),
    ]));
    expect([...again.values()].sort()).toEqual([...ids.values()].sort());
    expect(f.count("SELECT COUNT(*) count FROM concepts")).toBe(3);
    expect(Number(f.get("SELECT topology_version FROM knowledge_tree_versions").topology_version)).toBe(topology);
    // The alias resolves to the same identity through the binding table.
    expect(f.get("SELECT concept_id FROM concept_aliases WHERE alias_key='vector'").concept_id).toBe(vector);
  });

  it("shares global roots across plans and isolates project symbols", async () => {
    const f = fixture();
    const first = await f.forest.applyManifest(1, manifest([concept("cpp", "C++")]));
    await f.forest.associateRoots(1, [first.get("cpp")!]);
    const second = await f.forest.applyManifest(2, manifest([concept("cpp", "C++")]));
    expect(second.get("cpp")).toBe(first.get("cpp"));
    await f.forest.applyManifest(2, manifest([
      concept("sym", "Widget", null, { scope: "project", domain: "widget" }),
    ]));
    const snapshot = await f.forest.snapshot(1);
    expect(snapshot.concepts.map(node => node.name)).not.toContain("Widget");
    const snapshot2 = await f.forest.snapshot(2);
    expect(snapshot2.concepts.map(node => node.name)).toContain("Widget");
    expect(snapshot.plan_roots[0]).toMatchObject({ project_id: 1, status: "ready" });
    expect(snapshot2.plan_roots[0]).toMatchObject({ project_id: 2, status: "pending" });
  });

  it("rejects a global child under a private parent and unknown parents", async () => {
    const f = fixture();
    await expect(f.forest.applyManifest(1, manifest([
      concept("sym", "Widget", null, { scope: "project", domain: "widget" }),
      concept("child", "通用子概念", "sym"),
    ]))).rejects.toThrow("Global concepts cannot have private ancestors");
    await expect(f.forest.applyManifest(1, manifest([
      { ...concept("x", "X"), parent_ref: "missing" },
    ]))).rejects.toThrow("Unresolved parent_ref");
  });

  it("requires an explicit placement change and records a stale proposal instead of overwriting", async () => {
    const f = fixture();
    const ids = await f.forest.applyManifest(1, manifest([concept("cpp", "C++"), concept("vector", "std::vector")]));
    const cpp = ids.get("cpp")!, vector = ids.get("vector")!;
    const withParent = (changes?: TeachingManifestV2["placement_changes"]) => manifest([
      { ...concept("cpp", "C++"), existing_id: cpp },
      { ...concept("vector", "std::vector"), existing_id: vector, parent_ref: "cpp" },
    ], changes ? { placement_changes: changes } : undefined);
    const explicit = (from: string | null) => withParent([
      { concept_ref: "vector", from_parent_id: from, to_parent_ref: "cpp", reason: "补父" },
    ]);
    await expect(f.forest.applyManifest(1, withParent())).rejects.toThrow("Existing parent requires explicit topology change");
    // A stale from_parent_id keeps the current edge and records the conflict.
    await f.forest.applyManifest(1, explicit("stale-parent"));
    expect(f.get("SELECT parent_concept_id FROM concept_placements WHERE concept_id=?", [vector]).parent_concept_id).toBeNull();
    expect(f.count("SELECT COUNT(*) count FROM knowledge_topology_conflicts")).toBe(1);
    // With the real current parent the change applies and bumps topology.
    const before = Number(f.get("SELECT topology_version FROM knowledge_tree_versions").topology_version);
    await f.forest.applyManifest(1, explicit(null));
    expect(f.get("SELECT parent_concept_id FROM concept_placements WHERE concept_id=?", [vector]).parent_concept_id).toBe(cpp);
    expect(Number(f.get("SELECT topology_version FROM knowledge_tree_versions").topology_version)).toBe(before + 1);
  });

  it("derives factual familiarity per range without propagating to ancestors", async () => {
    const f = fixture();
    const ids = await f.forest.applyManifest(1, manifest([
      concept("cpp", "C++"), concept("stl", "STL 容器", "cpp"), concept("vector", "std::vector", "stl"),
    ]));
    const cpp = ids.get("cpp")!, stl = ids.get("stl")!, vector = ids.get("vector")!;
    await f.db.run("INSERT INTO concepts(id,concept_key,canonical_name,display_name,domain,created_at,scope_type,scope_id) VALUES(?,?,?,?,?,?,?,?)",
      ["doc", "global:cpp:doc", "文档", "文档", "cpp", "2026-10-21", "global", "local-user"]);
    f.sql.prepare("INSERT INTO teaching_documents VALUES(?,?,?,?,?,?,?)").run("doc", 1, "course", "lessons/lesson_01.md", "hash", "complete", "now");
    f.sql.prepare("INSERT INTO teaching_passages VALUES(?,?,?,?,?,?,?,?,?,?,1,?)").run("p1", "doc", vector, "扩容规则", "explained", 1, "conceptual", "扩容规则会重新分配存储。", 1, "hash", "now");
    // Facts come from the shared factual reducer, not from the feedback row.
    await f.db.run(
      `INSERT INTO learning_evidence_v2(id,idempotency_key,concept_id,scope_type,scope_id,dimension,direction,
        strength,reliability,source,action,object_json,result_json,context_json,event_time,voided,policy_version)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
      ["e1", "e1", vector, "global", "local-user", "conceptual", "neutral", 0, 0.72, "summary", "self_understood",
        "{}", JSON.stringify({ aspect: "扩容规则", dimension: "conceptual" }), "{}", "2026-10-21T00:00:00Z", "knowledge-facts-v1"],
    );
    await f.db.run(
      `INSERT INTO learning_evidence_v2(id,idempotency_key,concept_id,scope_type,scope_id,dimension,direction,
        strength,reliability,source,action,object_json,result_json,context_json,event_time,voided,policy_version)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`,
      ["e2", "e2", stl, "global", "local-user", "familiarity", "positive", 0.25, 0.6, "course_completion", "course_studied",
        "{}", "{}", "{}", "2026-10-21T00:00:01Z", "knowledge-facts-v1"],
    );
    const snapshot = await f.forest.snapshot(1);
    const node = (id: string) => snapshot.concepts.find(item => item.id === id)!;
    expect(node(vector).familiarity).toBe("self_reported_understood");
    expect(node(vector).ranges[0]).toMatchObject({ aspect: "扩容规则", dimension: "conceptual", familiarity: "self_reported_understood" });
    expect(node(vector).coverage[0]).toMatchObject({ aspect: "扩容规则", kind: "explained" });
    expect(node(stl).familiarity).toBe("studied");
    expect(node(cpp).familiarity).toBe("unrecorded");
  });

  it("serializes the complete tree with the user's explicit requirements", async () => {
    const f = fixture();
    await f.forest.applyManifest(1, manifest([
      concept("cpp", "C++"), concept("vector", "std::vector", "cpp", { aliases: ["vector"] }),
    ]));
    const context = await f.forest.context(1, ["只讲 vector 的扩容"]);
    expect(context).toContain("<knowledge_tree>");
    expect(context).toContain("std::vector");
    expect(context).toContain("<user_requirements>");
    expect(context).toContain("只讲 vector 的扩容");
    expect(context).toContain("\"topology_version\":");
  });
});
