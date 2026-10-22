// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningSettings } from "../../api/client";
import promptDefaults from "./default-prompts.json";

const harness = vi.hoisted(() => ({ sql: null as unknown as DatabaseSync }));
vi.mock("./database", () => ({ MobileDatabase: class {
  async query(sql: string, params: unknown[] = []) { return harness.sql.prepare(sql).all(...params as []); }
  async run(sql: string, params: unknown[] = []) { return Number(harness.sql.prepare(sql).run(...params as []).lastInsertRowid); }
} }));
import { AndroidLocalProvider } from "./localProvider";

type Message = { role: string; content: string };
type ProviderHarness = {
  request: AndroidLocalProvider["request"];
  forest: { context: (project: number, requirements: string[]) => Promise<string> };
  teachingContext: (project: number, requirements?: string[]) => Promise<string>;
  callLLM: (messages: Message[]) => Promise<string>;
  reportProgress: ReturnType<typeof vi.fn>;
  generateDetailedLesson: (project: number, payload: Record<string, unknown>, task: number, base: string, system: string, hash: string) => Promise<{ content: string }>;
  generateOutline: (project: number, payload: Record<string, unknown>, task: number, hash: string) => Promise<{ content: string }>;
  getLLMSettings: ReturnType<typeof vi.fn>;
  getProject: ReturnType<typeof vi.fn>;
  getPrompts: ReturnType<typeof vi.fn>;
  runTask: ReturnType<typeof vi.fn>;
};
function provider(): ProviderHarness {
  const result = new AndroidLocalProvider() as unknown as ProviderHarness;
  result.forest.context = vi.fn(async (_project, requirements) => `<teaching_context><knowledge_tree>完整知识树</knowledge_tree><user_requirements>${requirements.join("；")}</user_requirements></teaching_context>`);
  result.reportProgress = vi.fn();
  return result;
}
/** Valid same-response section manifest so a lesson may be published. */
function sectionManifest(index: number, quote: string): string {
  const payload = {
    schema_version: 2,
    concepts: [{
      ref: `c${index}`, existing_id: null, name: `知识点 ${index + 1}`,
      domain: "general", scope: "global", parent_ref: null, aliases: [],
    }],
    coverage: [{ concept_ref: `c${index}`, aspect: "说明", kind: "explained", dimension: "conceptual", core: true, quote }],
    terms: [],
  };
  return `\n\n<!-- codecourse-teaching: ${JSON.stringify(payload)} -->`;
}

async function save(result: ProviderHarness, language: unknown) {
  return result.request<LearningSettings>("/settings/learning", {
    method: "PUT", body: JSON.stringify({ primary_programming_language: language }),
  });
}

beforeEach(() => {
  harness.sql = new DatabaseSync(":memory:");
  harness.sql.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE prompt_revisions(id INTEGER PRIMARY KEY,prompt_key,value,source,created_at);
    CREATE TABLE generation_tasks(id INTEGER PRIMARY KEY,project_id,task_type,status,source_path,mode,model,prompt_version,input_hash,payload_json,progress_current,progress_total,stage_label,created_at,updated_at,output_path);
    CREATE TABLE course_files(project_id,filename);
    CREATE TABLE generation_prompt_snapshots(project_id,task_id,section_number,prompt_version,messages_json,updated_at,UNIQUE(task_id,section_number));
    INSERT INTO generation_tasks(id) VALUES(1);`);
});
afterEach(() => { harness.sql.close(); });

describe("Android learning settings", () => {
  it("defaults to automatic, persists across provider instances, trims and clears", async () => {
    const first = provider();
    expect(await first.request("/settings/learning")).toEqual({ primary_programming_language: "" });
    expect(await save(first, "  Elixir  ")).toEqual({ primary_programming_language: "Elixir" });
    const reopened = provider();
    expect(await reopened.request("/settings/learning")).toEqual({ primary_programming_language: "Elixir" });
    expect(await reopened.teachingContext(7, ["使用 Java 解释"])).toContain('主要编程语言："Elixir"');
    const context = await reopened.teachingContext(7, ["使用 Java 解释"]);
    expect(context).toContain("完整知识树");
    expect(context).toContain("使用 Java 解释");
    expect(context).toContain("当前明确要求、课程目标语言及所讨论语言特性优先");
    expect(context).toContain("保留真实源码语言");
    await save(reopened, "  ");
    expect(await provider().request("/settings/learning")).toEqual({ primary_programming_language: "" });
    expect(await reopened.teachingContext(7)).not.toContain("programming_language_preference");
  });

  it("rejects invalid values without replacing a saved language", async () => {
    const result = provider();
    await save(result, "Python");
    await expect(save(result, "a".repeat(81))).rejects.toThrow("80");
    await expect(save(result, 42)).rejects.toThrow("编程语言");
    expect(await result.request("/settings/learning")).toEqual({ primary_programming_language: "Python" });
  });

  it("freezes the queued language, ignores caller snapshots, and separates the completed-course cache", async () => {
    const result = provider();
    result.getLLMSettings = vi.fn(async () => ({ model: "test" }));
    result.getProject = vi.fn(async () => ({ project_type: "learning_plan" }));
    result.getPrompts = vi.fn(async () => promptDefaults);
    result.runTask = vi.fn();
    await save(result, "Python");
    const first = await result.request<{ id: number; input_hash: string; payload_json: string }>("/projects/7/outline/generate", {
      method: "POST", body: JSON.stringify({ _learning_settings: { primary_programming_language: "C++" } }),
    });
    await save(result, "C++");
    result.callLLM = vi.fn(async (messages: Message[]) => messages.map(message => message.content).join("\n").includes('主要编程语言："Python"') ? "# Python 课程" : "# C++ 课程");
    const generated = await result.generateOutline(7, JSON.parse(first.payload_json), first.id, first.input_hash);
    expect(generated.content).toContain("Python 课程");
    expect(generated.content).not.toContain("C++ 课程");
    harness.sql.prepare("UPDATE generation_tasks SET status='completed',output_path='outline.md' WHERE id=?").run(first.id);
    harness.sql.prepare("INSERT INTO course_files VALUES(7,'outline.md')").run();
    await save(result, "Python");
    const cached = await result.request<{ id: number }>("/projects/7/outline/generate", { method: "POST", body: "{}" });
    expect(cached.id).toBe(first.id);
    await save(result, "Java");
    const changed = await result.request<{ id: number; input_hash: string }>("/projects/7/outline/generate", { method: "POST", body: "{}" });
    expect(changed.id).not.toBe(first.id);
    expect(changed.input_hash).not.toBe(first.input_hash);
  });

  it.each([1, 11])("lets AI plan %i sections and sends the saved language to every course call", async (sectionCount) => {
    const result = provider();
    await save(result, "Rust");
    const sections = Array.from({ length: sectionCount }, (_, index) => ({
      title: `主题 ${index + 1}`, items: [{ name: `知识项 ${index + 1}`, kind: "concept", focus: "" }],
    }));
    const call = vi.fn(async (messages: Message[]) => {
      const user = messages.find(message => message.role === "user")!.content;
      if (user.startsWith("你是一位课程设计师")) {
        // Editing settings while this task is running applies to future work;
        // all sections of the current generation use the captured Rust context.
        await save(result, "Java");
        return JSON.stringify({ lesson_title: "示例课程", sections, textbooks: [] });
      }
      const section = sections.find(entry => user.includes(`章节标题：${entry.title}\n`));
      if (!section) return "";
      const index = sections.indexOf(section);
      const quote = `${section.items[0].name} 的说明。`;
      return `## ${section.title}\n\n${quote}` + sectionManifest(index, quote);
    });
    result.callLLM = call;
    const output = await result.generateDetailedLesson(7, { title: "示例课程", lesson_number: 1, instructions: "重点讲语言特性" }, 1, "课程材料", "讲师", "hash");
    expect(call).toHaveBeenCalledTimes(sectionCount + 2);
    for (const [messages] of call.mock.calls) {
      expect(messages.map(message => message.content).join("\n")).toContain('主要编程语言："Rust"');
    }
    expect(output.content).toContain(`知识项 ${sectionCount} 的说明。`);
    expect(call.mock.calls[0][0][1].content).not.toContain("4-10");
    expect(call.mock.calls.at(-1)![0][1].content).toContain("可以不生成综合案例、误区、练习或总结");
  });

  it("rebuilds partial sections after a changed language when a task resumes", async () => {
    const result = provider();
    const sections = [{ title: "主题", items: [{ name: "知识项", kind: "concept", focus: "" }] }];
    const call = vi.fn(async (messages: Message[]) => {
      const user = messages.find(message => message.role === "user")!.content;
      if (user.startsWith("你是一位课程设计师")) return JSON.stringify({ lesson_title: "示例课程", sections, textbooks: [] });
      if (!user.startsWith("你正在编写")) return "";
      const quote = "知识项的新版说明。";
      return "## 主题\n\n" + quote + sectionManifest(0, quote);
    });
    result.callLLM = call;
    const payload = { title: "示例课程", lesson_number: 1 };
    await save(result, "Rust");
    await result.generateDetailedLesson(7, payload, 1, "材料", "讲师", "same-task");
    const row = harness.sql.prepare("SELECT payload_json FROM generation_tasks WHERE id=1").get()!;
    const resumed = JSON.parse(String(row.payload_json));
    resumed._checkpoint.generatedByIndex = {
      "0": "## 主题\n\n知识项的 Rust 旧版说明。" + sectionManifest(0, "知识项的 Rust 旧版说明。"),
    };
    resumed._checkpoint.repairGenerated = null;
    call.mockClear();
    await save(result, "Python");
    const frozen = await result.generateDetailedLesson(7, resumed, 1, "材料", "讲师", "same-task");
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0].map(message => message.content).join("\n")).toContain('主要编程语言："Rust"');
    expect(frozen.content).toContain("Rust 旧版说明");
    // An older task without a preference snapshot safely rebuilds under its
    // newly captured preference instead of mixing the old partial sections.
    delete resumed._learning_settings;
    call.mockClear();
    const output = await result.generateDetailedLesson(7, resumed, 1, "材料", "讲师", "same-task");
    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls[0][0][1].content).toContain("你是一位课程设计师");
    for (const [messages] of call.mock.calls) expect(messages.map(message => message.content).join("\n")).toContain('主要编程语言："Python"');
    expect(output.content).not.toContain("Rust 旧版说明");
    expect(output.content).toContain("新版说明");
  });

  it("upgrades known old defaults while preserving appended requirements and unknown custom prompts", async () => {
    const old = "你是一名资深讲师，负责生成项目学习材料、自定义学习计划和 AI 助手回答。\n\n必须遵守以下规则：\n\n1. 回答应优先解决当前问题，不要加入与当前目标无关的背景知识。\n2. 仓库项目的关键判断尽量引用真实路径和符号；学习计划引用明确的知识项。\n3. 能从材料中明确判断的内容直接说明，不要反复使用\"可能\"\"也许\"等模糊表达。\n4. 材料不足、无法确认或存在冲突时，集中说明证据缺口和验证方法。\n5. 讲解方式与范围服从用户当前明确要求和带来源的历史原文要求；不读取固定风格滑块、诊断分数或推测偏好。\n6. 不默认学习者是初学者，也不默认已经掌握；只依据当前问题和学习证据决定解释范围。";
    const suffix = "请用 Kotlin 举例。";
    harness.sql.prepare("INSERT INTO settings VALUES(?,?)").run("prompt.system", `${old}\n\n${suffix}`);
    const custom = "用户自己的完整问答模板：{question} {context_text}";
    harness.sql.prepare("INSERT INTO settings VALUES(?,?)").run("prompt.qa.answer", custom);
    const result = await provider().request<Record<string, string>>("/settings/prompts");
    expect(result["prompt.qa.answer"]).toBe(custom);
    expect(result["prompt.system"]).toBe(`${promptDefaults["prompt.system"].trimEnd()}\n\n${suffix}`);
    expect(harness.sql.prepare("SELECT value FROM settings WHERE key=?").get("prompt_schema_version.prompt.system")).toMatchObject({ value: "5" });
    expect(harness.sql.prepare("SELECT source FROM prompt_revisions").all()).toEqual([{ source: "migration" }]);
  });
  it("migrates a default ending in a newline while preserving appended language instructions", async () => {
    const old = "请根据用户的学习目标生成一份路线型学习总纲。\n\n这是不绑定 GitHub 仓库的“学习计划”项目。不得输出文件路径、README、目录树、代码索引、RAG 片段、项目调用关系或“应该阅读哪些文件”等内容。\n\n生成原则：\n1. 安排 4-10 节有明确先后依赖的课程，不在总纲中展开完整课文。\n2. 总纲必须包含：适合人群、前置知识、可验证学习目标、课程路线、每课知识清单、每课学习产出和自测标准。\n3. 编程主题按函数、API、语法、数据结构和机制组织；非编程主题按概念、原理、步骤、公式和案例组织。\n4. 每课列出后续详细课件必须逐项讲清楚的知识，不得使用“了解相关内容”等空泛表述。\n5. 每课只描述适合参阅的知识主题，不在正文中自行输出书名、作者、版次、章节号或页码；系统会从经过校验的正式出版物目录附加可验证参考。\n6. 使用原创表述，不复制长段原文，不声称已访问或阅读教材全文。\n7. 学习目标和自测标准必须可观察、可回答或可完成。\n\n输出结构：\n# 学习计划总纲\n\n> 教材说明：经过系统校验的书目会统一附加在总纲末尾，正文只描述相关知识主题。\n\n## 适合谁学\n## 前置知识\n## 学习目标\n## 课程路线\n\n每节课必须使用三级标题，确保系统能生成课件：\n\n### 第 X 课：课程名称\n\n- 本课定位\n- 前置依赖\n- 必须完整讲解的函数/API/语法，或概念/公式/方法\n- 学习产出\n- 自测标准\n- 建议参阅主题：只写本课相关的知识主题，不写书名或章节号\n\n## 完成标准\n## 不确定项\n\n用户要求：\n{user_instructions}\n";
    const suffix = "请使用 TypeScript 示例。";
    harness.sql.prepare("INSERT INTO settings VALUES(?,?)").run("prompt.learning_plan.outline", `${old}\n\n${suffix}`);
    const result = await provider().request<Record<string, string>>("/settings/prompts");
    expect(result["prompt.learning_plan.outline"]).toBe(`${promptDefaults["prompt.learning_plan.outline"].trimEnd()}\n\n${suffix}`);
    expect(harness.sql.prepare("SELECT source FROM prompt_revisions").all()).toEqual([{ source: "migration" }]);
  });

});
