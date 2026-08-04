import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => {
  const runCalls: Array<{ sql: string; values: unknown[] }> = [];
  return {
    runCalls,
    run: vi.fn(async (sql: string, values: unknown[] = []) => {
      runCalls.push({ sql, values });
      return 0;
    }),
    query: vi.fn(async () => []),
  };
});

vi.mock("../database", () => ({
  MobileDatabase: class {
    run = dbMock.run;
    query = dbMock.query;
  },
}));

vi.mock("../workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../workspace")>();
  return {
    ...actual,
    removeProjectFiles: vi.fn(async () => undefined),
  };
});

import { AndroidLocalProvider } from "../localProvider";

const runCalls = dbMock.runCalls;
const hasDelete = (table: string) =>
  runCalls.some(({ sql }) => sql.startsWith(`DELETE FROM ${table} WHERE project_id = ?`));
const deleteIndex = (table: string) =>
  runCalls.findIndex(({ sql }) => sql.startsWith(`DELETE FROM ${table} WHERE project_id = ?`));

beforeEach(() => {
  runCalls.length = 0;
  dbMock.query.mockClear();
});

describe("Android project deletion cleanup", () => {
  it("deletes index tables and file manifest for the project", async () => {
    const provider = new AndroidLocalProvider();
    const result = await provider.request("/projects/11", { method: "DELETE" });

    expect(result).toEqual(expect.objectContaining({ id: 11, status: "deleted" }));
    expect(hasDelete("code_chunks_fts")).toBe(true);
    expect(hasDelete("code_chunks")).toBe(true);
    expect(hasDelete("indexed_files")).toBe(true);
    expect(hasDelete("project_files")).toBe(true);
  });

  it("deletes FTS rows before index and manifest rows (foreign-key-safe order)", async () => {
    const provider = new AndroidLocalProvider();
    await provider.request("/projects/11", { method: "DELETE" });

    const fts = deleteIndex("code_chunks_fts");
    const chunks = deleteIndex("code_chunks");
    const indexed = deleteIndex("indexed_files");
    const files = deleteIndex("project_files");
    expect(fts).toBeGreaterThanOrEqual(0);
    expect(fts).toBeLessThan(chunks);
    expect(chunks).toBeLessThan(indexed);
    expect(indexed).toBeLessThan(files);
  });

  it("still deletes the project row after cleanup", async () => {
    const provider = new AndroidLocalProvider();
    await provider.request("/projects/11", { method: "DELETE" });

    expect(runCalls.some(({ sql }) => sql === "DELETE FROM projects WHERE id = ?")).toBe(true);
    const projects = runCalls.findIndex(({ sql }) => sql === "DELETE FROM projects WHERE id = ?");
    const files = deleteIndex("project_files");
    expect(files).toBeGreaterThanOrEqual(0);
    expect(files).toBeLessThan(projects);
  });
});
