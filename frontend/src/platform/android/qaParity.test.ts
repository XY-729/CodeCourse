// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { QAAskPayload, QARecord, LLMSettings } from "../../api/client";

const harness = vi.hoisted(() => ({ sql: null as unknown as DatabaseSync, stream: vi.fn(), http: vi.fn(), readRepo: vi.fn(), readGenerated: vi.fn() }));
vi.mock("./llmStream", () => ({ streamAndroidLLM: harness.stream }));
vi.mock("@capacitor/core", async original => ({ ...await original<typeof import("@capacitor/core")>(), CapacitorHttp: { request: harness.http } }));
vi.mock("../runtime", () => ({ CodeCourseSecureStore: { get: async () => ({ value: "test-only" }) }, CodeCourseNative: {} }));
vi.mock("./workspace", async original => ({ ...await original<typeof import("./workspace")>(), readRepoFile: harness.readRepo, readGeneratedFile: harness.readGenerated }));
vi.mock("./database", () => ({ MobileDatabase: class {
  async query(sql: string, params: unknown[] = []) { return harness.sql.prepare(sql).all(...params as []); }
  async run(sql: string, params: unknown[] = []) { return Number(harness.sql.prepare(sql).run(...params as []).lastInsertRowid); }
  queryInTx = this.query; runInTx = this.run;
  async transaction<T>(work: () => Promise<T>) { harness.sql.exec("BEGIN"); try { const result = await work(); harness.sql.exec("COMMIT"); return result; } catch (error) { harness.sql.exec("ROLLBACK"); throw error; } }
} }));
import { AndroidLocalProvider } from "./localProvider";

type Internals = {
  courseCompletion: { context: ReturnType<typeof vi.fn> };
  getPrompts: ReturnType<typeof vi.fn>;
  getLLMSettings: () => Promise<LLMSettings>;
  getProject: ReturnType<typeof vi.fn>;
  getLearnerPreferences: ReturnType<typeof vi.fn>;
  setting: ReturnType<typeof vi.fn>;
  setSetting: ReturnType<typeof vi.fn>;
  upsertCourse: ReturnType<typeof vi.fn>;
  getQA: (project: number, id: number) => Promise<QARecord>;
  listQAThreads: ReturnType<typeof vi.fn>;
  getCurrentHandoff: ReturnType<typeof vi.fn>;
  termLearningContext: ReturnType<typeof vi.fn>;
  postprocessAnswer: ReturnType<typeof vi.fn>;
  teacherStrategyForQuestion: ReturnType<typeof vi.fn>;
  runAndroidObserver: ReturnType<typeof vi.fn>;
  resumeAnswerJobs: ReturnType<typeof vi.fn>;
  processAnswerJobs: () => Promise<void>;
  callLLM: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  sourceContext: (project: number, payload: QAAskPayload) => Promise<string>;
  search: ReturnType<typeof vi.fn>;
};
const payload: QAAskPayload = { source_type: "file", source_path: "main.ts", selected_text: "return 1", question: "解释 Python 的 return", provider: "test", base_url: "https://model.test", model: "configured", selection_range: { start_line: 2, start_column: 1, end_line: 2, end_column: 9 } };
let provider: Pick<AndroidLocalProvider, "askQuestionStream"> & Internals;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", new EventTarget());
  harness.sql = new DatabaseSync(":memory:");
  harness.sql.exec(`CREATE TABLE qa_records(id INTEGER PRIMARY KEY,project_id,session_id,parent_qa_id,relation_type,source_type,source_path,display_title,selected_text,question,answer_md,provider,model,output_path,retrieval_trace,favorite,created_at,updated_at,selection_range_json);
    CREATE TABLE qa_postprocess_jobs(qa_record_id INTEGER PRIMARY KEY,project_id,payload_json,context_snapshot,metadata_json,applied_plan_json,status DEFAULT 'pending',evidence_done DEFAULT 0,planner_done DEFAULT 0,observer_done DEFAULT 0,last_error);
    CREATE TABLE learner_inferences(scope_type,scope_id,status,summary,updated_at);
    CREATE TABLE teaching_handoffs(project_id,qa_record_id);
    CREATE TABLE learning_anchors(project_id,term_text,summary,updated_at);
    CREATE TABLE observer_jobs(id,project_id,qa_record_id,status);`);
  provider = new AndroidLocalProvider() as unknown as typeof provider;
  provider.courseCompletion.context = vi.fn(async () => "<completed_course_learning>已学习借用基础</completed_course_learning>");
  provider.getPrompts = vi.fn(async () => ({ "prompt.system": "保留讲解要求", "prompt.qa.answer": "问题：{question}\n材料：{context_text}\n{session_context}" }));
  provider.getLLMSettings = async () => ({ enabled: true, has_api_key: true, provider: "saved", base_url: "https://saved.test", model: "saved", masked_api_key: "***" });
  provider.getProject = vi.fn(async () => ({ id: 1, name: "测试项目", project_type: "repository" }));
  provider.getLearnerPreferences = vi.fn(async () => ({}));
  provider.setting = vi.fn(async () => null);
  provider.setSetting = vi.fn();
  provider.upsertCourse = vi.fn();
  provider.getQA = async (project, id) => {
    const row = harness.sql.prepare("SELECT * FROM qa_records WHERE project_id=? AND id=?").get(project, id);
    if (!row) throw new Error("回答不存在");
    return { ...row, selection_range: JSON.parse(String(row.selection_range_json)) } as QARecord;
  };
  provider.listQAThreads = vi.fn(async () => []);
  provider.getCurrentHandoff = vi.fn(async () => null);
  provider.termLearningContext = vi.fn(async () => "已有画像");
  provider.postprocessAnswer = vi.fn();
  provider.teacherStrategyForQuestion = vi.fn(async () => null);
  provider.runAndroidObserver = vi.fn();
  provider.resumeAnswerJobs = vi.fn();
  provider.search = vi.fn(async () => []);
  harness.readRepo.mockResolvedValue("授权参考文件正文");
  harness.readGenerated.mockResolvedValue("当前文档正文");
});
afterEach(() => { harness.sql.close(); vi.unstubAllGlobals(); });

it("publishes body before save, preserves selection, provider and model, and defers every model analysis", async () => {
  let finish!: () => void;
  harness.stream.mockImplementation((_options, onDelta) => { onDelta("**首段**"); return new Promise<string>(resolve => { finish = () => resolve("**首段**"); }); });
  const onDelta = vi.fn();
  const pending = provider.askQuestionStream(1, payload, { onDelta });
  await vi.waitFor(() => expect(onDelta).toHaveBeenCalledWith("**首段**"));
  expect(harness.sql.prepare("SELECT * FROM qa_records").all()).toHaveLength(0);
  expect(provider.teacherStrategyForQuestion).not.toHaveBeenCalled();
  expect(harness.readRepo).not.toHaveBeenCalled();
  expect(harness.readGenerated).not.toHaveBeenCalled();
  finish();
  const record = await pending;
  expect(record).toMatchObject({ session_id: record.id, provider: "test", model: "configured", answer_md: "**首段**", selection_range: payload.selection_range });
  expect(harness.sql.prepare("SELECT * FROM qa_postprocess_jobs").all()).toHaveLength(1);
  const sent = JSON.parse(harness.stream.mock.calls[0][0].body);
  expect(sent).toMatchObject({ stream: true, model: "configured", max_tokens: 65536 });
  expect(sent.messages[0].content).toContain("保留讲解要求");
  expect(sent.messages[1].content).toContain("已学习借用基础");
});

it("does not save or enqueue a canceled answer", async () => {
  const controller = new AbortController();
  harness.stream.mockImplementation(async (_options, onDelta) => { onDelta("未完成正文"); controller.abort(); return "未完成正文"; });
  await expect(provider.askQuestionStream(1, payload, {}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(harness.sql.prepare("SELECT * FROM qa_records").all()).toHaveLength(0);
  expect(harness.sql.prepare("SELECT * FROM qa_postprocess_jobs").all()).toHaveLength(0);
});

it("keeps explicit reference files independent of the opt-in document and retrieval", async () => {
  const context = await provider.sourceContext(1, { ...payload, include_context: false, context_files: ["chosen.ts"] });
  expect(context).toContain("授权参考文件正文");
  expect(harness.readRepo).toHaveBeenCalledExactlyOnceWith(1, "chosen.ts");
  expect(provider.search).not.toHaveBeenCalled();
  await provider.sourceContext(1, { ...payload, include_context: true });
  expect(harness.readRepo).toHaveBeenCalledWith(1, "main.ts");
  expect(provider.search).toHaveBeenCalledTimes(1);
});

it("lets new background model calls yield until the foreground answer saves", async () => {
  let finish!: () => void;
  harness.stream.mockImplementation((_options, onDelta) => { onDelta("正文"); return new Promise<string>(resolve => { finish = () => resolve("正文"); }); });
  harness.http.mockResolvedValue({ status: 200, data: { choices: [{ message: { content: "后台结果" } }] } });
  const answer = provider.askQuestionStream(1, payload, {});
  await vi.waitFor(() => expect(harness.stream).toHaveBeenCalled());
  const background = provider.callLLM([{ role: "user", content: "后台任务" }]);
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(harness.http).not.toHaveBeenCalled();
  finish(); await answer;
  await expect(background).resolves.toBe("后台结果");
});

it("resumes persisted metadata without another model call after a partial failure", async () => {
  const onEnriched = vi.fn();
  window.addEventListener("codecourse:qa-enriched", onEnriched);
  harness.stream.mockImplementation(async (_options, onDelta) => { onDelta("正文"); return "正文"; });
  const record = await provider.askQuestionStream(1, payload, {});
  const metadata = 'TITLE: 标题\nTERMS: []\nHANDOFF: {"engagement":"utility","continuity":"preserve","topic":"主题","is_new_topic":true,"new_topic":"主题","existing_topic":"","used_prior_context":false}';
  harness.sql.prepare("UPDATE qa_postprocess_jobs SET metadata_json=?,evidence_done=1,planner_done=1,status='failed' WHERE qa_record_id=?").run(metadata, record.id);
  await provider.processAnswerJobs();
  expect(harness.http).not.toHaveBeenCalled();
  expect(provider.postprocessAnswer).not.toHaveBeenCalled();
  expect(provider.teacherStrategyForQuestion).not.toHaveBeenCalled();
  expect(provider.runAndroidObserver).toHaveBeenCalledTimes(1);
  expect(harness.sql.prepare("SELECT status FROM qa_postprocess_jobs").get()).toMatchObject({ status: "completed" });
  expect(onEnriched).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ detail: { projectId: 1, qaRecordId: record.id } }));
});
