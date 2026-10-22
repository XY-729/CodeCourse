// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ sql: null as unknown as DatabaseSync, connected: false, opened: false, files: new Map<string, string>(), directories: new Set<string>() }));
vi.mock("@capacitor-community/sqlite", () => ({ CapacitorSQLite: {
  isSecretStored: async () => ({ result: true }), setEncryptionSecret: async () => {},
  isDBOpen: async () => {
    if (!state.connected) throw new Error("isDBOpen: No available connection for database codecourse_mobile");
    return { result: state.opened };
  },
  createConnection: async () => {
    if (state.connected) throw new Error("CreateConnection: Connection codecourse_mobile already exists");
    state.connected = true;
  },
  open: async () => { state.opened = true; },
  query: async ({ statement, values = [] }: { statement: string; values: [] }) => ({ values: state.sql.prepare(statement).all(...values) }),
  execute: async ({ statements, transaction }: { statements: string; transaction: boolean }) => {
    if (transaction) state.sql.exec("BEGIN");
    try { state.sql.exec(statements); if (transaction) state.sql.exec("COMMIT"); }
    catch (error) { if (transaction) state.sql.exec("ROLLBACK"); throw error; }
  },
  run: async ({ statement, values = [], transaction }: { statement: string; values: []; transaction: boolean }) => {
    if (transaction) state.sql.exec("BEGIN");
    try { const result = state.sql.prepare(statement).run(...values); if (transaction) state.sql.exec("COMMIT"); return { changes: { lastId: Number(result.lastInsertRowid) } }; }
    catch (error) { if (transaction) state.sql.exec("ROLLBACK"); throw error; }
  },
  executeSet: async ({ set }: { set: Array<{ statement: string; values: [] }> }) => { for (const entry of set) state.sql.prepare(entry.statement).run(...entry.values); },
} }));
vi.mock("../../runtime", () => ({ CodeCourseSecureStore: { get: async () => ({ value: "test-secret" }), set: async () => {} } }));
vi.mock("@capacitor/filesystem", () => ({ Directory: { Data: "DATA" }, Encoding: { UTF8: "utf8" }, Filesystem: {
  mkdir: async ({ path }: { path: string }) => { state.directories.add(path); },
  stat: async ({ path }: { path: string }) => { if (state.directories.has(path)) return { type: "directory" }; if (state.files.has(path)) return { type: "file" }; throw new Error("not found"); },
  writeFile: async ({ path, data }: { path: string; data: string }) => { state.files.set(path, data); },
  readFile: async ({ path }: { path: string }) => { if (!state.files.has(path)) throw new Error("not found"); return { data: state.files.get(path)! }; },
  rename: async ({ from, to }: { from: string; to: string }) => {
    if (!state.directories.has(from)) throw new Error("not found");
    for (const path of [...state.directories]) if (path === from || path.startsWith(from + "/")) { state.directories.delete(path); state.directories.add(to + path.slice(from.length)); }
    for (const [path, data] of [...state.files]) if (path.startsWith(from + "/")) { state.files.delete(path); state.files.set(to + path.slice(from.length), data); }
  },
  rmdir: async ({ path }: { path: string }) => {
    for (const dir of [...state.directories]) if (dir === path || dir.startsWith(path + "/")) state.directories.delete(dir);
    for (const file of [...state.files.keys()]) if (file.startsWith(path + "/")) state.files.delete(file);
  },
} }));
import { MobileDatabase } from "../database";
import { importAndroidDataArchive } from "../dataTransfer";
import { readGeneratedFile } from "../workspace";

beforeEach(() => { state.sql = new DatabaseSync(":memory:"); state.connected = false; state.opened = false; state.files.clear(); state.directories.clear(); });
afterEach(() => state.sql.close());

async function verifyRestore(blob: Blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  const database = new MobileDatabase();
  await database.init();
  const result = await importAndroidDataArchive(database, blob);
  expect(result.project_count).toBe(manifest.projects.length);
  const projects = await database.query("SELECT id,name,project_type FROM projects ORDER BY id");
  expect(projects).toEqual([...manifest.projects].sort((a, b) => a.id - b.id).map(({ id, name, project_type }) => ({ id, name, project_type })));
  for (const project of manifest.projects) {
    const expected = project.course_files.filter((file: { filename: string }) => /\.md$/i.test(file.filename) && !file.filename.split("/").some(part => part.startsWith(".")));
    const courses = await database.query("SELECT filename FROM course_files WHERE project_id=? ORDER BY filename", [project.id]);
    expect(courses.map(row => row.filename)).toEqual(expected.map((file: { filename: string }) => file.filename).sort());
    for (const file of expected) {
      const content = await readGeneratedFile(project.id, file.filename);
      expect(content).toBe(await zip.file(`projects/${project.id}/generated/${file.filename}`)!.async("string"));
    }
  }
  return database;
}

it.each([false, true])("upgrades a v0.4.2 database with existing user data (retained connection: %s)", async (retained) => {
  state.sql.exec(readFileSync(new URL("./fixtures/mobile-v042.sql", import.meta.url), "utf8"));
  state.sql.exec(`
    INSERT INTO projects(id,name,status,created_at,updated_at) VALUES(12,'原有项目','ready','2026-10-01','2026-10-01');
    INSERT INTO course_files(project_id,filename,title,updated_at) VALUES(12,'lessons/lesson_01.md','原有课件','2026-10-01');
    INSERT INTO qa_records(project_id,source_type,question,answer_md,provider,model,created_at,updated_at)
      VALUES(12,'course','原有问题','# 原有回答','test','test','2026-10-01','2026-10-01');
    INSERT INTO learning_states(project_id,source_type,source_path,position_value,last_opened_at,updated_at)
      VALUES(12,'course','lessons/lesson_01.md',0.75,'2026-10-01','2026-10-01');
    INSERT INTO settings(key,value) VALUES('user.preference','keep');
  `);
  state.connected = retained;
  state.opened = retained;
  const database = new MobileDatabase();
  await database.init();
  expect(await database.query("PRAGMA user_version")).toEqual([{ user_version: 9 }]);
  expect(await database.query("SELECT name FROM projects")).toEqual([{ name: "原有项目" }]);
  expect(await database.query("SELECT filename FROM course_files")).toEqual([{ filename: "lessons/lesson_01.md" }]);
  expect(await database.query("SELECT question,answer_md,selection_range_json FROM qa_records")).toEqual([{ question: "原有问题", answer_md: "# 原有回答", selection_range_json: null }]);
  expect(await database.query("SELECT position_value FROM learning_states")).toEqual([{ position_value: 0.75 }]);
  expect(await database.query("SELECT value FROM settings WHERE key='user.preference'")).toEqual([{ value: "keep" }]);
  expect(database.searchVersion).toBe(4);
  const reloadedDatabase = new MobileDatabase();
  await reloadedDatabase.init();
  expect(reloadedDatabase.searchVersion).toBe(4);
  expect(await reloadedDatabase.query("SELECT count(*) AS count FROM projects")).toEqual([{ count: 1 }]);
});

it("restores separate projects with the same Markdown filename and excludes generation scratch files from courses", async () => {
  const zip = new JSZip();
  const projects = [11, 12, 14].map(id => {
    const text = `# 第 ${id} 个项目\n\n**Markdown 正文**`;
    zip.file(`projects/${id}/generated/lessons/lesson_01.md`, text);
    return { id, name: `项目 ${id}`, project_type: "learning_plan", source_files: [], course_files: [{ filename: "lessons/lesson_01.md", title: `课程 ${id}`, group: "课程", size: new TextEncoder().encode(text).length }] };
  });
  zip.file("projects/11/generated/.tasks/task-1/section.part", "scratch");
  zip.file("projects/11/generated/.previews/task-1.json", "{}");
  projects[0].course_files.push({ filename: ".tasks/task-1/section.part", size: 7, title: "scratch", group: "课程" }, { filename: ".previews/task-1.json", size: 2, title: "preview", group: "课程" });
  zip.file("manifest.json", JSON.stringify({ format: "codecourse-data-archive", version: 1, source_platform: "desktop", secrets_included: false, project_count: 3, file_count: 5, projects }));
  zip.file("database.json", JSON.stringify({ settings: {}, tables: { projects: { columns: ["id", "name", "project_type", "status", "created_at", "updated_at"], rows: projects.map(project => [project.id, project.name, project.project_type, "ready", "2026-10-15", "2026-10-15"]) } } }));
  await verifyRestore(new Blob([await zip.generateAsync({ type: "arraybuffer" })]));
});

it("restores the authoritative concept forest, plan roots and user requirements from a desktop-shaped archive", async () => {
  const manifestComment = `<!-- codecourse-teaching: ${JSON.stringify({
    schema_version: 2,
    concepts: [
      { ref: "c1", existing_id: null, name: "std::vector", domain: "cpp", scope: "global", parent_ref: null, aliases: ["vector"] },
    ],
    coverage: [{ concept_ref: "c1", aspect: "连续存储", kind: "explained", dimension: "conceptual", core: true, quote: "vector 连续存储元素。" }],
    terms: [{ concept_ref: "c1", text: "vector", quote: "vector 连续存储元素。" }],
  })} -->`;
  const text = `# 课件\n\nvector 连续存储元素。\n\n${manifestComment}\n`;
  const zip = new JSZip();
  zip.file("projects/21/generated/lessons/lesson_01.md", text);
  zip.file("manifest.json", JSON.stringify({
    format: "codecourse-data-archive", version: 1, source_platform: "desktop", secrets_included: false,
    project_count: 1, file_count: 1,
    projects: [{
      id: 21, name: "迁移计划", project_type: "learning_plan", source_files: [],
      course_files: [{ filename: "lessons/lesson_01.md", title: "课件", group: "课程", size: new TextEncoder().encode(text).length }],
    }],
  }));
  zip.file("database.json", JSON.stringify({
    settings: { "personalization.observer.enabled": "false", "personalization.answer_depth": "0.9" },
    tables: {
      projects: {
        columns: ["id", "name", "project_type", "status", "created_at", "updated_at"],
        rows: [[21, "迁移计划", "learning_plan", "ready", "2026-10-15", "2026-10-15"]],
      },
      concepts: {
        columns: ["id", "concept_key", "canonical_name", "display_name", "domain", "concept_type", "aliases_json", "difficulty", "created_at"],
        rows: [["concept-cpp", "global:local-user:cpp:c++", "C++", "C++", "cpp", "theory", "[]", 0.5, "2026-10-15"],
          ["concept-vector", "global:local-user:cpp:std::vector", "std::vector", "std::vector", "cpp", "theory", '["vector"]', 0.5, "2026-10-15"]],
      },
      concept_placements: {
        columns: ["concept_id", "parent_concept_id", "placement_status", "provenance_json"],
        rows: [["concept-cpp", null, "root", "{}"], ["concept-vector", "concept-cpp", "placed", "{}"]],
      },
      concept_alias_bindings: {
        columns: ["scope_type", "scope_id", "domain", "alias", "concept_id"],
        rows: [["global", "local-user", "cpp", "vector", "concept-vector"]],
      },
      plan_concept_roots: {
        columns: ["project_id", "concept_id"],
        rows: [[21, "concept-cpp"]],
      },
      plan_root_status: {
        columns: ["project_id", "status", "error_message"],
        rows: [[21, "ready", null]],
      },
      knowledge_tree_versions: {
        columns: ["id", "topology_version", "state_version"],
        rows: [[1, 4, 2]],
      },
      user_teaching_requirements: {
        columns: ["id", "project_id", "scope_type", "scope_id", "text", "source", "action_id", "active", "created_at", "updated_at"],
        rows: [["req-1", 21, "project", "21", "只讲 vector 的扩容", "manual", "action-1", 1, "2026-10-15", "2026-10-15"]],
      },
    },
  }));
  const database = await verifyRestore(new Blob([await zip.generateAsync({ type: "arraybuffer" })]));
  // Parent edges and plan roots survive instead of collapsing into pending.
  expect(await database.query(
    "SELECT parent_concept_id,placement_status FROM concept_placements WHERE concept_id='concept-vector'",
  )).toEqual([{ parent_concept_id: "concept-cpp", placement_status: "placed" }]);
  expect(await database.query("SELECT concept_id FROM plan_concept_roots WHERE project_id=21"))
    .toEqual([{ concept_id: "concept-cpp" }]);
  expect(await database.query("SELECT status FROM plan_root_status WHERE project_id=21"))
    .toEqual([{ status: "ready" }]);
  expect(await database.query("SELECT text FROM user_teaching_requirements WHERE project_id=21"))
    .toEqual([{ text: "只讲 vector 的扩容" }]);
  // Canonical alias bindings are adopted by the Android binding table.
  expect(await database.query("SELECT concept_id FROM concept_aliases WHERE alias_key='vector'"))
    .toEqual([{ concept_id: "concept-vector" }]);
  // Retired opt-outs never come back as false, and the manifest is republished
  // locally without any model call.
  expect(await database.query("SELECT value FROM settings WHERE key='personalization.observer.enabled'"))
    .toEqual([{ value: "true" }]);
  expect(await database.query("SELECT count(*) AS count FROM settings WHERE key='personalization.answer_depth'"))
    .toEqual([{ count: 0 }]);
  expect(await database.query("SELECT metadata_status FROM teaching_manifests WHERE source_path='lessons/lesson_01.md'"))
    .toEqual([{ metadata_status: "complete" }]);
  expect(await database.query("SELECT index_status FROM teaching_documents WHERE source_path='lessons/lesson_01.md'"))
    .toEqual([{ index_status: "complete" }]);
});

it.skipIf(!process.env.CODECOURSE_TEST_ARCHIVE)("restores the user's actual desktop archive with project and Markdown contents intact", async () => {
  const bytes = readFileSync(process.env.CODECOURSE_TEST_ARCHIVE!);
  await verifyRestore(new Blob([Uint8Array.from(bytes).buffer]));
});
