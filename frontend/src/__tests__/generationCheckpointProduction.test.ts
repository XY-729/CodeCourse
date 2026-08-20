import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const tasks = new Map<number, Record<string, unknown>>();
  const writes: Array<{ filename: string; content: string }> = [];
  const db = {
    async init() {},
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      if (sql.includes("SELECT * FROM generation_tasks WHERE id=")) {
        const row = tasks.get(Number(params[0]));
        return (row ? [row] : []) as T[];
      }
      if (sql.includes("SELECT id FROM generation_tasks WHERE status")) return [] as T[];
      return [] as T[];
    },
    async run(sql: string, params: unknown[] = []): Promise<number> {
      if (sql.includes("UPDATE generation_tasks")) {
        const taskId = Number(params.at(-1));
        const row = tasks.get(taskId);
        if (row) {
          if (sql.includes("status='running'")) row.status = "running";
          if (sql.includes("status='completed'")) {
            row.status = "completed";
            row.output_path = params[0];
          }
          if (sql.includes("status='failed'")) row.status = "failed";
          if (sql.includes("payload_json=?")) row.payload_json = params[0];
        }
      }
      return 1;
    },
  };
  return { tasks, writes, db };
});

vi.mock("../platform/android/database", () => ({
  MobileDatabase: class {
    init = harness.db.init;
    query = harness.db.query;
    run = harness.db.run;
  },
}));

vi.mock("../platform/android/workspace", async (importOriginal) => {
  const original = await importOriginal<typeof import("../platform/android/workspace")>();
  return {
    ...original,
    readRepoFile: vi.fn(async () => "export function example() { return 1; }"),
    readGeneratedFile: vi.fn(async () => "# Outline"),
  };
});

vi.mock("../platform/runtime", () => ({
  CodeCourseSecureStore: {
    get: vi.fn(async () => ({ value: null })),
    set: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  },
  CodeCourseNative: {
    requestNotificationPermission: vi.fn(async () => ({
      granted: true,
      status: "granted",
      canAskAgain: false,
    })),
    getNotificationPermissionStatus: vi.fn(async () => ({
      granted: true,
      status: "granted",
      canAskAgain: false,
    })),
    notifyCompletion: vi.fn(async () => undefined),
  },
}));

import { AndroidLocalProvider } from "../platform/android/localProvider";

type ProviderInternals = {
  runTask(taskId: number): Promise<void>;
  retryTask(projectId: number, taskId: number): Promise<unknown>;
  generateOutline(
    projectId: number,
    payload: Record<string, unknown>,
    taskId: number,
    inputHash: string,
  ): Promise<{ filename: string; content: string }>;
  selectLessonFiles(projectId: number, outline: string): Promise<void>;
  callLLM: ReturnType<typeof vi.fn>;
  getProject(projectId: number): Promise<Record<string, unknown>>;
  getPrompts(): Promise<Record<string, string>>;
  getLLMSettings(): Promise<Record<string, unknown>>;
  ensureNotificationPermission(): Promise<void>;
  reportProgress(): Promise<void>;
  upsertCourse(projectId: number, filename: string, content: string): Promise<void>;
  ensureCourseNode(): Promise<void>;
  getTask(projectId: number, taskId: number): Promise<Record<string, unknown>>;
};

function taskRow(
  id: number,
  taskType: "outline" | "file_lesson" | "outline_lesson",
  checkpoint: Record<string, unknown>,
) {
  return {
    id,
    project_id: 1,
    task_type: taskType,
    input_hash: "input-hash",
    source_path: taskType === "file_lesson" ? "src/example.ts" : "",
    status: "failed",
    payload_json: JSON.stringify({
      path: "src/example.ts",
      mode: "brief",
      lesson_number: 3,
      title: "第三课",
      instructions: "",
      _checkpoint: checkpoint,
    }),
  };
}

function createProvider() {
  const provider = new AndroidLocalProvider() as unknown as ProviderInternals;
  provider.callLLM = vi.fn();
  provider.getProject = vi.fn(async () => ({
    id: 1,
    name: "Atlas",
    project_type: "learning_plan",
  }));
  provider.getPrompts = vi.fn(async () => ({
    "prompt.system": "system",
    "prompt.learning_plan.lesson": "lesson",
  }));
  provider.getLLMSettings = vi.fn(async () => ({
    provider: "deepseek",
    model: "deepseek-chat",
  }));
  provider.ensureNotificationPermission = vi.fn(async () => undefined);
  provider.reportProgress = vi.fn(async () => undefined);
  provider.upsertCourse = vi.fn(async (_projectId, filename, content) => {
    harness.writes.push({ filename, content });
  });
  provider.ensureCourseNode = vi.fn(async () => undefined);
  return provider;
}

beforeEach(() => {
  harness.tasks.clear();
  harness.writes.length = 0;
  vi.clearAllMocks();
});

describe("Android generation checkpoint production runTask", () => {
  it("does not complete a repository outline before lesson files are persisted", async () => {
    const provider = createProvider();
    provider.getProject = vi.fn(async () => ({
      id: 1,
      name: "Atlas",
      project_type: "repository",
    }));
    provider.getPrompts = vi.fn(async () => ({
      "prompt.system": "system",
      "prompt.outline": "outline {model} {scope_text} {user_instructions} {prompt_input}",
    }));
    provider.callLLM.mockResolvedValue("# Outline\n\n### 第 1 课：Start\n\nRead the entry point.");
    let releaseSelection: (() => void) | undefined;
    provider.selectLessonFiles = vi.fn(() => new Promise<void>((resolve) => {
      releaseSelection = resolve;
    }));

    let completed = false;
    const pending = provider.generateOutline(
      1,
      { scope: { type: "full_project", paths: [] }, instructions: "" },
      9,
      "outline-hash",
    ).then((value) => {
      completed = true;
      return value;
    });
    await vi.waitFor(() => expect(provider.selectLessonFiles).toHaveBeenCalledTimes(1));
    expect(completed).toBe(false);
    releaseSelection?.();
    await pending;
    expect(completed).toBe(true);
  });

  it("completes outline from checkpoint with zero LLM calls and slims payload", async () => {
    const checkpoint = {
      version: 1,
      taskType: "outline",
      inputHash: "input-hash",
      updatedAt: "2026-01-01",
      generated: true,
      generatedContent: "# Restored outline",
    };
    harness.tasks.set(1, taskRow(1, "outline", checkpoint));
    const provider = createProvider();
    await provider.runTask(1);

    expect(provider.callLLM).toHaveBeenCalledTimes(0);
    expect(harness.writes[0]).toMatchObject({ filename: "outline.md" });
    expect(harness.writes[0].content).toContain("Restored outline");
    expect(harness.tasks.get(1)?.status).toBe("completed");
    const payload = JSON.parse(String(harness.tasks.get(1)?.payload_json));
    expect(payload._checkpoint).toMatchObject({ completed: true, outputPath: "outline.md" });
    expect(payload._checkpoint.generatedContent).toBeUndefined();
  });

  it("completes file lesson from checkpoint with zero LLM calls", async () => {
    const checkpoint = {
      version: 1,
      taskType: "file_lesson",
      inputHash: "input-hash",
      updatedAt: "2026-01-01",
      generated: true,
      generatedContent: "# Restored file lesson",
    };
    harness.tasks.set(2, taskRow(2, "file_lesson", checkpoint));
    const provider = createProvider();
    await provider.runTask(2);

    expect(provider.callLLM).toHaveBeenCalledTimes(0);
    expect(harness.writes[0].filename).toContain("src_example.ts_brief.md");
    expect(harness.tasks.get(2)?.status).toBe("completed");
  });

  it("generates only the missing third section and preserves output order", async () => {
    const sections = [1, 2, 3, 4].map((number) => ({
      title: `Section ${number}`,
      items: [{ name: `item${number}`, kind: "concept", focus: "explain" }],
    }));
    const checkpoint = {
      version: 1,
      taskType: "outline_lesson",
      inputHash: "input-hash",
      updatedAt: "2026-01-01",
      plan: {
        lesson_title: "第三课",
        position: "middle",
        objectives: ["learn"],
        sections,
        textbooks: [],
      },
      generatedByIndex: {
        0: "## Section 1\n### item1",
        1: "## Section 2\n### item2",
        3: "## Section 4\n### item4",
      },
      repairGenerated: "## Existing repair",
    };
    harness.tasks.set(3, taskRow(3, "outline_lesson", checkpoint));
    const provider = createProvider();
    provider.callLLM.mockResolvedValue("## Section 3\n### item3\ncomplete");
    await provider.runTask(3);

    expect(provider.callLLM).toHaveBeenCalledTimes(1);
    const output = harness.writes[0].content;
    expect(output.indexOf("Section 1")).toBeLessThan(output.indexOf("Section 2"));
    expect(output.indexOf("Section 2")).toBeLessThan(output.indexOf("Section 3"));
    expect(output.indexOf("Section 3")).toBeLessThan(output.indexOf("Section 4"));
    expect(harness.tasks.get(3)?.status).toBe("completed");
  });

  it("reuses an existing repair checkpoint without another LLM call", async () => {
    const sections = [1, 2, 3, 4].map((number) => ({
      title: `Section ${number}`,
      items: [{ name: `item${number}`, kind: "concept", focus: "explain" }],
    }));
    const checkpoint = {
      version: 1,
      taskType: "outline_lesson",
      inputHash: "input-hash",
      updatedAt: "2026-01-01",
      plan: {
        lesson_title: "第三课",
        position: "middle",
        objectives: ["learn"],
        sections,
        textbooks: [],
      },
      generatedByIndex: {
        0: "## Section 1",
        1: "## Section 2",
        2: "## Section 3",
        3: "## Section 4",
      },
      repairGenerated: "## Repair\n### item1\n### item2\n### item3\n### item4",
    };
    harness.tasks.set(4, taskRow(4, "outline_lesson", checkpoint));
    const provider = createProvider();
    await provider.runTask(4);

    expect(provider.callLLM).toHaveBeenCalledTimes(0);
    expect(harness.writes[0].content).toContain("### item4");
    expect(harness.tasks.get(4)?.status).toBe("completed");
  });

  it("retry keeps the original task id and does not insert a replacement task", async () => {
    harness.tasks.set(5, taskRow(5, "outline", {
      version: 1,
      taskType: "outline",
      inputHash: "input-hash",
      updatedAt: "2026-01-01",
      generated: true,
      generatedContent: "# Ready",
    }));
    const provider = createProvider();
    provider.getTask = vi.fn(async () => ({
      id: 5,
      project_id: 1,
      status: String(harness.tasks.get(5)?.status),
    }));
    const runSpy = vi.spyOn(provider, "runTask").mockResolvedValue();

    await provider.retryTask(1, 5);
    expect(runSpy).toHaveBeenCalledWith(5);
    expect([...harness.tasks.keys()]).toEqual([5]);
  });
});
