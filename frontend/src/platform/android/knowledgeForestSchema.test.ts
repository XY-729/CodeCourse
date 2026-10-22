// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { KNOWLEDGE_FOREST_LEGACY_NORMALIZATION, KNOWLEDGE_FOREST_SCHEMA } from "./knowledgeForestSchema";
import { TEACHING_SCHEMA } from "./teachingSchema";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

type Row = Record<string, any>;

/** Schema v7 as installed by older releases plus the legacy rows they could contain. */
function legacyV7Database() {
  const sql = new DatabaseSync(":memory:"); databases.push(sql);
  sql.exec(`
    CREATE TABLE projects(id INTEGER PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL, project_type TEXT NOT NULL DEFAULT 'repository', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO projects VALUES (1,'C++ 学习计划','','ready','learning_plan','2026-10-01','2026-10-01');
    INSERT INTO projects VALUES (2,'仓库项目','','ready','repository','2026-10-01','2026-10-01');
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings VALUES ('personalization.enabled','false'),('personalization.observer.enabled','false'),('user.preference','keep');
    CREATE TABLE concepts(id TEXT PRIMARY KEY, concept_key TEXT NOT NULL UNIQUE, canonical_name TEXT NOT NULL,
      display_name TEXT NOT NULL, domain TEXT NOT NULL DEFAULT 'general', concept_type TEXT NOT NULL DEFAULT 'theory',
      aliases_json TEXT NOT NULL DEFAULT '[]', difficulty REAL NOT NULL DEFAULT 0.5, created_at TEXT NOT NULL);
    INSERT INTO concepts VALUES ('c1','global:general:cpp','C++','C++','cpp','theory','[]',0.5,'2026-10-01');
    INSERT INTO concepts VALUES ('c2','global:general:vector','vector','std::vector','cpp','theory','["vector"]',0.5,'2026-10-01');
    INSERT INTO concepts VALUES ('c3','project:2:symbol:widget','Widget','Widget','widget','project_symbol','[]',0.5,'2026-10-01');
    CREATE TABLE concept_mastery(id TEXT PRIMARY KEY, concept_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL,
      known_evidence REAL NOT NULL DEFAULT 1, unknown_evidence REAL NOT NULL DEFAULT 1, mastery REAL NOT NULL DEFAULT 0.5,
      uncertainty REAL NOT NULL DEFAULT 0.7071, manual_status TEXT, sequence INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO concept_mastery VALUES ('m1','c2','global','local-user',1,1,0.5,0.7071,'known',0,'2026-10-01','2026-10-01');
    CREATE TABLE observer_jobs(id TEXT PRIMARY KEY, project_id INTEGER NOT NULL, qa_record_id INTEGER NOT NULL, reason TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending', attempt_count INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL, locked_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO observer_jobs VALUES ('j1',2,5,'high_information','{}','pending',0,'2026-10-01',NULL,NULL,'2026-10-01','2026-10-01');
    CREATE TABLE qa_postprocess_jobs(qa_record_id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, payload_json TEXT NOT NULL,
      context_snapshot TEXT NOT NULL, metadata_json TEXT, applied_plan_json TEXT, status TEXT NOT NULL DEFAULT 'pending',
      evidence_done INTEGER NOT NULL DEFAULT 0, planner_done INTEGER NOT NULL DEFAULT 0, observer_done INTEGER NOT NULL DEFAULT 0, last_error TEXT);
    INSERT INTO qa_postprocess_jobs VALUES (5,2,'{}','','','','failed',1,0,0,'boom');
    CREATE TABLE diagnostic_items(id TEXT PRIMARY KEY, project_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
    INSERT INTO diagnostic_items VALUES ('d1',2,'pending'),('d2',2,'answered');
    CREATE TABLE survey_candidates(id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
    INSERT INTO survey_candidates VALUES ('s1','local-user','pending'),('s2','local-user','answered');
  `);
  sql.exec(TEACHING_SCHEMA);
  const get = (statement: string, values: unknown[] = []): Row => sql.prepare(statement).get(...values as never[]) as Row;
  return { sql, get };
}

function migrate(sql: DatabaseSync) {
  // Mirrors MobileDatabase.createSchema for schema v8: add scope columns, create
  // forest tables, then normalize legacy rows without inventing knowledge.
  sql.exec("ALTER TABLE concepts ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'global'");
  sql.exec("ALTER TABLE concepts ADD COLUMN scope_id TEXT NOT NULL DEFAULT 'local-user'");
  sql.exec(KNOWLEDGE_FOREST_SCHEMA);
  sql.exec(KNOWLEDGE_FOREST_LEGACY_NORMALIZATION);
}

describe("Android schema v7 → v8 migration", () => {
  it("derives scopes, pending placements and plan root status from legacy rows", () => {
    const { sql, get } = legacyV7Database();
    migrate(sql);

    expect(get("SELECT scope_type,scope_id FROM concepts WHERE id='c1'")).toMatchObject({ scope_type: "global", scope_id: "local-user" });
    expect(get("SELECT scope_type,scope_id FROM concepts WHERE id='c3'")).toMatchObject({ scope_type: "project", scope_id: "2" });
    // Legacy identities are adopted as unclassified nodes, never as planned coverage.
    expect(Number(get("SELECT COUNT(*) count FROM concept_placements").count)).toBe(3);
    expect(get("SELECT placement_status FROM concept_placements WHERE concept_id='c1'").placement_status).toBe("pending");
    expect(get("SELECT parent_concept_id FROM concept_placements WHERE concept_id='c3'").parent_concept_id).toBeNull();
    expect(get("SELECT * FROM plan_root_status WHERE project_id=1").status).toBe("pending");
    expect(get("SELECT * FROM plan_root_status WHERE project_id=2")).toBeUndefined();
    // Personalization and evidence analysis are forced on; imported false is inert.
    expect(get("SELECT value FROM settings WHERE key='personalization.enabled'").value).toBe("true");
    expect(get("SELECT value FROM settings WHERE key='personalization.observer.enabled'").value).toBe("true");
    expect(get("SELECT value FROM settings WHERE key='user.preference'").value).toBe("keep");
    // Legacy queues can never resume.
    expect(get("SELECT status FROM observer_jobs WHERE id='j1'").status).toBe("retired");
    expect(get("SELECT status FROM diagnostic_items WHERE id='d1'").status).toBe("retired");
    expect(get("SELECT status FROM diagnostic_items WHERE id='d2'").status).toBe("answered");
    expect(get("SELECT status FROM survey_candidates WHERE id='s1'").status).toBe("retired");
    expect(get("SELECT planner_done,observer_done FROM qa_postprocess_jobs WHERE qa_record_id=5")).toMatchObject({ planner_done: 1, observer_done: 1 });
  });

  it("is idempotent and keeps manual knowledge evidence intact", () => {
    const { sql, get } = legacyV7Database();
    migrate(sql);
    const placements = Number(get("SELECT COUNT(*) count FROM concept_placements").count);
    const versions = get("SELECT topology_version,state_version FROM knowledge_tree_versions");
    sql.exec(KNOWLEDGE_FOREST_SCHEMA);
    sql.exec(KNOWLEDGE_FOREST_LEGACY_NORMALIZATION);
    expect(Number(get("SELECT COUNT(*) count FROM concept_placements").count)).toBe(placements);
    expect(get("SELECT topology_version,state_version FROM knowledge_tree_versions")).toEqual(versions);
    // The legacy manual "known" claim survives as an explicit declaration.
    expect(get("SELECT manual_status FROM concept_mastery WHERE id='m1'").manual_status).toBe("known");
  });

  it("enforces one authoritative parent edge and rejects self-parenting", () => {
    const { sql } = legacyV7Database();
    migrate(sql);
    sql.exec("UPDATE concept_placements SET parent_concept_id='c1',placement_status='placed' WHERE concept_id='c2'");
    expect(() => sql.exec("UPDATE concept_placements SET parent_concept_id='c2' WHERE concept_id='c2'")).toThrow();
    expect(() => sql.exec("INSERT INTO concept_placements(concept_id,parent_concept_id,placement_status) VALUES('c1','c2','placed')")).toThrow();
    expect(() => sql.exec("INSERT INTO teaching_manifests(project_id,source_type,source_path,artifact_kind,content_hash,generation_id,metadata_status,updated_at) VALUES(1,'course','outline.md','outline','h','g','unknown','now')")).toThrow();
  });
});
