import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ connected: false, opened: false, version: 10 }));
const sqlite = vi.hoisted(() => ({
  isSecretStored: vi.fn<() => Promise<{ result: boolean }>>(),
  setEncryptionSecret: vi.fn<() => Promise<void>>(),
  isDBOpen: vi.fn<() => Promise<{ result: boolean }>>(),
  createConnection: vi.fn<() => Promise<void>>(),
  open: vi.fn<() => Promise<void>>(),
  execute: vi.fn<(options: { statements: string }) => Promise<void>>(),
  query: vi.fn<(options: { statement: string }) => Promise<{ values: Record<string, unknown>[] }>>(),
  run: vi.fn<() => Promise<{ changes: { lastId: number } }>>(),
}));

vi.mock("@capacitor-community/sqlite", () => ({ CapacitorSQLite: sqlite }));
vi.mock("../../runtime", () => ({
  CodeCourseSecureStore: {
    get: vi.fn(async () => ({ value: "existing-secret" })),
    set: vi.fn(async () => undefined),
  },
}));

import { MobileDatabase } from "../database";

beforeEach(() => {
  vi.resetAllMocks();
  native.connected = false;
  native.opened = false;
  native.version = 10;
  sqlite.isSecretStored.mockResolvedValue({ result: true });
  sqlite.isDBOpen.mockImplementation(async () => {
    if (!native.connected) throw new Error("isDBOpen: No available connection for database codecourse_mobile");
    return { result: native.opened };
  });
  sqlite.createConnection.mockImplementation(async () => {
    if (native.connected) throw new Error("CreateConnection: Connection codecourse_mobile already exists");
    native.connected = true;
  });
  sqlite.open.mockImplementation(async () => { native.opened = true; });
  sqlite.execute.mockImplementation(async ({ statements }) => {
    if (statements === "PRAGMA user_version = 10") native.version = 10;
  });
  sqlite.query.mockImplementation(async ({ statement }) => {
    if (statement === "PRAGMA user_version") return { values: [{ user_version: native.version }] };
    if (statement.includes("sqlite_master")) return { values: [{ sql: "CREATE VIRTUAL TABLE code_chunks_fts USING fts5(content)" }] };
    return { values: [] };
  });
  sqlite.run.mockResolvedValue({ changes: { lastId: 0 } });
});

describe("MobileDatabase startup", () => {
  it("shares one initialization across concurrent callers", async () => {
    const database = new MobileDatabase();
    await Promise.all([database.init(), database.init(), database.query("SELECT 1")]);

    expect(sqlite.createConnection).toHaveBeenCalledTimes(1);
    expect(sqlite.open).toHaveBeenCalledTimes(1);
    expect(sqlite.query).toHaveBeenCalledWith(expect.objectContaining({ statement: "PRAGMA user_version" }));
  });

  it("uses the version fast path without rebuilding schema", async () => {
    const database = new MobileDatabase();
    await database.init();

    const calls = sqlite.execute.mock.calls as unknown as Array<[{ statements: string }]>;
    const statements = calls.map((args) => String(args[0].statements));
    expect(statements).toEqual(["PRAGMA foreign_keys = ON"]);
    expect(database.searchVersion).toBe(5);
  });

  it("reuses an open native connection retained after a WebView reload", async () => {
    native.connected = true;
    native.opened = true;
    const database = new MobileDatabase();
    await database.query("SELECT * FROM projects");
    expect(sqlite.createConnection).not.toHaveBeenCalled();
    expect(sqlite.open).not.toHaveBeenCalled();
    expect(database.searchVersion).toBe(5);
  });

  it("opens a retained closed connection without creating it again", async () => {
    native.connected = true;
    await new MobileDatabase().init();
    expect(sqlite.createConnection).not.toHaveBeenCalled();
    expect(sqlite.open).toHaveBeenCalledTimes(1);
  });

  it("retries a failed open using the registered native connection", async () => {
    const database = new MobileDatabase();
    sqlite.open.mockRejectedValueOnce(new Error("Open: temporarily unavailable"));
    await expect(database.init()).rejects.toThrow("Open: temporarily unavailable");
    await database.init();
    expect(sqlite.createConnection).toHaveBeenCalledTimes(1);
    expect(sqlite.open).toHaveBeenCalledTimes(2);
  });

  it("retries an interrupted migration without masking the error or recreating the connection", async () => {
    native.version = 5;
    const database = new MobileDatabase();
    const execute = sqlite.execute.getMockImplementation()!;
    let interrupted = false;
    sqlite.execute.mockImplementation(async (options) => {
      if (!interrupted && options.statements.includes("CREATE TABLE")) {
        interrupted = true;
        throw new Error("Execute: migration interrupted");
      }
      await execute(options);
    });
    await expect(database.init()).rejects.toThrow("Execute: migration interrupted");
    expect(native.version).toBe(5);
    await Promise.all([database.init(), database.query("SELECT * FROM projects")]);
    expect(native.version).toBe(10);
    expect(sqlite.createConnection).toHaveBeenCalledTimes(1);
    expect(sqlite.open).toHaveBeenCalledTimes(1);
  });

  it("serializes initialization across wrappers sharing the native database", async () => {
    native.version = 5;
    await Promise.all([new MobileDatabase().init(), new MobileDatabase().init()]);
    expect(sqlite.createConnection).toHaveBeenCalledTimes(1);
    expect(sqlite.open).toHaveBeenCalledTimes(1);
    expect(sqlite.execute.mock.calls.filter(([options]) => options.statements === "PRAGMA user_version = 10")).toHaveLength(1);
  });

  it("handles a native connection appearing during bridge reconnection", async () => {
    sqlite.createConnection.mockImplementationOnce(async () => {
      native.connected = true;
      native.opened = true;
      throw { message: "CreateConnection: Connection codecourse_mobile already exists" };
    });
    await new MobileDatabase().init();
    expect(sqlite.open).not.toHaveBeenCalled();
  });

  it("preserves unexpected native probe errors", async () => {
    sqlite.isDBOpen.mockRejectedValueOnce(new Error("isDBOpen: native plugin unavailable"));
    await expect(new MobileDatabase().init()).rejects.toThrow("native plugin unavailable");
    expect(sqlite.createConnection).not.toHaveBeenCalled();
  });

  it("preserves genuine connection errors and permits a later retry", async () => {
    const database = new MobileDatabase();
    sqlite.createConnection.mockRejectedValueOnce(new Error("CreateConnection: encrypted database unavailable"));
    await expect(database.init()).rejects.toThrow("encrypted database unavailable");
    expect(sqlite.open).not.toHaveBeenCalled();
    await database.init();
    expect(sqlite.open).toHaveBeenCalledTimes(1);
  });

  it("keeps reporting the underlying schema failure across retries", async () => {
    const database = new MobileDatabase();
    sqlite.execute.mockRejectedValue(new Error("Execute: disk full"));
    await expect(database.init()).rejects.toThrow("Execute: disk full");
    await expect(database.init()).rejects.toThrow("Execute: disk full");
    expect(sqlite.createConnection).toHaveBeenCalledTimes(1);
    expect(sqlite.open).toHaveBeenCalledTimes(1);
  });
});

it("upgrades version 5 with durable answer jobs, the concept forest and selection ranges", async () => {
  sqlite.query.mockImplementation(async ({ statement }: { statement: string }) => {
    if (statement === "PRAGMA user_version") return { values: [{ user_version: 5 }] };
    return { values: [] };
  });
  await new MobileDatabase().init();
  const statements = (sqlite.execute.mock.calls as unknown as Array<[{ statements: string }]>).map(call => call[0].statements).join("\n");
  expect(statements).toContain("CREATE TABLE IF NOT EXISTS qa_postprocess_jobs");
  expect(statements).toContain("ALTER TABLE qa_records ADD COLUMN selection_range_json TEXT");
  expect(statements).toContain("ALTER TABLE learning_states ADD COLUMN profile_status TEXT NOT NULL DEFAULT 'none'");
  // Schema v8: authoritative concept forest, manifests and factual versions.
  expect(statements).toContain("ALTER TABLE concepts ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'global'");
  expect(statements).toContain("CREATE TABLE IF NOT EXISTS concept_placements");
  expect(statements).toContain("CREATE TABLE IF NOT EXISTS teaching_manifests");
  expect(statements).toContain("CREATE TABLE IF NOT EXISTS knowledge_tree_versions");
  expect(statements).toContain("CREATE TABLE IF NOT EXISTS user_teaching_requirements");
  expect(statements).toContain("UPDATE observer_jobs SET status='retired'");
  expect(statements).toContain("INSERT OR REPLACE INTO settings(key,value) VALUES('personalization.enabled','true')");
  expect(statements).toContain("PRAGMA user_version = 10");
  expect(statements).not.toContain("DROP TABLE");
});

it("serializes foreground saves across wrappers with background transactions and releases the queue after rollback", async () => {
  sqlite.query.mockImplementation(async ({ statement }: { statement: string }) => statement === "PRAGMA user_version" ? { values: [{ user_version: 10 }] } : { values: [] });
  const database = new MobileDatabase();
  const foregroundDatabase = new MobileDatabase();
  await Promise.all([database.init(), foregroundDatabase.init()]);
  sqlite.run.mockClear();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const background = database.transaction(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); throw new Error("rollback"); });
  const failed = expect(background).rejects.toThrow("rollback");
  await started;
  const foreground = foregroundDatabase.run("INSERT INTO qa_records VALUES (?)", [1]);
  await Promise.resolve();
  expect(sqlite.run).not.toHaveBeenCalled();
  release(); await failed; await foreground;
  expect(sqlite.run).toHaveBeenCalledTimes(1);
});
