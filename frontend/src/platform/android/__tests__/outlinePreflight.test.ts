import { describe, expect, it, vi } from "vitest";
import { AndroidLocalProvider } from "../localProvider";

type ProviderInternals = {
  callLLM: ReturnType<typeof vi.fn>;
  getLLMSettings: ReturnType<typeof vi.fn>;
  getPrompts: ReturnType<typeof vi.fn>;
  getProject: ReturnType<typeof vi.fn>;
  getLearnerPreferences: ReturnType<typeof vi.fn>;
  projectContext: ReturnType<typeof vi.fn>;
  queueTask: ReturnType<typeof vi.fn>;
};

type TestProvider = ProviderInternals & {
  request: (path: string, init?: RequestInit) => Promise<unknown>;
};

function createProvider() {
  const provider = new AndroidLocalProvider() as unknown as TestProvider;
  provider.callLLM = vi.fn(async () => "");
  provider.getLLMSettings = vi.fn(async () => ({ provider: "deepseek", model: "deepseek-chat" }));
  provider.getPrompts = vi.fn(async () => ({
    "prompt.system": "你是课程规划助手。",
    "prompt.outline.questionnaire": "为学习者生成问卷：{scope_text} {user_instructions} {preferences_summary}",
  }));
  provider.getProject = vi.fn(async () => ({ id: 7, name: "Atlas", project_type: "learning_plan" }));
  provider.getLearnerPreferences = vi.fn(async () => ({
    prerequisiteDetail: "无",
    answerDepth: "中等",
    codeRatio: "均衡",
  }));
  provider.projectContext = vi.fn(async () => "");
  provider.queueTask = vi.fn(async (_projectId: number, _type: string, payload: Record<string, unknown>) => ({
    id: 1,
    task_type: "outline",
    status: "pending",
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

describe("Android outline preflight route contract", () => {
  it("parses LLM questionnaire JSON into OutlineQuestion[] with options cap", async () => {
    const provider = createProvider();
    provider.callLLM = vi.fn(async () => JSON.stringify([
      {
        question: "你的编程经验？",
        question_type: "single_choice",
        dimension: "prerequisite",
        options: ["零基础", "入门", "熟练", "深入"],
        rationale: "决定起点",
      },
      {
        question: "希望讲解多深？",
        question_type: "text",
        dimension: "depth",
        options: [],
        rationale: "决定密度",
      },
    ]));

    const result = await request<any>(
      provider,
      "/projects/7/outline/generate/preflight",
      "POST",
      { scope: { type: "full_project" }, instructions: "想重点学网络" },
    );

    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].question).toBe("你的编程经验？");
    expect(result.questions[0].question_type).toBe("single_choice");
    expect(result.questions[0].options).toEqual(["零基础", "入门", "熟练", "深入"]);
    expect(result.preflight_id).toMatch(/^pf:7:/);
    expect(provider.callLLM).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: "system" }),
      expect.objectContaining({ role: "user" }),
    ]));
  });

  it("strips fenced code blocks from LLM output", async () => {
    const provider = createProvider();
    provider.callLLM = vi.fn(async () => "```json\n[{ \"question\": \"偏好？\", \"options\": [\"A\", \"B\"] }]\n```");

    const result = await request<any>(
      provider,
      "/projects/7/outline/generate/preflight",
      "POST",
      { scope: { type: "learning_plan" }, instructions: "" },
    );

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].question).toBe("偏好？");
  });

  it("returns error payload instead of throwing when LLM output is invalid", async () => {
    const provider = createProvider();
    provider.callLLM = vi.fn(async () => "not json at all");

    const result = await request<any>(
      provider,
      "/projects/7/outline/generate/preflight",
      "POST",
      { scope: { type: "full_project" }, instructions: "" },
    );

    expect(result.status).toBe("error");
    expect(result.questions).toEqual([]);
    expect(result.message).toContain("not valid JSON");
  });

  it("returns error when questionnaire prompt template is missing", async () => {
    const provider = createProvider();
    provider.getPrompts = vi.fn(async () => ({}));

    const result = await request<any>(
      provider,
      "/projects/7/outline/generate/preflight",
      "POST",
      { scope: { type: "full_project" }, instructions: "" },
    );

    expect(result.status).toBe("error");
    expect(result.message).toContain("问卷提示词缺失");
    expect(provider.callLLM).not.toHaveBeenCalled();
  });
});

describe("Android outline confirm route contract", () => {
  it("queues outline task with answers serialized into instructions", async () => {
    const provider = createProvider();

    const result = await request<any>(
      provider,
      "/projects/7/outline/generate/confirm",
      "POST",
      {
        scope: { type: "learning_plan" },
        instructions: "按官方文档来",
        answers: [
          { question: "你的编程经验？", question_type: "single_choice", dimension: "prerequisite", selected: "入门" },
          { question: "希望讲解多深？", question_type: "text", dimension: "depth", selected: "深入浅出" },
        ],
      },
    );

    expect(result.task_type).toBe("outline");
    expect(provider.queueTask).toHaveBeenCalledWith(
      7,
      "outline",
      expect.objectContaining({
        instructions: expect.stringContaining("按官方文档来"),
      }),
    );
    const payload = provider.queueTask.mock.calls[0][2] as { instructions: string };
    expect(payload.instructions).toContain("<learning_intent>");
    expect(payload.instructions).toContain("你的编程经验？ [prerequisite]：入门");
    expect(payload.instructions).toContain("希望讲解多深？ [depth]：深入浅出");
    expect(payload.instructions).toContain("</learning_intent>");
  });

  it("passes instructions through untouched when answers are empty", async () => {
    const provider = createProvider();

    await request(
      provider,
      "/projects/7/outline/generate/confirm",
      "POST",
      { scope: { type: "full_project" }, instructions: "不要问卷", answers: [] },
    );

    const payload = provider.queueTask.mock.calls[0][2] as { instructions: string };
    expect(payload.instructions).toBe("不要问卷");
    expect(payload.instructions).not.toContain("<learning_intent>");
  });
});
