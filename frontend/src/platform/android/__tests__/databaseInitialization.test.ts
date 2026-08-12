import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlite = vi.hoisted(() => ({
  isSecretStored: vi.fn(async () => ({ result: true })),
  setEncryptionSecret: vi.fn(async () => undefined),
  createConnection: vi.fn(async () => undefined),
  open: vi.fn(async () => undefined),
  execute: vi.fn(async () => undefined),
  query: vi.fn(async ({ statement }: { statement: string }) => {
    if (statement === "PRAGMA user_version") return { values: [{ user_version: 2 }] };
    if (statement.includes("sqlite_master")) return { values: [{ sql: "CREATE VIRTUAL TABLE code_chunks_fts USING fts5(content)" }] };
    return { values: [] };
  }),
  run: vi.fn(async () => ({ changes: { lastId: 0 } })),
}));

vi.mock("@capacitor-community/sqlite", () => ({ CapacitorSQLite: sqlite }));
vi.mock("../../runtime", () => ({
  CodeCourseSecureStore: {
    get: vi.fn(async () => ({ value: "existing-secret" })),
    set: vi.fn(async () => undefined),
  },
}));

import { MobileDatabase } from "../database";

describe("MobileDatabase startup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
});
