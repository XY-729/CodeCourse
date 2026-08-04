import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  run: vi.fn(async () => 0),
  query: vi.fn(async () => []),
}));

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
    readGeneratedFile: vi.fn(async () => ""),
    readRepoFile: vi.fn(async () => ""),
  };
});

import { AndroidLocalProvider } from "../localProvider";

type TestProvider = {
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  queueTask: ReturnType<typeof vi.fn>;
};

function createProvider(): TestProvider {
  const provider = new AndroidLocalProvider() as unknown as TestProvider;
  provider.queueTask = vi.fn(async (_projectId: number, type: string, payload: Record<string, unknown>) => ({
    id: 1,
    task_type: type,
    status: "queued",
    payload_json: JSON.stringify(payload),
  }));
  return provider;
}

async function request<T>(provider: TestProvider, path: string, method = "GET", body?: unknown): Promise<T> {
  return provider.request(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as Promise<T>;
}

beforeEach(() => {
  dbMock.run.mockClear();
  dbMock.query.mockClear();
});

describe("Android sub-outline routes", () => {
  it("POST /outlines/sub queues a sub_outline task with paths and title", async () => {
    const provider = createProvider();

    const result = await request<any>(
      provider,
      "/projects/7/outlines/sub",
      "POST",
      { title: "深入 async 运行时", paths: ["src/runtime.ts", "src/loop.ts"], instructions: "重点讲事件循环" },
    );

    expect(result.task_type).toBe("sub_outline");
    expect(provider.queueTask).toHaveBeenCalledWith(7, "sub_outline", {
      title: "深入 async 运行时",
      paths: ["src/runtime.ts", "src/loop.ts"],
      instructions: "重点讲事件循环",
    });
  });

  it("POST /lessons/sub-outline rejects non sub-outline paths", async () => {
    const provider = createProvider();

    await expect(
      request(provider, "/projects/7/lessons/sub-outline", "POST", {
        outline_path: "outline.md",
        lesson_number: 1,
        title: "第一课",
      }),
    ).rejects.toThrow("子总纲课件只能基于子总纲文件生成");
    expect(provider.queueTask).not.toHaveBeenCalled();
  });

  it("POST /lessons/sub-outline rejects paths not in course_files", async () => {
    const provider = createProvider();
    dbMock.query.mockResolvedValueOnce([]);

    await expect(
      request(provider, "/projects/7/lessons/sub-outline", "POST", {
        outline_path: "sub-outline-1a2b3c4d.md",
        lesson_number: 3,
        title: "第三课",
      }),
    ).rejects.toThrow("子总纲文件不存在或已删除");
    expect(provider.queueTask).not.toHaveBeenCalled();
  });

  it("POST /lessons/sub-outline forwards valid paths to queueTask", async () => {
    const provider = createProvider();
    dbMock.query.mockResolvedValueOnce([{ id: 1 }]);

    const result = await request<any>(
      provider,
      "/projects/7/lessons/sub-outline",
      "POST",
      { outline_path: "sub-outline-1a2b3c4d.md", lesson_number: 3, title: "第三课" },
    );

    expect(result.task_type).toBe("outline_lesson");
    expect(provider.queueTask).toHaveBeenCalledWith(
      7,
      "outline_lesson",
      expect.objectContaining({ outline_path: "sub-outline-1a2b3c4d.md", lesson_number: 3 }),
    );
  });
});
