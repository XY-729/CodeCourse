// @vitest-environment node
/**
 * Regression coverage for the 2026-10-22 acceptance findings R01/R04/R11.
 *
 * R01: a response without (or with a broken) TeachingManifest must never replace
 *      a published course; the new text is kept as a hidden draft.
 * R04: the factual term-profile queries must work on a real schema with both
 *      mastery and state rows (the previous SQL reused an `m` alias).
 * R11: stored user requirements participate in generation context.
 */
import { DatabaseSync } from "node:sqlite";
import { KNOWLEDGE_MAINTENANCE_SCHEMA } from '../knowledgeForestSchema';
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  sql: null as unknown as DatabaseSync,
  files: new Map<string, string>(),
}));

vi.mock("@capacitor/core", async (original) => ({
  ...(await original<typeof import("@capacitor/core")>()),
  CapacitorHttp: { request: vi.fn() },
}));
vi.mock("../../runtime", () => ({
  CodeCourseSecureStore: { get: async () => ({ value: "test-only" }) },
  CodeCourseNative: {},
}));
vi.mock("../workspace", async (original) => ({
  ...(await original<typeof import("../workspace")>()),
  readGeneratedFile: async (_project: number, path: string) => {
    if (!harness.files.has(path)) throw new Error("missing");
    return harness.files.get(path)!;
  },
  writeGeneratedFileAtomic: async (_project: number, path: string, content: string) => {
    harness.files.set(path, content);
  },
}));
vi.mock("../database", () => ({
  MobileDatabase: class {
    async query(sql: string, params: unknown[] = []) {
      return harness.sql.prepare(sql).all(...(params as []));
    }
    async run(sql: string, params: unknown[] = []) {
      harness.sql.prepare(sql).run(...(params as []));
      return 1;
    }
    queryInTx = this.query;
    runInTx = this.run;
    async transaction<T>(work: () => Promise<T>) {
      harness.sql.exec("BEGIN");
      try {
        const result = await work();
        harness.sql.exec("COMMIT");
        return result;
      } catch (error) {
        harness.sql.exec("ROLLBACK");
        throw error;
      }
    }
  },
}));

import { AndroidLocalProvider } from "../localProvider";

let provider: any;

beforeEach(() => {
  vi.clearAllMocks();
  harness.files.clear();
  harness.sql = new DatabaseSync(":memory:");
  harness.sql.exec(`
    CREATE TABLE projects(id INTEGER PRIMARY KEY, name, project_type);
    INSERT INTO projects(id, name, project_type) VALUES(1, 'Project', 'learning_plan');
    CREATE TABLE generation_tasks(id INTEGER PRIMARY KEY, payload_json, progress_current, progress_total, stage_label, updated_at);
    INSERT INTO generation_tasks(id) VALUES(1);
    CREATE TABLE generation_prompt_snapshots(project_id, task_id, section_number, prompt_version, messages_json, updated_at, UNIQUE(task_id, section_number));
    CREATE TABLE concepts(id PRIMARY KEY, concept_key, canonical_name, display_name, domain, concept_type, aliases_json, difficulty, created_at, scope_type, scope_id);
    CREATE TABLE concept_mastery(concept_id, mastery, uncertainty, manual_status, scope_type, scope_id);
    CREATE TABLE knowledge_states_v2(concept_id, scope_type, scope_id, state_json);
    CREATE TABLE knowledge_tree_versions(id INTEGER PRIMARY KEY, topology_version, state_version);
    INSERT INTO knowledge_tree_versions VALUES(1, 4, 2);
    CREATE TABLE course_files(project_id, filename, title, group_name, updated_at, UNIQUE(project_id, filename));
    CREATE TABLE concept_placements(concept_id TEXT PRIMARY KEY, parent_concept_id TEXT, placement_status TEXT NOT NULL DEFAULT 'pending', provenance_json TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE concept_aliases(scope_type TEXT, scope_id TEXT, domain TEXT, alias_key TEXT, alias TEXT, concept_id TEXT, PRIMARY KEY(scope_type, scope_id, domain, alias_key));
    CREATE TABLE plan_concept_roots(project_id INTEGER, concept_id TEXT, PRIMARY KEY(project_id, concept_id));
    CREATE TABLE plan_root_status(project_id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', error_message TEXT);
    CREATE TABLE teaching_manifests(project_id INTEGER, source_type TEXT, source_path TEXT, artifact_kind TEXT, content_hash TEXT, generation_id TEXT, manifest_json TEXT NOT NULL DEFAULT '{}', concept_map_json TEXT NOT NULL DEFAULT '{}', topology_version INTEGER NOT NULL DEFAULT 0, state_version INTEGER NOT NULL DEFAULT 0, metadata_status TEXT NOT NULL, error_message TEXT, updated_at TEXT, PRIMARY KEY(project_id, source_type, source_path));
    CREATE TABLE teaching_documents(id TEXT PRIMARY KEY, project_id INTEGER, source_type TEXT, source_path TEXT, content_hash TEXT, index_status TEXT);
    CREATE TABLE document_terms(id INTEGER PRIMARY KEY, project_id, source_type, source_path, term_text, concept_id, status, confidence, canonical_name, category, source_span_json, link_origin, qa_record_id, created_at, updated_at, detection_source);
    CREATE TABLE teaching_passages(id TEXT PRIMARY KEY, document_id TEXT, concept_id TEXT, aspect TEXT, kind TEXT, core INTEGER, dimension TEXT, quote TEXT, start_line INTEGER, content_hash TEXT, active INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
    CREATE TABLE learning_evidence_v2(id TEXT PRIMARY KEY, idempotency_key TEXT, concept_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, dimension TEXT NOT NULL, direction TEXT NOT NULL, strength REAL NOT NULL DEFAULT 0, reliability REAL NOT NULL DEFAULT 0, source TEXT NOT NULL, action TEXT NOT NULL, object_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}', context_json TEXT NOT NULL DEFAULT '{}', event_time TEXT NOT NULL, session_id TEXT, qa_record_id INTEGER, target_evidence_id TEXT, voided INTEGER NOT NULL DEFAULT 0, policy_version TEXT);
    CREATE TABLE user_teaching_requirements(id TEXT PRIMARY KEY, project_id, scope_type, scope_id, text, source, action_id, active, created_at, updated_at);
  `);
  harness.sql.exec(KNOWLEDGE_MAINTENANCE_SCHEMA);
  provider = new AndroidLocalProvider();
  provider.getProject = vi.fn(async () => ({ id: 1, name: "Project", project_type: "learning_plan" }));
  provider.getLLMSettings = vi.fn(async () => ({ enabled: true, base_url: "https://example.test", model: "test" }));
  provider.getLearningSettings = vi.fn(async () => ({ primary_programming_language: "" }));
  provider.teaching.prepare = vi.fn(async (_project: number, content: string) => content);
  provider.registerTerms = vi.fn(async () => undefined);
});

afterEach(() => harness.sql.close());

const manifestComment = (quote: string) => `\n\n<!-- codecourse-teaching: ${JSON.stringify({
  schema_version: 2,
  concepts: [{ ref: "c1", existing_id: null, name: "std::vector", domain: "cpp", scope: "global", parent_ref: null, aliases: [] }],
  coverage: [{ concept_ref: "c1", aspect: "扩容", kind: "explained", dimension: "conceptual", core: true, quote }],
  terms: [],
})} -->`;

function seedPublishedCourse(path: string, body: string, hash = "old-hash") {
  harness.sql.prepare("INSERT INTO teaching_manifests(project_id,source_type,source_path,metadata_status) VALUES(1,'course',?,'complete')").run(path);
  harness.files.set(path, body);
  void hash;
}

it("R01 keeps the published course when the new response has no manifest", async () => {
  const oldBody = "# 旧课件\n\n旧的有效正文。" + manifestComment("旧的有效正文。");
  seedPublishedCourse("lessons/lesson_01.md", oldBody);
  let rejected = false;
  try {
    await provider.upsertCourse(1, "lessons/lesson_01.md", "# 新课件\n\n完全没有知识清单的新正文。", "课程");
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
  expect(harness.files.get("lessons/lesson_01.md")).toBe(oldBody);
  // The rejected text stays recoverable as a hidden draft.
  expect(harness.files.get(".drafts/lessons/lesson_01.md")).toContain("完全没有知识清单的新正文。");
  // Old manifest binding is untouched.
  const rows = harness.sql.prepare("SELECT metadata_status FROM teaching_manifests WHERE source_path='lessons/lesson_01.md'").all();
  expect(rows).toEqual([{ metadata_status: "complete" }]);
});

it("R01 also blocks legacy and damaged manifests and exempts explicit manual edits", async () => {
  const oldBody = "# 旧课件\n\n旧正文。" + manifestComment("旧正文。");
  seedPublishedCourse("lessons/lesson_02.md", oldBody);
  for (const broken of [
    "# 新正文\n\nTEACHING: [{\"concept\":\"旧接口\"}]\n",
    "# 新正文\n\n<!-- codecourse-teaching: {\"schema_version\":2,\"concepts\":\"bad\"} -->",
  ]) {
    await expect(provider.upsertCourse(1, "lessons/lesson_02.md", broken, "课程")).rejects.toThrow();
    expect(harness.files.get("lessons/lesson_02.md")).toBe(oldBody);
  }
  // A user-authored note edit may proceed without a manifest.
  await provider.upsertCourse(1, "lessons/lesson_02.md", "# 手工修改\n\n用户自己写的内容。", "课程", undefined, "从头保留原文", false);
  expect(harness.files.get("lessons/lesson_02.md")).toContain("用户自己写的内容。");
});

it("R04 returns factual profiles for UUID requests with real scope columns", async () => {
  harness.sql.exec(`
    INSERT INTO concepts(id, concept_key, canonical_name, display_name, domain, concept_type, aliases_json, difficulty, created_at, scope_type, scope_id)
      VALUES('vector-uuid','global:cpp:std::vector','std::vector','std::vector','cpp','theory','[]',0.5,'2026-10-01','global','local-user');
    INSERT INTO concept_mastery VALUES('vector-uuid',0.8,0.1,'known','global','local-user');
    INSERT INTO knowledge_states_v2 VALUES('vector-uuid','global','local-user','{"dimensions":{"familiarity":{"probability":0.95,"uncertainty":0.05,"status":"confirmed","evidenceCount":2,"directEvidenceCount":1,"objectiveAttemptCount":0,"reliableCorrectSessions":0,"manualStatus":"known"}},"familiarity":"self_reported_understood","ranges":[{"aspect":"扩容","dimension":"conceptual","familiarity":"self_reported_understood","evidence_ids":["e1"]}],"evidence_ids":["e1"],"source_count":1}');
    INSERT INTO concepts(id, concept_key, canonical_name, display_name, domain, concept_type, aliases_json, difficulty, created_at, scope_type, scope_id)
      VALUES('state-only','global:cpp:allocator','allocator','allocator','cpp','theory','[]',0.5,'2026-10-01','global','local-user');
    INSERT INTO knowledge_states_v2 VALUES('state-only','global','local-user','{"dimensions":{"familiarity":{"probability":0.1,"uncertainty":0.4,"status":"learning","evidenceCount":1,"directEvidenceCount":1,"objectiveAttemptCount":0,"reliableCorrectSessions":0,"manualStatus":null}},"familiarity":"needs_help","ranges":[{"aspect":"分配","dimension":"implementation","familiarity":"needs_help"}],"evidence_ids":["e2"],"source_count":1}');
  `);
  const result = await provider.getTermDisplayProfiles(1, ["vector-uuid", "state-only", "missing"]);
  const profiles = result.profiles as Array<Record<string, unknown>>;
  expect(profiles).toHaveLength(3);
  // An unknown identity still yields an explicit neutral profile instead of a
  // silent hole in the batch response.
  expect(profiles.find((item) => item.request_id === "missing")?.familiarity).toBe("unrecorded");
  const vector = profiles.find((item) => item.request_id === "vector-uuid")!;
  expect(vector.concept_id).toBe("vector-uuid");
  expect(vector.concept_key).toBe("global:cpp:std::vector");
  expect(vector.familiarity).toBe("self_reported_understood");
  expect((vector.ranges as Array<Record<string, unknown>>)[0]).toMatchObject({ aspect: "扩容", familiarity: "self_reported_understood" });
  expect(vector.tree_snapshot).toEqual({ topology_version: 4, state_version: 2 });
  expect(vector.manual_status).toBe("known");
  // State-only concept still resolves identity and facts.
  const allocator = profiles.find((item) => item.request_id === "state-only")!;
  expect(allocator.concept_id).toBe("state-only");
  expect(allocator.familiarity).toBe("needs_help");
});

it("R02 lists both same-spelling concepts from the authoritative manifest", async () => {
  const content = [
    "# 课件",
    "",
    "C++ 的 stack 是后进先出的容器适配器。",
    "",
    "Python 的 stack 通常用 list 模拟。",
  ].join("\n");
  harness.files.set("lessons/homonyms.md", content);
  const payload = {
    schema_version: 2,
    concepts: [
      { ref: "cpp_stack", existing_id: null, name: "stack", domain: "cpp", scope: "global", parent_ref: null, aliases: [] },
      { ref: "py_stack", existing_id: null, name: "stack", domain: "python", scope: "global", parent_ref: null, aliases: [] },
    ],
    coverage: [
      { concept_ref: "cpp_stack", aspect: "LIFO 语义", kind: "explained", dimension: "conceptual", core: true, quote: "C++ 的 stack 是后进先出的容器适配器。" },
      { concept_ref: "py_stack", aspect: "list 模拟", kind: "explained", dimension: "implementation", core: true, quote: "Python 的 stack 通常用 list 模拟。" },
    ],
    terms: [
      { concept_ref: "cpp_stack", text: "stack", quote: "C++ 的 stack 是后进先出的容器适配器。" },
      { concept_ref: "py_stack", text: "stack", quote: "Python 的 stack 通常用 list 模拟。" },
    ],
  };
  harness.sql.prepare("INSERT INTO concepts VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run("cpp-stack", "global:local-user:cpp:stack", "stack", "stack", "cpp", "theory", "[]", 0.5, "2026-10-01", "global", "local-user");
  harness.sql.prepare("INSERT INTO concepts VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run("py-stack", "global:local-user:python:stack", "stack", "stack", "python", "theory", "[]", 0.5, "2026-10-01", "global", "local-user");
  harness.sql.prepare("INSERT INTO teaching_manifests VALUES(1,'course','lessons/homonyms.md','lesson','hash','gen',?,?,4,2,'complete',NULL,'2026-10-01')")
    .run(JSON.stringify(payload), JSON.stringify({ cpp_stack: "cpp-stack", py_stack: "py-stack" }));
  provider.registerTerms = vi.fn(async () => undefined);
  const terms = await provider.listTerms(1, new URLSearchParams("source_type=course&source_path=lessons/homonyms.md"));
  expect(terms).toHaveLength(2);
  expect(terms.map((term: Record<string, unknown>) => term.concept_id)).toEqual(["cpp-stack", "py-stack"]);
  expect(new Set(terms.map((term: Record<string, unknown>) => JSON.stringify(term.source_span))).size).toBe(2);
  expect(terms[0].familiarity).toBe("unrecorded");
  expect(terms[0].quote).not.toBe(terms[1].quote);
});

it("R11 merges stored requirements into the generation context", async () => {
  harness.sql.exec(`
    INSERT INTO user_teaching_requirements VALUES('r1',1,'project','1','本项目只讲 vector 扩容','manual','a1',1,'2026-10-01','2026-10-01');
    INSERT INTO user_teaching_requirements VALUES('r2',1,'global','local-user','代码示例优先用 C++','manual','a2',1,'2026-10-01','2026-10-01');
    INSERT INTO user_teaching_requirements VALUES('r3',1,'project','1','已失效的要求','manual','a3',0,'2026-10-01','2026-10-01');
  `);
  const requirements = await provider.forest.requirements(1);
  expect(requirements[0]).toBe("本项目只讲 vector 扩容");
  expect(requirements).toContain("代码示例优先用 C++");
  expect(requirements).not.toContain("已失效的要求");
  // The tree serialization is covered elsewhere; here we only assert the merged
  // requirement order that reaches the model.
  provider.forest.context = vi.fn(async (_project: number, merged: string[]) =>
    `<teaching_context><user_requirements>${merged.join("|")}</user_requirements></teaching_context>`);
  const context = await provider.teachingContext(1, ["当前轮要求：先讲扩容"]);
  expect(context).toContain("当前轮要求：先讲扩容");
  expect(context).toContain("本项目只讲 vector 扩容");
  // Current wording comes first; saved requirements follow.
  expect(context.indexOf("当前轮要求：先讲扩容")).toBeLessThan(context.indexOf("本项目只讲 vector 扩容"));
});
