import { CapacitorHttp, HttpResponse } from "@capacitor/core";
import { CodeCourseNative, CodeCourseSecureStore } from "../runtime";
import type { BatteryOptimizationState, NotificationPermissionResult, NotificationPermissionStatus } from "../runtime";
import type { CodeCourseProvider } from "../provider";
import {
  CHECKPOINT_VERSION as CP_VER,
  parseOutlineCheckpoint, parseDetailedLessonCheckpoint,
  courseGroupForTaskType, buildCompletionLabel,
  canRetry, buildSlimCheckpoint, permissionNotice, batteryNotice,
  type ProviderNotice,
  type OutlineCheckpoint, type DetailedLessonCheckpoint,
  type LessonPlan as GsLessonPlan,
} from "./generationState";
import {
  GenerationServiceCoordinator,
  type ProgressSnapshot,
} from "./generationServiceCoordinator";

// Local aliases matching the original localProvider types
type LessonPlan = GsLessonPlan;
type LessonPlanSection = GsLessonPlan["sections"][number];
type LessonPlanItem = LessonPlanSection["items"][number];
import type {
  CourseFile, GenerationTask, HighlightRecord, KnowledgeEdge, KnowledgeGraph, KnowledgeLink, KnowledgeNode,
  LearningAnchor, LearningState, LearningStateUpdate, LLMSettings, OutlinePreflight, OutlineQuestion, OutlineSurveyAnswer, Project, ProjectIndexStatus, ProjectSearchResult,
  QAAskPayload, QARecord, TreeNode,
  PersonalizationConcept, PersonalizationMastery, PersonalizationEvent,
  LearnerPreferences, PersonalizationProfile, LearnerInference,
  KnowledgeStateV2,
} from "../../api/client";
import {
  buildLearnerContext,
  inferPreferenceSignals,
  shouldOfferStyleSurvey,
} from "../../personalization/preferenceEngine";
import { composeSystemPrompt } from "../../personalization/promptContracts";
import {
  buildTeacherPlannerUserPrompt,
  effectiveTeachingPlan,
  parseTeachingPlan,
  TEACHER_PLANNER_SYSTEM_PROMPT,
  type EffectiveTeachingPlan,
} from "../../personalization/teacherPlan";
import {
  previewPromptBundle,
  PROMPT_SCHEMA_VERSION,
  promptTemplateMetadata,
  validatePromptTemplate,
} from "../../personalization/promptTemplateContract";
import { normalizeTerm } from "../../personalization/conceptResolver";
import {
  validateTermCandidate,
  type StructuredTermCandidate,
  type TermCandidateInput,
} from "../../personalization/termCandidate";
import {
  buildObserverPrompt,
  conservativeDomainState,
  isAcceptedDirectEvidence,
  isAcceptedRelation,
  mergeInference,
  parseObserverResult,
  type InferenceState,
  type ObserverResult,
} from "../../personalization/domainInference";
import {
  KNOWLEDGE_POLICY_VERSION,
  resolveKnowledgeState,
  type LearningEvidenceV2,
  type KnowledgeDimension,
} from "../../personalization/knowledgeState";
import {
  assembleLessonFileEvidence,
  type LessonEvidenceRange,
  type ReadableEvidenceFile,
} from "../../generation/lessonEvidence";

type ScopeTypeStr = "global" | "project" | "session";
import promptDefaults from "./default-prompts.json";
import {
  appendValidatedBibliography,
  bibliographyForPrompt,
  bibliographyMarkdown,
  bibliographyMetadataInstruction,
  parseBibliographyMetadata,
  validateBibliographySelections,
} from "./bibliography";
import { AndroidDiagnosticService } from "./diagnosticService";
import { MobileDatabase } from "./database";
import { createAndroidPersonalizationRoutes } from "./personalizationRoutes";
import { dispatchAndroidRoutes } from "./routeRegistry";
import { createAndroidTermRoutes } from "./termRoutes";
import { AndroidTeachingOutcomeService } from "./teachingOutcomeService";
import {
  buildTree, downloadGitHubSnapshot, inferLanguage, readGeneratedFile, readRepoFile, readZipFiles, removeGeneratedFile,
  removeProjectFiles, writeGeneratedFileAtomic, writeRepoFile,
} from "./workspace";

type Row = Record<string, unknown>;

const LEGACY_PROMPT_HASHES: Record<string, string> = {
  "prompt.system": "9492dc15",
  "prompt.outline": "611b81fc",
  "prompt.file_lesson.detailed_expected": "2e09c662",
  "prompt.file_lesson.brief_expected": "43825251",
  "prompt.file_lesson.template": "38c51719",
  "prompt.outline_lesson": "e5332c68",
  "prompt.learning_plan.outline": "9398be36",
  "prompt.learning_plan.lesson": "8b080e0b",
  "prompt.qa.answer": "cfa78f24",
};
const PROMPT_SCHEMA_SETTING_PREFIX = "prompt_schema_version.";

function addOutlineLessonLinks(outline: string, outlinePath?: string): string {
  const START = "<!-- CODECOURSE_LESSON_LINKS_START -->";
  const END = "<!-- CODECOURSE_LESSON_LINKS_END -->";
  const HEADING_RE = /^###\s*第\s*(\d+)\s*课\s*[：:]\s*(.+?)\s*$/gm;
  const TABLE_RE = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|/gm;
  const suffix = outlinePath ? `&outline_path=${encodeURIComponent(outlinePath)}` : "";

  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cleaned = outline.replace(new RegExp(`\\n?${esc(START)}.*?${esc(END)}\\n?`, "s"), "\n").trimEnd();

  const lessons: [number, string][] = [];
  for (const m of cleaned.matchAll(HEADING_RE)) {
    lessons.push([Number(m[1]), m[2].trim()]);
  }
  if (!lessons.length) {
    for (const m of cleaned.matchAll(TABLE_RE)) {
      const t = m[2].trim();
      if (t && t !== "课程名称" && t !== "课程") lessons.push([Number(m[1]), t]);
    }
  }

  if (!lessons.length) return cleaned + "\n";

  const lines = [START, "## 按课生成课件", "> 课件按需生成。点击一节课后会请求模型，并优先使用项目索引中的相关代码片段。", ""];
  for (const [n, t] of lessons) {
    lines.push(`- [生成第 ${n} 课：${t}](https://codecourse.local/generate-lesson/${n}?title=${encodeURIComponent(t)}${suffix})`);
  }
  lines.push(END, "");

  return cleaned + "\n\n" + lines.join("\n");
}

// ---- checkpoint types (from shared generationState) ----
const CHECKPOINT_VERSION = CP_VER;


type TaskOutput = { filename: string; content: string };

const db = new MobileDatabase();
const teachingOutcomes = new AndroidTeachingOutcomeService(db);
const DEFAULT_MODEL = { provider: "deepseek", base_url: "https://api.deepseek.com", model: "deepseek-chat", enabled: false };
const MOBILE_LESSON_CONCURRENCY = 4;
const KNOWN_TECH_TERMS = ["FastAPI", "Pydantic", "Uvicorn", "React", "TypeScript", "JavaScript", "Electron", "SQLite", "FTS5", "Cytoscape", "Monaco", "Tree-sitter", "Docker", "CMake", "Cargo", "WebSocket", "REST", "RAG", "LLM", "API", "Git", "依赖注入", "异步任务", "全文检索", "知识图谱", "调用关系", "路由", "中间件"];

function now(): string { return new Date().toISOString(); }
function bool(value: unknown): boolean { return value === true || value === 1 || value === "1"; }
function decodePath(value: string): string { return value.split("/").map(decodeURIComponent).join("/"); }
function bodyJson(init?: RequestInit): any {
  if (!init?.body || typeof init.body !== "string") return {};
  return JSON.parse(init.body);
}
function titleFromMarkdown(filename: string, content: string): string {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() || filename.replace(/\.md$/i, "");
}
function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function legacyPromptSuffix(key: string, saved: string): string | null {
  const legacyHash = LEGACY_PROMPT_HASHES[key];
  if (!legacyHash) return null;
  if (hashText(saved) === legacyHash) return "";
  const boundaries = [...saved.matchAll(/\n/g)].map((match) => match.index ?? -1);
  for (const boundary of boundaries.reverse()) {
    const prefix = saved.slice(0, boundary).trimEnd();
    if (hashText(prefix) === legacyHash) return saved.slice(boundary).trim();
  }
  return null;
}
function compactText(value: string, limit = 12_000): string {
  if (value.length <= limit) return value;
  const half = Math.floor(limit / 2);
  return `${value.slice(0, half)}\n\n...(content omitted)...\n\n${value.slice(-half)}`;
}
function renderPrompt(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{([a-z_]+)\}/gi, (match, key: string) => Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match);
}

function serializeLearningIntent(answers: OutlineSurveyAnswer[]): string {
  if (!answers.length) return "";
  const lines: string[] = ["<learning_intent>"];
  for (const answer of answers) {
    const question = String(answer.question ?? "").trim();
    const dimension = String(answer.dimension ?? "other").trim();
    const selected = answer.selected;
    const selectedText = Array.isArray(selected)
      ? (selected.length ? selected.join("、") : "（未选择）")
      : String(selected || "（未选择）");
    const line = `- ${question}` + (dimension && dimension !== "other" ? ` [${dimension}]` : "") + `：${selectedText}`;
    lines.push(line);
  }
  lines.push("</learning_intent>");
  return lines.join("\n");
}
function sourceNodeTitle(sourceType: string, sourcePath?: string | null): string {
  if (!sourcePath) return "project context";
  if (sourceType === "course" && sourcePath === "outline.md") return "outline";
  const lesson = sourceType === "course" ? sourcePath.match(/^lessons\/lesson_(\d+)\.md$/) : null;
  if (lesson) return `lesson_${Number(lesson[1])}`;
  return sourcePath.split("/").pop() || sourcePath;
}

function extractJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  if (!candidate) throw new Error("lesson plan did not return valid JSON");
  return JSON.parse(candidate);
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function parseLessonPlan(raw: string): LessonPlan {
  const value = extractJsonObject(raw) as Record<string, unknown>;
  const sections = Array.isArray(value.sections) ? value.sections : [];
  const parsedSections = sections.slice(0, 10).map((section, index) => {
    const record = section && typeof section === "object" ? section as Record<string, unknown> : {};
    const rawItems = Array.isArray(record.items) ? record.items : [];
    const items = rawItems.map((item) => {
      const entry = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const name = String(entry.name || "").trim();
      if (!name) return null;
      return {
        name,
        kind: entry.kind === "function" ? "function" as const : "concept" as const,
        focus: String(entry.focus || "full explanation").trim(),
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
    if (!items.length) throw new Error(`section ${index + 1} of lesson plan has no items`);
    return { title: String(record.title || `section ${index + 1}`).trim(), items };
  });
  if (parsedSections.length < 4) throw new Error("lesson plan must contain 4-10 sections");
  const textbooks = validateBibliographySelections(value.textbooks);
  return {
    lesson_title: String(value.lesson_title || "").trim(),
    position: String(value.position || "").trim(),
    objectives: (Array.isArray(value.objectives) ? value.objectives : []).map(String).map((item) => item.trim()).filter(Boolean),
    sections: parsedSections as LessonPlanSection[],
    textbooks,
  };
}

function missingLessonItems(markdown: string, sections: LessonPlanSection[]): LessonPlanItem[] {
  const normalized = markdown.toLocaleLowerCase();
  return sections.flatMap((section) => section.items).filter((item) => !normalized.includes(item.name.toLocaleLowerCase()));
}

function dedupeLessonMarkdown(markdown: string): string {
  const blocks = markdown.trim().split(/\n{2,}/);
  const seenProse = new Set<string>();
  const seenLessonHeadings = new Set<string>();
  const kept: string[] = [];
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    const heading = block.match(/^##\s+(.+)$/);
    if (heading) {
      const key = heading[1].replace(/[\s`*_#：:（）()\[\]{}<>]+/g, "").toLocaleLowerCase();
      if (seenLessonHeadings.has(key)) continue;
      seenLessonHeadings.add(key);
      kept.push(block);
      continue;
    }
    const normalized = block.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    const isProse = normalized.length >= 100
      && !block.startsWith("```")
      && !block.startsWith("|")
      && !block.startsWith(">");
    if (isProse && seenProse.has(normalized)) continue;
    if (isProse) seenProse.add(normalized);
    kept.push(block);
  }
  return kept.join("\n\n").trim();
}

function localTermCandidates(content: string): StructuredTermCandidate[] {
  const visible = content.replace(/```[\s\S]*?```/g, " ");
  const weighted: StructuredTermCandidate[] = [];
  const add = (raw: string, confidence: number, category = "other") => {
    const candidate = validateTermCandidate(
      {
        display_name: raw,
        canonical_name: raw,
        category,
        confidence,
      },
      content,
      { source: "rule", confidence },
    );
    if (
      candidate
      && visible.includes(candidate.display_name)
      && !weighted.some(
        (item) => item.canonical_name.toLocaleLowerCase() === candidate.canonical_name.toLocaleLowerCase(),
      )
    ) weighted.push(candidate);
  };
  for (const match of visible.matchAll(/`([^`\n]{2,80})`/g)) add(match[1], 0.76, "symbol");
  for (const term of KNOWN_TECH_TERMS) if (visible.includes(term)) add(term, 0.84, "library");
  for (const match of visible.matchAll(/\b(?:[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]*)+|[A-Z]{2,}[A-Z0-9_-]*|[A-Za-z]+\.[A-Za-z0-9_.-]+)\b/g)) add(match[0], 0.72, "symbol");
  return weighted.sort((a, b) => b.display_name.length - a.display_name.length).slice(0, 20);
}
function projectFromRow(row: Row, courseFiles: string[] = []): Project {
  return {
    id: Number(row.id), name: String(row.name), url: String(row.url || ""), local_path: `android://projects/${row.id}`,
    status: String(row.status), project_type: row.project_type === "learning_plan" ? "learning_plan" : "repository",
    course_files: courseFiles, created_at: String(row.created_at), updated_at: String(row.updated_at),
  };
}
function taskFromRow(row: Row): GenerationTask {
  return { ...row, id: Number(row.id), project_id: Number(row.project_id), progress_current: Number(row.progress_current || 0), progress_total: Number(row.progress_total || 1) } as GenerationTask;
}
function qaFromRow(row: Row): QARecord {
  return { ...row, id: Number(row.id), project_id: Number(row.project_id), favorite: bool(row.favorite), selected_text: String(row.selected_text || "") } as QARecord;
}
function learningStateFromRow(row: Row): LearningState {
  return {
    id: Number(row.id),
    project_id: Number(row.project_id),
    source_type: row.source_type,
    source_path: String(row.source_path),
    status: row.status,
    position_kind: row.position_kind,
    position_value: Number(row.position_value || 0),
    last_opened_at: String(row.last_opened_at),
    completed_at: row.completed_at ? String(row.completed_at) : null,
    updated_at: String(row.updated_at),
  } as LearningState;
}

// ---- safe error message extraction ----
function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

/**
 * Build completion notification label from task type + output metadata.
 * Never guesses task type from file path.
 */
export class AndroidLocalProvider implements CodeCourseProvider {
  // ---- task lifecycle ----
  private runningTasks = new Set<number>();
  private runningIndexes = new Set<number>();
  private promptStates: Record<string, Record<string, unknown>> = {};
  /** 1s keep-alive ticks per running task; cleared when the task ends. */
  private heartbeatIntervals = new Map<number, number>();

  // The coordinator is the only owner of foreground Service state.
  private readonly serviceCoordinator = new GenerationServiceCoordinator(CodeCourseNative);
  private readonly diagnostics = new AndroidDiagnosticService(db, teachingOutcomes, {
    ensureProject: (projectId) => this.getProject(projectId),
    appendEvidence: (projectId, payload, inTransaction) => (
      this.appendLearningEvidenceV2(projectId, payload, inTransaction)
    ),
    voidEvidence: (projectId, evidenceId, idempotencyKey, reason) => (
      this.voidLearningEvidenceV2(projectId, evidenceId, idempotencyKey, reason)
    ),
  });
  private readonly personalizationRoutes = createAndroidPersonalizationRoutes({
    listConcepts: (projectId, query) => this.listPersonalizationConcepts(projectId, query),
    createConcept: (projectId, body) => this.createPersonalizationConcept(
      projectId,
      body as Parameters<AndroidLocalProvider["createPersonalizationConcept"]>[1],
    ),
    getMastery: (projectId, conceptIds) => this.getPersonalizationMasteryBatch(projectId, conceptIds),
    resolveTerms: (projectId, terms) => this.resolvePersonalizationTerms(
      projectId,
      terms as Array<Record<string, unknown>>,
    ),
    getPreferences: (projectId) => this.getLearnerPreferences(projectId),
    updatePreferences: (projectId, body) => this.updateLearnerPreferences(projectId, body),
    applyAnswerFeedback: (projectId, body) => this.applyAnswerPreferenceFeedback(projectId, body),
    saveTermImpressions: (projectId, impressions) => this.saveTermImpressions(
      projectId,
      impressions as Array<Record<string, unknown>>,
    ),
    getTermDisplayProfiles: (projectId, conceptKeys) => this.getTermDisplayProfiles(projectId, conceptKeys),
    getKnowledgeStates: (projectId, conceptIds) => this.getKnowledgeStatesV2(projectId, conceptIds),
    appendEvidence: (projectId, body) => this.appendLearningEvidenceV2(projectId, body),
    voidEvidence: (projectId, evidenceId, idempotencyKey, reason) => this.voidLearningEvidenceV2(
      projectId,
      evidenceId,
      idempotencyKey,
      reason,
    ),
    rebuildProfile: (projectId) => this.rebuildKnowledgeProfileV2(projectId),
    getPendingDiagnostic: (projectId) => this.diagnostics.getPending(projectId),
    answerDiagnostic: (projectId, itemId, answer) => this.diagnostics.answer(projectId, itemId, answer),
    dismissDiagnostic: (projectId, itemId) => this.diagnostics.dismiss(projectId, itemId),
    flagDiagnostic: (projectId, itemId) => this.diagnostics.flag(projectId, itemId),
    getTeachingTrial: (projectId, qaRecordId) => teachingOutcomes.getTrial(projectId, qaRecordId),
    submitTeachingFeedback: (projectId, qaRecordId, result, key, reason) => (
      teachingOutcomes.recordManualFeedback(projectId, qaRecordId, result, key, reason)
    ),
    getProfile: (projectId) => this.getPersonalizationProfile(projectId),
    resetProfile: (projectId, scope) => this.resetPersonalizationProfile(projectId, scope),
    voidInference: (projectId, inferenceId) => this.voidLearnerInference(projectId, inferenceId),
    answerSurvey: (projectId, surveyId, choice) => this.answerDynamicSurvey(projectId, surveyId, choice),
    dismissSurvey: (surveyId) => this.dismissDynamicSurvey(surveyId),
    getExplanation: (conceptId) => this.getReusableConceptExplanation(conceptId),
    markKnown: (projectId, conceptId, key, evidence) => this.markConceptKnown(projectId, conceptId, key, evidence),
    markUnknown: (projectId, conceptId, key, evidence) => this.markConceptUnknown(projectId, conceptId, key, evidence),
    clearOverride: (projectId, conceptId, key) => this.clearConceptOverride(projectId, conceptId, key),
    getEvents: (projectId, conceptId) => this.getPersonalizationEvents(projectId, conceptId),
    voidEvent: (projectId, eventId, conceptId, key, reason) => (
      this.voidPersonalizationEvent(projectId, eventId, conceptId, key, reason)
    ),
  });
  private readonly termRoutes = createAndroidTermRoutes({
    list: (projectId, params) => this.listTerms(projectId, params),
    status: (projectId, params, force) => this.termStatus(projectId, params, force),
    setStatus: (termId, status) => this.setTermStatus(termId, status),
  });

  // ---- permission ----
  private permissionResult: NotificationPermissionResult | null = null;
  private permissionPromise: Promise<NotificationPermissionResult> | null = null;
  private lastPermissionNotice: NotificationPermissionStatus | null = null;

  // ---- notice channel ----
  private onPermissionNotice: ((notice: ProviderNotice) => void) | null = null;

  /** Register a callback for permission/battery UI notices. */
  setPermissionNoticeHandler(handler: ((notice: ProviderNotice) => void) | null) {
    this.onPermissionNotice = handler;
  }

  /** Invalidate cached permission after returning from settings. */
  invalidatePermissionCache() {
    this.permissionResult = null;
    this.permissionPromise = null;
    this.lastPermissionNotice = null;
  }

  static async create(): Promise<AndroidLocalProvider> {
    const provider = new AndroidLocalProvider();
    await db.init();
    // 恢复任务必须等待：生成中的任务需要立刻接续，避免状态错乱。
    await provider.resumeTasks();
    // 其余恢复不阻塞冷启动首帧：前台服务状态/索引/观察任务在后台完成。
    void provider.reconcileGenerationServiceState().catch((error) => {
      console.warn("Initial generation Service reconcile failed", error);
    });
    void provider.resumeIndexes();
    void provider.resumeObserverJobs().catch((error) => {
      console.warn("Observer job resume failed", error);
    });
    return provider;
  }

  // ==================================================================
  //  Service State Synchronizer
  // ==================================================================

  private async syncGenerationServiceState(): Promise<void> {
    await this.serviceCoordinator.sync();
  }

  async reconcileGenerationServiceState(): Promise<void> {
    await this.serviceCoordinator.reconcile();
  }

  // ==================================================================
  //  Notification Permission
  // ==================================================================

  private batteryState: boolean | null = null;

  private async ensureNotificationPermission(): Promise<void> {
    if (this.permissionResult) {
      this.emitPermissionNotice(this.permissionResult);
      return;
    }
    if (this.permissionPromise) { await this.permissionPromise; return; }

    this.permissionPromise = (async () => {
      try {
        this.permissionResult = await CodeCourseNative.requestNotificationPermission();
      } catch {
        this.permissionResult = { granted: false, status: "error", canAskAgain: false };
      }
      this.emitPermissionNotice(this.permissionResult);
      return this.permissionResult;
    })();

    await this.permissionPromise;
    this.permissionPromise = null;
  }

  private async ensureBatteryOptimization(): Promise<void> {
    if (this.batteryState !== null) {
      this.emitBatteryNotice(this.batteryState);
      return;
    }
    try {
      const state = await CodeCourseNative.isIgnoringBatteryOptimizations();
      this.batteryState = state.ignoring;
      this.emitBatteryNotice(state.ignoring);
    } catch {
      // 查询失败时静默跳过，不阻塞生成。
    }
  }

  /** Re-check battery exemption after returning from system settings. */
  invalidateBatteryOptimization() {
    this.batteryState = null;
  }

  async getBatteryOptimizationStatus(): Promise<BatteryOptimizationState> {
    try {
      const state = await CodeCourseNative.isIgnoringBatteryOptimizations();
      this.batteryState = state.ignoring;
      return state;
    } catch {
      return { ignoring: this.batteryState ?? false };
    }
  }

  async getNotificationPermissionStatus(): Promise<NotificationPermissionResult> {
    this.permissionResult = await CodeCourseNative.getNotificationPermissionStatus();
    this.permissionPromise = null;
    this.emitPermissionNotice(this.permissionResult);
    return this.permissionResult;
  }

  private emitPermissionNotice(result: NotificationPermissionResult) {
    if (result.granted) {
      this.lastPermissionNotice = result.status;
      this.onPermissionNotice?.(null);
      return;
    }
    if (result.status !== this.lastPermissionNotice) {
      this.lastPermissionNotice = result.status;
      const notice = permissionNotice(result);
      if (notice) this.onPermissionNotice?.({ kind: "permission", notice });
    }
  }

  private emitBatteryNotice(ignoring: boolean) {
    const notice = batteryNotice(ignoring);
    if (notice) this.onPermissionNotice?.({ kind: "battery", notice });
  }

  // ==================================================================
  //  Progress Reporting (per-task)
  // ==================================================================

  /**
   * Throttled per-task progress update to native notification.
   * Only sends if this task is the current foreground task.
   */
  private async reportProgress(taskId: number, stageLabel: string, current: number, total: number, indeterminate: boolean): Promise<void> {
    const snapshot: ProgressSnapshot = { stageLabel, current, total, indeterminate };
    await this.serviceCoordinator.reportProgress(taskId, snapshot);
  }

  // ==================================================================
  //  runTask — full try/finally lifecycle
  // ==================================================================

  private async resumeTasks(): Promise<void> {
    const rows = await db.query<Row>("SELECT id FROM generation_tasks WHERE status IN ('queued','running')");
    if (!rows.length) return;

    // If a task was backgrounded before it ever made progress, tell the
    // notification the truth: work resumes now that the app is visible.
    try {
      if (await this.serviceCoordinator.hasPendingProgress()) {
        await this.serviceCoordinator.heartbeatPaused();
      }
    } catch {
      // Best-effort; normal recovery below is unaffected.
    }

    // Reset any lingering running tasks to queued
    for (const row of rows) {
      await db.run("UPDATE generation_tasks SET status='queued',stage_label='resuming' WHERE id=?", [row.id]);
    }

    // Don't start service here — each runTask() will increment runningTasks
    // from 0→1, and syncGenerationServiceState() will start the service once.
    for (const row of rows) {
      void this.runTask(Number(row.id));
    }
  }

  private async runTask(taskId: number): Promise<void> {
    if (this.runningTasks.has(taskId)) return;

    this.runningTasks.add(taskId);

    let taskRow: Row | null = null;
    let projectId = 0;
    let project: Project | null = null;
    let payload: Record<string, unknown> = {};
    let taskType = "";
    let taskInputHash = "";

    try {
      // 1. Load task (before any service start)
      const rows = await db.query<Row>("SELECT * FROM generation_tasks WHERE id=?", [taskId]);
      if (!rows.length) {
        console.warn(`Task ${taskId} not found — skipping`);
        return;
      }
      taskRow = rows[0];
      taskType = String(taskRow.task_type);
      projectId = Number(taskRow.project_id);
      taskInputHash = String(taskRow.input_hash || "");

      // 2. Load project
      project = await this.getProject(projectId);

      // 3. Parse payload
      try {
        payload = JSON.parse(String(taskRow.payload_json || "{}"));
      } catch {
        throw new Error("Task payload is corrupted — cannot recover");
      }

      // 4. Register task info (before service start so foreground pick works)
      this.serviceCoordinator.registerTask({
        taskId, startedAt: Date.now(), projectId, taskType,
        projectName: project.name,
        sourcePath: String(taskRow.source_path || ""),
      });

      // 5. Permission + service
      await this.ensureNotificationPermission();
      await this.ensureBatteryOptimization();
      await this.syncGenerationServiceState();

      // Mark running
      await db.run("UPDATE generation_tasks SET status='running',progress_current=0,progress_total=1,stage_label='preparing',updated_at=? WHERE id=?", [now(), taskId]);
      await this.reportProgress(taskId, "preparing", 0, 1, true);

      // Keep the native notification visibly alive while this task is busy
      // (long LLM calls, retry backoff). Heartbeat only needs a live interval;
      // the coordinator guards against non-foreground tasks.
      const heartbeat = window.setInterval(() => {
        void this.serviceCoordinator.heartbeat(taskId, String(taskRow?.stage_label ?? "正在后台生成学习内容")).catch(() => undefined);
      }, 1000);
      this.heartbeatIntervals.set(taskId, heartbeat);

      // 6. Execute with DB inputHash for checkpoint consistency
      let output: TaskOutput;
      if (taskType === "outline") {
        output = await this.generateOutline(projectId, payload, taskId, taskInputHash);
      } else if (taskType === "sub_outline") {
        output = await this.generateSubOutline(projectId, payload, taskId, taskInputHash);
      } else if (taskType === "file_lesson") {
        output = await this.generateFileLesson(projectId, payload, taskId, taskInputHash);
      } else if (taskType === "outline_lesson") {
        output = await this.generateOutlineLesson(projectId, payload, taskId, taskInputHash);
      } else {
        throw new Error(`Unknown task type: ${taskType}`);
      }

      // Persist result — group by taskType, not filename
      const group = taskType === "outline" || taskType === "sub_outline" ? "总纲" : taskType === "file_lesson" ? "文件课件" : "课件";
      await this.upsertCourse(projectId, output.filename, output.content, group);
      if (taskType !== "outline" && taskType !== "sub_outline") {
        // Best-effort: link the lesson to its outline node. A graph-link failure
        // must never fail the completed generation itself.
        try {
          const lessonNode = await this.ensureCourseNode(projectId, output.filename);
          if (lessonNode?.id != null) {
            await this.linkLessonToOutline(projectId, lessonNode.id, String(payload.outline_path || "outline.md"));
          }
        } catch (err) {
          console.warn("Graph link failed for task", taskId, ":", safeErrorMessage(err));
        }
      }
      await db.run("UPDATE generation_tasks SET status='completed',progress_current=progress_total,stage_label='completed',output_path=?,updated_at=? WHERE id=?", [output.filename, now(), taskId]);

      // Slim checkpoint — always reduce payload after success
      try {
        const slimCheckpoint = buildSlimCheckpoint(taskType, taskInputHash, output.filename);
        const { _checkpoint: _, ...rest } = payload as Record<string, unknown>;
        await db.run("UPDATE generation_tasks SET payload_json=? WHERE id=?", [JSON.stringify({ ...rest, _checkpoint: slimCheckpoint }), taskId]);
      } catch { /* best-effort */ }

      // Send completion notification — only after everything persisted
      const bodyText = buildCompletionLabel(taskType, project.name, output);
      try {
        await CodeCourseNative.notifyCompletion({
          taskId, projectId, taskType,
          outputPath: output.filename,
          label: bodyText,
        });
      } catch (err) {
        console.warn("Completion notification failed for task", taskId, ":", safeErrorMessage(err));
        // Task is still completed — notification failure is non-fatal
      }

    } catch (error) {
      const msg = safeErrorMessage(error);
      try {
        await db.run("UPDATE generation_tasks SET status='failed',stage_label='failed',error_message=?,updated_at=? WHERE id=?", [msg, now(), taskId]);
      } catch (dbError) {
        console.error("Failed to update task failure status for", taskId, ":", safeErrorMessage(dbError));
        // Fall through to finally — must not skip Service cleanup
      }

      // Report failure to notification if foreground
      try {
        await this.reportProgress(taskId, "failed", 0, 0, true);
      } catch { /* best-effort */ }

    } finally {
      // CRITICAL: always cleanup
      const heartbeat = this.heartbeatIntervals.get(taskId);
      if (heartbeat !== undefined) {
        window.clearInterval(heartbeat);
        this.heartbeatIntervals.delete(taskId);
      }
      this.runningTasks.delete(taskId);
      this.serviceCoordinator.unregisterTask(taskId);

      // Sync service state (N→0 transition stops the service)
      await this.syncGenerationServiceState();
    }
  }

  // ==================================================================
  //  API Router
  // ==================================================================

  async request<T>(rawPath: string, init?: RequestInit): Promise<T> {
    const url = new URL(rawPath, "https://codecourse.local");
    const path = url.pathname;
    const method = (init?.method || "GET").toUpperCase();
    const body = bodyJson(init);
    let match: RegExpMatchArray | null;

    if (path === "/projects" && method === "GET") return this.listProjects() as Promise<T>;
    if (path === "/projects/import" && method === "POST") return this.importRepository(body.url) as Promise<T>;
    if (path === "/projects/import-archive" && method === "POST") {
      if (!(init?.body instanceof Blob)) throw new Error("请选择 ZIP 文件。");
      return this.importArchive(init.body) as Promise<T>;
    }
    if (path === "/projects/learning-plan" && method === "POST") return this.createLearningPlan(body.name) as Promise<T>;
    if (path === "/settings/llm" && method === "GET") return this.getLLMSettings() as Promise<T>;
    if (path === "/settings/llm" && method === "PUT") return this.saveLLMSettings(body) as Promise<T>;
    if (path === "/settings/llm/test" && method === "POST") return this.testLLMSettings() as Promise<T>;
    if (path === "/settings/personalization" && method === "GET") {
      return this.getPersonalizationRuntimeSettings() as Promise<T>;
    }
    if (path === "/settings/personalization" && method === "PUT") {
      return this.savePersonalizationRuntimeSettings(body) as Promise<T>;
    }
    if (path === "/settings/prompts" && method === "GET") return this.getPrompts() as Promise<T>;
    if (path === "/settings/prompts" && method === "PUT") return this.savePrompts(body) as Promise<T>;
    if (path === "/settings/prompts/metadata" && method === "GET") return this.getPromptMetadata() as Promise<T>;
    if (path === "/settings/prompts/history" && method === "GET") {
      return this.getPromptHistory(url.searchParams.get("key") || "") as Promise<T>;
    }
    if (path === "/settings/prompts/preview" && method === "POST") {
      return this.previewPrompt(String(body.key || ""), String(body.value || "")) as Promise<T>;
    }
    if (path === "/settings/prompts/reset" && method === "POST") {
      return this.resetPrompt(String(body.key || "")) as Promise<T>;
    }

    if ((match = path.match(/^\/projects\/(\d+)$/))) {
      const projectId = Number(match[1]);
      if (method === "GET") return this.getProject(projectId) as Promise<T>;
      if (method === "DELETE") return this.deleteProject(projectId) as Promise<T>;
    }
    if ((match = path.match(/^\/projects\/(\d+)\/tree$/))) return this.getTree(Number(match[1])) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/file$/))) return this.getFile(Number(match[1]), url.searchParams.get("path") || "") as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/course$/))) return this.listCourses(Number(match[1])) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/course\/empty$/)) && method === "POST") return this.createCourse(Number(match[1]), body.title) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/course\/(.+)$/))) {
      const projectId = Number(match[1]); const filename = decodePath(match[2]);
      if (method === "GET") return this.getCourse(projectId, filename) as Promise<T>;
      if (method === "DELETE") return this.deleteCourse(projectId, filename) as Promise<T>;
    }
    if ((match = path.match(/^\/projects\/(\d+)\/regenerate$/))) return this.regenerate(Number(match[1])) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/outline\/generate\/preflight$/))) {
      return this.outlinePreflight(Number(match[1]), body) as Promise<T>;
    }
    if ((match = path.match(/^\/projects\/(\d+)\/outline\/generate\/confirm$/))) {
      return this.outlineConfirm(Number(match[1]), body) as Promise<T>;
    }
    if ((match = path.match(/^\/projects\/(\d+)\/outline\/generate$/))) return this.queueTask(Number(match[1]), "outline", body) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/outlines\/sub$/))) return this.queueTask(Number(match[1]), "sub_outline", body) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/lessons\/file$/))) return this.queueTask(Number(match[1]), "file_lesson", body) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/lessons\/outline\/evidence$/))) {
      return this.previewOutlineLessonEvidence(Number(match[1]), body) as Promise<T>;
    }
    if ((match = path.match(/^\/projects\/(\d+)\/lessons\/sub-outline$/))) {
      return this.queueSubOutlineLesson(Number(match[1]), body) as Promise<T>;
    }
    if ((match = path.match(/^\/projects\/(\d+)\/lessons\/outline$/))) return this.queueTask(Number(match[1]), "outline_lesson", body) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/tasks$/))) return this.listTasks(Number(match[1])) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/tasks\/(\d+)$/))) return this.getTask(Number(match[1]), Number(match[2])) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/tasks\/(\d+)\/retry$/)) && method === "POST") return this.retryTask(Number(match[1]), Number(match[2])) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/index\/build$/))) return this.buildIndex(Number(match[1])) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/index\/status$/))) return this.indexStatus(Number(match[1])) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/learning-state$/))) {
      const projectId = Number(match[1]);
      if (method === "GET") return this.listLearningStates(projectId) as Promise<T>;
      if (method === "PUT") return this.updateLearningState(projectId, body) as Promise<T>;
      if (method === "DELETE") return this.resetLearningStates(projectId) as Promise<T>;
    }
    if ((match = path.match(/^\/projects\/(\d+)\/search$/))) return this.search(Number(match[1]), body.query, body.source_path, body.limit) as Promise<T>;

    if ((match = path.match(/^\/projects\/(\d+)\/qa\/ask$/))) return this.ask(Number(match[1]), body) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/qa$/))) return this.listQA(Number(match[1]), url.searchParams.get("query") || "", url.searchParams.get("favorite")) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/qa\/sessions\/(\d+)\/tree$/))) return this.sessionTree(Number(match[1]), Number(match[2])) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/qa\/(\d+)\/favorite$/))) return this.favoriteQA(Number(match[1]), Number(match[2]), bool(body.favorite)) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/qa\/(\d+)\/understanding$/))) {
      if (method === "GET") return this.getAnchor(Number(match[1]), Number(match[2])) as Promise<T>;
      if (method === "POST") return this.saveAnchor(Number(match[1]), Number(match[2]), body) as Promise<T>;
      if (method === "DELETE") return this.deleteAnchor(Number(match[1]), Number(match[2])) as Promise<T>;
    }
    if ((match = path.match(/^\/projects\/(\d+)\/qa\/(\d+)$/))) {
      if (method === "GET") return this.getQA(Number(match[1]), Number(match[2])) as Promise<T>;
      if (method === "PUT") return this.updateQA(Number(match[1]), Number(match[2]), body) as Promise<T>;
      if (method === "DELETE") return this.deleteQA(Number(match[1]), Number(match[2])) as Promise<T>;
    }

    if ((match = path.match(/^\/projects\/(\d+)\/highlights$/))) {
      if (method === "GET") return this.listHighlights(Number(match[1]), url.searchParams) as Promise<T>;
      if (method === "POST") return this.createHighlight(Number(match[1]), body) as Promise<T>;
    }
    if ((match = path.match(/^\/projects\/(\d+)\/highlights\/(\d+)$/)) && method === "DELETE") return this.deleteById("highlights", Number(match[2])) as Promise<T>;
    const terms = await dispatchAndroidRoutes(this.termRoutes, {
      path,
      method,
      searchParams: url.searchParams,
      body,
    });
    if (terms.handled) return terms.value as T;

    if ((match = path.match(/^\/projects\/(\d+)\/knowledge\/graph$/))) return this.getGraph(Number(match[1])) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/knowledge\/links$/))) return this.listLinks(Number(match[1]), url.searchParams) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/knowledge\/nodes$/)) && method === "POST") return this.createNode(Number(match[1]), body) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/knowledge\/nodes\/(\d+)$/))) {
      if (method === "PUT") return this.updateNode(Number(match[1]), Number(match[2]), body) as Promise<T>;
      if (method === "DELETE") return this.deleteNode(Number(match[1]), Number(match[2])) as Promise<T>;
    }
    if ((match = path.match(/^\/projects\/(\d+)\/knowledge\/edges$/)) && method === "POST") return this.createEdge(Number(match[1]), body) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/knowledge\/edges\/(\d+)$/))) {
      if (method === "PUT") return this.updateEdge(Number(match[1]), Number(match[2]), body) as Promise<T>;
      if (method === "DELETE") return this.deleteById("knowledge_edges", Number(match[2])) as Promise<T>;
    }

    const personalization = await dispatchAndroidRoutes(this.personalizationRoutes, {
      path,
      method,
      searchParams: url.searchParams,
      body,
    });
    if (personalization.handled) return personalization.value as T;

    throw new Error(`移动端尚未实现此操作：${method} ${path}`);
  }

  // ---- project CRUD ----
  private async courseNames(projectId: number): Promise<string[]> {
    return (await db.query<Row>("SELECT filename FROM course_files WHERE project_id = ? ORDER BY filename", [projectId])).map((row) => String(row.filename));
  }
  private async getProject(projectId: number): Promise<Project> {
    const row = (await db.query<Row>("SELECT p.*, COALESCE(GROUP_CONCAT(cf.filename, '\n'), '') AS course_names FROM projects p LEFT JOIN course_files cf ON cf.project_id = p.id WHERE p.id = ? GROUP BY p.id", [projectId]))[0];
    if (!row) throw new Error("项目不存在。");
    return projectFromRow(row, this.courseNamesFromRow(row));
  }
  private async listProjects(): Promise<Project[]> {
    const rows = await db.query<Row>("SELECT p.*, COALESCE(GROUP_CONCAT(cf.filename, '\n'), '') AS course_names FROM projects p LEFT JOIN course_files cf ON cf.project_id = p.id GROUP BY p.id ORDER BY p.updated_at DESC");
    return rows.map((row) => projectFromRow(row, this.courseNamesFromRow(row)));
  }
  private courseNamesFromRow(row: Row): string[] {
    const names = String(row.course_names ?? "").trim();
    return names ? names.split("\n") : [];
  }
  private async createLearningPlan(name: string): Promise<Project> {
    const clean = String(name || "").trim(); if (!clean) throw new Error("请输入学习计划名称。");
    const stamp = now();
    const id = await db.run("INSERT INTO projects(name,url,status,project_type,created_at,updated_at) VALUES(?,?,?,?,?,?)", [clean, "", "scanned", "learning_plan", stamp, stamp]);
    const placeholder = `# ${clean}\n\n> 点击"生成 AI 总纲"开始构建学习路线。\n`;
    await writeGeneratedFileAtomic(id, "outline.md", placeholder);
    await this.upsertCourse(id, "outline.md", placeholder, "总纲");
    return this.getProject(id);
  }
  private async importRepository(url: string): Promise<Project> {
    const snapshot = await downloadGitHubSnapshot(String(url || ""));
    return this.persistImportedProject(snapshot.name, String(url), snapshot.files);
  }
  private async importArchive(blob: Blob): Promise<Project> {
    const files = await readZipFiles(await blob.arrayBuffer());
    const rawName = blob instanceof File ? blob.name.replace(/\.zip$/i, "") : "本地项目";
    return this.persistImportedProject(rawName || "本地项目", "local-zip://snapshot", files);
  }
  private async persistImportedProject(name: string, url: string, files: Array<{ path: string; content: string; language: string; size: number; isKeyFile: boolean }>): Promise<Project> {
    const stamp = now();
    const id = await db.run("INSERT INTO projects(name,url,status,project_type,created_at,updated_at) VALUES(?,?,?,?,?,?)", [name, url, "scanned", "repository", stamp, stamp]);
    try {
      for (const file of files) {
        await writeRepoFile(id, file.path, file.content);
        await db.run("INSERT INTO project_files(project_id,path,language,size,is_key_file) VALUES(?,?,?,?,?)", [id, file.path, file.language, file.size, file.isKeyFile ? 1 : 0]);
      }
      await this.writeRuleCourse(id, name, files.map((file) => file.path));
      const project = await this.getProject(id);
      void this.buildIndex(id);
      return project;
    } catch (error) {
      await db.run("DELETE FROM projects WHERE id = ?", [id]); await removeProjectFiles(id); throw error;
    }
  }
  private async deleteProject(projectId: number): Promise<{ id: number; status: string; message: string; course_files: string[] }> {
    // 索引表在删除 projects 行前必须显式清理：code_chunks_fts 是 FTS 表，
    // 其余表可依赖 FK 级联，但显式删除保证不依赖外键开关状态。
    await db.run("DELETE FROM code_chunks_fts WHERE project_id = ?", [projectId]).catch(() => undefined);
    await db.run("DELETE FROM code_chunks WHERE project_id = ?", [projectId]).catch(() => undefined);
    await db.run("DELETE FROM indexed_files WHERE project_id = ?", [projectId]).catch(() => undefined);
    await db.run("DELETE FROM project_files WHERE project_id = ?", [projectId]).catch(() => undefined);
    for (const table of ["learning_events", "concept_mastery", "preference_events", "learner_preferences"]) {
      await db.run(
        `DELETE FROM ${table} WHERE scope_type='project' AND scope_id=?`,
        [String(projectId)],
      );
    }
    await db.run("DELETE FROM term_impressions WHERE project_id=?", [projectId]);
    const projectConcepts = await db.query<Row>(
      "SELECT id FROM concepts WHERE concept_key LIKE ?",
      [`project:${projectId}:%`],
    );
    for (const concept of projectConcepts) {
      await db.run(
        "DELETE FROM concept_relations WHERE source_concept_id=? OR target_concept_id=?",
        [concept.id, concept.id],
      );
      await db.run("DELETE FROM learner_inferences WHERE subject_type='concept' AND subject_key=?", [concept.id]);
      await db.run("DELETE FROM concepts WHERE id=?", [concept.id]);
    }
    await db.run("DELETE FROM learner_inferences WHERE scope_type='project' AND scope_id=?", [String(projectId)]);
    await db.run("DELETE FROM concept_explanations WHERE project_id=?", [projectId]);
    await db.run("DELETE FROM model_call_audit WHERE project_id=?", [projectId]);
    await db.run("DELETE FROM term_model_scans WHERE project_id=?", [projectId]);
    await db.run("DELETE FROM diagnostic_attempts WHERE project_id=?", [projectId]);
    await db.run("DELETE FROM diagnostic_items WHERE project_id=?", [projectId]);
    await db.run("DELETE FROM observer_jobs WHERE project_id=?", [projectId]);
    await db.run("DELETE FROM teaching_outcomes WHERE project_id=?", [projectId]);
    await db.run("DELETE FROM teaching_trials WHERE project_id=?", [projectId]);
    await db.run("DELETE FROM learning_evidence_v2 WHERE scope_type='project' AND scope_id=?", [String(projectId)]);
    await db.run("DELETE FROM knowledge_states_v2 WHERE scope_type='project' AND scope_id=?", [String(projectId)]);
    await db.run("DELETE FROM projects WHERE id = ?", [projectId]); await removeProjectFiles(projectId);
    return { id: projectId, status: "deleted", message: "项目已删除", course_files: [] };
  }
  private async getTree(projectId: number): Promise<TreeNode> {
    const project = await this.getProject(projectId);
    const rows = await db.query<Row>("SELECT path,is_key_file FROM project_files WHERE project_id = ? ORDER BY path", [projectId]);
    return buildTree(project.name, rows.map((row) => ({ path: String(row.path), is_key_file: Boolean(row.is_key_file) })));
  }
  private async getFile(projectId: number, path: string): Promise<{ path: string; language: string; content: string }> {
    const row = (await db.query<Row>("SELECT language FROM project_files WHERE project_id = ? AND path = ?", [projectId, path]))[0];
    if (!row) throw new Error("文件不存在或不是可阅读文本。");
    return { path, language: String(row.language), content: await readRepoFile(projectId, path) };
  }
  private async listCourses(projectId: number): Promise<CourseFile[]> {
    return (await db.query<Row>("SELECT filename,title,group_name FROM course_files WHERE project_id = ? ORDER BY filename", [projectId]))
      .map((row) => ({ filename: String(row.filename), title: String(row.title), group: String(row.group_name) }));
  }
  private async upsertCourse(projectId: number, filename: string, content: string, group = "课程"): Promise<void> {
    await writeGeneratedFileAtomic(projectId, filename, content);
    await db.run("INSERT OR REPLACE INTO course_files(project_id,filename,title,group_name,updated_at) VALUES(?,?,?,?,?)", [projectId, filename, titleFromMarkdown(filename, content), group, now()]);
    await this.registerTerms(projectId, "course", filename, content);
  }
  private async createCourse(projectId: number, title: string): Promise<CourseFile> {
    const clean = String(title || "").trim(); if (!clean) throw new Error("请输入文档标题。");
    const filename = `notes/${Date.now()}_${clean.replace(/[^\p{L}\p{N}_.-]+/gu, "_").slice(0, 40)}.md`;
    await this.upsertCourse(projectId, filename, `# ${clean}\n\n待编辑。\n`, "笔记");
    return { filename, title: clean, group: "笔记" };
  }
  private async getCourse(projectId: number, filename: string): Promise<{ filename: string; content: string }> {
    const exists = await db.query<Row>("SELECT id FROM course_files WHERE project_id = ? AND filename = ?", [projectId, filename]);
    if (!exists.length) throw new Error("课程文件不存在。");
    return { filename, content: await readGeneratedFile(projectId, filename) };
  }
  private async deleteCourse(projectId: number, filename: string): Promise<{ deleted: boolean; filename: string }> {
    await db.run("DELETE FROM course_files WHERE project_id = ? AND filename = ?", [projectId, filename]);
    await db.run("DELETE FROM learning_states WHERE project_id = ? AND source_path = ? AND source_type IN ('course','qa')", [projectId, filename]);
    await db.run("DELETE FROM highlights WHERE project_id = ? AND source_type = 'course' AND source_path = ?", [projectId, filename]);
    await db.run("DELETE FROM knowledge_links WHERE project_id = ? AND source_type = 'course' AND source_path = ?", [projectId, filename]);
    await db.run("DELETE FROM document_terms WHERE project_id = ? AND source_type = 'course' AND source_path = ?", [projectId, filename]);
    await db.run("DELETE FROM knowledge_nodes WHERE project_id = ? AND ref_type = 'course' AND ref_path = ?", [projectId, filename]);
    await removeGeneratedFile(projectId, filename); return { deleted: true, filename };
  }
  private async writeRuleCourse(projectId: number, name: string, paths: string[]): Promise<void> {
    const key = paths.filter((path) => /(^|\/)(README[^/]*|package\.json|pyproject\.toml|CMakeLists\.txt|Cargo\.toml|go\.mod|Dockerfile)$/i.test(path));
    const map = `# 项目结构说明\n\n> 生成方式：本地规则\n\n## 项目\n\n${name}\n\n## 关键文件\n\n${(key.length ? key : paths.slice(0, 12)).map((path) => `- \`${path}\``).join("\n")}\n`;
    const outline = `# 项目学习总纲\n\n> 生成方式：本地规则，占位内容可通过"生成 AI 总纲"替换。\n\n## 学习路线\n\n1. 阅读 README 和构建配置，确认项目目标。\n2. 找到程序入口和核心目录。\n3. 沿关键符号阅读主要流程。\n4. 阅读测试与部署配置，验证理解。\n`;
    await this.upsertCourse(projectId, "project_map.md", map, "总纲");
    await this.upsertCourse(projectId, "outline.md", outline, "总纲");
  }
  private async regenerate(projectId: number): Promise<{ id: number; status: string; message: string; course_files: string[] }> {
    const project = await this.getProject(projectId);
    if (project.project_type === "repository") {
      const rows = await db.query<Row>("SELECT path FROM project_files WHERE project_id = ?", [projectId]);
      await this.writeRuleCourse(projectId, project.name, rows.map((row) => String(row.path)));
    }
    return { id: projectId, status: "scanned", message: "规则课程已更新", course_files: await this.courseNames(projectId) };
  }

  // ---- settings / LLM ----
  private async setting(key: string): Promise<string | null> { const v = (await db.query<Row>("SELECT value FROM settings WHERE key = ?", [key]))[0]?.value; return v != null ? String(v) : null; }
  private async setSetting(key: string, value: string): Promise<void> { await db.run("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", [key, value]); }
  private async getLLMSettings(): Promise<LLMSettings> {
    const saved = JSON.parse((await this.setting("llm.config")) || JSON.stringify(DEFAULT_MODEL));
    const apiKey = (await CodeCourseSecureStore.get({ key: "llm_api_key" })).value;
    return { ...saved, has_api_key: Boolean(apiKey), masked_api_key: apiKey ? `****${apiKey.slice(-4)}` : null };
  }
  private async saveLLMSettings(payload: Record<string, unknown>): Promise<LLMSettings> {
    const baseUrl = String(payload.base_url || DEFAULT_MODEL.base_url).trim().replace(/\/$/, "");
    let parsedUrl: URL; try { parsedUrl = new URL(baseUrl); } catch { throw new Error("请输入有效的模型 API 地址。"); }
    if (parsedUrl.protocol !== "https:") throw new Error("手机版只允许使用 HTTPS 模型 API，避免密钥明文传输。");
    const config = { provider: payload.provider || "deepseek", base_url: baseUrl, model: payload.model || DEFAULT_MODEL.model, enabled: Boolean(payload.enabled) };
    await this.setSetting("llm.config", JSON.stringify(config));
    if (payload.clear_api_key) await CodeCourseSecureStore.remove({ key: "llm_api_key" });
    else if (String(payload.api_key || "").trim()) await CodeCourseSecureStore.set({ key: "llm_api_key", value: String(payload.api_key).trim() });
    return this.getLLMSettings();
  }
  private async callLLM(messages: Array<{ role: string; content: string }>, override?: Partial<LLMSettings>): Promise<string> {
    const settings = { ...(await this.getLLMSettings()), ...override };
    const apiKey = (await CodeCourseSecureStore.get({ key: "llm_api_key" })).value;
    if (!settings.enabled || !apiKey) throw new Error("请先在模型 API 中配置并启用模型。");

    const url = `${settings.base_url.replace(/\/$/, "")}/chat/completions`;
    const body = JSON.stringify({ model: settings.model, messages, temperature: 0.25, max_tokens: 65536 });

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response: HttpResponse = await CapacitorHttp.request({
          method: "POST",
          url,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          data: body,
          connectTimeout: 30_000,
          readTimeout: 300_000,
        });
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`模型调用失败（${response.status}）：${JSON.stringify(response.data)}`);
        }
        const data = response.data as { choices?: Array<{ message?: { content?: string } }> };
        const message = data?.choices?.[0]?.message ?? {};
        const content = String(message.content || "").trim();
        if (!content) throw new Error("模型返回了空内容。");
        return content;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const msg = lastError.message;
        if (msg.includes("模型返回了空内容") || msg.includes("请先在模型 API")) throw lastError;
        // 4xx（401/403/404 等）不可恢复，直接失败；429/5xx/网络错误为瞬态，退避重试。
        const statusMatch = msg.match(/模型调用失败（(\d+)）/);
        if (statusMatch && Number(statusMatch[1]) < 500 && Number(statusMatch[1]) !== 429) throw lastError;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 3000 * 2 ** attempt));
        }
      }
    }
    throw lastError ?? new Error("模型调用失败");
  }
  private async testLLMSettings(): Promise<{ ok: boolean; provider: string; message: string }> {
    await this.callLLM([{ role: "user", content: "只回答 OK" }]);
    const settings = await this.getLLMSettings(); return { ok: true, provider: settings.provider, message: "模型连接成功" };
  }
  private async getPersonalizationRuntimeSettings() {
    return {
      supported: true,
      teacher_planner_enabled: (await this.setting("personalization.teacher_planner.enabled")) === "true",
      observer_enabled: (await this.setting("personalization.observer.enabled")) === "true",
      teacher_planner_mode: "assist" as const,
      observer_mode: "shadow" as const,
    };
  }
  private async savePersonalizationRuntimeSettings(payload: Record<string, unknown>) {
    if ("teacher_planner_enabled" in payload) {
      await this.setSetting(
        "personalization.teacher_planner.enabled",
        bool(payload.teacher_planner_enabled) ? "true" : "false",
      );
    }
    if ("observer_enabled" in payload) {
      await this.setSetting(
        "personalization.observer.enabled",
        bool(payload.observer_enabled) ? "true" : "false",
      );
    }
    return this.getPersonalizationRuntimeSettings();
  }
  private async getPrompts(): Promise<Record<string, string>> {
    const prompts = { ...(promptDefaults as Record<string, string>) };
    const rows = await db.query<Row>(
      "SELECT key,value FROM settings WHERE key LIKE 'prompt.%' OR key LIKE 'prompt_schema_version.%'",
    );
    const stored = new Map(rows.map((row) => [String(row.key), String(row.value)]));
    const states: Record<string, Record<string, unknown>> = {};
    for (const [key, currentDefault] of Object.entries(prompts)) {
      const saved = stored.get(key);
      const rawVersion = Number(stored.get(`${PROMPT_SCHEMA_SETTING_PREFIX}${key}`) || 1);
      const storedVersion = Number.isFinite(rawVersion) ? Math.max(1, rawVersion) : 1;
      if (!saved) {
        states[key] = {
          is_default: true,
          schema_version: PROMPT_SCHEMA_VERSION,
          stored_schema_version: PROMPT_SCHEMA_VERSION,
          upgrade_status: "default",
        };
        continue;
      }
      if (saved === currentDefault) {
        prompts[key] = saved;
        states[key] = {
          is_default: true,
          schema_version: PROMPT_SCHEMA_VERSION,
          stored_schema_version: PROMPT_SCHEMA_VERSION,
          upgrade_status: "current",
        };
        if (storedVersion !== PROMPT_SCHEMA_VERSION) {
          await this.setSetting(`${PROMPT_SCHEMA_SETTING_PREFIX}${key}`, String(PROMPT_SCHEMA_VERSION));
        }
        continue;
      }
      if (storedVersion >= PROMPT_SCHEMA_VERSION) {
        prompts[key] = saved;
        states[key] = {
          is_default: false,
          schema_version: PROMPT_SCHEMA_VERSION,
          stored_schema_version: storedVersion,
          upgrade_status: "current_custom",
        };
        continue;
      }
      const customSuffix = legacyPromptSuffix(key, saved);
      if (customSuffix !== null) {
        const migrated = customSuffix ? `${currentDefault.trimEnd()}\n\n${customSuffix}` : currentDefault;
        prompts[key] = migrated;
        await this.setSetting(key, migrated);
        await this.setSetting(`${PROMPT_SCHEMA_SETTING_PREFIX}${key}`, String(PROMPT_SCHEMA_VERSION));
        await this.addPromptRevision(key, migrated, "migration");
        states[key] = {
          is_default: !customSuffix,
          schema_version: PROMPT_SCHEMA_VERSION,
          stored_schema_version: PROMPT_SCHEMA_VERSION,
          upgrade_status: customSuffix ? "migrated_with_custom_directives" : "migrated",
        };
      } else {
        prompts[key] = saved;
        states[key] = {
          is_default: false,
          schema_version: PROMPT_SCHEMA_VERSION,
          stored_schema_version: storedVersion,
          upgrade_status: "outdated_custom",
        };
      }
    }
    this.promptStates = states;
    return prompts;
  }
  private async savePrompts(payload: Record<string, string>): Promise<{ ok: boolean }> {
    const errors: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (!key.startsWith("prompt.")) continue;
      const itemErrors = validatePromptTemplate(key, value);
      if (itemErrors.length) errors[key] = itemErrors;
    }
    if (Object.keys(errors).length) {
      throw new Error(Object.values(errors).flat().join("\n"));
    }
    const current = await this.getPrompts();
    for (const [key, value] of Object.entries(payload)) {
      if (!key.startsWith("prompt.") || current[key] === value) continue;
      await this.setSetting(key, value);
      await this.setSetting(`${PROMPT_SCHEMA_SETTING_PREFIX}${key}`, String(PROMPT_SCHEMA_VERSION));
      await this.addPromptRevision(key, value, "user");
    }
    return { ok: true };
  }

  private async addPromptRevision(key: string, value: string, source: string): Promise<void> {
    await db.run(
      "INSERT INTO prompt_revisions(prompt_key,value,source,created_at) VALUES(?,?,?,?)",
      [key, value, source, now()],
    );
    await db.run(
      `DELETE FROM prompt_revisions
       WHERE prompt_key=?
         AND id NOT IN (
           SELECT id FROM prompt_revisions
           WHERE prompt_key=?
           ORDER BY id DESC
           LIMIT 20
         )`,
      [key, key],
    );
  }

  private async getPromptMetadata() {
    const current = await this.getPrompts();
    return {
      prompts: promptTemplateMetadata(
        promptDefaults as Record<string, string>,
        current,
        this.promptStates,
      ),
    };
  }

  private async getPromptHistory(key: string) {
    if (validatePromptTemplate(key, (promptDefaults as Record<string, string>)[key] || "").includes("未知提示词模板。")) {
      throw new Error("未知提示词模板。");
    }
    const revisions = await db.query<Row>(
      `SELECT id,prompt_key,value,source,created_at
       FROM prompt_revisions
       WHERE prompt_key=?
       ORDER BY id DESC
       LIMIT 20`,
      [key],
    );
    return { key, revisions };
  }

  private async previewPrompt(key: string, value: string) {
    const current = await this.getPrompts();
    return {
      key,
      ...previewPromptBundle(
        key,
        value,
        promptDefaults as Record<string, string>,
        current,
      ),
    };
  }

  private async resetPrompt(key: string) {
    const value = (promptDefaults as Record<string, string>)[key];
    if (value === undefined) throw new Error("未知提示词模板。");
    await this.setSetting(key, value);
    await this.setSetting(`${PROMPT_SCHEMA_SETTING_PREFIX}${key}`, String(PROMPT_SCHEMA_VERSION));
    await this.addPromptRevision(key, value, "reset");
    return { key, value };
  }

  // ---- task queue ----
  private async queueTask(projectId: number, taskType: string, payload: Record<string, unknown>): Promise<GenerationTask> {
    const settings = await this.getLLMSettings();
    const project = await this.getProject(projectId); const prompts = await this.getPrompts();
    let sourceFingerprint = ""; let promptFingerprint = "";
    if (taskType === "file_lesson" && payload.path) {
      sourceFingerprint = hashText(await readRepoFile(projectId, String(payload.path)));
      promptFingerprint = `${prompts["prompt.file_lesson.template"] || ""}\n${prompts[`prompt.file_lesson.${payload.mode}_expected`] || ""}`;
    } else if (taskType === "outline_lesson") {
      const outlinePath = String(payload.outline_path || "outline.md");
      sourceFingerprint = hashText(await readGeneratedFile(projectId, outlinePath));
      promptFingerprint = prompts[project.project_type === "learning_plan" ? "prompt.learning_plan.lesson" : "prompt.outline_lesson"] || "";
    } else if (taskType === "sub_outline") {
      const paths = Array.isArray(payload.paths) ? payload.paths.map(String) : [];
      const contents = await Promise.all(paths.map((path) => readRepoFile(projectId, path).catch(() => "")));
      sourceFingerprint = hashText(JSON.stringify(contents));
      promptFingerprint = prompts["prompt.outline"] || "";
    } else {
      promptFingerprint = prompts[project.project_type === "learning_plan" ? "prompt.learning_plan.outline" : "prompt.outline"] || "";
    }
    const stamp = now(); const serialized = JSON.stringify(payload);
    const inputHash = hashText(JSON.stringify({ taskType, payload, model: settings.model, promptFingerprint, sourceFingerprint }));
    const cached = (await db.query<Row>(`SELECT t.* FROM generation_tasks t JOIN course_files c ON c.project_id=t.project_id AND c.filename=t.output_path WHERE t.project_id=? AND t.task_type=? AND t.status='completed' AND t.input_hash=? ORDER BY t.id DESC LIMIT 1`, [projectId, taskType, inputHash]))[0];
    if (cached) return taskFromRow(cached);
    const id = await db.run(`INSERT INTO generation_tasks(project_id,task_type,status,source_path,mode,model,prompt_version,input_hash,payload_json,stage_label,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [projectId, taskType, "queued", payload.path || null, payload.mode || null, settings.model, "mobile-v3", inputHash, serialized, "排队中", stamp, stamp]);
    void this.runTask(id); return this.getTask(projectId, id);
  }

  private async listTasks(projectId: number): Promise<GenerationTask[]> { return (await db.query<Row>("SELECT * FROM generation_tasks WHERE project_id=? ORDER BY id DESC", [projectId])).map(taskFromRow); }
  private async getTask(projectId: number, taskId: number): Promise<GenerationTask> {
    const row = (await db.query<Row>("SELECT * FROM generation_tasks WHERE project_id=? AND id=?", [projectId, taskId]))[0];
    if (!row) throw new Error("生成任务不存在。"); return taskFromRow(row);
  }

  private async queueSubOutlineLesson(projectId: number, body: Record<string, unknown>): Promise<GenerationTask> {
    const outlinePath = String(body.outline_path || "");
    if (!/^sub-outline-[0-9a-f]{8}\.md$/.test(outlinePath)) {
      throw new Error("子总纲课件只能基于子总纲文件生成。");
    }
    const exists = await db.query<Row>("SELECT id FROM course_files WHERE project_id=? AND filename=?", [projectId, outlinePath]);
    if (!exists.length) {
      throw new Error("子总纲文件不存在或已删除。");
    }
    return this.queueTask(projectId, "outline_lesson", { ...body, outline_path: outlinePath });
  }

  private async retryTask(projectId: number, taskId: number): Promise<GenerationTask> {
    const task = await this.getTask(projectId, taskId);
    if (task.status !== "failed" && task.status !== "cancelled") {
      throw new Error("只能重试失败或已取消的任务");
    }
    // Reset to queued, keep _checkpoint in payload_json for resume
    await db.run("UPDATE generation_tasks SET status='queued',error_message=NULL,stage_label='等待重试',updated_at=? WHERE id=?", [now(), taskId]);
    void this.runTask(taskId);
    return this.getTask(projectId, taskId);
  }

  // ---- generation methods ----
  private async projectContext(projectId: number, paths?: string[]): Promise<string> {
    const placeholders = paths?.length ? ` AND path IN (${paths.map(() => "?").join(",")})` : "";
    const rows = await db.query<Row>(`SELECT path,language,is_key_file FROM project_files WHERE project_id=? ${placeholders} ORDER BY is_key_file DESC,path LIMIT 60`, [projectId, ...(paths || [])]);
    const blocks: string[] = [];
    for (const row of rows.slice(0, 8)) {
      const content = await readRepoFile(projectId, String(row.path));
      blocks.push(`## ${row.path}\n\n${compactText(content, 3000)}`);
    }
    return blocks.join("\n\n");
  }

  private async currentIndexFingerprint(projectId: number): Promise<string | null> {
    const status = await this.indexStatus(projectId);
    const value = status.indexed_fingerprint ?? status.active_generation;
    return value == null || value === "" ? null : String(value);
  }

  private async selectLessonFilePaths(projectId: number, query: string): Promise<string[]> {
    const existingRows = await db.query<Row>("SELECT path FROM project_files WHERE project_id=?", [projectId]);
    const existing = new Set(existingRows.map((row) => String(row.path)));
    const hits = await this.search(projectId, query, undefined, 8).catch(() => []);
    const files: string[] = [];
    for (const hit of hits) {
      if (existing.has(hit.path) && !files.includes(hit.path)) files.push(hit.path);
      if (files.length >= 8) break;
    }
    if (files.length < 2) {
      const keyRows = await db.query<Row>(
        "SELECT path FROM project_files WHERE project_id=? AND is_key_file=1 ORDER BY CASE WHEN lower(path)='readme.md' THEN 0 ELSE 1 END,path LIMIT 8",
        [projectId],
      );
      for (const row of keyRows) {
        const path = String(row.path);
        if (!files.includes(path)) files.push(path);
        if (files.length >= 2) break;
      }
    }
    return files.slice(0, 10);
  }

  private async persistLessonFiles(projectId: number, lessonNumber: number, files: string[]): Promise<void> {
    const fingerprint = await this.currentIndexFingerprint(projectId);
    await db.run("DELETE FROM lesson_files WHERE project_id=? AND lesson_number=?", [projectId, lessonNumber]);
    for (let rank = 0; rank < files.length; rank += 1) {
      await db.run(
        `INSERT INTO lesson_files(
          project_id,lesson_number,file_path,source,relevance_rank,indexed_fingerprint,updated_at
        ) VALUES(?,?,?,?,?,?,?)`,
        [projectId, lessonNumber, files[rank], "index", rank, fingerprint, now()],
      );
    }
  }

  private async selectLessonFiles(projectId: number, outline: string): Promise<void> {
    const pattern = /^###\s*第\s*(\d+)\s*课\s*[：:]\s*(.+?)\s*$/gm;
    const matches = [...outline.matchAll(pattern)];
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const lessonNumber = Number(match[1]);
      const title = match[2].trim();
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? outline.length;
      const section = outline.slice(start, end);
      const files = await this.selectLessonFilePaths(projectId, `${title} ${section.slice(0, 2000)}`);
      await this.persistLessonFiles(projectId, lessonNumber, files);
    }
  }

  private async ensureLessonFiles(
    projectId: number,
    lessonNumber: number,
    title: string,
    lessonSection: string,
    bypassCache = false,
  ): Promise<string[]> {
    if (bypassCache) {
      const files = await this.selectLessonFilePaths(projectId, `${title} ${lessonSection.slice(0, 2000)}`);
      await this.persistLessonFiles(projectId, lessonNumber, files);
      return files;
    }
    const rows = await db.query<Row>(
      `SELECT file_path,indexed_fingerprint FROM lesson_files
       WHERE project_id=? AND lesson_number=? ORDER BY relevance_rank,file_path`,
      [projectId, lessonNumber],
    );
    const fingerprint = await this.currentIndexFingerprint(projectId);
    const existingRows = await db.query<Row>("SELECT path FROM project_files WHERE project_id=?", [projectId]);
    const existing = new Set(existingRows.map((row) => String(row.path)));
    const stale = !rows.length
      || (fingerprint != null && rows.some((row) => String(row.indexed_fingerprint ?? "") !== fingerprint))
      || rows.some((row) => !existing.has(String(row.file_path)));
    if (!stale) return rows.map((row) => String(row.file_path));
    const files = await this.selectLessonFilePaths(projectId, `${title} ${lessonSection.slice(0, 2000)}`);
    await this.persistLessonFiles(projectId, lessonNumber, files);
    return files;
  }

  private async prepareLessonEvidence(
    projectId: number,
    lessonNumber: number,
    title: string,
    lessonSection: string,
    bypassCache = false,
  ) {
    const query = `${title} ${lessonSection.slice(0, 2000)}`.trim();
    const hits = (await this.search(projectId, query, undefined, 10).catch(() => []))
      .filter((item) => item.content.trim());
    const lessonFiles = await this.ensureLessonFiles(projectId, lessonNumber, title, lessonSection, bypassCache);
    const readable: ReadableEvidenceFile[] = [];
    const readFailed: string[] = [];
    for (const path of lessonFiles) {
      try {
        const content = await readRepoFile(projectId, path);
        if (!content.trim()) readFailed.push(path);
        else readable.push({ path, content, language: inferLanguage(path) });
      } catch {
        readFailed.push(path);
      }
    }
    const ranges: LessonEvidenceRange[] = hits
      .filter((item) => lessonFiles.includes(item.path))
      .map((item) => ({ path: item.path, startLine: item.start_line, endLine: item.end_line }));
    const assembly = assembleLessonFileEvidence(readable, ranges, readFailed);
    const seen = new Set<string>();
    const ragBlocks: string[] = [];
    const validHits = hits.filter((item) => assembly.included.includes(item.path));
    for (const item of validHits) {
      const key = `${item.path}:${item.start_line}:${item.end_line}:${item.content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ragBlocks.push(`### ${item.path}:${item.start_line}-${item.end_line}\n\`\`\`${item.language}\n${item.content.slice(0, 3600)}\n\`\`\``);
    }
    const ragContext = ragBlocks.join("\n\n");
    if (!assembly.content.trim() && !ragContext.trim()) {
      throw new Error("本课没有可用的真实代码内容。请刷新仓库文件并重新构建索引后再生成课件。");
    }
    const ragPaths = new Set(validHits.map((item) => item.path));
    const { content: _content, ...diagnostics } = assembly;
    return {
      fileBlocks: assembly.content,
      ragContext,
      preview: {
        ...diagnostics,
        file_count: assembly.included.length,
        snippet_count: ragBlocks.length + assembly.included.filter((path) => !ragPaths.has(path)).length,
        ready: true,
      },
    };
  }

  private async previewOutlineLessonEvidence(projectId: number, body: Record<string, unknown>) {
    const project = await this.getProject(projectId);
    if (project.project_type === "learning_plan") {
      return {
        file_count: 0, snippet_count: 0, included: [], truncated: [],
        read_failed: [], budget_skipped: [], ready: true,
      };
    }
    const outlinePath = String(body.outline_path || "outline.md");
    const outline = await readGeneratedFile(projectId, outlinePath);
    const lessonNumber = Number(body.lesson_number || 0);
    const title = String(body.title || "");
    const matches = [...outline.matchAll(/^###\s*第\s*(\d+)\s*课\s*[：:]\s*(.+?)\s*$/gm)];
    const index = matches.findIndex((match) => Number(match[1]) === lessonNumber);
    const start = index >= 0 ? (matches[index].index ?? 0) : 0;
    const end = index >= 0 ? (matches[index + 1]?.index ?? outline.length) : outline.length;
    const section = index >= 0 ? outline.slice(start, end) : title;
    return (await this.prepareLessonEvidence(projectId, lessonNumber, title, section, outlinePath !== "outline.md")).preview;
  }

  private async outlinePreflight(projectId: number, body: Record<string, unknown>): Promise<OutlinePreflight> {
    try {
      const settings = await this.getLLMSettings();
      const prompts = await this.getPrompts();
      const template = prompts["prompt.outline.questionnaire"] || "";
      if (!template) throw new Error("问卷提示词缺失，可跳过问卷直接生成总纲。");

      const project = await this.getProject(projectId);
      const scope = (body.scope ?? {}) as Record<string, unknown>;
      const instructions = String(body.instructions ?? "");
      const scopeText = String(scope.type || "full_project");
      const context = await this.projectContext(projectId, (scope.paths as string[] | undefined) ?? undefined);
      const promptInput = context || `学习范围：\n${scopeText}\n\n用户补充要求：\n${instructions || "无"}\n`;
      const preferences = await this.getLearnerPreferences(projectId);
      const prefsSummary = `前置知识：${preferences.prerequisiteDetail}；讲解深度：${preferences.answerDepth}；代码比例：${preferences.codeRatio}`;

      const prompt = renderPrompt(template, {
        scope_text: scopeText,
        user_instructions: instructions || "无",
        preferences_summary: prefsSummary,
        prompt_input: promptInput,
      });
      const raw = await this.callLLM([
        { role: "system", content: composeSystemPrompt(prompts["prompt.system"] || "你是课程规划助手。", "json_array") },
        { role: "user", content: prompt },
      ]);
      const questions = this.parseQuestionnaire(raw);
      const preflightId = `pf:${projectId}:${crypto.randomUUID().slice(0, 12)}`;
      return { preflight_id: preflightId, questions };
    } catch (error) {
      return {
        preflight_id: "",
        questions: [],
        status: "error",
        message: error instanceof Error ? error.message : "问卷生成失败",
      };
    }
  }

  private parseQuestionnaire(raw: string): OutlineQuestion[] {
    let text = raw.trim();
    if (text.startsWith("```")) {
      const lines = text.split("\n");
      if (lines[0]?.startsWith("```")) lines.shift();
      if (lines[lines.length - 1]?.trim() === "```") lines.pop();
      text = lines.join("\n").trim();
    }
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("问卷生成返回结构错误");
    const questions: OutlineQuestion[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const question = String(record.question ?? "").trim();
      if (!question) continue;
      const options = Array.isArray(record.options) ? record.options.slice(0, 8) : [];
      questions.push({
        question,
        question_type: String(record.question_type ?? "single_choice"),
        dimension: String(record.dimension ?? "other"),
        options,
        rationale: String(record.rationale ?? ""),
      });
    }
    if (!questions.length) throw new Error("问卷未生成任何有效问题");
    return questions;
  }

  private async outlineConfirm(projectId: number, body: Record<string, unknown>): Promise<GenerationTask> {
    const answers = Array.isArray(body.answers) ? body.answers as OutlineSurveyAnswer[] : [];
    const scope = (body.scope ?? {}) as Record<string, unknown>;
    const instructions = String(body.instructions ?? "");
    const intent = serializeLearningIntent(answers);
    const mergedInstructions = intent ? `${instructions}\n\n${intent}` : instructions;
    return this.queueTask(projectId, "outline", { ...body, instructions: mergedInstructions });
  }

  private async generateOutline(projectId: number, payload: Record<string, unknown>, taskId: number, inputHash: string): Promise<TaskOutput> {
    const project = await this.getProject(projectId); const prompts = await this.getPrompts();
    const key = project.project_type === "learning_plan" ? "prompt.learning_plan.outline" : "prompt.outline";
    const context = project.project_type === "learning_plan" ? "" : await this.projectContext(projectId, (payload.scope as Record<string, unknown>)?.paths as string[] | undefined);

    // Validate checkpoint
    const cp = parseOutlineCheckpoint(payload._checkpoint, "outline", inputHash);
    let content: string;
    if (cp?.generated && cp.generatedContent) {
      content = cp.generatedContent;
    } else {
      await db.run("UPDATE generation_tasks SET stage_label='生成学习总纲',updated_at=? WHERE id=?", [now(), taskId]);
      await this.reportProgress(taskId, "生成学习总纲", 0, 1, true);
      const settings = await this.getLLMSettings();
      let prompt = renderPrompt(prompts[key] || "生成详细学习总纲", {
        model: settings.model,
        scope_text: (payload.scope as Record<string, unknown>)?.type as string || (project.project_type === "learning_plan" ? "learning_plan" : "full_project"),
        user_instructions: String(payload.instructions || "无"),
        prompt_input: context,
      });
      if (project.project_type === "learning_plan") {
        prompt += bibliographyMetadataInstruction();
      }
      content = await this.callLLM([
        {
          role: "system",
          content: composeSystemPrompt(prompts["prompt.system"] || "你是学习助手。", "markdown"),
        },
        { role: "user", content: prompt },
      ]);
      if (project.project_type === "learning_plan") {
        const parsedBibliography = parseBibliographyMetadata(content);
        content = appendValidatedBibliography(
          parsedBibliography.content,
          parsedBibliography.selections,
        );
      }
      if (!content.startsWith("#")) content = `# ${project.project_type === "learning_plan" ? "学习计划总纲" : "项目学习总纲"}\n\n${content}`;
      if (project.project_type === "repository" && content.includes("## FILE:")) {
        const outlinePart = content.match(/## FILE:\s*outline\.md\s*([\s\S]*)/i)?.[1]?.trim(); if (outlinePart) content = outlinePart;
      }

      // Save checkpoint after LLM returns
      const checkpoint: OutlineCheckpoint = {
        version: CHECKPOINT_VERSION,
        taskType: "outline",
        inputHash,
        updatedAt: now(),
        generatedContent: content,
        generated: true,
      };
      await db.run("UPDATE generation_tasks SET payload_json=? WHERE id=?", [JSON.stringify({ ...payload, _checkpoint: checkpoint }), taskId]);
    }

    content = addOutlineLessonLinks(content);
    if (project.project_type === "repository") {
      await this.selectLessonFiles(projectId, content);
    }
    await this.reportProgress(taskId, "总纲生成完成", 1, 1, false);
    return { filename: "outline.md", content };
  }

  private async generateSubOutline(projectId: number, payload: Record<string, unknown>, taskId: number, inputHash: string): Promise<TaskOutput> {
    const prompts = await this.getPrompts();
    const paths = Array.isArray(payload.paths) ? payload.paths.map(String) : [];
    if (!paths.length) {
      throw new Error("子总纲需要至少选择一个文件。");
    }
    const title = String(payload.title || "");
    const filename = `sub-outline-${hashText(JSON.stringify({ paths, title }))}.md`;

    const cp = parseOutlineCheckpoint(payload._checkpoint, "sub_outline", inputHash);
    let content: string;
    if (cp?.generated && cp.generatedContent) {
      content = cp.generatedContent;
    } else {
      await db.run("UPDATE generation_tasks SET stage_label='生成子总纲',updated_at=? WHERE id=?", [now(), taskId]);
      await this.reportProgress(taskId, "生成子总纲", 0, 1, true);
      const settings = await this.getLLMSettings();
      const context = await this.projectContext(projectId, paths);
      const prompt = renderPrompt(prompts["prompt.outline"] || "生成详细学习总纲", {
        model: settings.model,
        scope_text: `files: ${paths.slice(0, 80).join(", ")}`,
        user_instructions: String(payload.instructions || title || "无"),
        prompt_input: context,
      });
      content = await this.callLLM([
        {
          role: "system",
          content: composeSystemPrompt(prompts["prompt.system"] || "你是学习助手。", "markdown"),
        },
        { role: "user", content: prompt },
      ]);
      if (!content.startsWith("#")) content = `# ${title || "子学习总纲"}\n\n${content}`;
      if (content.includes("## FILE:")) {
        const outlinePart = content.match(/## FILE:\s*outline\.md\s*([\s\S]*)/i)?.[1]?.trim();
        if (outlinePart) content = outlinePart;
      }

      const checkpoint: OutlineCheckpoint = {
        version: CHECKPOINT_VERSION,
        taskType: "sub_outline",
        inputHash,
        updatedAt: now(),
        generatedContent: content,
        generated: true,
      };
      await db.run("UPDATE generation_tasks SET payload_json=? WHERE id=?", [JSON.stringify({ ...payload, _checkpoint: checkpoint }), taskId]);
    }

    content = addOutlineLessonLinks(content, filename);
    await this.reportProgress(taskId, "子总纲生成完成", 1, 1, false);
    return { filename, content };
  }

  private async generateFileLesson(projectId: number, payload: Record<string, unknown>, taskId: number, inputHash: string): Promise<TaskOutput> {
    const prompts = await this.getPrompts();
    const sourcePath = String(payload.path || "");
    const content = await readRepoFile(projectId, sourcePath);
    const mode = payload.mode === "detailed" ? "detailed" : "brief";
    const expected = prompts[`prompt.file_lesson.${mode}_expected`] || "详细解释文件职责、结构、关键符号和练习。";
    const settings = await this.getLLMSettings();
    const cp = parseOutlineCheckpoint(payload._checkpoint, "file_lesson", inputHash);

    let lesson: string;
    if (cp?.generated && cp.generatedContent) {
      lesson = cp.generatedContent;
    } else {
      const prompt = renderPrompt(prompts["prompt.file_lesson.template"] || "生成文件课件", {
        mode_label: mode === "detailed" ? "详细分析" : "粗略介绍",
        relative_path: sourcePath,
        user_instructions: String(payload.instructions || "无"),
        model: settings.model,
        expected,
        prompt_input: compactText(content, mode === "detailed" ? 24000 : 10000),
      });
      lesson = await this.callLLM([
        {
          role: "system",
          content: composeSystemPrompt(prompts["prompt.system"] || "你是软件工程讲师。", "markdown"),
        },
        { role: "user", content: prompt },
      ]);

      // Save full-response checkpoint
      const checkpoint: OutlineCheckpoint = {
        version: CHECKPOINT_VERSION,
        taskType: "file_lesson",
        inputHash,
        updatedAt: now(),
        generatedContent: lesson,
        generated: true,
      };
      await db.run("UPDATE generation_tasks SET payload_json=? WHERE id=?", [JSON.stringify({ ...payload, _checkpoint: checkpoint }), taskId]);
    }

    const title = `${sourcePath} ${mode === "detailed" ? "详细分析" : "粗略介绍"}`;
    if (!lesson.startsWith("#")) lesson = `# ${title}\n\n${lesson}`;
    return { filename: `files/${sourcePath.replace(/[^\p{L}\p{N}_.-]+/gu, "_")}_${mode}.md`, content: lesson };
  }

  private async generateOutlineLesson(projectId: number, payload: Record<string, unknown>, taskId: number, inputHash: string): Promise<TaskOutput> {
    const project = await this.getProject(projectId); const prompts = await this.getPrompts();
    const outlinePath = String(payload.outline_path || "outline.md");
    const outline = await readGeneratedFile(projectId, outlinePath);
    const key = project.project_type === "learning_plan" ? "prompt.learning_plan.lesson" : "prompt.outline_lesson";
    const settings = await this.getLLMSettings();
    let lessonInput = `项目学习总纲：\n${compactText(outline, 16000)}`;
    if (project.project_type === "repository") {
      const lessonNumber = Number(payload.lesson_number || 0);
      const matches = [...outline.matchAll(/^###\s*第\s*(\d+)\s*课\s*[：:]\s*(.+?)\s*$/gm)];
      const index = matches.findIndex((match) => Number(match[1]) === lessonNumber);
      const sectionStart = index >= 0 ? (matches[index].index ?? 0) : 0;
      const sectionEnd = index >= 0 ? (matches[index + 1]?.index ?? outline.length) : outline.length;
      const lessonSection = index >= 0 ? outline.slice(sectionStart, sectionEnd) : String(payload.title || "");
      const evidence = await this.prepareLessonEvidence(
        projectId,
        lessonNumber,
        String(payload.title || ""),
        lessonSection,
        outlinePath !== "outline.md",
      );
      lessonInput += `\n\n涉及文件代码：\n${evidence.fileBlocks}`;
      lessonInput += `\n\nRAG 索引检索片段：\n${evidence.ragContext || "（相关文件正文已加载，索引没有额外命中片段。）"}`;
    }
    const base = project.project_type === "learning_plan"
      ? `${prompts[key] || "生成完整课件"}\n\n第 ${payload.lesson_number} 课：${payload.title}\n用户要求：${payload.instructions || "无"}\n\n总纲：\n${compactText(outline, 18000)}`
      : renderPrompt(prompts[key] || "生成完整课件", {
        lesson_number: payload.lesson_number,
        lesson_title: payload.title,
        user_instructions: payload.instructions || "无",
        model: settings.model,
        lesson_input: lessonInput,
      });
    return this.generateDetailedLesson(
      projectId,
      payload,
      taskId,
      base,
      prompts["prompt.system"] || "你是学习课程设计师。",
      inputHash,
    );
  }

  private async generateDetailedLesson(
    projectId: number, payload: Record<string, unknown>, taskId: number,
    base: string, editableSystemPrompt: string, inputHash: string,
  ): Promise<TaskOutput> {

    await db.run("UPDATE generation_tasks SET progress_current=0,progress_total=12,stage_label='planning',updated_at=? WHERE id=?", [now(), taskId]);
    await this.reportProgress(taskId, "正在规划课件", 0, 12, true);

    // Parse or recover plan from checkpoint
    const rawCp = payload._checkpoint;
    const dlCp = parseDetailedLessonCheckpoint(rawCp, inputHash);

    const plannerPrompt = `你是一位课程设计师。现在要根据课程材料，为其中一课制定详细的章节规划。\n\n本课名称：${payload.title}\n本课是课程路线中的第 ${payload.lesson_number} 课。\n\n你的任务：阅读下方课程材料，从中提取本课应该覆盖的全部知识内容，并将其组织为 4-10 个章节。每个章节必须列出明确的知识项（函数、API、语法、概念、公式或方法）。不能使用"其他相关知识"等笼统项。\n\n只输出一个 JSON 对象，不要输出 Markdown 或额外解释：\n\n{\n  "lesson_title": "${payload.title}",\n  "position": "本课在学习路线中的位置（从课程材料推断）",\n  "objectives": ["可验证的学习目标"],\n  "sections": [\n    {\n      "title": "章节标题",\n      "items": [\n        {"name": "具体的知识项名称", "kind": "function 或 concept", "focus": "讲解重点（可选，可为空字符串）"}\n      ]\n    }\n  ],\n  "textbooks": [{"id": "只能从允许书目中选择的 ID", "topics": ["只能逐字选择该书允许的主题"]}]\n}\n\n允许书目：\n${bibliographyForPrompt()}\n\n教材不确定或没有直接匹配时 textbooks 返回空数组。不要自行输出书名、作者、章节号、页码、版次或未列出的主题。\n\n用户补充要求：${payload.instructions || "无"}\n\n课程材料：\n${base}`;

    const plan = dlCp?.plan
      ? dlCp.plan
      : parseLessonPlan(await this.callLLM([
        { role: "system", content: composeSystemPrompt(editableSystemPrompt, "json") },
        { role: "user", content: plannerPrompt },
      ]));

    let totalCalls = 2 + plan.sections.length;

    // Recover generated sections by index
    const generatedByIndex: Map<number, string> = new Map();
    if (dlCp?.generatedByIndex) {
      for (const [key, value] of Object.entries(dlCp.generatedByIndex)) {
        const idx = Number(key);
        if (Number.isFinite(idx) && idx >= 0 && idx < plan.sections.length && typeof value === "string" && value.trim()) {
          generatedByIndex.set(idx, value);
        }
      }
    }
    const completedCount = generatedByIndex.size;

    // Mutable repair state — survives across batch boundaries and restores on cold start
    let repairGenerated: string | null = dlCp?.repairGenerated ?? null;

    // Save plan to checkpoint immediately
    const saveCheckpoint = async () => {
      const obj: Record<string, string> = {};
      for (const [k, v] of generatedByIndex) obj[String(k)] = v;
      const cp: DetailedLessonCheckpoint = {
        version: CHECKPOINT_VERSION,
        taskType: "outline_lesson",
        inputHash,
        updatedAt: now(),
        plan,
        generatedByIndex: obj,
      };
      if (repairGenerated) cp.repairGenerated = repairGenerated;
      await db.run("UPDATE generation_tasks SET payload_json=? WHERE id=?", [JSON.stringify({ ...payload, _checkpoint: cp }), taskId]);
    };

    if (!dlCp?.plan) await saveCheckpoint();

    await db.run("UPDATE generation_tasks SET progress_current=?,progress_total=?,stage_label=?,updated_at=? WHERE id=?", [1 + completedCount, totalCalls, completedCount ? `已恢复 ${completedCount}/${plan.sections.length} 个章节` : "章节计划已完成", now(), taskId]);
    await this.reportProgress(taskId, completedCount ? `已恢复 ${completedCount}/${plan.sections.length} 个章节` : "章节计划已完成", 1 + completedCount, totalCalls, false);

    const genSection = async (sectionIndex: number, sec: LessonPlanSection): Promise<string> => {
      const itemLines = sec.items.map((item) => `- ${item.name}（类型：${item.kind}；重点：${item.focus || "完整讲清"}）`).join("\n");
      const sectionPrompt = `你正在编写一节课中的一个核心正文章节，而不是完整课件。\n\n本课：第 ${payload.lesson_number} 课"${payload.title}"\n章节标题：${sec.title}\n本章知识项：\n${itemLines}\n\n输出要求：\n- 直接以 \`## ${sec.title}\` 开始，只输出本章 Markdown。\n- 每个知识项必须以包含其完整名称的 \`###\` 小节单独展开。\n- 围绕知识项解释直觉、机制和必要示例；深度以讲清为准，不设置固定段落或示例数量。\n- 不要输出本课定位、目标、知识地图、前置知识总表、综合案例、全课练习、自测、常见误区、总结或教材参照；这些由统一整合阶段生成。\n- 不要重复其他章节应负责的知识；无法由材料确认的内容明确标注证据不足。\n\n用户补充要求：${payload.instructions || "无"}\n\n课程材料：\n${base}`;
      let markdown = (await this.callLLM([
        { role: "system", content: composeSystemPrompt(editableSystemPrompt, "markdown") },
        { role: "user", content: sectionPrompt },
      ])).trim();
      if (!markdown.startsWith("##")) markdown = `## ${sec.title}\n\n${markdown}`;
      return markdown;
    };

    // Identify remaining sections (by index)
    const remainingIndices: number[] = [];
    for (let i = 0; i < plan.sections.length; i++) {
      if (!generatedByIndex.has(i)) remainingIndices.push(i);
    }

    // Process remaining sections in batches
    for (let batchStart = 0; batchStart < remainingIndices.length; batchStart += MOBILE_LESSON_CONCURRENCY) {
      const batchIndices = remainingIndices.slice(batchStart, batchStart + MOBILE_LESSON_CONCURRENCY);
      const batchSections = batchIndices.map((i) => ({ index: i, section: plan.sections[i] }));

      await db.run("UPDATE generation_tasks SET stage_label=?,updated_at=? WHERE id=?", [
        `并发生成 section ${batchIndices[0] + 1}-${batchIndices[batchIndices.length - 1] + 1}/${plan.sections.length}`,
        now(), taskId,
      ]);
      await this.reportProgress(taskId, `生成第 ${batchIndices[0] + 1}-${batchIndices[batchIndices.length - 1] + 1}/${plan.sections.length} 章`, 1 + completedCount, totalCalls, false);

      const results = await Promise.allSettled(batchSections.map(({ index, section }) =>
        genSection(index, section).then((html) => ({ index, html }))
      ));

      // Save all fulfilled results to the map BEFORE checkpointing
      for (const result of results) {
        if (result.status === "fulfilled") {
          generatedByIndex.set(result.value.index, result.value.html);
        }
      }

      // Persist checkpoint — even if some failed, the succeeded ones are saved
      await saveCheckpoint();

      // Now check for failures
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) throw failed.reason;

      const progressLabel = `已完成 ${generatedByIndex.size}/${plan.sections.length} 个章节`;
      await db.run("UPDATE generation_tasks SET progress_current=?,stage_label=?,updated_at=? WHERE id=?", [
        1 + generatedByIndex.size, progressLabel, now(), taskId,
      ]);
      await this.reportProgress(taskId, progressLabel, 1 + generatedByIndex.size, totalCalls, false);
    }

    // Build body in plan order
    const orderedSections: string[] = [];
    for (let i = 0; i < plan.sections.length; i++) {
      const section = generatedByIndex.get(i);
      if (section) orderedSections.push(section);
    }
    let body = orderedSections.join("\n\n");
    const missing = missingLessonItems(body, plan.sections);

    if (!repairGenerated) {
      await db.run(
        "UPDATE generation_tasks SET progress_current=?,progress_total=?,stage_label=?,updated_at=? WHERE id=?",
        [totalCalls - 1, totalCalls, "正在统一整合课件", now(), taskId],
      );
      await this.reportProgress(taskId, "正在统一整合课件", totalCalls - 1, totalCalls, false);
      const planLines = plan.sections
        .map((section) => `- ${section.title}：${section.items.map((item) => item.name).join("、")}`)
        .join("\n");
      const missingLines = missing.length
        ? missing.map((item) => `- ${item.name}（${item.kind}）：${item.focus}`).join("\n")
        : "- 无";
      const excerpts = orderedSections
        .map((markdown, index) => `### ${plan.sections[index].title} 摘要\n${markdown.slice(0, 1600)}`)
        .join("\n\n");
      repairGenerated = (await this.callLLM([
        { role: "system", content: composeSystemPrompt(editableSystemPrompt, "markdown") },
        {
          role: "user",
          content: `你是本课的责任编辑。核心章节已经分别生成，请只补充一次全课公共部分，不要重写章节正文。\n\n本课：第 ${payload.lesson_number} 课"${payload.title}"\n章节与知识项：\n${planLines}\n\n章节正文摘要：\n${excerpts}\n\n尚未被正文明确覆盖的知识项：\n${missingLines}\n\n只输出适用的 Markdown 二级章节：\n- \`## 必要补充\`：仅在存在遗漏知识项时逐项补足。\n- \`## 综合串联\`：用一个连贯流程或案例连接章节，不重复各节定义和完整代码。\n- \`## 常见误区\`：只列能够解释原因和验证方式的误区，不设数量要求。\n- \`## 练习与自测\`：全课只生成一组练习与答案要点，每题写明判断标准。\n- \`## 本课小结\`：简短总结目标之间的关系，不逐节复述。\n\n禁止输出教材参照、前置知识总表、课程目标或知识地图。不要为了凑齐标题输出空泛内容。\n用户补充要求：${payload.instructions || "无"}`,
        },
      ])).trim();
      await saveCheckpoint();
    }

    body = dedupeLessonMarkdown(`${body}\n\n${repairGenerated || ""}`);
    if (missingLessonItems(body, plan.sections).length) {
      throw new Error("统一整合后仍有规划知识项未覆盖，旧课件已保留。");
    }

    const title = plan.lesson_title || String(payload.title || `第 ${payload.lesson_number} 课`);
    const objectiveLines = plan.objectives.length ? plan.objectives.map((item) => `- ${item}`).join("\n") : "- 完成本课知识地图中的全部项目。";
    const mapLines = ["| 章节 | 必须掌握的知识项 |", "|---|---|", ...plan.sections.map((section) => `| ${section.title} | ${section.items.map((item) => item.name).join("、")} |`)];
    const textbookSection = bibliographyMarkdown(plan.textbooks);
    const content = `# 第 ${payload.lesson_number} 课：${title}\n\n> 生成方式：AI 分章节生成  \n> 教材说明：书目来自 CodeCourse 内置校验目录，课件未读取教材原文。\n\n## 本课定位\n\n${plan.position || "本课承接学习总纲中的对应阶段。"}\n\n## 本课目标\n\n${objectiveLines}\n\n## 知识地图\n\n${mapLines.join("\n")}\n\n${body}\n\n${textbookSection}\n`;
    return { filename: `lessons/lesson_${String(payload.lesson_number).padStart(2, "0")}.md`, content };
  }

  // ---- index ----
  private async buildIndex(projectId: number): Promise<ProjectIndexStatus> {
    if (this.runningIndexes.has(projectId)) return this.indexStatus(projectId);
    this.runningIndexes.add(projectId);
    await this.setSetting(`index.${projectId}.status`, JSON.stringify({ status: "building", chunk_count: 0, updated_at: now(), stage: "scanning" }));
    try {
      const files = await db.query<Row>("SELECT path,language FROM project_files WHERE project_id=? ORDER BY path", [projectId]);
      const existingRows = await db.query<Row>("SELECT relative_path, file_size, mtime_ns, content_hash, language FROM indexed_files WHERE project_id=?", [projectId]);
      const existingMap = new Map<string, Row>();
      for (const row of existingRows) existingMap.set(String(row.relative_path), row);

      const newPaths: string[] = [];
      const unchangedPaths: string[] = [];
      for (const file of files) {
        const existing = existingMap.get(String(file.path));
        if (!existing) { newPaths.push(String(file.path)); } else { unchangedPaths.push(String(file.path)); }
      }
      const existingPaths = new Set(existingMap.keys());
      const currentPaths = new Set(files.map((f) => String(f.path)));
      const stalePaths = [...existingPaths].filter((p) => !currentPaths.has(p));

      const genRow = (await db.query<Row>("SELECT COALESCE(MAX(generation), 0) AS mx FROM code_chunks WHERE project_id=?", [projectId]))[0];
      const newGen = Number(genRow.mx) + 1;
      const activeGen = newGen > 1 ? newGen - 1 : 0;

      await this.setSetting(`index.${projectId}.status`, JSON.stringify({
        status: "building", chunk_count: 0, updated_at: now(),
        stage: "building_text_index", progress_current: 0, progress_total: newPaths.length,
        unchanged_files: unchangedPaths.length, added_files: newPaths.length, updated_files: 0, deleted_files: stalePaths.length,
      }));

      let totalChunks = 0;
      const allFiles = [...newPaths];
      for (let i = 0; i < allFiles.length; i++) {
        const path = allFiles[i];
        const fileRow = (await db.query<Row>("SELECT language FROM project_files WHERE project_id=? AND path=?", [projectId, path]))[0];
        const language = String(fileRow?.language || "plaintext");
        const content = await readRepoFile(projectId, path);
        let hashValue = 0;
        for (let j = 0; j < content.length; j += 1) { hashValue = Math.imul(hashValue ^ content.charCodeAt(j), 16777619); }
        const contentHash = (hashValue >>> 0).toString(16).padStart(8, "0");

        const lines = content.split("\n");
        for (let start = 0; start < lines.length; start += 70) {
          const block = lines.slice(start, start + 80).join("\n"); if (!block.trim()) continue;
          const symbol = block.match(/(?:class|interface|struct|def|function|fn|func)\s+([A-Za-z_$][\w$]*)/)?.[1] || null;
          const id = await db.run("INSERT INTO code_chunks(project_id,path,language,start_line,end_line,chunk_type,symbol_name,content,generation) VALUES(?,?,?,?,?,?,?,?,?)", [projectId, path, language, start + 1, Math.min(lines.length, start + 80), symbol ? "symbol" : "block", symbol, block, newGen]);
          await db.run("INSERT INTO code_chunks_fts(rowid,project_id,path,symbol_name,content) VALUES(?,?,?,?,?)", [id, projectId, path, symbol, block]);
          totalChunks += 1;
        }

        await db.run("INSERT INTO indexed_files(project_id,relative_path,file_size,mtime_ns,content_hash,language,indexed_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,relative_path) DO UPDATE SET file_size=excluded.file_size,mtime_ns=excluded.mtime_ns,content_hash=excluded.content_hash,language=excluded.language,indexed_at=excluded.indexed_at", [projectId, path, content.length, 0, contentHash, language, now()]);

        if ((i + 1) % 5 === 0) {
          await this.setSetting(`index.${projectId}.status`, JSON.stringify({
            status: "building", chunk_count: totalChunks, updated_at: now(),
            stage: "building_text_index", progress_current: i + 1, progress_total: allFiles.length,
          }));
        }
      }

      for (const path of unchangedPaths) {
        const oldChunks = await db.query<Row>("SELECT path,language,start_line,end_line,chunk_type,symbol_name,content FROM code_chunks WHERE project_id=? AND path=? AND generation=?", [projectId, path, activeGen]);
        for (const chunk of oldChunks) {
          const id = await db.run("INSERT INTO code_chunks(project_id,path,language,start_line,end_line,chunk_type,symbol_name,content,generation) VALUES(?,?,?,?,?,?,?,?,?)", [projectId, chunk.path, chunk.language, Number(chunk.start_line), Number(chunk.end_line), chunk.chunk_type, chunk.symbol_name, chunk.content, newGen]);
          await db.run("INSERT INTO code_chunks_fts(rowid,project_id,path,symbol_name,content) VALUES(?,?,?,?,?)", [id, projectId, chunk.path, chunk.symbol_name, chunk.content]);
          totalChunks += 1;
        }
      }

      for (const stalePath of stalePaths) {
        await db.run("DELETE FROM code_chunks_fts WHERE rowid IN (SELECT id FROM code_chunks WHERE project_id=? AND path=?)", [projectId, stalePath]);
        await db.run("DELETE FROM code_chunks WHERE project_id=? AND path=?", [projectId, stalePath]);
        await db.run("DELETE FROM indexed_files WHERE project_id=? AND relative_path=?", [projectId, stalePath]);
      }

      if (activeGen > 0) {
        await db.run("DELETE FROM code_chunks_fts WHERE rowid IN (SELECT id FROM code_chunks WHERE project_id=? AND generation=?)", [projectId, activeGen]);
        await db.run("DELETE FROM code_chunks WHERE project_id=? AND generation=?", [projectId, activeGen]);
      }

      const result = {
        project_id: projectId, status: "ready", chunk_count: totalChunks, updated_at: now(), error_message: null,
        stage: "completed", active_generation: newGen, unchanged_files: unchangedPaths.length,
        added_files: newPaths.length, updated_files: 0, deleted_files: stalePaths.length,
      };
      await this.setSetting(`index.${projectId}.status`, JSON.stringify(result));
      return result;
    } catch (error) {
      const result = { project_id: projectId, status: "failed", chunk_count: 0, updated_at: now(), error_message: safeErrorMessage(error), stage: "failed" };
      await this.setSetting(`index.${projectId}.status`, JSON.stringify(result));
      return result;
    } finally { this.runningIndexes.delete(projectId); }
  }
  private async resumeIndexes(): Promise<void> {
    const rows = await db.query<Row>("SELECT id FROM projects WHERE project_type='repository'");
    for (const row of rows) {
      const status = await this.indexStatus(Number(row.id));
      if (status.status === "building") void this.buildIndex(Number(row.id));
    }
  }
  private async indexStatus(projectId: number): Promise<ProjectIndexStatus> {
    const value = await this.setting(`index.${projectId}.status`); return value ? JSON.parse(value) : { project_id: projectId, status: "not_built", chunk_count: 0, updated_at: null, error_message: null };
  }
  private async search(projectId: number, rawQuery: string, sourcePath?: string, rawLimit = 8): Promise<ProjectSearchResult[]> {
    const query = String(rawQuery || "").trim(); if (!query) return []; const limit = Math.min(20, Math.max(1, Number(rawLimit || 8)));
    const terms = query.match(/[\p{L}\p{N}_.$:-]{2,}/gu)?.slice(0, 8) || [query]; const ftsQuery = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
    const maxGenRow = (await db.query<Row>("SELECT COALESCE(MAX(generation), 0) AS mx FROM code_chunks WHERE project_id=?", [projectId]))[0];
    const activeGen = Number(maxGenRow.mx);
    let rows: Row[] = [];
    try {
      rows = await db.query<Row>(`SELECT c.* FROM code_chunks_fts f JOIN code_chunks c ON c.id=f.rowid WHERE f.project_id=? AND code_chunks_fts MATCH ? AND (c.generation=? OR ?=0) ORDER BY CASE WHEN c.path=? THEN 0 ELSE 1 END LIMIT ?`, [projectId, ftsQuery, activeGen, activeGen, sourcePath || "", limit]);
    } catch {
      rows = await db.query<Row>("SELECT * FROM code_chunks WHERE project_id=? AND (content LIKE ? OR symbol_name LIKE ? OR path LIKE ?) AND (generation=? OR ?=0) ORDER BY CASE WHEN path=? THEN 0 ELSE 1 END LIMIT ?", [projectId, `%${query}%`, `%${query}%`, `%${query}%`, activeGen, activeGen, sourcePath || "", limit]);
    }
    return rows.map((row, index): ProjectSearchResult => ({ path: String(row.path), language: String(row.language), start_line: Number(row.start_line), end_line: Number(row.end_line), chunk_type: String(row.chunk_type), symbol_name: row.symbol_name ? String(row.symbol_name) : null, content: String(row.content), score: 1 / (index + 1) }));
  }

  // ---- learning states ----
  private async learningSourceExists(projectId: number, sourceType: LearningState["source_type"], sourcePath: string): Promise<boolean> {
    if (sourceType === "file") {
      return (await db.query<Row>("SELECT id FROM project_files WHERE project_id=? AND path=?", [projectId, sourcePath])).length > 0;
    }
    if (sourceType === "qa") {
      return (await db.query<Row>("SELECT id FROM qa_records WHERE project_id=? AND output_path=?", [projectId, sourcePath])).length > 0;
    }
    return (await db.query<Row>("SELECT id FROM course_files WHERE project_id=? AND filename=?", [projectId, sourcePath])).length > 0;
  }

  private async listLearningStates(projectId: number): Promise<LearningState[]> {
    await this.getProject(projectId);
    const rows = await db.query<Row>("SELECT * FROM learning_states WHERE project_id=? ORDER BY last_opened_at DESC,id DESC", [projectId]);
    const valid: LearningState[] = [];
    for (const row of rows) {
      const state = learningStateFromRow(row);
      if (await this.learningSourceExists(projectId, state.source_type, state.source_path)) {
        valid.push(state);
      } else {
        await db.run("DELETE FROM learning_states WHERE id=?", [state.id]);
      }
    }
    return valid;
  }

  private async updateLearningState(projectId: number, payload: LearningStateUpdate): Promise<LearningState> {
    await this.getProject(projectId);
    const sourceType = payload.source_type;
    const sourcePath = String(payload.source_path || "").trim();
    if (!sourcePath || !(await this.learningSourceExists(projectId, sourceType, sourcePath))) {
      throw new Error("学习来源不存在。");
    }
    const status = payload.status === "completed" ? "completed" : "in_progress";
    const positionKind = payload.position_kind === "line" ? "line" : "scroll_ratio";
    const rawPosition = Number(payload.position_value || 0);
    const positionValue = positionKind === "line" ? Math.max(1, Math.round(rawPosition)) : Math.min(1, Math.max(0, rawPosition));
    const stamp = now();
    const completedAt = status === "completed" ? stamp : null;
    await db.run(`INSERT INTO learning_states(project_id,source_type,source_path,status,position_kind,position_value,last_opened_at,completed_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,source_type,source_path) DO UPDATE SET
        status=excluded.status,
        position_kind=excluded.position_kind,
        position_value=excluded.position_value,
        last_opened_at=excluded.last_opened_at,
        completed_at=CASE WHEN excluded.status='completed' THEN COALESCE(learning_states.completed_at,excluded.completed_at) ELSE NULL END,
        updated_at=excluded.updated_at`, [projectId, sourceType, sourcePath, status, positionKind, positionValue, stamp, completedAt, stamp]);
    const row = (await db.query<Row>("SELECT * FROM learning_states WHERE project_id=? AND source_type=? AND source_path=?", [projectId, sourceType, sourcePath]))[0];
    if (!row) throw new Error("学习进度保存失败。");
    return learningStateFromRow(row);
  }

  private async resetLearningStates(projectId: number): Promise<{ reset: boolean; deleted: number }> {
    await this.getProject(projectId);
    const existing = await db.query<Row>("SELECT id FROM learning_states WHERE project_id=?", [projectId]);
    await db.run("DELETE FROM learning_states WHERE project_id=?", [projectId]);
    return { reset: true, deleted: existing.length };
  }

  // ---- QA ----
  private async sourceContext(projectId: number, payload: QAAskPayload): Promise<string> {
    const selected = String(payload.selected_text || "").trim();
    let source = "";
    if (payload.source_path) {
      try {
        if (payload.source_type === "file") source = await readRepoFile(projectId, payload.source_path);
        else source = await readGeneratedFile(projectId, payload.source_path);
      } catch { source = ""; }
    }
    if (!payload.source_path) {
      const summaries: string[] = [];
      for (const filename of ["project_map.md", "outline.md"]) {
        try { summaries.push(`## ${filename}\n${compactText(await readGeneratedFile(projectId, filename), 5000)}`); } catch { /* optional */ }
      }
      source = summaries.join("\n\n");
    }
    let anchoredContext = "";
    if (payload.source_type === "file" && source && payload.selection_range) {
      const lines = source.split("\n");
      const start = Math.max(0, payload.selection_range.start_line - 9);
      const end = Math.min(lines.length, payload.selection_range.end_line + 8);
      anchoredContext = `选区前后文（${start + 1}-${end} 行）：\n${lines.slice(start, end).map((line, index) => `${start + index + 1}: ${line}`).join("\n")}`;
    } else if (selected && source) {
      const at = source.indexOf(selected);
      if (at >= 0) anchoredContext = `选区前后文：\n${source.slice(Math.max(0, at - 1600), Math.min(source.length, at + selected.length + 1600))}`;
    }
    const results = await this.search(projectId, `${payload.question} ${selected}`, payload.source_path ?? undefined, 6).catch(() => []);
    const evidence = results.map((item) => `### ${item.path}:${item.start_line}-${item.end_line}\n${item.content}`).join("\n\n");
    const anchorTerms = `${payload.question} ${selected}`.match(/[\p{L}\p{N}_-]{2,}/gu)?.slice(0, 6) || [];
    const anchorRows = anchorTerms.length
      ? await db.query<Row>(`SELECT term_text,summary FROM learning_anchors WHERE project_id=? AND (${anchorTerms.map(() => "summary LIKE ? OR term_text LIKE ?").join(" OR ")}) ORDER BY updated_at DESC LIMIT 4`, [projectId, ...anchorTerms.flatMap((term) => [`%${term}%`, `%${term}%`])])
      : [];
    const anchors = anchorRows.map((row) => `- ${row.term_text || "个人总结"}：${row.summary}`).join("\n");
    return `来源：${payload.source_type} ${payload.source_path || "项目"}\n\n${selected ? `用户附带上下文：\n${selected}` : `当前文档摘要：\n${compactText(source, 8000)}`}\n\n${anchoredContext}\n\n相关项目证据：\n${evidence || "暂无索引命中"}\n\n学习者已确认的理解：\n${anchors || "暂无"}`;
  }
  private parseAnswer(raw: string, payload: QAAskPayload): { title: string; answer: string; terms: StructuredTermCandidate[] } {
    const titleLine = raw.match(/^TITLE:\s*(.+)$/mi)?.[1]?.trim();
    const termsLine = raw.match(/^TERMS:\s*(.+)$/mi)?.[1] || "";
    const answer = raw.replace(/^TITLE:.*$/mi, "").replace(/^TERMS:.*$/mi, "").trim();
    const selected = String(payload.selected_text || "").trim().split(/\s+/)[0];
    const title = (titleLine || selected || payload.question || "AI 回答").slice(0, 48);
    let parsedTerms: unknown = [];
    try { parsedTerms = JSON.parse(termsLine); } catch { parsedTerms = termsLine.split(/[,，、]/); }
    const terms = (Array.isArray(parsedTerms) ? parsedTerms : [])
      .map((term) => validateTermCandidate(
        term as TermCandidateInput,
        answer,
        { source: "model", confidence: 0.94 },
      ))
      .filter((term): term is StructuredTermCandidate => term !== null)
      .filter((term, index, values) =>
        values.findIndex(
          (candidate) => candidate.canonical_name.toLocaleLowerCase() === term.canonical_name.toLocaleLowerCase(),
        ) === index
      )
      .slice(0, 20);
    return { title, answer, terms };
  }
  private formatQA(record: QARecord): string {
    return `# ${record.display_title || record.question}\n\n## 问题\n\n${record.question}\n\n## 附带上下文\n\n${record.selected_text || "无选区内容"}\n\n## 回答\n\n${record.answer_md}\n\n---\n\n来源：${record.source_type} ${record.source_path || "项目"}  \n模型：${record.model}  \n创建时间：${record.created_at}\n`;
  }
  private async relevantConcepts(
    projectId: number,
    question: string,
    selectedText: string,
    sourceType?: string,
    sourcePath?: string | null,
  ): Promise<PersonalizationConcept[]> {
    const haystack = `${question}\n${selectedText}`.toLocaleLowerCase();
    if (selectedText.trim() && selectedText.trim().length <= 80) {
      await this.resolvePersonalizationTerms(projectId, [{
        text: selectedText.trim(),
        source: "rule",
        confidence: 0.9,
      }]);
    }
    const concepts = await this.listPersonalizationConcepts(projectId);
    const matched = new Map<string, PersonalizationConcept>();
    for (const concept of concepts) {
      if ([concept.canonicalName, ...concept.aliases].some(
        (name) => name.length >= 2 && haystack.includes(name.toLocaleLowerCase()),
      )) {
        matched.set(concept.id, concept);
      }
    }
    if ((sourceType === "course" || sourceType === "qa") && sourcePath) {
      const terms = await db.query<Row>(
        "SELECT concept_id,term_text FROM document_terms WHERE project_id=? AND source_type=? AND source_path=?",
        [projectId, sourceType, sourcePath],
      );
      for (const term of terms) {
        if (!haystack.includes(String(term.term_text).toLocaleLowerCase())) continue;
        const concept = concepts.find((item) => item.id === String(term.concept_id));
        if (concept) matched.set(concept.id, concept);
      }
    }
    return [...matched.values()].slice(0, 8);
  }

  private async learnerContextForQuestion(
    projectId: number,
    payload: QAAskPayload,
  ): Promise<string> {
    const preferences = await this.getLearnerPreferences(projectId);
    const concepts = await this.relevantConcepts(
      projectId,
      payload.question,
      payload.selected_text || "",
      payload.source_type,
      payload.source_path,
    );
    const status = {
      known: [] as string[],
      unfamiliar: [] as string[],
      uncertain: [] as string[],
    };
    const conceptIds: string[] = [];
    const knowledgeStates = (await this.getKnowledgeStatesV2(
      projectId,
      concepts.map((concept) => concept.id),
    )).states;
    const stateByConcept = new Map(
      knowledgeStates.map((state) => [state.conceptId, state]),
    );
    for (const concept of concepts) {
      conceptIds.push(concept.id);
      const dimensions = stateByConcept.get(concept.id)?.dimensions;
      if (
        dimensions?.familiarity.status === "confirmed"
        || dimensions?.conceptual.status === "confirmed"
      ) {
        status.known.push(concept.displayName);
      } else if (
        dimensions?.familiarity.status === "learning"
        || dimensions?.conceptual.status === "learning"
      ) {
        status.unfamiliar.push(concept.displayName);
      } else {
        status.uncertain.push(concept.displayName);
      }
    }
    const explicitReplay = /(重新讲|详细讲|从头讲|再解释|不要省略)/.test(payload.question);
    const prerequisiteRows = conceptIds.length
      ? await db.query<Row>(
        `SELECT DISTINCT c.display_name
         FROM concept_relations r
         JOIN concepts c ON c.id=r.target_concept_id
         WHERE r.source_concept_id IN (${conceptIds.map(() => "?").join(",")})
           AND r.relation_type='prerequisite' AND r.status='active'
         ORDER BY r.confidence DESC LIMIT 8`,
        conceptIds,
      )
      : [];
    const likelyNames = prerequisiteRows.map((row) => String(row.display_name));
    const domains = [...new Set(concepts.map((concept) => concept.domain).filter(Boolean))];
    const domainRows = domains.length
      ? await db.query<Row>(
        `SELECT * FROM domain_profiles
         WHERE scope_id='local-user' AND domain_key IN (${domains.map(() => "?").join(",")})`,
        domains,
      )
      : [];
    const explanationRows = conceptIds.length && !explicitReplay
      ? await db.query<Row>(
        `SELECT e.concept_id,e.project_id,e.qa_record_id,e.title
         FROM concept_explanations e
         JOIN qa_records q ON q.id=e.qa_record_id AND q.project_id=e.project_id
         JOIN projects p ON p.id=e.project_id
         WHERE e.status='active' AND e.concept_id IN (${conceptIds.map(() => "?").join(",")})
         ORDER BY e.updated_at DESC`,
        conceptIds,
      )
      : [];
    const additions = [
      likelyNames.length
        ? `可能具备的前置知识（仅调整讲解顺序，不视为已掌握）：\n${likelyNames.map((name) => `- ${name}`).join("\n")}`
        : "",
      domainRows.length
        ? `相关领域边界：\n${domainRows.map((row) => `- ${row.domain_key}：${row.summary}`).join("\n")}`
        : "",
      explanationRows.length
        ? `此前解释（不要重复完整定义，给出链接即可）：\n${explanationRows.map((row) => `- ${row.title}：https://codecourse.local/qa/${row.project_id}/${row.qa_record_id}`).join("\n")}`
        : "",
    ].filter(Boolean).join("\n\n");
    return `${buildLearnerContext(preferences, status)}\n\n${additions}`;
  }

  private async recordSuccessfulAnswerLearning(
    projectId: number,
    record: QARecord,
  ): Promise<void> {
    let concepts = await this.relevantConcepts(
      projectId,
      record.question,
      record.selected_text,
      record.source_type,
      record.source_path,
    );
    if (!concepts.length && record.parent_qa_id) {
      const parent = await this.getQA(projectId, record.parent_qa_id).catch(() => null);
      if (parent) {
        concepts = await this.relevantConcepts(
          projectId,
          parent.question,
          parent.selected_text,
          parent.source_type,
          parent.source_path,
        );
      }
    }
    const isExplicitDefinition = record.relation_type === "term_explanation";
    const eventType = record.parent_qa_id ? "asked_clarification" : isExplicitDefinition ? "asked_definition" : "";
    if (eventType) {
      for (const concept of concepts) {
        const idempotencyKey = `qa-learning:${record.id}:${concept.id}:${eventType}`;
        const exists = (await db.query<Row>(
          "SELECT id FROM learning_events WHERE idempotency_key=?",
          [idempotencyKey],
        ))[0];
        if (exists) continue;
        const scope = await this.scopeForConcept(projectId, concept.id);
        const stamp = now();
        await db.run(
          "INSERT INTO learning_events(id,idempotency_key,schema_version,concept_id,scope_type,scope_id,event_type,direction,strength,source,evidence_text,session_id,qa_record_id,created_at) VALUES(?,?,1,?,?,?,?,?,1,'system_inference',?,?,?,?)",
          [
            crypto.randomUUID(),
            idempotencyKey,
            concept.id,
            scope.type,
            scope.id,
            eventType,
            "unknown",
            record.question.slice(0, 200),
            record.session_id ? String(record.session_id) : null,
            record.id,
            stamp,
          ],
        );
        await this.updateProjection(concept.id, scope.type, scope.id, stamp);
        await this.appendLearningEvidenceV2(projectId, {
          idempotencyKey: `v2:${idempotencyKey}`,
          conceptId: concept.id,
          dimension: "familiarity",
          direction: "negative",
          strength: eventType === "asked_definition" ? 0.75 : 0.55,
          reliability: 0.8,
          source: "question",
          action: eventType,
          object: { type: "qa", qaRecordId: record.id },
          result: { evidenceText: record.question.slice(0, 200) },
          sessionId: record.session_id ? String(record.session_id) : null,
          qaRecordId: record.id,
        });
      }
    }
    for (const signal of inferPreferenceSignals(record.question)) {
      await this.applyAnswerPreferenceFeedback(projectId, {
        dimension: signal.dimension,
        choice: signal.choice,
        source: "implicit_question",
        qa_record_id: record.id,
        idempotency_key: `qa-pref:${record.id}:${signal.dimension}:${signal.choice}`,
      });
    }
  }

  private async ask(projectId: number, payload: QAAskPayload): Promise<QARecord> {
    const prompts = await this.getPrompts(); const settings = await this.getLLMSettings();
    const previous = payload.session_id ? await this.sessionTree(projectId, payload.session_id) : [];
    const memory = previous.slice(-6).map((item) => `用户：${item.question}\n助手：${compactText(item.answer_md, 1200)}`).join("\n\n");
    const context = await this.sourceContext(projectId, payload);
    const project = await this.getProject(projectId);
    const sessionContext = `项目：${project.name}\n项目类型：${project.project_type}\n当前负责解释：${payload.source_path || "项目整体"}\n\n最近对话：\n${memory || "这是本会话的第一个问题。"}`;
    const questionPrompt = renderPrompt(prompts["prompt.qa.answer"] || "回答用户关于项目的问题。", {
      source_type: payload.source_type,
      source_path: payload.source_path || "项目",
      question: payload.question,
      session_context: sessionContext,
      context_text: context,
    });
    const learnerContext = await this.learnerContextForQuestion(projectId, payload);
    const teacherPlanResult = await this.teacherStrategyForQuestion(projectId, payload);
    const teacherPlan = teacherPlanResult?.rendered ?? "";
    const raw = await this.callLLM([
      {
        role: "system",
        content: composeSystemPrompt(prompts["prompt.system"] || "你是项目学习助手。", "qa"),
      },
      { role: "user", content: `${learnerContext}\n\n${teacherPlan}\n\n${questionPrompt}` },
    ], { provider: payload.provider, base_url: payload.base_url, model: payload.model });
    const parsed = this.parseAnswer(raw, payload); const stamp = now();
    const id = await db.run(`INSERT INTO qa_records(project_id,session_id,parent_qa_id,relation_type,source_type,source_path,display_title,selected_text,question,answer_md,provider,model,output_path,retrieval_trace,favorite,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [projectId, payload.session_id || null, payload.parent_qa_id || null, payload.relation_type || "follow_up", payload.source_type, payload.source_path || null, parsed.title, payload.selected_text || "", payload.question, parsed.answer, settings.provider, settings.model, null, JSON.stringify({ source: payload.source_path, context: context.slice(0, 6000) }), 0, stamp, stamp]);
    const sessionId = payload.session_id || id; const outputPath = `selection_answers/qa_${String(id).padStart(4, "0")}.md`;
    await db.run("UPDATE qa_records SET session_id=?,output_path=? WHERE id=?", [sessionId, outputPath, id]);
    let record = await this.getQA(projectId, id); await this.upsertCourse(projectId, outputPath, this.formatQA(record), "AI 回答");
    const qaNode = await this.createNode(projectId, { node_type: "qa", title: parsed.title, ref_type: "qa", ref_id: id, ref_path: outputPath, summary: parsed.answer.slice(0, 300) });
    const parent = await this.ensureSourceNode(projectId, payload); if (parent) await this.createEdge(projectId, { source_node_id: parent.id, target_node_id: qaNode.id, relation_type: "explains", label: null });
    if (payload.source_type === "course" && payload.source_path && payload.selected_text.trim()) {
      await db.run("INSERT INTO knowledge_links(project_id,source_type,source_path,term_text,qa_record_id,node_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)", [projectId, "course", payload.source_path, payload.selected_text.trim(), id, qaNode.id, stamp, stamp]);
    }
    await this.registerTerms(projectId, "qa", outputPath, parsed.answer, parsed.terms);
    if (payload.term_candidate_id) {
      const termRow = (await db.query<Row>(
        "SELECT concept_id FROM document_terms WHERE project_id=? AND id=?",
        [projectId, payload.term_candidate_id],
      ))[0];
      await db.run("UPDATE document_terms SET status='linked',link_origin='automatic',qa_record_id=?,updated_at=? WHERE project_id=? AND id=?", [id, stamp, projectId, payload.term_candidate_id]);
      if (termRow?.concept_id) {
        await this.registerConceptExplanation(String(termRow.concept_id), projectId, id, parsed.title);
      }
    } else if (payload.relation_type === "term_explanation" && payload.selected_text.trim()) {
      const resolved = await this.resolvePersonalizationTerms(projectId, [{
        text: payload.selected_text.trim().slice(0, 80),
        source: payload.source_type === "file" ? "index" : "selection",
        confidence: 0.95,
      }]);
      const concept = resolved.terms[0]?.concept as PersonalizationConcept | undefined;
      if (concept) {
        await this.registerConceptExplanation(concept.id, projectId, id, parsed.title);
      }
    }
    record = await this.getQA(projectId, id);
    const strategies = teacherPlanResult?.strategies ?? [];
    const trialConcepts = await this.relevantConcepts(
      projectId,
      record.question,
      record.selected_text,
      record.source_type,
      record.source_path,
    );
    const preState = (await this.getKnowledgeStatesV2(
      projectId,
      trialConcepts.map((concept) => concept.id),
    )).states;
    const stateByConceptId = new Map(preState.map((state) => [state.conceptId, state]));
    const assumedKnown: string[] = [...(teacherPlanResult?.assumedKnown ?? [])];
    const explainInDetail: string[] = [...(teacherPlanResult?.explainInDetail ?? [])];
    const explainBriefly: string[] = [...(teacherPlanResult?.explainBriefly ?? [])];
    if (!teacherPlanResult) {
      for (const concept of trialConcepts) {
        const dimensions = stateByConceptId.get(concept.id)?.dimensions;
        if (
          dimensions?.familiarity.status === "confirmed"
          || dimensions?.conceptual.status === "confirmed"
        ) {
          assumedKnown.push(concept.displayName);
        } else if (
          dimensions?.familiarity.status === "learning"
          || dimensions?.conceptual.status === "learning"
        ) {
          explainInDetail.push(concept.displayName);
        } else {
          explainBriefly.push(concept.displayName);
        }
      }
    }
    await teachingOutcomes.saveTrial({
      projectId,
      sessionId,
      qaRecordId: id,
      answerModel: settings.model,
      mode: teacherPlanResult ? "assist" : "default",
      context: {
        schemaVersion: 1,
        mode: teacherPlanResult ? "planned" : "default",
        userGoal: teacherPlanResult?.plan.user_goal ?? "unknown",
        teachingGoal: teacherPlanResult
          ? teacherPlanResult.plan.teaching_goal
          : "Answer the current question using the relevant learner context.",
        strategies: strategies.length ? strategies : ["direct_answer"],
        assumedKnown,
        explainBriefly,
        explainInDetail,
      },
      preState,
      targetConceptIds: trialConcepts.map((concept) => concept.id),
      targetDimensions: payload.source_type === "file"
        ? ["familiarity", "conceptual", "code_reading"]
        : ["familiarity", "conceptual"],
      strategyRationale: teacherPlanResult
        ? JSON.stringify({
          blocker: teacherPlanResult.plan.blocker_summary,
          confidence: teacherPlanResult.plan.plan_confidence,
          uncertainty: teacherPlanResult.plan.uncertainty_notes,
        }).slice(0, 1200)
        : "The answer used the current learner context without a separate Planner call.",
    });
    await this.recordSuccessfulAnswerLearning(projectId, record);
    void this.runAndroidObserver(projectId, record);
    return record;
  }
  private async getQA(projectId: number, qaId: number): Promise<QARecord> {
    const row = (await db.query<Row>("SELECT * FROM qa_records WHERE project_id=? AND id=?", [projectId, qaId]))[0];
    if (!row) throw new Error("回答不存在。"); return qaFromRow(row);
  }
  private async listQA(projectId: number, query: string, favorite: string | null): Promise<QARecord[]> {
    const values: unknown[] = [projectId]; let sql = "SELECT * FROM qa_records WHERE project_id=?";
    if (query.trim()) { sql += " AND (question LIKE ? OR display_title LIKE ? OR answer_md LIKE ? OR selected_text LIKE ?)"; values.push(...Array(4).fill(`%${query.trim()}%`)); }
    if (favorite != null) { sql += " AND favorite=?"; values.push(favorite === "true" ? 1 : 0); }
    sql += " ORDER BY updated_at DESC"; return (await db.query<Row>(sql, values)).map(qaFromRow);
  }
  private async sessionTree(projectId: number, sessionId: number): Promise<QARecord[]> { return (await db.query<Row>("SELECT * FROM qa_records WHERE project_id=? AND session_id=? ORDER BY id", [projectId, sessionId])).map(qaFromRow); }
  private async updateQA(projectId: number, qaId: number, payload: Record<string, unknown>): Promise<QARecord> {
    const current = await this.getQA(projectId, qaId);
    const next = { question: (payload.question as string) ?? current.question, answer_md: (payload.answer_md as string) ?? current.answer_md, display_title: (payload.display_title as string) ?? current.display_title };
    await db.run("UPDATE qa_records SET question=?,answer_md=?,display_title=?,updated_at=? WHERE project_id=? AND id=?", [next.question, next.answer_md, next.display_title, now(), projectId, qaId]);
    const record = await this.getQA(projectId, qaId); if (record.output_path) await this.upsertCourse(projectId, record.output_path, this.formatQA(record), "AI 回答"); return record;
  }
  private async favoriteQA(projectId: number, qaId: number, favorite: boolean): Promise<QARecord> { await db.run("UPDATE qa_records SET favorite=?,updated_at=? WHERE project_id=? AND id=?", [favorite ? 1 : 0, now(), projectId, qaId]); return this.getQA(projectId, qaId); }
  private async deleteQA(projectId: number, qaId: number): Promise<{ deleted: boolean; id: number }> {
    const record = await this.getQA(projectId, qaId); await db.run("DELETE FROM qa_records WHERE id=?", [qaId]); await db.run("DELETE FROM learning_anchors WHERE project_id=? AND qa_record_id=?", [projectId, qaId]); await db.run("DELETE FROM knowledge_nodes WHERE project_id=? AND ((ref_type='qa' AND ref_id=?) OR (ref_type='learning_anchor' AND ref_id=?))", [projectId, qaId, qaId]); await db.run("DELETE FROM knowledge_links WHERE project_id=? AND qa_record_id=?", [projectId, qaId]);
    if (record.output_path) await this.deleteCourse(projectId, record.output_path); return { deleted: true, id: qaId };
  }
  private async getAnchor(projectId: number, qaId: number): Promise<LearningAnchor> {
    const row = (await db.query<Row>("SELECT * FROM learning_anchors WHERE project_id=? AND qa_record_id=?", [projectId, qaId]))[0]; if (!row) throw new Error("尚未保存理解总结。"); return row as LearningAnchor;
  }
  private async saveAnchor(projectId: number, qaId: number, payload: Record<string, unknown>): Promise<LearningAnchor> {
    const stamp = now(); await db.run("INSERT OR REPLACE INTO learning_anchors(project_id,qa_record_id,term_text,summary,created_at,updated_at) VALUES(?,?,?,?,COALESCE((SELECT created_at FROM learning_anchors WHERE qa_record_id=?),?),?)", [projectId, qaId, payload.term_text || null, payload.summary, qaId, stamp, stamp]);
    const qa = await this.getQA(projectId, qaId);
    const qaNode = await this.createNode(projectId, { node_type: "qa", title: qa.display_title || qa.question, ref_type: "qa", ref_id: qa.id, ref_path: qa.output_path });
    const anchorNode = await this.createNode(projectId, { node_type: "anchor", title: payload.term_text || `理解 #${qaId}`, ref_type: "learning_anchor", ref_id: qaId, summary: payload.summary });
    await this.createEdge(projectId, { source_node_id: qaNode.id, target_node_id: anchorNode.id, relation_type: "related_to", label: null });
    const concepts = await this.relevantConcepts(
      projectId,
      `${qa.question}\n${String(payload.term_text || "")}`,
      qa.selected_text,
      qa.source_type,
      qa.source_path,
    );
    for (const concept of concepts) {
      await this.appendLearningEvidenceV2(projectId, {
        idempotencyKey: `summary-v2:${qaId}:${concept.id}`,
        conceptId: concept.id,
        dimension: "conceptual",
        direction: "positive",
        strength: 0.65,
        reliability: 0.72,
        source: "summary",
        action: "saved_understanding",
        object: { type: "qa", qaRecordId: qaId },
        result: { summary: String(payload.summary || "").slice(0, 500) },
        sessionId: qa.session_id ? String(qa.session_id) : null,
        qaRecordId: qaId,
      });
    }
    return this.getAnchor(projectId, qaId);
  }
  private async deleteAnchor(projectId: number, qaId: number): Promise<{ deleted: boolean; qa_id: number }> {
    await db.run("DELETE FROM learning_anchors WHERE project_id=? AND qa_record_id=?", [projectId, qaId]);
    await db.run("DELETE FROM knowledge_nodes WHERE project_id=? AND ref_type='learning_anchor' AND ref_id=?", [projectId, qaId]);
    const evidence = await db.query<Row>(
      "SELECT id FROM learning_evidence_v2 WHERE qa_record_id=? AND source='summary' AND action='saved_understanding'",
      [qaId],
    );
    for (const row of evidence) {
      await this.voidLearningEvidenceV2(
        projectId,
        String(row.id),
        `void-summary-v2:${qaId}:${row.id}`,
        "understanding_removed",
      );
    }
    return { deleted: true, qa_id: qaId };
  }

  private async listHighlights(projectId: number, params: URLSearchParams): Promise<HighlightRecord[]> {
    let sql = "SELECT * FROM highlights WHERE project_id=?"; const values: unknown[] = [projectId];
    if (params.get("source_type")) { sql += " AND source_type=?"; values.push(params.get("source_type")); }
    if (params.get("source_path")) { sql += " AND source_path=?"; values.push(params.get("source_path")); }
    return await db.query<Row>(`${sql} ORDER BY id`, values) as HighlightRecord[];
  }
  private async createHighlight(projectId: number, payload: Record<string, unknown>): Promise<HighlightRecord> {
    const stamp = now(); const id = await db.run("INSERT INTO highlights(project_id,source_type,source_path,selected_text,color,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)", [projectId, payload.source_type, payload.source_path, payload.selected_text, payload.color || "yellow", payload.note || null, stamp, stamp]); return (await db.query<Row>("SELECT * FROM highlights WHERE id=?", [id]))[0] as HighlightRecord;
  }
  private async registerTerms(
    projectId: number,
    sourceType: "course" | "qa",
    sourcePath: string,
    content: string,
    modelTerms: TermCandidateInput[] = [],
    allowModelScan = true,
  ): Promise<void> {
    const weighted: StructuredTermCandidate[] = [
      ...modelTerms.map((term) => validateTermCandidate(
        term,
        content,
        { source: "model", confidence: 0.94 },
      )).filter((term): term is StructuredTermCandidate => term !== null),
      ...localTermCandidates(content),
    ];
    const seen = new Set<string>();
    const contentHash = hashText(content);
    await db.run(
      "DELETE FROM document_terms WHERE project_id=? AND source_type=? AND source_path=? AND status='candidate' AND COALESCE(content_hash,'')<>?",
      [projectId, sourceType, sourcePath, contentHash],
    );
    const resolved = await this.resolvePersonalizationTerms(
      projectId,
      weighted.slice(0, 30).map((item) => ({
        text: item.canonical_name,
        source: item.source,
        confidence: item.confidence,
      })),
    );
    const conceptByTerm = new Map(
      resolved.terms.map((item) => [String(item.text).toLocaleLowerCase(), String((item.concept as PersonalizationConcept).id)]),
    );
    for (const item of weighted.sort((a, b) => b.display_name.length - a.display_name.length)) {
      const key = item.canonical_name.toLocaleLowerCase(); if (seen.has(key)) continue; seen.add(key);
      await db.run(
        `INSERT INTO document_terms(
           project_id,source_type,source_path,term_text,detection_source,confidence,status,
           concept_id,content_hash,canonical_name,category,source_span_json,created_at,updated_at
         )
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(project_id,source_type,source_path,term_text) DO UPDATE SET
           detection_source=CASE WHEN excluded.confidence>document_terms.confidence THEN excluded.detection_source ELSE document_terms.detection_source END,
           confidence=MAX(document_terms.confidence,excluded.confidence),
           concept_id=COALESCE(document_terms.concept_id,excluded.concept_id),
           content_hash=excluded.content_hash,
           canonical_name=COALESCE(excluded.canonical_name,document_terms.canonical_name),
           category=COALESCE(excluded.category,document_terms.category),
           source_span_json=COALESCE(excluded.source_span_json,document_terms.source_span_json),
           updated_at=excluded.updated_at`,
        [
          projectId, sourceType, sourcePath, item.display_name, item.source, item.confidence,
          "candidate", conceptByTerm.get(key) || null, contentHash, item.canonical_name,
          item.category, JSON.stringify(item.source_span), now(), now(),
        ],
      );
      if (seen.size >= 24) break;
    }
    const highConfidenceCount = weighted.filter((item) => item.confidence >= 0.8).length;
    if (allowModelScan && (seen.size < 4 || highConfidenceCount < 3)) {
      void this.runAndroidTermScan(projectId, sourceType, sourcePath, content, contentHash, seen.size);
    }
  }

  private async runAndroidTermScan(
    projectId: number,
    sourceType: "course" | "qa",
    sourcePath: string,
    content: string,
    contentHash: string,
    localCandidateCount = 0,
  ): Promise<void> {
    const runtime = await this.getPersonalizationRuntimeSettings();
    if (!runtime.observer_enabled) return;
    const existing = await db.query<Row>(
      `SELECT status FROM term_model_scans
       WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=?`,
      [projectId, sourceType, sourcePath, contentHash],
    );
    if (existing.length) return;
    const stamp = now();
    await db.run(
      `INSERT INTO term_model_scans
       (project_id,source_type,source_path,content_hash,status,terms_json,
        local_candidate_count,model_candidate_count,created_at,updated_at)
       VALUES(?,?,?,?,?,'[]',?,0,?,?)`,
      [projectId, sourceType, sourcePath, contentHash, "running", localCandidateCount, stamp, stamp],
    );
    const started = performance.now();
    try {
      const compact = compactText(content, 18_000);
      const raw = await this.callLLM([
        {
          role: "system",
          content: "你是技术教材术语分析器。只提取正文中实际出现、可能陌生且值得解释的技术术语。只输出 JSON。",
        },
        {
          role: "user",
          content: `返回 {"terms":[{"display_name":"正文原词","canonical_name":"规范名称","category":"concept","confidence":0.0,"source_span":{"text":"正文原词"}}]}，最多 16 个。display_name 与 source_span.text 必须逐字出现在正文可见文本中。跳过普通词、完整句子、命令、路径、函数调用或签名、编译错误、已有链接和代码块局部变量。\n\n${compact}`,
        },
      ]);
      const parsed = extractJsonObject(raw) as Record<string, unknown>;
      const terms = (Array.isArray(parsed.terms) ? parsed.terms : [])
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .filter((item) => Number(item.confidence || 0) >= 0.62)
        .map((item) => validateTermCandidate(
          item,
          content,
          { source: "model", confidence: Number(item.confidence || 0) },
        ))
        .filter((term): term is StructuredTermCandidate => term !== null)
        .slice(0, 16);
      await this.registerTerms(projectId, sourceType, sourcePath, content, terms, false);
      await db.run(
        `UPDATE term_model_scans SET status='completed',terms_json=?,model_candidate_count=?,error_message=NULL,updated_at=?
         WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=?`,
        [JSON.stringify(terms), terms.length, now(), projectId, sourceType, sourcePath, contentHash],
      );
      await this.recordModelCall(projectId, "term_scan", "completed", started);
    } catch (error) {
      await db.run(
        `UPDATE term_model_scans SET status='failed',error_message=?,updated_at=?
         WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=?`,
        [
          error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
          now(),
          projectId,
          sourceType,
          sourcePath,
          contentHash,
        ],
      );
      await this.recordModelCall(projectId, "term_scan", "failed", started, error).catch(() => undefined);
    }
  }
  private async listTerms(projectId: number, params: URLSearchParams): Promise<Row[]> {
    const sourceType = params.get("source_type") as "course" | "qa";
    const sourcePath = params.get("source_path") || "";
    let rows: Row[] = [];
    if (sourcePath) {
      try {
        const content = sourceType === "qa"
          ? ((await db.query<Row>("SELECT answer_md FROM qa_records WHERE project_id=? AND (output_path=? OR CAST(id AS TEXT)=?)", [projectId, sourcePath, sourcePath]))[0]?.answer_md || "")
          : await readGeneratedFile(projectId, sourcePath);
        if (content) await this.registerTerms(projectId, sourceType, sourcePath, String(content));
      } catch { /* Missing source documents simply have no term candidates. */ }
    }
    rows = await db.query<Row>("SELECT * FROM document_terms WHERE project_id=? AND source_type=? AND source_path=? ORDER BY length(term_text) DESC", [projectId, sourceType, sourcePath]);
    const content = sourcePath
      ? sourceType === "qa"
        ? String((await db.query<Row>("SELECT answer_md FROM qa_records WHERE project_id=? AND (output_path=? OR CAST(id AS TEXT)=?)", [projectId, sourcePath, sourcePath]))[0]?.answer_md || "")
        : await readGeneratedFile(projectId, sourcePath).catch(() => "")
      : "";
    const invalidCandidateIds = rows
      .filter((row) => String(row.status) === "candidate")
      .filter((row) => !validateTermCandidate(
        {
          display_name: row.term_text,
          canonical_name: row.canonical_name || row.term_text,
          category: row.category || "other",
          confidence: row.confidence,
          source_span: parseJsonRecord(row.source_span_json),
        },
        content,
        { source: String(row.detection_source || "rule"), confidence: Number(row.confidence || 0.7) },
      ))
      .map((row) => Number(row.id));
    if (invalidCandidateIds.length) {
      await db.run(
        `DELETE FROM document_terms WHERE project_id=? AND status='candidate' AND id IN (${invalidCandidateIds.map(() => "?").join(",")})`,
        [projectId, ...invalidCandidateIds],
      );
      rows = rows.filter((row) => !invalidCandidateIds.includes(Number(row.id)));
    }
    return rows.map((row) => ({
      ...row,
      source_span: parseJsonRecord(row.source_span_json) ?? null,
    }));
  }

  private async termStatus(projectId: number, params: URLSearchParams, force = false): Promise<Record<string, unknown>> {
    const sourceType = params.get("source_type") as "course" | "qa";
    const sourcePath = params.get("source_path") || "";
    const content = sourcePath
      ? sourceType === "qa"
        ? String((await db.query<Row>(
          "SELECT answer_md FROM qa_records WHERE project_id=? AND (output_path=? OR CAST(id AS TEXT)=?)",
          [projectId, sourcePath, sourcePath],
        ))[0]?.answer_md || "")
        : await readGeneratedFile(projectId, sourcePath).catch(() => "")
      : "";
    if (!content) {
      return {
        source_type: sourceType,
        source_path: sourcePath,
        content_hash: "",
        scan_status: "missing_source",
        model_scan_authorized: false,
        candidate_count: 0,
        high_confidence_count: 0,
        local_candidate_count: 0,
        model_candidate_count: 0,
        error_message: "Document content is unavailable",
        updated_at: null,
      };
    }
    const contentHash = hashText(content);
    if (force) {
      await db.run(
        "DELETE FROM term_model_scans WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=?",
        [projectId, sourceType, sourcePath, contentHash],
      );
    }
    const terms = await this.listTerms(projectId, params);
    const runtime = await this.getPersonalizationRuntimeSettings();
    const state = (await db.query<Row>(
      `SELECT * FROM term_model_scans
       WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=?`,
      [projectId, sourceType, sourcePath, contentHash],
    ))[0];
    const highConfidenceCount = terms.filter((term) => Number(term.confidence || 0) >= 0.8).length;
    const needsModelScan = terms.length < 4 || highConfidenceCount < 3;
    return {
      source_type: sourceType,
      source_path: sourcePath,
      content_hash: contentHash,
      scan_status: state?.status
        || (!runtime.observer_enabled ? "local_only" : needsModelScan ? "idle" : "completed"),
      model_scan_authorized: Boolean(runtime.observer_enabled),
      candidate_count: terms.length,
      high_confidence_count: highConfidenceCount,
      local_candidate_count: Number(state?.local_candidate_count ?? terms.length),
      model_candidate_count: Number(state?.model_candidate_count ?? 0),
      error_message: state?.error_message ?? null,
      updated_at: state?.updated_at ?? null,
    };
  }
  private async setTermStatus(termId: number, status: string): Promise<Row> { await db.run("UPDATE document_terms SET status=?,updated_at=? WHERE id=?", [status, now(), termId]); return (await db.query<Row>("SELECT * FROM document_terms WHERE id=?", [termId]))[0]; }

  private nodeFromRow(row: Row): KnowledgeNode { return { ...row, id: Number(row.id), project_id: Number(row.project_id), ref_id: row.ref_id == null ? null : Number(row.ref_id), x: row.x == null ? null : Number(row.x), y: row.y == null ? null : Number(row.y) } as KnowledgeNode; }
  private edgeFromRow(row: Row): KnowledgeEdge { return { ...row, id: Number(row.id), project_id: Number(row.project_id), source_node_id: Number(row.source_node_id), target_node_id: Number(row.target_node_id) } as KnowledgeEdge; }
  private async getGraph(projectId: number): Promise<KnowledgeGraph> {
    await db.run("UPDATE knowledge_nodes SET title='总纲',updated_at=? WHERE project_id=? AND ref_type='course' AND ref_path='outline.md' AND title IN ('outline.md','outline','项目学习总纲','学习计划总纲')", [now(), projectId]);
    return { nodes: (await db.query<Row>("SELECT * FROM knowledge_nodes WHERE project_id=?", [projectId])).map((row) => this.nodeFromRow(row)), edges: (await db.query<Row>("SELECT * FROM knowledge_edges WHERE project_id=?", [projectId])).map((row) => this.edgeFromRow(row)) };
  }
  private async createNode(projectId: number, payload: Record<string, unknown>): Promise<KnowledgeNode> {
    if (payload.ref_type && payload.ref_id != null) {
      const existing = (await db.query<Row>("SELECT * FROM knowledge_nodes WHERE project_id=? AND ref_type=? AND ref_id=? ORDER BY id LIMIT 1", [projectId, payload.ref_type, payload.ref_id]))[0];
      if (existing) return this.nodeFromRow(existing);
    } else if (payload.ref_type && payload.ref_path) {
      const existing = (await db.query<Row>("SELECT * FROM knowledge_nodes WHERE project_id=? AND ref_type=? AND ref_path=? ORDER BY id LIMIT 1", [projectId, payload.ref_type, payload.ref_path]))[0];
      if (existing) return this.nodeFromRow(existing);
    }
    const stamp = now(); const id = await db.run("INSERT INTO knowledge_nodes(project_id,node_type,title,ref_type,ref_id,ref_path,summary,x,y,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [projectId, payload.node_type || "manual", payload.title, payload.ref_type || null, payload.ref_id ?? null, payload.ref_path || null, payload.summary || null, payload.x ?? null, payload.y ?? null, stamp, stamp]); return this.nodeFromRow((await db.query<Row>("SELECT * FROM knowledge_nodes WHERE id=?", [id]))[0]);
  }
  private async ensureCourseNode(projectId: number, filename: string): Promise<KnowledgeNode> { return this.createNode(projectId, { node_type: "course", title: sourceNodeTitle("course", filename), ref_type: "course", ref_path: filename }); }
  private async linkLessonToOutline(projectId: number, lessonNodeId: number, outlinePath: string): Promise<void> {
    const outlineRel = outlinePath || "outline.md";
    const outlineNode = await this.createNode(projectId, { node_type: "course", title: "总纲", ref_type: "course", ref_path: outlineRel });
    await this.createEdge(projectId, { source_node_id: outlineNode.id, target_node_id: lessonNodeId, relation_type: "parent_of", label: "属于总纲" });
  }
  private async ensureSourceNode(projectId: number, payload: QAAskPayload): Promise<KnowledgeNode | null> {
    if (payload.parent_qa_id) { const parent = await this.getQA(projectId, payload.parent_qa_id); return this.createNode(projectId, { node_type: "qa", title: parent.display_title || parent.question, ref_type: "qa", ref_id: parent.id, ref_path: parent.output_path }); }
    if (!payload.source_path) return this.createNode(projectId, { node_type: "manual", title: (await this.getProject(projectId)).name, ref_type: "project", ref_id: projectId });
    if (payload.source_type === "qa") {
      const parent = (await db.query<Row>("SELECT * FROM qa_records WHERE project_id=? AND output_path=?", [projectId, payload.source_path]))[0];
      if (parent) return this.createNode(projectId, { node_type: "qa", title: parent.display_title || parent.question, ref_type: "qa", ref_id: parent.id, ref_path: parent.output_path });
    }
    const type = payload.source_type === "file" ? "file" : "course"; return this.createNode(projectId, { node_type: type, title: sourceNodeTitle(type, payload.source_path), ref_type: type, ref_path: payload.source_path });
  }
  private async updateNode(projectId: number, nodeId: number, payload: Record<string, unknown>): Promise<KnowledgeNode> { const current = this.nodeFromRow((await db.query<Row>("SELECT * FROM knowledge_nodes WHERE project_id=? AND id=?", [projectId, nodeId]))[0]); await db.run("UPDATE knowledge_nodes SET title=?,summary=?,x=?,y=?,updated_at=? WHERE project_id=? AND id=?", [payload.title ?? current.title, payload.summary ?? current.summary, payload.x ?? current.x, payload.y ?? current.y, now(), projectId, nodeId]); return this.nodeFromRow((await db.query<Row>("SELECT * FROM knowledge_nodes WHERE id=?", [nodeId]))[0]); }
  private async deleteNode(projectId: number, nodeId: number): Promise<{ deleted: boolean; id: number }> {
    const node = (await db.query<Row>("SELECT * FROM knowledge_nodes WHERE project_id=? AND id=?", [projectId, nodeId]))[0];
    if (!node) return { deleted: false, id: nodeId };
    if (node.ref_type === "qa" && node.ref_id != null) {
      await this.deleteQA(projectId, Number(node.ref_id));
      return { deleted: true, id: nodeId };
    }
    if (node.ref_type === "course" && node.ref_path) {
      await this.deleteCourse(projectId, String(node.ref_path));
      return { deleted: true, id: nodeId };
    }
    await db.run("DELETE FROM knowledge_links WHERE project_id=? AND node_id=?", [projectId, nodeId]);
    await db.run("DELETE FROM knowledge_nodes WHERE project_id=? AND id=?", [projectId, nodeId]);
    return { deleted: true, id: nodeId };
  }
  private async createEdge(projectId: number, payload: Record<string, unknown>): Promise<KnowledgeEdge> { const nodes = await db.query<Row>("SELECT id FROM knowledge_nodes WHERE project_id=? AND id IN (?,?)", [projectId, payload.source_node_id, payload.target_node_id]); if (nodes.length !== 2) throw new Error("连线两端必须属于当前项目。"); const existing = (await db.query<Row>("SELECT * FROM knowledge_edges WHERE project_id=? AND source_node_id=? AND target_node_id=? AND relation_type=?", [projectId, payload.source_node_id, payload.target_node_id, payload.relation_type]))[0]; if (existing) return this.edgeFromRow(existing); const stamp = now(); const id = await db.run("INSERT INTO knowledge_edges(project_id,source_node_id,target_node_id,relation_type,label,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", [projectId, payload.source_node_id, payload.target_node_id, payload.relation_type, payload.label || null, stamp, stamp]); return this.edgeFromRow((await db.query<Row>("SELECT * FROM knowledge_edges WHERE id=?", [id]))[0]); }
  private async updateEdge(projectId: number, edgeId: number, payload: Record<string, unknown>): Promise<KnowledgeEdge> { const row = (await db.query<Row>("SELECT * FROM knowledge_edges WHERE project_id=? AND id=?", [projectId, edgeId]))[0]; await db.run("UPDATE knowledge_edges SET relation_type=?,label=?,updated_at=? WHERE project_id=? AND id=?", [payload.relation_type ?? row.relation_type, payload.label ?? row.label, now(), projectId, edgeId]); return this.edgeFromRow((await db.query<Row>("SELECT * FROM knowledge_edges WHERE id=?", [edgeId]))[0]); }
  private async listLinks(projectId: number, params: URLSearchParams): Promise<KnowledgeLink[]> { let sql = "SELECT * FROM knowledge_links WHERE project_id=?"; const values: unknown[] = [projectId]; if (params.get("source_type")) { sql += " AND source_type=?"; values.push(params.get("source_type")); } if (params.get("source_path")) { sql += " AND source_path=?"; values.push(params.get("source_path")); } return db.query<Row>(sql, values) as Promise<KnowledgeLink[]>; }
  private async deleteById(table: "highlights" | "knowledge_edges", id: number): Promise<{ deleted: boolean; id: number }> { await db.run(`DELETE FROM ${table} WHERE id=?`, [id]); return { deleted: true, id }; }

  // ---- Personalization Methods ----
  // Mirrors Python backend. Evidence deltas match TypeScript AUTO_EVIDENCE_DELTAS.

  private scope(projectId: number) { return { type: "project" as const, id: String(projectId) }; }

  private scopeForConceptRow(projectId: number, concept: Row) {
    const isProjectSymbol = String(concept.concept_key || "").startsWith("project:")
      || String(concept.concept_type || "") === "project_symbol";
    return isProjectSymbol
      ? { type: "project" as const, id: String(projectId) }
      : { type: "global" as const, id: "local-user" };
  }

  private async scopeForConcept(projectId: number, conceptId: string) {
    const concept = (await db.query<Row>("SELECT * FROM concepts WHERE id=?", [conceptId]))[0];
    if (!concept) throw new Error("Concept not found");
    return this.scopeForConceptRow(projectId, concept);
  }

  private conceptFromRow(r: Row): PersonalizationConcept {
    return {
      id: String(r.id),
      conceptKey: String(r.concept_key || `global:${r.domain}:${r.canonical_name}`),
      canonicalName: String(r.canonical_name),
      displayName: String(r.display_name),
      domain: String(r.domain),
      conceptType: String(r.concept_type) as PersonalizationConcept["conceptType"],
      aliases: JSON.parse(String(r.aliases_json || "[]")) as string[],
      difficulty: Number(r.difficulty),
      createdAt: String(r.created_at),
    };
  }

  private masteryFromRow(r: Row, scopeType: string, scopeId: string): PersonalizationMastery {
    return {
      id: String(r.id), conceptId: String(r.concept_id),
      scope: { type: scopeType as unknown as ScopeTypeStr, id: scopeId },
      knownEvidence: Number(r.known_evidence), unknownEvidence: Number(r.unknown_evidence),
      mastery: Number(r.mastery), uncertainty: Number(r.uncertainty),
      manualStatus: (r.manual_status as "known" | "unknown" | null) ?? null,
      sequence: Number(r.sequence ?? 0),
      lastSeenAt: String(r.last_seen_at), updatedAt: String(r.updated_at),
    };
  }

  private eventFromRow(r: Row): PersonalizationEvent {
    return {
      eventId: String(r.id), idempotencyKey: String(r.idempotency_key),
      schemaVersion: Number(r.schema_version), conceptId: String(r.concept_id),
      scope: { type: String(r.scope_type) as unknown as ScopeTypeStr, id: String(r.scope_id) },
      eventType: String(r.event_type), direction: String(r.direction) as "known" | "unknown" | "neutral",
      strength: Number(r.strength), source: String(r.source) as "explicit_user" | "system_inference" | "model_inference",
      targetEventId: r.target_event_id ? String(r.target_event_id) : undefined,
      evidenceText: r.evidence_text ? String(r.evidence_text) : undefined,
      sessionId: r.session_id ? String(r.session_id) : undefined,
      qaRecordId: r.qa_record_id ? Number(r.qa_record_id) : undefined,
      isVoided: Boolean(r.is_voided), createdAt: String(r.created_at),
    };
  }

  private autoDeltas: Record<string, [number, number]> = {
    asked_definition: [0, 3], asked_clarification: [0, 2], used_correctly: [1, 0],
    opened_explanation: [0, 1], completed_exercise: [3, 0], saved_learning_anchor: [2, 0],
    manual_override_known: [0, 0], manual_override_unknown: [0, 0],
    manual_override_cleared: [0, 0], event_voided: [0, 0],
  };

  private calc(known: number, unknown: number) {
    const total = known + unknown;
    return { mastery: total > 0 ? known / total : 0.5, uncertainty: total > 0 ? 1 / Math.sqrt(total) : 0.7071 };
  }

  private async replayEvents(conceptId: string, scopeType: string, scopeId: string) {
    const rows = await db.query<Row>(
      "SELECT * FROM learning_events WHERE concept_id=? AND scope_type=? AND scope_id=? AND is_voided=0 ORDER BY created_at ASC, id ASC",
      [conceptId, scopeType, scopeId],
    );
    const voidedIds = new Set(rows.filter(e => e.event_type === "event_voided" && e.target_event_id).map(e => String(e.target_event_id)));
    const active = rows.filter(e => !voidedIds.has(String(e.id))).sort((a, b) => {
      const dc = String(a.created_at).localeCompare(String(b.created_at));
      return dc !== 0 ? dc : String(a.id).localeCompare(String(b.id));
    });
    let known = 1, unknown = 1, manual: string | null = null;
    for (const e of active) {
      const et = String(e.event_type);
      if (et === "manual_override_known") { manual = "known"; continue; }
      if (et === "manual_override_unknown") { manual = "unknown"; continue; }
      if (et === "manual_override_cleared") { manual = null; continue; }
      if (et === "event_voided") continue;
      if (manual !== null) continue;
      const d = this.autoDeltas[et] || [0, 0];
      let dk = d[0], du = d[1];
      if (String(e.source) !== "explicit_user") { dk = Math.min(dk, 1); du = Math.min(du, 1); }
      known += dk * Number(e.strength); unknown += du * Number(e.strength);
    }
    return { known: Math.max(1, known), unknown: Math.max(1, unknown), manualStatus: manual as "known" | "unknown" | null };
  }

  private async updateProjection(conceptId: string, scopeType: string, scopeId: string, stamp: string): Promise<PersonalizationMastery> {
    const { known, unknown, manualStatus } = await this.replayEvents(conceptId, scopeType, scopeId);
    const { mastery, uncertainty } = this.calc(known, unknown);
    const existing = (await db.query<Row>("SELECT * FROM concept_mastery WHERE concept_id=? AND scope_type=? AND scope_id=?", [conceptId, scopeType, scopeId]))[0];
    const id = existing ? String(existing.id) : crypto.randomUUID();
    const seq = (existing ? Number(existing.sequence ?? 0) : 0) + 1;
    await db.run(
      `INSERT INTO concept_mastery (id,concept_id,scope_type,scope_id,known_evidence,unknown_evidence,mastery,uncertainty,manual_status,sequence,last_seen_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(concept_id,scope_type,scope_id) DO UPDATE SET known_evidence=excluded.known_evidence,unknown_evidence=excluded.unknown_evidence,mastery=excluded.mastery,uncertainty=excluded.uncertainty,manual_status=excluded.manual_status,sequence=excluded.sequence,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`,
      [id, conceptId, scopeType, scopeId, known, unknown, mastery, uncertainty, manualStatus, seq, stamp, stamp],
    );
    return { id, conceptId, scope: { type: scopeType as unknown as ScopeTypeStr, id: scopeId }, knownEvidence: known, unknownEvidence: unknown, mastery, uncertainty, manualStatus, sequence: seq, lastSeenAt: stamp, updatedAt: stamp };
  }

  async listPersonalizationConcepts(projectId: number, query?: string): Promise<PersonalizationConcept[]> {
    await db.init();
    const rows = query
      ? await db.query<Row>("SELECT * FROM concepts WHERE canonical_name LIKE ? OR display_name LIKE ? OR aliases_json LIKE ? ORDER BY canonical_name LIMIT 50", [`%${query}%`, `%${query}%`, `%${query}%`])
      : await db.query<Row>("SELECT * FROM concepts ORDER BY domain, canonical_name");
    return rows.map(r => this.conceptFromRow(r));
  }

  async createPersonalizationConcept(projectId: number, payload: { conceptKey: string; canonicalName: string; displayName: string; domain?: string; conceptType?: string; aliases?: string[]; difficulty?: number }): Promise<PersonalizationConcept> {
    await db.init();
    const stamp = now();
    const existing = (await db.query<Row>("SELECT * FROM concepts WHERE concept_key=?", [payload.conceptKey]))[0];
    if (existing) return this.conceptFromRow(existing);
    const id = crypto.randomUUID();
    await db.run(
      "INSERT INTO concepts (id,concept_key,canonical_name,display_name,domain,concept_type,aliases_json,difficulty,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, payload.conceptKey, payload.canonicalName, payload.displayName || payload.canonicalName, payload.domain || "general", payload.conceptType || "theory", JSON.stringify(payload.aliases || []), payload.difficulty ?? 0.5, stamp],
    );
    return this.conceptFromRow((await db.query<Row>("SELECT * FROM concepts WHERE id=?", [id]))[0]);
  }

  async getPersonalizationMasteryBatch(projectId: number, conceptIds: string[]): Promise<Record<string, PersonalizationMastery>> {
    await db.init();
    if (!conceptIds.length) return {};
    const result: Record<string, PersonalizationMastery> = {};
    for (const conceptId of conceptIds) {
      const { type: st, id: si } = await this.scopeForConcept(projectId, conceptId);
      const row = (await db.query<Row>(
        "SELECT * FROM concept_mastery WHERE concept_id=? AND scope_type=? AND scope_id=?",
        [conceptId, st, si],
      ))[0];
      if (row) result[conceptId] = this.masteryFromRow(row, st, si);
    }
    return result;
  }

  private async atomicFeedback(projectId: number, conceptId: string, eventType: "manual_override_known" | "manual_override_unknown" | "manual_override_cleared", direction: "known" | "unknown" | "neutral", idempotencyKey: string, evidenceText?: string): Promise<{ event: PersonalizationEvent; mastery: PersonalizationMastery; idempotent: boolean }> {
    await db.init();
    const { type: st, id: si } = await this.scopeForConcept(projectId, conceptId);

    return db.transaction(async () => {
      const stamp = now();
      const concept = (await db.queryInTx<Row>("SELECT * FROM concepts WHERE id=?", [conceptId]))[0];
      if (!concept) throw new Error("Concept not found");

      // Idempotency check
      const existingEvt = (await db.queryInTx<Row>("SELECT * FROM learning_events WHERE idempotency_key=?", [idempotencyKey]))[0];
      if (existingEvt) {
        const m = (await db.queryInTx<Row>("SELECT * FROM concept_mastery WHERE concept_id=? AND scope_type=? AND scope_id=?", [conceptId, st, si]))[0];
        return {
          event: this.eventFromRow(existingEvt),
          mastery: m ? this.masteryFromRow(m, st, si) : { id: "", conceptId, scope: { type: st as unknown as ScopeTypeStr, id: si }, knownEvidence: 1, unknownEvidence: 1, mastery: 0.5, uncertainty: 0.7071, manualStatus: null, sequence: 0, lastSeenAt: stamp, updatedAt: stamp },
          idempotent: true,
        };
      }

      // Insert event
      const eventId = crypto.randomUUID();
      await db.runInTx(
        "INSERT INTO learning_events (id,idempotency_key,schema_version,concept_id,scope_type,scope_id,event_type,direction,strength,source,evidence_text,created_at) VALUES (?,?,1,?,?,?,?,?,1.0,'explicit_user',?,?)",
        [eventId, idempotencyKey, conceptId, st, si, eventType, direction, evidenceText || null, stamp],
      );

      // Read stable event sequence and replay projection
      const rows = await db.queryInTx<Row>(
        "SELECT * FROM learning_events WHERE concept_id=? AND scope_type=? AND scope_id=? AND is_voided=0 ORDER BY created_at ASC, id ASC",
        [conceptId, st, si],
      );
      const voidedIds = new Set(rows.filter(e => e.event_type === "event_voided" && e.target_event_id).map(e => String(e.target_event_id)));
      const active = rows.filter(e => !voidedIds.has(String(e.id))).sort((a, b) => {
        const dc = String(a.created_at).localeCompare(String(b.created_at));
        return dc !== 0 ? dc : String(a.id).localeCompare(String(b.id));
      });
      let known = 1, unknown = 1, manual: string | null = null;
      for (const e of active) {
        const et = String(e.event_type);
        if (et === "manual_override_known") { manual = "known"; continue; }
        if (et === "manual_override_unknown") { manual = "unknown"; continue; }
        if (et === "manual_override_cleared") { manual = null; continue; }
        if (et === "event_voided") continue;
        if (manual !== null) continue;
        const d = this.autoDeltas[et] || [0, 0];
        let dk = d[0], du = d[1];
        if (String(e.source) !== "explicit_user") { dk = Math.min(dk, 1); du = Math.min(du, 1); }
        known += dk * Number(e.strength); unknown += du * Number(e.strength);
      }
      known = Math.max(1, known); unknown = Math.max(1, unknown);
      const total = known + unknown;
      const mst = total > 0 ? known / total : 0.5;
      const unc = total > 0 ? 1 / Math.sqrt(total) : 0.7071;

      // UPSERT projection
      const existingM = (await db.queryInTx<Row>("SELECT * FROM concept_mastery WHERE concept_id=? AND scope_type=? AND scope_id=?", [conceptId, st, si]))[0];
      const masteryId = existingM ? String(existingM.id) : crypto.randomUUID();
      const seq = (existingM ? Number(existingM.sequence ?? 0) : 0) + 1;
      await db.runInTx(
        "INSERT INTO concept_mastery (id,concept_id,scope_type,scope_id,known_evidence,unknown_evidence,mastery,uncertainty,manual_status,sequence,last_seen_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(concept_id,scope_type,scope_id) DO UPDATE SET known_evidence=excluded.known_evidence,unknown_evidence=excluded.unknown_evidence,mastery=excluded.mastery,uncertainty=excluded.uncertainty,manual_status=excluded.manual_status,sequence=excluded.sequence,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at",
        [masteryId, conceptId, st, si, known, unknown, mst, unc, manual, seq, stamp, stamp],
      );
      await this.appendLearningEvidenceV2(
        projectId,
        {
          idempotencyKey: `v2:${idempotencyKey}`,
          conceptId,
          scopeType: st,
          scopeId: si,
          dimension: "familiarity",
          direction: direction === "known" ? "positive" : direction === "unknown" ? "negative" : "neutral",
          strength: 1,
          reliability: 1,
          source: "manual",
          action: direction === "known" ? "manual_known" : direction === "unknown" ? "manual_unknown" : "manual_clear",
          object: { type: "concept", id: conceptId },
          result: { status: direction === "neutral" ? null : direction, evidenceText: evidenceText || "" },
          eventTime: stamp,
        },
        true,
      );

      const mastery: PersonalizationMastery = { id: masteryId, conceptId, scope: { type: st as unknown as ScopeTypeStr, id: si }, knownEvidence: known, unknownEvidence: unknown, mastery: mst, uncertainty: unc, manualStatus: manual as "known" | "unknown" | null, sequence: seq, lastSeenAt: stamp, updatedAt: stamp };
      return {
        event: { eventId, idempotencyKey, schemaVersion: 1, conceptId, scope: { type: st as unknown as ScopeTypeStr, id: si }, eventType, direction, strength: 1.0, source: "explicit_user" as const, isVoided: false, createdAt: stamp, evidenceText: evidenceText || undefined },
        mastery,
        idempotent: false,
      };
    });
  }

  async markConceptKnown(projectId: number, conceptId: string, idempotencyKey: string, evidenceText?: string): Promise<{ event: PersonalizationEvent; mastery: PersonalizationMastery; idempotent: boolean }> {
    return this.atomicFeedback(projectId, conceptId, "manual_override_known", "known", idempotencyKey, evidenceText);
  }
  async markConceptUnknown(projectId: number, conceptId: string, idempotencyKey: string, evidenceText?: string): Promise<{ event: PersonalizationEvent; mastery: PersonalizationMastery; idempotent: boolean }> {
    return this.atomicFeedback(projectId, conceptId, "manual_override_unknown", "unknown", idempotencyKey, evidenceText);
  }
  async clearConceptOverride(projectId: number, conceptId: string, idempotencyKey: string): Promise<{ event: PersonalizationEvent; mastery: PersonalizationMastery; idempotent: boolean }> {
    return this.atomicFeedback(projectId, conceptId, "manual_override_cleared", "neutral", idempotencyKey);
  }

  async getPersonalizationEvents(projectId: number, conceptId: string): Promise<PersonalizationEvent[]> {
    await db.init();
    const { type: st, id: si } = await this.scopeForConcept(projectId, conceptId);
    const rows = await db.query<Row>("SELECT * FROM learning_events WHERE concept_id=? AND scope_type=? AND scope_id=? AND is_voided=0 ORDER BY created_at ASC, id ASC", [conceptId, st, si]);
    return rows.map(r => this.eventFromRow(r));
  }

  async voidPersonalizationEvent(projectId: number, eventId: string, conceptId: string, idempotencyKey: string, reason?: string): Promise<PersonalizationEvent> {
    await db.init();
    const { type: st, id: si } = await this.scopeForConcept(projectId, conceptId);
    const stamp = now();
    const compensationId = crypto.randomUUID();
    await db.run(
      "INSERT INTO learning_events (id,idempotency_key,schema_version,concept_id,scope_type,scope_id,event_type,direction,strength,source,target_event_id,evidence_text,created_at) VALUES (?,?,1,?,?,?,?,?,1.0,'explicit_user',?,?,?)",
      [compensationId, idempotencyKey, conceptId, st, si, "event_voided", "neutral", eventId, reason || "User requested undo", stamp],
    );
    await this.updateProjection(conceptId, st, si, stamp);
    return { eventId: compensationId, idempotencyKey, schemaVersion: 1, conceptId, scope: { type: st as unknown as ScopeTypeStr, id: si }, eventType: "event_voided", direction: "neutral", strength: 1.0, source: "explicit_user", targetEventId: eventId, evidenceText: reason, isVoided: false, createdAt: stamp };
  }

  private async resolvePersonalizationTerms(
    projectId: number,
    candidates: Array<Record<string, unknown>>,
  ): Promise<{ terms: Array<Record<string, unknown>> }> {
    const terms: Array<Record<string, unknown>> = [];
    for (const candidate of candidates.slice(0, 50)) {
      const text = String(candidate.text || "").trim().slice(0, 80);
      if (!text) continue;
      const source = String(candidate.source || "rule");
      const normalized = normalizeTerm(text);
      if (!normalized) continue;
      const isProject = ["index", "project", "code", "symbol"].includes(source);
      const conceptKey = isProject
        ? `project:${projectId}:symbol:${normalized}`
        : `global:general:${normalized}`;
      let concept = (await db.query<Row>("SELECT * FROM concepts WHERE concept_key=?", [conceptKey]))[0];
      if (!concept && !isProject) {
        const byName = (await db.query<Row>(
          "SELECT * FROM concepts WHERE concept_key LIKE 'global:%' AND (lower(canonical_name)=lower(?) OR lower(aliases_json) LIKE lower(?)) LIMIT 1",
          [text, `%"${text}"%`],
        ))[0];
        concept = byName;
      }
      if (!concept) {
        const id = crypto.randomUUID();
        const stamp = now();
        const confidence = Number(candidate.confidence ?? 0.7);
        await db.run(
          "INSERT INTO concepts(id,concept_key,canonical_name,display_name,domain,concept_type,aliases_json,difficulty,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
          [
            id,
            conceptKey,
            text,
            text,
            isProject ? "project-symbol" : "general",
            isProject ? "project_symbol" : "theory",
            "[]",
            Math.max(0.2, Math.min(0.9, 0.45 + confidence - 0.7)),
            stamp,
          ],
        );
        concept = (await db.query<Row>("SELECT * FROM concepts WHERE id=?", [id]))[0];
      }
      const parsed = this.conceptFromRow(concept);
      const { type: st, id: si } = this.scopeForConceptRow(projectId, concept);
      const masteryRow = (await db.query<Row>(
        "SELECT * FROM concept_mastery WHERE concept_id=? AND scope_type=? AND scope_id=?",
        [parsed.id, st, si],
      ))[0];
      terms.push({
        text,
        source,
        confidence: Number(candidate.confidence ?? 0.7),
        contextRelevance: Number(candidate.context_relevance ?? 0.5),
        concept: parsed,
        mastery: masteryRow ? this.masteryFromRow(masteryRow, st, si) : null,
      });
    }
    return { terms };
  }

  private preferencesFromRow(row: Row): LearnerPreferences {
    const preferences = {
      answerDepth: Number(row.answer_depth),
      codeRatio: Number(row.code_ratio),
      explanationOrder: String(row.explanation_order) as LearnerPreferences["explanationOrder"],
      prerequisiteDetail: Number(row.prerequisite_detail),
      terminologyDensity: Number(row.terminology_density),
      feedbackCount: Number(row.feedback_count),
      surveyEnabled: bool(row.survey_enabled),
      lastSurveyAt: row.last_survey_at ? String(row.last_survey_at) : null,
      updatedAt: String(row.updated_at),
      scope: {
        type: String(row.scope_type) as PersonalizationMastery["scope"]["type"],
        id: String(row.scope_id),
      },
    };
    return {
      ...preferences,
      surveyDue: shouldOfferStyleSurvey(preferences),
    };
  }

  private async ensurePreferences(
    projectId: number,
    scope: "global" | "project" = "global",
  ): Promise<LearnerPreferences> {
    const st = scope;
    const si = scope === "global" ? "local-user" : String(projectId);
    let row = (await db.query<Row>(
      "SELECT * FROM learner_preferences WHERE scope_type=? AND scope_id=?",
      [st, si],
    ))[0];
    if (!row && scope === "project") {
      return this.ensurePreferences(projectId, "global");
    }
    if (!row) {
      const stamp = now();
      await db.run(
        "INSERT INTO learner_preferences(scope_type,scope_id,answer_depth,code_ratio,explanation_order,prerequisite_detail,terminology_density,feedback_count,survey_enabled,last_survey_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        [st, si, 0.5, 0.5, "balanced", 0.5, 0.5, 0, 1, null, stamp],
      );
      row = (await db.query<Row>(
        "SELECT * FROM learner_preferences WHERE scope_type=? AND scope_id=?",
        [st, si],
      ))[0];
    }
    return this.preferencesFromRow(row);
  }

  private async getLearnerPreferences(projectId: number): Promise<LearnerPreferences> {
    const project = (await db.query<Row>(
      "SELECT * FROM learner_preferences WHERE scope_type='project' AND scope_id=?",
      [String(projectId)],
    ))[0];
    return project ? this.preferencesFromRow(project) : this.ensurePreferences(projectId);
  }

  private async updateLearnerPreferences(
    projectId: number,
    payload: Record<string, unknown>,
  ): Promise<LearnerPreferences> {
    const scope = payload.scope === "project" ? "project" : "global";
    const current = await this.ensurePreferences(projectId, scope);
    const clamp01 = (value: unknown, fallback: number) => value == null
      ? fallback
      : Math.max(0, Math.min(1, Number(value)));
    const order = ["balanced", "example_first", "principle_first", "code_first"].includes(String(payload.explanation_order))
      ? String(payload.explanation_order)
      : current.explanationOrder;
    const st = scope;
    const si = scope === "global" ? "local-user" : String(projectId);
    await db.run(
      `INSERT INTO learner_preferences(scope_type,scope_id,answer_depth,code_ratio,explanation_order,prerequisite_detail,terminology_density,feedback_count,survey_enabled,last_survey_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(scope_type,scope_id) DO UPDATE SET answer_depth=excluded.answer_depth,code_ratio=excluded.code_ratio,explanation_order=excluded.explanation_order,prerequisite_detail=excluded.prerequisite_detail,terminology_density=excluded.terminology_density,feedback_count=excluded.feedback_count,survey_enabled=excluded.survey_enabled,last_survey_at=excluded.last_survey_at,updated_at=excluded.updated_at`,
      [
        st,
        si,
        clamp01(payload.answer_depth, current.answerDepth),
        clamp01(payload.code_ratio, current.codeRatio),
        order,
        clamp01(payload.prerequisite_detail, current.prerequisiteDetail),
        clamp01(payload.terminology_density, current.terminologyDensity),
        Number(payload.feedback_count ?? current.feedbackCount),
        payload.survey_enabled == null ? (current.surveyEnabled ? 1 : 0) : (bool(payload.survey_enabled) ? 1 : 0),
        payload.last_survey_at === undefined ? current.lastSurveyAt : payload.last_survey_at,
        now(),
      ],
    );
    return this.preferencesFromRow((await db.query<Row>(
      "SELECT * FROM learner_preferences WHERE scope_type=? AND scope_id=?",
      [st, si],
    ))[0]);
  }

  private async applyAnswerPreferenceFeedback(
    projectId: number,
    payload: Record<string, unknown>,
  ): Promise<LearnerPreferences> {
    const scope = payload.scope === "project" ? "project" : "global";
    const st = scope;
    const si = scope === "global" ? "local-user" : String(projectId);
    const idempotencyKey = String(payload.idempotency_key || "");
    const existing = (await db.query<Row>(
      "SELECT id FROM preference_events WHERE idempotency_key=?",
      [idempotencyKey],
    ))[0];
    if (existing) return this.ensurePreferences(projectId, scope);

    const current = await this.ensurePreferences(projectId, scope);
    const source = String(payload.source || "explicit_user");
    const explicit = source === "explicit_user" || source === "survey";
    const magnitude = (explicit ? 0.05 : 0.02)
      * Math.max(0.35, 1 / Math.sqrt(1 + current.feedbackCount / 8));
    const choice = String(payload.choice || "");
    const positive = new Set(["more", "deeper", "code", "examples", "prerequisites", "terms", "too_shallow"]);
    const negative = new Set(["less", "shorter", "principles", "fewer", "too_deep"]);
    const delta = positive.has(choice) ? magnitude : negative.has(choice) ? -magnitude : 0;
    const dimension = String(payload.dimension || "");
    const updates: Record<string, unknown> = {
      scope,
      feedback_count: current.feedbackCount + 1,
      last_survey_at: source === "survey" ? now() : current.lastSurveyAt,
    };
    const fields: Record<string, keyof LearnerPreferences> = {
      answer_depth: "answerDepth",
      code_ratio: "codeRatio",
      prerequisite_detail: "prerequisiteDetail",
      terminology_density: "terminologyDensity",
    };
    if (fields[dimension]) {
      updates[dimension] = Math.max(0, Math.min(1, Number(current[fields[dimension]]) + delta));
    } else if (dimension === "explanation_order") {
      updates.explanation_order = {
        examples: "example_first",
        principles: "principle_first",
        code: "code_first",
        balanced: "balanced",
      }[choice] || current.explanationOrder;
    }
    await db.run(
      "INSERT INTO preference_events(id,idempotency_key,scope_type,scope_id,dimension,delta,source,qa_record_id,evidence_text,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      [crypto.randomUUID(), idempotencyKey, st, si, dimension, delta, source, payload.qa_record_id ?? null, choice, now()],
    );
    return this.updateLearnerPreferences(projectId, updates);
  }

  private async saveTermImpressions(
    projectId: number,
    impressions: Array<Record<string, unknown>>,
  ): Promise<{ status: string; saved: number }> {
    let saved = 0;
    for (const item of impressions.slice(0, 100)) {
      const stamp = now();
      await db.run(
        `INSERT INTO term_impressions(project_id,concept_id,source_type,source_path,term_text,content_hash,displayed_count,opened_count,feedback,display_style,last_displayed_at,last_opened_at,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(project_id,source_type,source_path,term_text,content_hash) DO UPDATE SET
           concept_id=COALESCE(term_impressions.concept_id,excluded.concept_id),
           displayed_count=term_impressions.displayed_count+excluded.displayed_count,
           opened_count=term_impressions.opened_count+excluded.opened_count,
           feedback=COALESCE(excluded.feedback,term_impressions.feedback),
           display_style=excluded.display_style,
           last_displayed_at=COALESCE(excluded.last_displayed_at,term_impressions.last_displayed_at),
           last_opened_at=COALESCE(excluded.last_opened_at,term_impressions.last_opened_at),
           updated_at=excluded.updated_at`,
        [
          projectId,
          item.concept_id ?? null,
          item.source_type,
          item.source_path,
          item.term_text,
          item.content_hash || "",
          bool(item.displayed) ? 1 : 0,
          bool(item.opened) ? 1 : 0,
          item.feedback ?? null,
          item.display_style || "subtle",
          bool(item.displayed) ? stamp : null,
          bool(item.opened) ? stamp : null,
          stamp,
          stamp,
        ],
      );
      saved += 1;
    }
    return { status: "ok", saved };
  }

  private async getTermDisplayProfiles(
    projectId: number,
    conceptIds: string[],
  ): Promise<{ profiles: Array<Record<string, unknown>> }> {
    await this.getProject(projectId);
    if (!conceptIds.length) return { profiles: [] };
    const placeholders = conceptIds.map(() => "?").join(",");
    const masteryRows = await db.query<Row>(
      `SELECT c.concept_key,m.mastery,m.uncertainty,m.manual_status,m.scope_type
       FROM concept_mastery m
       JOIN concepts c ON c.id=m.concept_id
       WHERE ((m.scope_type='global' AND m.scope_id='local-user')
          OR (m.scope_type='project' AND m.scope_id=?))
         AND c.concept_key IN (${placeholders})
       ORDER BY CASE WHEN m.scope_type='project' THEN 1 ELSE 0 END`,
      [String(projectId), ...conceptIds],
    );
    const stateRows = await db.query<Row>(
      `SELECT c.concept_key,s.state_json,s.scope_type
       FROM knowledge_states_v2 s
       JOIN concepts c ON c.id=s.concept_id
       WHERE ((s.scope_type='global' AND s.scope_id='local-user')
          OR (s.scope_type='project' AND s.scope_id=?))
         AND c.concept_key IN (${placeholders})
       ORDER BY CASE WHEN s.scope_type='project' THEN 1 ELSE 0 END`,
      [String(projectId), ...conceptIds],
    );
    const masteryById = new Map(masteryRows.map((row) => [String(row.concept_key), row]));
    const stateById = new Map(stateRows.map((row) => [String(row.concept_key), JSON.parse(String(row.state_json)) as KnowledgeStateV2]));
    return {
      profiles: conceptIds.map((conceptId) => {
        const mastery = masteryById.get(conceptId);
        const familiarity = stateById.get(conceptId)?.dimensions.familiarity;
        return {
          concept_key: conceptId,
          manual_status: mastery?.manual_status ?? null,
          mastery: mastery == null ? null : Number(mastery.mastery),
          uncertainty: mastery == null ? null : Number(mastery.uncertainty),
          shadow_familiarity: familiarity?.probability ?? null,
          shadow_confidence: familiarity == null ? null : 1 - familiarity.uncertainty,
          shadow_evidence_count: familiarity?.evidenceCount ?? 0,
          domain_prior: null,
        };
      }),
    };
  }

  private evidenceV2FromRow(row: Row): LearningEvidenceV2 {
    const parseObject = (value: unknown): Record<string, unknown> => {
      try {
        const parsed = JSON.parse(String(value || "{}"));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    };
    return {
      id: String(row.id),
      idempotencyKey: String(row.idempotency_key),
      schemaVersion: 2,
      conceptId: String(row.concept_id),
      scopeType: String(row.scope_type) as "global" | "project",
      scopeId: String(row.scope_id),
      dimension: String(row.dimension) as KnowledgeDimension,
      direction: String(row.direction) as LearningEvidenceV2["direction"],
      strength: Number(row.strength),
      reliability: Number(row.reliability),
      source: String(row.source) as LearningEvidenceV2["source"],
      action: String(row.action),
      object: parseObject(row.object_json),
      result: parseObject(row.result_json),
      context: parseObject(row.context_json),
      eventTime: String(row.event_time),
      sessionId: row.session_id == null ? null : String(row.session_id),
      qaRecordId: row.qa_record_id == null ? null : Number(row.qa_record_id),
      diagnosticAttemptId: row.diagnostic_attempt_id == null ? null : String(row.diagnostic_attempt_id),
      objectiveCorrect: row.objective_correct == null ? null : bool(row.objective_correct),
      targetEvidenceId: row.target_evidence_id == null ? null : String(row.target_evidence_id),
      voided: bool(row.voided),
      modelVersion: row.model_version == null ? null : String(row.model_version),
      policyVersion: String(row.policy_version || KNOWLEDGE_POLICY_VERSION),
    };
  }

  private async appendLearningEvidenceV2(
    projectId: number,
    payload: Record<string, unknown>,
    inTransaction = false,
  ): Promise<{ evidence: LearningEvidenceV2; state: KnowledgeStateV2 }> {
    const query = <T extends Row>(statement: string, values: unknown[] = []) => (
      inTransaction ? db.queryInTx<T>(statement, values) : db.query<T>(statement, values)
    );
    const run = (statement: string, values: unknown[] = []) => (
      inTransaction ? db.runInTx(statement, values) : db.run(statement, values)
    );
    const conceptId = String(payload.conceptId || "");
    const concept = (await query<Row>("SELECT * FROM concepts WHERE id=?", [conceptId]))[0];
    if (!concept) throw new Error("Concept not found");
    const derivedScope = this.scopeForConceptRow(projectId, concept);
    const scopeType = derivedScope.type as "global" | "project";
    const scopeId = derivedScope.id;
    const dimension = String(payload.dimension || "") as KnowledgeDimension;
    if (!["familiarity", "conceptual", "code_reading", "implementation", "debugging", "transfer"].includes(dimension)) {
      throw new Error(`Unsupported knowledge dimension: ${dimension}`);
    }
    const direction = String(payload.direction || "");
    if (!["positive", "negative", "neutral"].includes(direction)) throw new Error("Unsupported evidence direction");
    const source = String(payload.source || "");
    if (!["manual", "diagnostic", "question", "summary", "observer", "course_completion", "migration"].includes(source)) {
      throw new Error("Unsupported evidence source");
    }
    const id = String(payload.id || crypto.randomUUID());
    const idempotencyKey = String(payload.idempotencyKey || id);
    const eventTime = String(payload.eventTime || now());
    await run(
      `INSERT OR IGNORE INTO learning_evidence_v2
       (id,idempotency_key,schema_version,concept_id,scope_type,scope_id,
        dimension,direction,strength,reliability,source,action,object_json,
        result_json,context_json,event_time,session_id,qa_record_id,
        diagnostic_attempt_id,objective_correct,target_evidence_id,voided,
        model_version,policy_version)
       VALUES(?,?,2,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, idempotencyKey, conceptId, scopeType, scopeId, dimension, direction,
        Math.max(0, Math.min(1, Number(payload.strength ?? 1))),
        Math.max(0, Math.min(1, Number(payload.reliability ?? 0.5))),
        source, String(payload.action || "observed"),
        JSON.stringify(payload.object || {}), JSON.stringify(payload.result || {}),
        JSON.stringify(payload.context || {}), eventTime,
        payload.sessionId ?? null, payload.qaRecordId ?? null,
        payload.diagnosticAttemptId ?? null,
        payload.objectiveCorrect == null ? null : (bool(payload.objectiveCorrect) ? 1 : 0),
        payload.targetEvidenceId ?? null, bool(payload.voided) ? 1 : 0,
        payload.modelVersion ?? null, String(payload.policyVersion || KNOWLEDGE_POLICY_VERSION),
      ],
    );
    const row = (await query<Row>(
      "SELECT * FROM learning_evidence_v2 WHERE idempotency_key=?",
      [idempotencyKey],
    ))[0];
    if (!row) throw new Error("Evidence was not persisted");
    const evidence = this.evidenceV2FromRow(row);
    const rows = await query<Row>(
      `SELECT * FROM learning_evidence_v2
       WHERE concept_id=? AND scope_type=? AND scope_id=?
       ORDER BY event_time,id`,
      [conceptId, scopeType, scopeId],
    );
    const state = resolveKnowledgeState(
      conceptId,
      scopeType,
      scopeId,
      rows.map((item) => this.evidenceV2FromRow(item)),
      now(),
    );
    await run(
      `INSERT INTO knowledge_states_v2
       (concept_id,scope_type,scope_id,state_json,policy_version,evidence_version,updated_at)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(concept_id,scope_type,scope_id) DO UPDATE SET
         state_json=excluded.state_json,policy_version=excluded.policy_version,
         evidence_version=excluded.evidence_version,updated_at=excluded.updated_at`,
      [conceptId, scopeType, scopeId, JSON.stringify(state), state.policyVersion, state.evidenceVersion, state.updatedAt],
    );
    return { evidence, state };
  }

  private async getKnowledgeStatesV2(
    projectId: number,
    conceptIds: string[] = [],
  ): Promise<{ policyVersion: string; states: KnowledgeStateV2[] }> {
    await this.getProject(projectId);
    const missing = Number((await db.query<Row>(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT DISTINCT e.concept_id,e.scope_type,e.scope_id
         FROM learning_evidence_v2 e
         LEFT JOIN knowledge_states_v2 s
           ON s.concept_id=e.concept_id AND s.scope_type=e.scope_type AND s.scope_id=e.scope_id
         WHERE ((e.scope_type='global' AND e.scope_id='local-user')
            OR (e.scope_type='project' AND e.scope_id=?))
           AND (s.concept_id IS NULL OR s.policy_version<>?)
       )`,
      [String(projectId), KNOWLEDGE_POLICY_VERSION],
    ))[0]?.count || 0);
    if (missing > 0) await this.rebuildKnowledgeProfileV2(projectId);
    const filters = conceptIds.length
      ? ` AND concept_id IN (${conceptIds.map(() => "?").join(",")})`
      : "";
    const rows = await db.query<Row>(
      `SELECT state_json FROM knowledge_states_v2
       WHERE ((scope_type='global' AND scope_id='local-user')
          OR (scope_type='project' AND scope_id=?))${filters}`,
      [String(projectId), ...conceptIds],
    );
    return {
      policyVersion: KNOWLEDGE_POLICY_VERSION,
      states: rows.map((row) => JSON.parse(String(row.state_json)) as KnowledgeStateV2),
    };
  }

  private async voidLearningEvidenceV2(
    projectId: number,
    evidenceId: string,
    idempotencyKey: string,
    reason: string,
  ): Promise<{ evidence: LearningEvidenceV2; state: KnowledgeStateV2 }> {
    return db.transaction(async () => {
      const target = (await db.queryInTx<Row>(
        "SELECT * FROM learning_evidence_v2 WHERE id=?",
        [evidenceId],
      ))[0];
      if (!target) throw new Error("Evidence not found");
      return this.appendLearningEvidenceV2(projectId, {
        idempotencyKey,
        conceptId: target.concept_id,
        dimension: target.dimension,
        direction: "neutral",
        strength: 0,
        reliability: 1,
        source: "manual",
        action: "void_evidence",
        targetEvidenceId: evidenceId,
        result: { reason },
      }, true);
    });
  }

  private async rebuildKnowledgeProfileV2(
    projectId: number,
  ): Promise<{ status: string; rebuilt: number; policyVersion: string }> {
    await this.getProject(projectId);
    const pairs = await db.query<Row>(
      `SELECT DISTINCT concept_id FROM learning_evidence_v2
       WHERE (scope_type='global' AND scope_id='local-user')
          OR (scope_type='project' AND scope_id=?)`,
      [String(projectId)],
    );
    let rebuilt = 0;
    for (const pair of pairs) {
      const concept = (await db.query<Row>("SELECT * FROM concepts WHERE id=?", [pair.concept_id]))[0];
      if (!concept) continue;
      const scope = this.scopeForConceptRow(projectId, concept);
      const events = await db.query<Row>(
        "SELECT * FROM learning_evidence_v2 WHERE concept_id=? AND scope_type=? AND scope_id=? ORDER BY event_time,id",
        [pair.concept_id, scope.type, scope.id],
      );
      const state = resolveKnowledgeState(
        String(pair.concept_id),
        scope.type as "global" | "project",
        scope.id,
        events.map((row) => this.evidenceV2FromRow(row)),
      );
      await db.run(
        `INSERT INTO knowledge_states_v2(concept_id,scope_type,scope_id,state_json,policy_version,evidence_version,updated_at)
         VALUES(?,?,?,?,?,?,?) ON CONFLICT(concept_id,scope_type,scope_id) DO UPDATE SET
         state_json=excluded.state_json,policy_version=excluded.policy_version,
         evidence_version=excluded.evidence_version,updated_at=excluded.updated_at`,
        [pair.concept_id, scope.type, scope.id, JSON.stringify(state), state.policyVersion, state.evidenceVersion, state.updatedAt],
      );
      rebuilt += 1;
    }
    return { status: "ok", rebuilt, policyVersion: KNOWLEDGE_POLICY_VERSION };
  }

  private jsonArray(value: unknown): Array<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(String(value || "[]"));
      return Array.isArray(parsed)
        ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        : [];
    } catch {
      return [];
    }
  }

  private stringArray(value: unknown): string[] {
    try {
      const parsed = JSON.parse(String(value || "[]"));
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  private async recordModelCall(
    projectId: number | null,
    purpose: string,
    status: "completed" | "failed",
    startedAt: number,
    error?: unknown,
  ): Promise<void> {
    const settings = await this.getLLMSettings().catch(() => null);
    await db.run(
      `INSERT INTO model_call_audit
       (id,project_id,purpose,provider,model,status,input_tokens,output_tokens,estimated_cost,latency_ms,error_message,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        crypto.randomUUID(),
        projectId,
        purpose,
        settings?.provider ?? null,
        settings?.model ?? null,
        status,
        null,
        null,
        null,
        Math.max(0, Math.round(performance.now() - startedAt)),
        error instanceof Error ? error.message.slice(0, 500) : error ? String(error).slice(0, 500) : null,
        now(),
      ],
    );
  }

  private async resolveObserverConcept(
    projectId: number,
    text: string,
    domain: string,
  ): Promise<PersonalizationConcept | null> {
    const resolved = await this.resolvePersonalizationTerms(projectId, [{
      text,
      source: "observer",
      confidence: 0.78,
    }]);
    const concept = resolved.terms[0]?.concept as PersonalizationConcept | undefined;
    if (!concept) return null;
    if (domain && domain !== "general" && concept.domain === "general") {
      await db.run("UPDATE concepts SET domain=? WHERE id=?", [domain.slice(0, 80), concept.id]);
      return this.conceptFromRow((await db.query<Row>("SELECT * FROM concepts WHERE id=?", [concept.id]))[0]);
    }
    return concept;
  }

  private async upsertLearnerInference(
    subjectType: "concept" | "domain",
    subjectKey: string,
    scopeType: "global" | "project",
    scopeId: string,
    state: InferenceState,
    summary: string,
    confidence: number,
    direct: boolean,
    evidence: Record<string, unknown>,
  ): Promise<void> {
    const current = (await db.query<Row>(
      `SELECT * FROM learner_inferences
       WHERE subject_type=? AND subject_key=? AND scope_type=? AND scope_id=?`,
      [subjectType, subjectKey, scopeType, scopeId],
    ))[0];
    const aggregate = mergeInference(
      current ? {
        state: String(current.state) as InferenceState,
        confidence: Number(current.confidence),
        directEvidenceCount: Number(current.direct_evidence_count),
        inferredEvidenceCount: Number(current.inferred_evidence_count),
      } : null,
      state,
      confidence,
      direct,
    );
    const stamp = now();
    const existingEvidence = current ? this.jsonArray(current.evidence_json) : [];
    const evidenceId = String(evidence.id || "");
    const mergedEvidence = [
      evidence,
      ...existingEvidence.filter((item) => !evidenceId || String(item.id || "") !== evidenceId),
    ].slice(0, 20);
    await db.run(
      `INSERT INTO learner_inferences
       (id,subject_type,subject_key,scope_type,scope_id,state,summary,confidence,
        direct_evidence_count,inferred_evidence_count,evidence_json,status,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,'active',?,?)
       ON CONFLICT(subject_type,subject_key,scope_type,scope_id) DO UPDATE SET
         state=excluded.state,summary=excluded.summary,confidence=excluded.confidence,
         direct_evidence_count=excluded.direct_evidence_count,
         inferred_evidence_count=excluded.inferred_evidence_count,
         evidence_json=excluded.evidence_json,status='active',updated_at=excluded.updated_at`,
      [
        current?.id || crypto.randomUUID(),
        subjectType,
        subjectKey,
        scopeType,
        scopeId,
        aggregate.state,
        summary.slice(0, 500),
        aggregate.confidence,
        aggregate.directEvidenceCount,
        aggregate.inferredEvidenceCount,
        JSON.stringify(mergedEvidence),
        current?.created_at || stamp,
        stamp,
      ],
    );
  }

  private async applyAndroidObserverResult(
    projectId: number,
    record: QARecord,
    result: ObserverResult,
    observerRunId: string,
  ): Promise<void> {
    const userCorpus = `${record.question}\n${record.selected_text}`.toLocaleLowerCase();
    const acceptedEvidence = result.knowledgeEvidence.filter((item) => {
      if (!isAcceptedDirectEvidence(item)) return false;
      const quote = item.evidenceQuote.trim().toLocaleLowerCase();
      return Boolean(quote) && userCorpus.includes(quote);
    });

    for (const [index, evidence] of acceptedEvidence.entries()) {
      const concept = await this.resolveObserverConcept(projectId, evidence.concept, evidence.domain);
      if (!concept) continue;
      const scope = await this.scopeForConcept(projectId, concept.id);
      await this.upsertLearnerInference(
        "concept",
        concept.id,
        scope.type,
        scope.id,
        evidence.direction === "positive" ? "insufficient" : "learning",
        evidence.explanation,
        evidence.confidence,
        evidence.direction === "negative",
        {
          id: `${observerRunId}:knowledge:${index}`,
          qaRecordId: record.id,
          quote: evidence.evidenceQuote,
          direction: evidence.direction,
        },
      );
      await this.appendLearningEvidenceV2(projectId, {
        id: `${observerRunId}:knowledge-v2:${index}`,
        idempotencyKey: `${observerRunId}:knowledge-v2:${index}`,
        conceptId: concept.id,
        dimension: evidence.dimension || "familiarity",
        direction: evidence.direction === "uncertain" ? "neutral" : evidence.direction,
        strength: 0.65,
        reliability: Math.min(0.65, evidence.confidence),
        source: "observer",
        action: "candidate_accepted",
        object: { type: "concept", conceptText: evidence.concept },
        result: { evidenceQuote: evidence.evidenceQuote, explanation: evidence.explanation },
        qaRecordId: record.id,
        sessionId: record.session_id == null ? null : String(record.session_id),
        modelVersion: "android-observer-v2",
      });
    }

    for (const [index, relation] of result.conceptRelations.filter(isAcceptedRelation).entries()) {
      const source = await this.resolveObserverConcept(projectId, relation.source, relation.domain);
      const target = await this.resolveObserverConcept(projectId, relation.target, relation.domain);
      if (!source || !target || source.id === target.id) continue;
      const stamp = now();
      const current = (await db.query<Row>(
        `SELECT * FROM concept_relations
         WHERE source_concept_id=? AND target_concept_id=? AND relation_type=?`,
        [source.id, target.id, relation.relationType],
      ))[0];
      const evidence: Record<string, unknown> = {
        id: `${observerRunId}:relation:${index}`,
        rationale: relation.rationale,
        confidence: relation.confidence,
      };
      const merged = [
        evidence,
        ...(current ? this.jsonArray(current.evidence_json) : []).filter(
          (item) => String(item.id || "") !== evidence.id,
        ),
      ].slice(0, 200);
      const activeEvidence = merged.filter((item) => !bool(item.voided));
      const mergedConfidence = activeEvidence.length
        ? activeEvidence.reduce((sum, item) => sum + Math.max(0, Math.min(1, Number(item.confidence || 0))), 0)
          / activeEvidence.length
        : 0;
      const mergedStatus = activeEvidence.length ? "active" : "voided";
      await db.run(
        `INSERT INTO concept_relations
         (id,source_concept_id,target_concept_id,relation_type,domain,confidence,
          evidence_json,origin,status,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,'observer',?,?,?)
         ON CONFLICT(source_concept_id,target_concept_id,relation_type) DO UPDATE SET
           domain=excluded.domain,
           confidence=excluded.confidence,
           evidence_json=excluded.evidence_json,status=excluded.status,updated_at=excluded.updated_at`,
        [
          current?.id || crypto.randomUUID(),
          source.id,
          target.id,
          relation.relationType,
          relation.domain || "general",
          mergedConfidence,
          JSON.stringify(merged),
          mergedStatus,
          current?.created_at || stamp,
          stamp,
        ],
      );
    }

    for (const [index, assessment] of result.domainAssessments.entries()) {
      const conservative = conservativeDomainState(assessment, acceptedEvidence);
      await this.upsertLearnerInference(
        "domain",
        assessment.domainKey,
        "global",
        "local-user",
        conservative.state,
        assessment.summary,
        assessment.confidence,
        conservative.direct,
        {
          id: `${observerRunId}:domain:${index}`,
          qaRecordId: record.id,
          quotes: assessment.evidenceQuotes,
          concepts: assessment.concepts,
        },
      );
    }

    await this.rebuildAndroidDomainProfiles();
    await this.storeAndroidSurveyCandidate(result, observerRunId);
    await this.storeAndroidDiagnosticCandidate(projectId, record, result);
  }

  private async rebuildAndroidDomainProfiles(): Promise<void> {
    const rows = await db.query<Row>(
      `SELECT c.domain,c.display_name,i.state,i.confidence,i.evidence_json
       FROM concepts c
       JOIN learner_inferences i ON i.subject_type='concept' AND i.subject_key=c.id
       WHERE i.status='active' AND i.scope_type='global' AND i.scope_id='local-user'`,
    );
    const domainInferenceRows = await db.query<Row>(
      `SELECT * FROM learner_inferences
       WHERE subject_type='domain' AND scope_type='global'
         AND scope_id='local-user' AND status='active'`,
    );
    const domains = new Set([
      ...rows.map((row) => String(row.domain || "general")),
      ...domainInferenceRows.map((row) => String(row.subject_key)),
    ]);
    for (const domain of domains) {
      const conceptRows = rows.filter((row) => String(row.domain || "general") === domain);
      const domainInference = domainInferenceRows.find((row) => String(row.subject_key) === domain);
      const confirmed = conceptRows.filter((row) => row.state === "confirmed").map((row) => String(row.display_name));
      const learning = conceptRows.filter((row) => row.state === "learning").map((row) => String(row.display_name));
      const likely = conceptRows.filter((row) => row.state === "likely_prerequisite").map((row) => String(row.display_name));
      const summary = domainInference
        ? String(domainInference.summary)
        : [
          confirmed.length ? `已有直接证据：${confirmed.slice(0, 4).join("、")}` : "",
          learning.length ? `正在学习：${learning.slice(0, 4).join("、")}` : "",
        ].filter(Boolean).join("；") || "目前证据不足";
      const confidence = domainInference
        ? Number(domainInference.confidence)
        : Math.max(0, ...conceptRows.map((row) => Number(row.confidence)));
      const stamp = now();
      await db.run(
        `INSERT INTO domain_profiles
         (domain_key,scope_id,summary,confidence,confirmed_json,learning_json,
          likely_prerequisites_json,evidence_json,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(domain_key,scope_id) DO UPDATE SET
           summary=excluded.summary,confidence=excluded.confidence,
           confirmed_json=excluded.confirmed_json,learning_json=excluded.learning_json,
           likely_prerequisites_json=excluded.likely_prerequisites_json,
           evidence_json=excluded.evidence_json,updated_at=excluded.updated_at`,
        [
          domain,
          "local-user",
          summary,
          confidence,
          JSON.stringify(confirmed.slice(0, 20)),
          JSON.stringify(learning.slice(0, 20)),
          JSON.stringify(likely.slice(0, 20)),
          domainInference?.evidence_json || "[]",
          stamp,
          stamp,
        ],
      );
    }
  }

  private async storeAndroidSurveyCandidate(
    result: ObserverResult,
    observerRunId: string,
  ): Promise<void> {
    const survey = result.surveyCandidate;
    if (!survey || survey.confidence < 0.65) return;
    const preferences = await this.getLearnerPreferences(0);
    const completedAnswerCount = Number((await db.query<Row>(
      "SELECT COUNT(*) AS count FROM qa_records WHERE answer_md <> ''",
    ))[0]?.count || 0);
    if (!preferences.surveyEnabled || completedAnswerCount < 5) return;
    const pending = await db.query<Row>(
      "SELECT id FROM survey_candidates WHERE scope_id='local-user' AND status='pending' LIMIT 1",
    );
    if (pending.length) return;
    const latest = (await db.query<Row>(
      "SELECT created_at FROM survey_candidates WHERE scope_id='local-user' ORDER BY created_at DESC LIMIT 1",
    ))[0];
    if (latest && Date.now() - Date.parse(String(latest.created_at)) < 24 * 60 * 60 * 1000) return;
    await db.run(
      `INSERT INTO survey_candidates
       (id,scope_id,question,dimension,options_json,rationale,confidence,status,observer_run_id,created_at)
       VALUES(?,'local-user',?,?,?,?,?,'pending',?,?)`,
      [
        crypto.randomUUID(),
        survey.question,
        survey.dimension,
        JSON.stringify(survey.options),
        survey.rationale,
        survey.confidence,
        observerRunId,
        now(),
      ],
    );
  }

  private async storeAndroidDiagnosticCandidate(
    projectId: number,
    record: QARecord,
    result: ObserverResult,
  ): Promise<void> {
    const candidate = result.diagnosticCandidate;
    if (!candidate || !candidate.sourceRefs.length) return;
    if (!record.source_path) return;
    let trustedSource = "";
    try {
      trustedSource = record.source_type === "file"
        ? await readRepoFile(projectId, record.source_path)
        : await readGeneratedFile(projectId, record.source_path);
    } catch {
      return;
    }
    const sourceVerified = candidate.sourceRefs.every((ref) => {
      const path = String(ref.source_path ?? ref.sourcePath ?? "").trim();
      const excerpt = String(ref.excerpt ?? "").trim();
      return path === record.source_path && Boolean(excerpt) && trustedSource.includes(excerpt);
    });
    if (!sourceVerified) return;
    const pending = await db.query<Row>(
      "SELECT id FROM diagnostic_items WHERE project_id=? AND status='pending' LIMIT 1",
      [projectId],
    );
    if (pending.length) return;
    const last = (await db.query<Row>(
      "SELECT COALESCE(MAX(source_qa_record_id),0) AS last_qa FROM diagnostic_items WHERE project_id=?",
      [projectId],
    ))[0];
    const completed = Number((await db.query<Row>(
      "SELECT COUNT(*) AS count FROM qa_records WHERE project_id=? AND id>? AND answer_md<>''",
      [projectId, Number(last?.last_qa || 0)],
    ))[0]?.count || 0);
    if (completed < 5) return;
    const conceptIds: string[] = [];
    for (const conceptName of candidate.concepts) {
      const concept = await this.resolveObserverConcept(projectId, conceptName, "general");
      if (concept) conceptIds.push(concept.id);
    }
    if (!conceptIds.length) return;
    const teachingTrial = await teachingOutcomes.findTrialForQa(projectId, record.id);
    await db.run(
      `INSERT INTO diagnostic_items
       (id,project_id,session_id,source_qa_record_id,teaching_trial_id,
        concept_ids_json,dimension,item_type,prompt,options_json,answer_key_json,
        source_refs_json,rationale,difficulty,strategy_version,status,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)`,
      [
        `diagnostic:${crypto.randomUUID()}`,
        projectId,
        record.session_id == null ? null : String(record.session_id),
        record.id,
        teachingTrial?.id ?? null,
        JSON.stringify(conceptIds),
        candidate.dimension,
        candidate.itemType,
        candidate.prompt,
        JSON.stringify(candidate.options),
        JSON.stringify(candidate.answerKey),
        JSON.stringify(candidate.sourceRefs),
        candidate.rationale,
        candidate.difficulty,
        "android-observer-v2",
        now(),
      ],
    );
  }

  private async shouldRunAndroidObserver(projectId: number, record: QARecord): Promise<boolean> {
    if (
      record.parent_qa_id != null
      || record.relation_type === "term_explanation"
      || record.relation_type === "alternate"
      || Boolean(record.selected_text)
    ) {
      return true;
    }
    const existingJobs = Number((await db.query<Row>(
      "SELECT COUNT(*) AS count FROM observer_jobs WHERE project_id=?",
      [projectId],
    ))[0]?.count || 0);
    if (existingJobs === 0) return true;
    const completed = Number((await db.query<Row>(
      "SELECT COUNT(*) AS count FROM qa_records WHERE project_id=? AND answer_md<>''",
      [projectId],
    ))[0]?.count || 0);
    if (completed % 5 === 0) return true;
    const concepts = await db.query<Row>(
      "SELECT id,canonical_name,display_name FROM concepts WHERE length(canonical_name)>=2",
    );
    const question = record.question.toLocaleLowerCase();
    for (const concept of concepts) {
      const names = [concept.canonical_name, concept.display_name]
        .map((value) => String(value || "").toLocaleLowerCase())
        .filter(Boolean);
      if (!names.some((name) => question.includes(name))) continue;
      const state = await db.query<Row>(
        "SELECT 1 FROM knowledge_states_v2 WHERE concept_id=? LIMIT 1",
        [concept.id],
      );
      if (!state.length) return true;
    }
    return false;
  }

  private async resumeObserverJobs(): Promise<void> {
    await db.run(
      "UPDATE observer_jobs SET status='pending',locked_at=NULL,updated_at=? WHERE status='running'",
      [now()],
    );
    const rows = await db.query<Row>(
      "SELECT project_id,qa_record_id FROM observer_jobs WHERE status='pending' ORDER BY created_at LIMIT 16",
    );
    for (const row of rows) {
      const record = await this.getQA(Number(row.project_id), Number(row.qa_record_id)).catch(() => null);
      if (record) void this.executeAndroidObserverJob(Number(row.project_id), record);
    }
  }

  private async executeAndroidObserverJob(projectId: number, record: QARecord): Promise<void> {
    const jobId = `android-observer:${projectId}:${record.id}`;
    const stamp = now();
    await db.run(
      `INSERT OR IGNORE INTO observer_jobs
       (id,project_id,qa_record_id,reason,payload_json,status,attempt_count,
        available_at,created_at,updated_at)
       VALUES(?,?,?,'high_information','{}','pending',0,?,?,?)`,
      [jobId, projectId, record.id, stamp, stamp, stamp],
    );
    await db.run(
      "UPDATE observer_jobs SET status='running',attempt_count=attempt_count+1,locked_at=?,updated_at=? WHERE id=?",
      [stamp, stamp, jobId],
    );
    const start = performance.now();
    try {
      const concepts = await this.listPersonalizationConcepts(projectId);
      const mastery = await this.getPersonalizationMasteryBatch(projectId, concepts.map((item) => item.id));
      const parent = record.parent_qa_id
        ? await this.getQA(projectId, record.parent_qa_id!).catch(() => null)
        : null;
      const previousTrial = (await db.query<Row>(
        `SELECT t.* FROM teaching_trials t
         WHERE t.project_id=?
           AND ((t.session_id=?)
             OR (t.session_id IS NULL AND ? IS NULL))
           AND t.qa_record_id<?
           AND t.was_applied=1
           AND NOT EXISTS(
             SELECT 1 FROM teaching_outcomes o
             WHERE o.teaching_trial_id=t.id
           )
         ORDER BY t.qa_record_id DESC LIMIT 1`,
        [projectId, record.session_id ?? null, record.session_id ?? null, record.id],
      ))[0];
      let previousTeachingContext: Record<string, unknown> = {};
      if (previousTrial?.effective_context_json) {
        try {
          previousTeachingContext = JSON.parse(String(previousTrial.effective_context_json));
        } catch {
          previousTeachingContext = {};
        }
      }
      const completedAnswerCount = Number((await db.query<Row>(
        "SELECT COUNT(*) AS count FROM qa_records WHERE answer_md <> ''",
      ))[0]?.count || 0);
      let sourceExcerpt = "";
      if (record.source_path) {
        try {
          sourceExcerpt = record.source_type === "file"
            ? await readRepoFile(projectId, record.source_path)
            : await readGeneratedFile(projectId, record.source_path);
        } catch {
          sourceExcerpt = "";
        }
      }
      const prompt = buildObserverPrompt({
        question: record.question,
        selectedText: record.selected_text,
        parentQuestion: parent?.question,
        parentAnswer: parent?.answer_md,
        knownConcepts: concepts.filter((item) => mastery[item.id]?.manualStatus === "known").map((item) => item.displayName),
        unfamiliarConcepts: concepts.filter((item) => mastery[item.id]?.manualStatus === "unknown").map((item) => item.displayName),
        completedAnswerCount,
        sourceType: record.source_type,
        sourcePath: record.source_path || undefined,
        sourceExcerpt: compactText(sourceExcerpt, 2200),
        previousAppliedTeaching: previousTrial ? {
          qaRecordId: Number(previousTrial.qa_record_id),
          teachingGoal: String(previousTeachingContext.teaching_goal || ""),
          strategies: Array.isArray(previousTeachingContext.strategies)
            ? previousTeachingContext.strategies.map(String).filter(Boolean).slice(0, 5)
            : [],
        } : null,
      });
      const raw = await this.callLLM([
        { role: "system", content: "You are a conservative, auditable learning-evidence observer. Output valid JSON only." },
        { role: "user", content: prompt },
      ]);
      const result = parseObserverResult(raw);
      await this.applyAndroidObserverResult(projectId, record, result, jobId);
      const teachingOutcome = result.previousTeachingOutcome;
      if (
        previousTrial
        && teachingOutcome
        && teachingOutcome.confidence >= 0.55
        && record.id > Number(previousTrial.qa_record_id)
        && record.question.includes(teachingOutcome.evidenceQuote)
      ) {
        await teachingOutcomes.recordOutcome({
          idempotencyKey: `teaching-outcome:v1:trial:${previousTrial.id}:evaluation-qa:${record.id}`,
          projectId,
          teachingTrialId: String(previousTrial.id),
          result: teachingOutcome.result,
          confidence: teachingOutcome.confidence,
          reason: teachingOutcome.reason,
          evidenceQuote: teachingOutcome.evidenceQuote,
          evidenceType: "observer_inference",
          evidenceRefId: `qa:${record.id}`,
          evaluationQaRecordId: record.id,
          sourceObservationId: `android-observer:v1:qa:${record.id}:previous_teaching_outcome:0`,
          observerRunId: jobId,
        });
      }
      await this.recordModelCall(projectId, "observer", "completed", start);
      await db.run("UPDATE observer_jobs SET status='completed',updated_at=? WHERE id=?", [now(), jobId]);
    } catch (error) {
      await this.recordModelCall(projectId, "observer", "failed", start, error).catch(() => undefined);
      await db.run(
        "UPDATE observer_jobs SET status='failed',last_error=?,updated_at=? WHERE id=?",
        [safeErrorMessage(error), now(), jobId],
      );
    }
  }

  private async runAndroidObserver(projectId: number, record: QARecord): Promise<void> {
    const runtime = await this.getPersonalizationRuntimeSettings();
    if (!runtime.observer_enabled) return;
    if (!await this.shouldRunAndroidObserver(projectId, record)) return;
    await this.executeAndroidObserverJob(projectId, record);
  }

  private async shouldUseTeacherPlanner(
    projectId: number,
    payload: QAAskPayload,
  ): Promise<boolean> {
    if (payload.parent_qa_id != null || Boolean(payload.selected_text)) return true;
    const rows = await db.query<Row>(
      "SELECT id,canonical_name,display_name FROM concepts",
    );
    const question = payload.question.toLocaleLowerCase();
    const conceptIds = rows
      .filter((row) => [row.canonical_name, row.display_name]
        .map((value) => String(value || "").toLocaleLowerCase())
        .some((name) => name.length >= 2 && question.includes(name)))
      .map((row) => String(row.id));
    if (conceptIds.length > 1) return true;
    if (!conceptIds.length) return false;
    const unresolved = await db.query<Row>(
      `SELECT 1 FROM concept_relations r
       LEFT JOIN knowledge_states_v2 s ON s.concept_id=r.target_concept_id
       WHERE r.source_concept_id IN (${conceptIds.map(() => "?").join(",")})
         AND r.relation_type='prerequisite'
         AND (s.state_json IS NULL OR s.state_json NOT LIKE '%"status":"confirmed"%')
       LIMIT 1`,
      conceptIds,
    );
    return unresolved.length > 0;
  }

  private async teacherStrategyForQuestion(
    projectId: number,
    payload: QAAskPayload,
  ): Promise<EffectiveTeachingPlan | null> {
    const runtime = await this.getPersonalizationRuntimeSettings();
    const complex = await this.shouldUseTeacherPlanner(projectId, payload);
    if (!runtime.teacher_planner_enabled || !complex) return null;
    const start = performance.now();
    try {
      const learnerContext = await this.learnerContextForQuestion(projectId, payload);
      const rawPlan = await this.callLLM([
        {
          role: "system",
          content: composeSystemPrompt(TEACHER_PLANNER_SYSTEM_PROMPT, "json"),
        },
        {
          role: "user",
          content: buildTeacherPlannerUserPrompt(
            learnerContext,
            payload.question,
            payload.selected_text || "",
            payload.source_type,
            payload.source_path || "",
          ),
        },
      ]);
      const result = effectiveTeachingPlan(parseTeachingPlan(rawPlan), payload.question);
      await this.recordModelCall(projectId, "teacher_planner", "completed", start);
      return result;
    } catch (error) {
      await this.recordModelCall(projectId, "teacher_planner", "failed", start, error).catch(() => undefined);
      return null;
    }
  }

  private async getPersonalizationProfile(projectId: number): Promise<PersonalizationProfile> {
    const concepts = await this.listPersonalizationConcepts(projectId);
    const knowledgeStates = (await this.getKnowledgeStatesV2(projectId)).states;
    const stateByConceptId = new Map(
      knowledgeStates.map((state) => [state.conceptId, state]),
    );
    const entries: PersonalizationProfile["concepts"] = [];
    for (const concept of concepts) {
      const legacyMastery = (await this.getPersonalizationMasteryBatch(projectId, [concept.id]))[concept.id];
      const state = stateByConceptId.get(concept.id);
      if (!legacyMastery && !state) continue;
      const familiarity = state?.dimensions.familiarity;
      const mastery = legacyMastery ?? {
        id: `v2:${concept.id}`,
        conceptId: concept.id,
        scope: {
          type: state!.scopeType,
          id: state!.scopeId,
        },
        knownEvidence: familiarity?.directEvidenceCount ?? 0,
        unknownEvidence: Math.max(0, (familiarity?.evidenceCount ?? 0) - (familiarity?.directEvidenceCount ?? 0)),
        mastery: familiarity?.probability ?? 0.5,
        uncertainty: familiarity?.uncertainty ?? 1,
        manualStatus: familiarity?.manualStatus ?? null,
        sequence: state!.evidenceVersion,
        lastSeenAt: familiarity?.lastEvidenceAt ?? state!.updatedAt,
        updatedAt: state!.updatedAt,
      } satisfies PersonalizationMastery;
      const manualJudgement = (familiarity?.manualStatus ?? mastery.manualStatus) === "known"
        ? "known"
        : (familiarity?.manualStatus ?? mastery.manualStatus) === "unknown"
          ? "unfamiliar"
          : null;
      const judgement = manualJudgement
        || (familiarity?.status === "confirmed"
          ? "known"
          : familiarity?.status === "learning"
            ? "unfamiliar"
            : mastery.mastery >= 0.75
              ? "known"
              : mastery.mastery <= 0.35
                ? "unfamiliar"
                : "uncertain");
      entries.push({ concept, mastery, judgement });
    }
    const preferenceRows = await db.query<Row>(
      "SELECT * FROM preference_events WHERE (scope_type='global' AND scope_id='local-user') OR (scope_type='project' AND scope_id=?) ORDER BY created_at DESC LIMIT 50",
      [String(projectId)],
    );
    const domainRows = await db.query<Row>(
      "SELECT * FROM domain_profiles WHERE scope_id='local-user' ORDER BY updated_at DESC",
    );
    const inferenceRows = await db.query<Row>(
      `SELECT i.*,c.display_name
       FROM learner_inferences i
       LEFT JOIN concepts c ON i.subject_type='concept' AND c.id=i.subject_key
       WHERE i.status='active' AND ((i.scope_type='global' AND i.scope_id='local-user')
         OR (i.scope_type='project' AND i.scope_id=?))
       ORDER BY i.updated_at DESC LIMIT 200`,
      [String(projectId)],
    );
    const relationRows = await db.query<Row>(
      "SELECT * FROM concept_relations WHERE status='active' ORDER BY updated_at DESC LIMIT 200",
    );
    const surveyRow = (await db.query<Row>(
      "SELECT * FROM survey_candidates WHERE scope_id='local-user' AND status='pending' ORDER BY created_at DESC LIMIT 1",
    ))[0];
    const callRows = await db.query<Row>(
      "SELECT * FROM model_call_audit ORDER BY created_at DESC LIMIT 50",
    );
    const evidenceRows = await db.query<Row>(
      `SELECT * FROM learning_evidence_v2
       WHERE (scope_type='global' AND scope_id='local-user')
          OR (scope_type='project' AND scope_id=?)
       ORDER BY event_time DESC LIMIT 100`,
      [String(projectId)],
    );
    const evidenceConcept = (entry: PersonalizationProfile["concepts"][number]) => ({
      conceptId: entry.concept.id,
      displayName: entry.concept.displayName,
      domain: entry.concept.domain,
    });
    return {
      preferences: await this.getLearnerPreferences(projectId),
      concepts: entries,
      preferenceEvidence: preferenceRows.map((row) => ({
        id: String(row.id),
        dimension: String(row.dimension),
        delta: Number(row.delta),
        source: String(row.source),
        evidenceText: row.evidence_text ? String(row.evidence_text) : null,
        qaRecordId: row.qa_record_id == null ? null : Number(row.qa_record_id),
          createdAt: String(row.created_at),
      })),
      domainProfiles: domainRows.map((row) => ({
        domainKey: String(row.domain_key),
        summary: String(row.summary),
        confidence: Number(row.confidence),
        confirmed: this.stringArray(row.confirmed_json),
        learning: this.stringArray(row.learning_json),
        likelyPrerequisites: this.stringArray(row.likely_prerequisites_json),
        evidence: this.jsonArray(row.evidence_json),
        updatedAt: String(row.updated_at),
      })),
      inferences: inferenceRows.map((row) => ({
        id: String(row.id),
        subjectType: String(row.subject_type) as LearnerInference["subjectType"],
        subjectKey: String(row.subject_key),
        displayName: row.display_name == null ? null : String(row.display_name),
        scopeType: String(row.scope_type) as LearnerInference["scopeType"],
        scopeId: String(row.scope_id),
        state: String(row.state) as LearnerInference["state"],
        summary: String(row.summary),
        confidence: Number(row.confidence),
        directEvidenceCount: Number(row.direct_evidence_count),
        inferredEvidenceCount: Number(row.inferred_evidence_count),
        evidence: this.jsonArray(row.evidence_json),
        updatedAt: String(row.updated_at),
      })),
      relations: relationRows.map((row) => ({
        id: String(row.id),
        sourceConceptId: String(row.source_concept_id),
        targetConceptId: String(row.target_concept_id),
        relationType: String(row.relation_type) as PersonalizationProfile["relations"][number]["relationType"],
        domain: String(row.domain),
        confidence: Number(row.confidence),
        evidence: this.jsonArray(row.evidence_json),
      })),
      surveyCandidate: surveyRow ? {
        id: String(surveyRow.id),
        question: String(surveyRow.question),
        dimension: String(surveyRow.dimension),
        options: this.jsonArray(surveyRow.options_json).map((item) => ({
          value: String(item.value || ""),
          label: String(item.label || ""),
        })).filter((item) => item.value && item.label),
        rationale: String(surveyRow.rationale || ""),
        confidence: Number(surveyRow.confidence),
        createdAt: String(surveyRow.created_at),
      } : null,
      modelCalls: callRows.map((row) => ({
        id: String(row.id),
        projectId: row.project_id == null ? null : Number(row.project_id),
        purpose: String(row.purpose),
        provider: row.provider == null ? null : String(row.provider),
        model: row.model == null ? null : String(row.model),
        status: String(row.status),
        inputTokens: row.input_tokens == null ? null : Number(row.input_tokens),
        outputTokens: row.output_tokens == null ? null : Number(row.output_tokens),
        estimatedCost: row.estimated_cost == null ? null : Number(row.estimated_cost),
        latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
        errorMessage: row.error_message == null ? null : String(row.error_message),
        createdAt: String(row.created_at),
      })),
      knowledgeStates,
      learningEvidence: evidenceRows.map((row) => {
        const evidence = this.evidenceV2FromRow(row);
        return {
          ...evidence,
          scopeType: evidence.scopeType,
          scopeId: evidence.scopeId,
        };
      }),
      evidenceSummary: {
        verified: entries.filter((entry) => entry.judgement === "known").slice(0, 20).map(evidenceConcept),
        learning: entries.filter((entry) => entry.judgement === "unfamiliar").slice(0, 20).map(evidenceConcept),
        insufficient: entries.filter((entry) => entry.judgement === "uncertain").slice(0, 20).map(evidenceConcept),
        teaching: await teachingOutcomes.evidenceSummary(projectId),
      },
    };
  }

  private async voidLearnerInference(
    projectId: number,
    inferenceId: string,
  ): Promise<{ status: string; id: string }> {
    await this.getProject(projectId);
    const row = (await db.query<Row>("SELECT id,evidence_json FROM learner_inferences WHERE id=?", [inferenceId]))[0];
    if (!row) throw new Error("学习判断不存在。");
    await db.run(
      "UPDATE learner_inferences SET status='voided',updated_at=? WHERE id=?",
      [now(), inferenceId],
    );
    const observerRuns = new Set(
      this.jsonArray(row.evidence_json)
        .map((item) => String(item.id || ""))
        .filter((id) => id.includes(":knowledge:"))
        .map((id) => id.split(":knowledge:", 1)[0]),
    );
    if (observerRuns.size) {
      const relations = await db.query<Row>("SELECT id,evidence_json FROM concept_relations");
      for (const relation of relations) {
        const evidence = this.jsonArray(relation.evidence_json);
        let changed = false;
        for (const item of evidence) {
          const id = String(item.id || "");
          const matchesRun = [...observerRuns].some((runId) => id.startsWith(`${runId}:relation:`));
          if (matchesRun && !bool(item.voided)) {
            item.voided = true;
            changed = true;
          }
        }
        if (!changed) continue;
        const active = evidence.filter((item) => !bool(item.voided));
        const confidence = active.length
          ? active.reduce((sum, item) => sum + Math.max(0, Math.min(1, Number(item.confidence || 0))), 0) / active.length
          : 0;
        await db.run(
          "UPDATE concept_relations SET confidence=?,evidence_json=?,status=?,updated_at=? WHERE id=?",
          [confidence, JSON.stringify(evidence), active.length ? "active" : "voided", now(), relation.id],
        );
      }
    }
    await this.rebuildAndroidDomainProfiles();
    return { status: "voided", id: inferenceId };
  }

  private async answerDynamicSurvey(
    projectId: number,
    surveyId: string,
    choice: string,
  ): Promise<{ status: string }> {
    const row = (await db.query<Row>(
      "SELECT * FROM survey_candidates WHERE id=? AND scope_id='local-user'",
      [surveyId],
    ))[0];
    if (!row) throw new Error("风格问题不存在。");
    if (String(row.status) !== "pending") return { status: String(row.status) };
    const options = this.jsonArray(row.options_json);
    if (!options.some((option) => String(option.value) === choice)) {
      throw new Error("无效的风格选择。");
    }
    await db.run(
      "UPDATE survey_candidates SET status='answered',answer=?,answered_at=? WHERE id=?",
      [choice, now(), surveyId],
    );
    await this.applyAnswerPreferenceFeedback(projectId, {
      dimension: String(row.dimension),
      choice,
      source: "survey",
      idempotency_key: `dynamic-survey:${surveyId}`,
      scope: "global",
    });
    return { status: "answered" };
  }

  private async dismissDynamicSurvey(surveyId: string): Promise<{ status: string }> {
    await db.run(
      `UPDATE survey_candidates SET status='dismissed',dismissed_at=?
       WHERE id=? AND scope_id='local-user' AND status='pending'`,
      [now(), surveyId],
    );
    return { status: "dismissed" };
  }

  private async registerConceptExplanation(
    conceptId: string,
    projectId: number,
    qaRecordId: number,
    title: string,
  ): Promise<void> {
    const stamp = now();
    await db.run(
      `INSERT INTO concept_explanations
       (id,concept_id,project_id,qa_record_id,title,status,created_at,updated_at)
       VALUES(?,?,?,?,?,'active',?,?)
       ON CONFLICT(concept_id,qa_record_id) DO UPDATE SET
         title=excluded.title,status='active',updated_at=excluded.updated_at`,
      [crypto.randomUUID(), conceptId, projectId, qaRecordId, title.slice(0, 200), stamp, stamp],
    );
  }

  private async getReusableConceptExplanation(
    conceptId: string,
  ): Promise<{ explanation: { projectId: number; qa: QARecord } | null }> {
    const row = (await db.query<Row>(
      `SELECT e.project_id,e.qa_record_id
       FROM concept_explanations e
       JOIN qa_records q ON q.id=e.qa_record_id AND q.project_id=e.project_id
       JOIN projects p ON p.id=e.project_id
       WHERE e.concept_id=? AND e.status='active'
       ORDER BY e.updated_at DESC LIMIT 1`,
      [conceptId],
    ))[0];
    if (!row) return { explanation: null };
    const sourceProjectId = Number(row.project_id);
    return {
      explanation: {
        projectId: sourceProjectId,
        qa: await this.getQA(sourceProjectId, Number(row.qa_record_id)),
      },
    };
  }

  async resetPersonalizationProfile(projectId: number, scope: "project" | "global" | "all" = "project"): Promise<{ status: string; deletedMasteryCount: number; deletedEventCount: number }> {
    await db.init();

    if (scope === "all") {
      return db.transaction(async () => {
        const events = await db.queryInTx<Row>("SELECT COUNT(*) as c FROM learning_events");
        const mastery = await db.queryInTx<Row>("SELECT COUNT(*) as c FROM concept_mastery");
        await db.runInTx("DELETE FROM learning_events");
        await db.runInTx("DELETE FROM concept_mastery");
        await db.runInTx("DELETE FROM preference_events");
        await db.runInTx("DELETE FROM learner_preferences");
        await db.runInTx("DELETE FROM term_impressions");
        await db.runInTx("DELETE FROM concept_relations");
        await db.runInTx("DELETE FROM learner_inferences");
        await db.runInTx("DELETE FROM domain_profiles");
        await db.runInTx("DELETE FROM survey_candidates");
        await db.runInTx("DELETE FROM model_call_audit");
        await db.runInTx("DELETE FROM term_model_scans");
        await db.runInTx("DELETE FROM learning_evidence_v2");
        await db.runInTx("DELETE FROM knowledge_states_v2");
        await db.runInTx("DELETE FROM diagnostic_attempts");
        await db.runInTx("DELETE FROM diagnostic_items");
        await db.runInTx("DELETE FROM observer_jobs");
        await db.runInTx("DELETE FROM teaching_outcomes");
        await db.runInTx("DELETE FROM teaching_trials");
        return {
          status: "ok",
          deletedMasteryCount: Number(mastery[0]?.c ?? 0),
          deletedEventCount: Number(events[0]?.c ?? 0),
        };
      });
    }

    const { type: st, id: si } = scope === "global"
      ? { type: "global" as const, id: "local-user" }
      : this.scope(projectId);
    return db.transaction(async () => {
      const events = await db.queryInTx<Row>("SELECT COUNT(*) as c FROM learning_events WHERE scope_type=? AND scope_id=?", [st, si]);
      const eventCount = Number(events[0]?.c ?? 0);
      const mastery = await db.queryInTx<Row>("SELECT COUNT(*) as c FROM concept_mastery WHERE scope_type=? AND scope_id=?", [st, si]);
      const masteryCount = Number(mastery[0]?.c ?? 0);
      await db.runInTx("DELETE FROM learning_events WHERE scope_type=? AND scope_id=?", [st, si]);
      await db.runInTx("DELETE FROM concept_mastery WHERE scope_type=? AND scope_id=?", [st, si]);
      await db.runInTx("DELETE FROM preference_events WHERE scope_type=? AND scope_id=?", [st, si]);
      await db.runInTx("DELETE FROM learner_preferences WHERE scope_type=? AND scope_id=?", [st, si]);
      await db.runInTx("DELETE FROM learning_evidence_v2 WHERE scope_type=? AND scope_id=?", [st, si]);
      await db.runInTx("DELETE FROM knowledge_states_v2 WHERE scope_type=? AND scope_id=?", [st, si]);
      if (scope === "project") {
        await db.runInTx("DELETE FROM term_impressions WHERE project_id=?", [projectId]);
        await db.runInTx("DELETE FROM learner_inferences WHERE scope_type='project' AND scope_id=?", [String(projectId)]);
        await db.runInTx("DELETE FROM model_call_audit WHERE project_id=?", [projectId]);
        await db.runInTx("DELETE FROM term_model_scans WHERE project_id=?", [projectId]);
        await db.runInTx("DELETE FROM diagnostic_attempts WHERE project_id=?", [projectId]);
        await db.runInTx("DELETE FROM diagnostic_items WHERE project_id=?", [projectId]);
        await db.runInTx("DELETE FROM observer_jobs WHERE project_id=?", [projectId]);
        await db.runInTx("DELETE FROM teaching_outcomes WHERE project_id=?", [projectId]);
        await db.runInTx("DELETE FROM teaching_trials WHERE project_id=?", [projectId]);
      } else {
        await db.runInTx("DELETE FROM learner_inferences WHERE scope_type='global' AND scope_id='local-user'");
        await db.runInTx("DELETE FROM domain_profiles WHERE scope_id='local-user'");
        await db.runInTx("DELETE FROM survey_candidates WHERE scope_id='local-user'");
      }
      return { status: "ok", deletedMasteryCount: masteryCount, deletedEventCount: eventCount };
    });
  }
}
