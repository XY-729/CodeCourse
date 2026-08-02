import { httpApiUrl, providerRequest } from "../platform/provider";
import { isAndroidRuntime } from "../platform/runtime";
import type { TermPersonalizationProfile } from "../personalization/termDisplayTypes";

export type Project = {
  id: number;
  name: string;
  url: string;
  local_path: string;
  status: string;
  project_type: "repository" | "learning_plan";
  course_files: string[];
  created_at?: string;
  updated_at?: string;
};

export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children: TreeNode[];
  is_key_file: boolean;
};

export type CourseFile = {
  filename: string;
  title: string;
  group: string;
};

export type FileContent = {
  path: string;
  language: string;
  content: string;
};

export type SourceType = "file" | "course" | "selection" | "qa";

export type RetrievalSource = {
  path: string;
  start_line: number;
  end_line: number;
  symbol_name?: string | null;
  qualified_name?: string | null;
  relation?: string | null;
  evidence_type: string;
  provider: string;
  content: string;
  score: number;
};

export type QARecord = {
  id: number;
  project_id: number;
  session_id?: number | null;
  parent_qa_id?: number | null;
  relation_type: "follow_up" | "term_explanation" | "alternate" | string;
  source_type: SourceType;
  source_path?: string | null;
  display_title?: string | null;
  selected_text: string;
  question: string;
  answer_md: string;
  provider: string;
  model: string;
  output_path?: string | null;
  retrieval_trace?: string | null;
  retrieval_sources?: RetrievalSource[];
  favorite: boolean;
  created_at: string;
  updated_at: string;
};

export type HighlightRecord = {
  id: number;
  project_id: number;
  source_type: "course" | "qa";
  source_path: string;
  selected_text: string;
  color: string;
  note?: string | null;
  created_at: string;
  updated_at: string;
};

export type KnowledgeNode = {
  id: number;
  project_id: number;
  node_type: "term" | "qa" | "course" | "file" | "manual" | string;
  title: string;
  ref_type?: string | null;
  ref_id?: number | null;
  ref_path?: string | null;
  summary?: string | null;
  x?: number | null;
  y?: number | null;
  created_at: string;
  updated_at: string;
};

export type KnowledgeEdge = {
  id: number;
  project_id: number;
  source_node_id: number;
  target_node_id: number;
  relation_type: "explains" | "parent_of" | "related_to" | "references" | string;
  label?: string | null;
  created_at: string;
  updated_at: string;
};

export type KnowledgeGraph = {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
};

export type KnowledgeLink = {
  id: number;
  project_id: number;
  source_type: string;
  source_path: string;
  term_text: string;
  qa_record_id: number;
  node_id: number;
  created_at: string;
  updated_at: string;
};

export type QAAskPayload = {
  source_type: SourceType;
  source_path?: string | null;
  selected_text: string;
  question: string;
  provider: string;
  base_url: string;
  model: string;
  session_id?: number | null;
  parent_qa_id?: number | null;
  relation_type?: "follow_up" | "term_explanation" | "alternate";
  term_candidate_id?: number | null;
  selection_range?: {
    start_line: number;
    start_column: number;
    end_line: number;
    end_column: number;
  } | null;
};

export type QAStreamStage = "queued" | "retrieving" | "waiting_model" | "answering" | "saving";

export type QAStreamHandlers = {
  onStage?: (stage: QAStreamStage, label: string) => void;
  onDelta?: (text: string) => void;
};

export type TermLinkOrigin = "manual" | "automatic" | "legacy_unknown";

export type DocumentTerm = {
  id: number;
  project_id: number;
  source_type: "course" | "qa";
  source_path: string;
  term_text: string;
  detection_source: "model" | "index" | "rule" | string;
  confidence: number;
  status: "candidate" | "linked" | "known" | "dismissed" | string;
  link_origin?: TermLinkOrigin | string;
  qa_record_id?: number | null;
  concept_id?: string | null;
  content_hash?: string | null;
  canonical_name?: string | null;
  category?: string | null;
  source_span?: {
    text: string;
    start?: number;
    end?: number;
  } | null;
  created_at: string;
  updated_at: string;
};

export type LearningAnchor = {
  id: number;
  project_id: number;
  qa_record_id: number;
  term_text?: string | null;
  summary: string;
  created_at: string;
  updated_at: string;
};

export type ProjectIndexStatus = {
  project_id: number;
  status: string;
  chunk_count: number;
  updated_at?: string | null;
  error_message?: string | null;
  text_status?: string;
  structural_status?: string;
  node_count?: number;
  edge_count?: number;
  engine?: string | null;
  degraded_reason?: string | null;
  indexed_fingerprint?: string | null;
  stage?: string | null;
  progress_current?: number;
  progress_total?: number;
  processed_files?: number;
  unchanged_files?: number;
  added_files?: number;
  updated_files?: number;
  deleted_files?: number;
  skipped_files?: number;
  failed_files?: number;
  active_generation?: number;
  building_generation?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  duration_ms?: number | null;
  last_good_index_at?: string | null;
};

export type LearningState = {
  id: number;
  project_id: number;
  source_type: "course" | "file" | "qa";
  source_path: string;
  status: "in_progress" | "completed";
  position_kind: "scroll_ratio" | "line";
  position_value: number;
  last_opened_at: string;
  completed_at?: string | null;
  updated_at: string;
};

export type LearningStateUpdate = {
  source_type: LearningState["source_type"];
  source_path: string;
  status: LearningState["status"];
  position_kind: LearningState["position_kind"];
  position_value: number;
};

export type ProjectSearchResult = {
  path: string;
  language: string;
  start_line: number;
  end_line: number;
  chunk_type: string;
  symbol_name?: string | null;
  qualified_name?: string | null;
  relation?: string | null;
  provider?: string;
  content: string;
  score: number;
};

export type ProjectActionResponse = {
  id: number;
  status: string;
  message: string;
  course_files: string[];
};

export type LLMSettings = {
  provider: string;
  base_url: string;
  model: string;
  enabled: boolean;
  has_api_key: boolean;
  masked_api_key: string | null;
};

export type SaveLLMSettingsPayload = {
  provider: string;
  base_url: string;
  model: string;
  enabled: boolean;
  api_key?: string;
  clear_api_key?: boolean;
};

export type LLMTestResponse = {
  ok: boolean;
  provider: string;
  message: string;
};

export type PersonalizationRuntimeSettings = {
  supported: boolean;
  teacher_planner_enabled: boolean;
  observer_enabled: boolean;
  teacher_planner_mode: "assist";
  observer_mode: "shadow";
};

export type SavePersonalizationRuntimeSettingsPayload = Partial<Pick<
  PersonalizationRuntimeSettings,
  "teacher_planner_enabled" | "observer_enabled"
>>;

export type LearningScope = {
  type: "full_project" | "files" | "learning_plan";
  paths: string[];
};

export type OutlineQuestion = {
  question: string;
  question_type: string;
  dimension: string;
  options: Array<{ value: string; label: string }>;
  rationale?: string;
};

export type OutlinePreflight = {
  preflight_id: string;
  questions: OutlineQuestion[];
  status?: "pending" | "error";
  message?: string | null;
};

export type OutlineSurveyAnswer = {
  question: string;
  question_type: string;
  dimension: string;
  selected: string | string[];
  _key: string;
};

export type LessonEvidencePreview = {
  file_count: number;
  snippet_count: number;
  included: string[];
  truncated: string[];
  read_failed: string[];
  budget_skipped: string[];
  ready: boolean;
};

export type GenerateOutlineRequestPayload = {
  scope: LearningScope;
  instructions: string;
  survey_answers: OutlineSurveyAnswer[];
};

export type GenerationTask = {
  id: number;
  project_id: number;
  task_type: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  source_path?: string | null;
  mode?: string | null;
  model?: string | null;
  prompt_version: string;
  input_hash: string;
  output_path?: string | null;
  error_message?: string | null;
  progress_current: number;
  progress_total: number;
  stage_label?: string | null;
  created_at: string;
  updated_at: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return providerRequest<T>(path, init);
}

export function listProjects(): Promise<Project[]> {
  return request<Project[]>("/projects");
}

export function importProject(url: string): Promise<Project> {
  return request<Project>("/projects/import", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export function importLocalProject(path: string): Promise<Project> {
  return request<Project>("/projects/import-local", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function createLearningPlan(name: string): Promise<Project> {
  return request<Project>("/projects/learning-plan", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function getProject(projectId: number): Promise<Project> {
  return request<Project>(`/projects/${projectId}`);
}

export function regenerateProject(projectId: number): Promise<ProjectActionResponse> {
  return request<ProjectActionResponse>(`/projects/${projectId}/regenerate`, {
    method: "POST",
  });
}

export function deleteProject(projectId: number): Promise<ProjectActionResponse> {
  return request<ProjectActionResponse>(`/projects/${projectId}`, {
    method: "DELETE",
  });
}

export function getLLMSettings(): Promise<LLMSettings> {
  return request<LLMSettings>("/settings/llm");
}

export function saveLLMSettings(payload: SaveLLMSettingsPayload): Promise<LLMSettings> {
  return request<LLMSettings>("/settings/llm", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function testLLMSettings(): Promise<LLMTestResponse> {
  return request<LLMTestResponse>("/settings/llm/test", {
    method: "POST",
  });
}

export function getPersonalizationRuntimeSettings(): Promise<PersonalizationRuntimeSettings> {
  return request<PersonalizationRuntimeSettings>("/settings/personalization");
}

export function savePersonalizationRuntimeSettings(
  payload: SavePersonalizationRuntimeSettingsPayload,
): Promise<PersonalizationRuntimeSettings> {
  return request<PersonalizationRuntimeSettings>("/settings/personalization", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getTree(projectId: number): Promise<TreeNode> {
  return request<TreeNode>(`/projects/${projectId}/tree`);
}

export function getProjectFile(projectId: number, path: string): Promise<FileContent> {
  return request<FileContent>(`/projects/${projectId}/file?path=${encodeURIComponent(path)}`);
}

export function getCourseFiles(projectId: number): Promise<CourseFile[]> {
  return request<CourseFile[]>(`/projects/${projectId}/course`);
}

export function createEmptyCourseFile(projectId: number, title: string): Promise<CourseFile> {
  return request<CourseFile>(`/projects/${projectId}/course/empty`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function getCourseContent(projectId: number, filename: string): Promise<{ filename: string; content: string }> {
  return request<{ filename: string; content: string }>(`/projects/${projectId}/course/${filename.split("/").map(encodeURIComponent).join("/")}`);
}

export function deleteCourseFile(projectId: number, filename: string): Promise<{ deleted: boolean; filename: string }> {
  return request<{ deleted: boolean; filename: string }>(
    `/projects/${projectId}/course/${filename.split("/").map(encodeURIComponent).join("/")}`,
    { method: "DELETE" },
  );
}

export function generateOutline(
  projectId: number,
  scope: LearningScope,
  instructions: string,
  surveyAnswers: OutlineSurveyAnswer[] = [],
): Promise<GenerationTask> {
  return request<GenerationTask>(`/projects/${projectId}/outline/generate`, {
    method: "POST",
    body: JSON.stringify({ scope, instructions, survey_answers: surveyAnswers }),
  });
}

export function generateOutlinePreflight(
  projectId: number,
  scope: LearningScope,
  instructions: string,
): Promise<OutlinePreflight> {
  return request<OutlinePreflight>(`/projects/${projectId}/outline/generate/preflight`, {
    method: "POST",
    body: JSON.stringify({ scope, instructions }),
  });
}

export function confirmOutlineAnswers(
  projectId: number,
  payload: {
    preflight_id: string;
    answers: OutlineSurveyAnswer[];
    scope: LearningScope;
    instructions: string;
  },
): Promise<GenerationTask> {
  return request<GenerationTask>(`/projects/${projectId}/outline/generate/confirm`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function generateFileLesson(projectId: number, path: string, mode: "brief" | "detailed", instructions: string): Promise<GenerationTask> {
  return request<GenerationTask>(`/projects/${projectId}/lessons/file`, {
    method: "POST",
    body: JSON.stringify({ path, mode, instructions }),
  });
}

export function generateOutlineLesson(projectId: number, lessonNumber: number, title: string, instructions: string): Promise<GenerationTask> {
  return request<GenerationTask>(`/projects/${projectId}/lessons/outline`, {
    method: "POST",
    body: JSON.stringify({ lesson_number: lessonNumber, title, instructions }),
  });
}

export function previewOutlineLessonEvidence(
  projectId: number,
  lessonNumber: number,
  title: string,
): Promise<LessonEvidencePreview> {
  return request<LessonEvidencePreview>(`/projects/${projectId}/lessons/outline/evidence`, {
    method: "POST",
    body: JSON.stringify({ lesson_number: lessonNumber, title, instructions: "" }),
  });
}

// ---------------------------------------------------------------------------
// Streaming generation
// ---------------------------------------------------------------------------

export type GenStreamHandlers = {
  onTaskCreated?: (payload: { filename: string; task_id: number }) => void;
  onDelta?: (text: string) => void;
  onStage?: (stage: string, label: string) => void;
  onFileCreated?: (payload: { filename: string }) => void;
  onCompleted?: (payload: { filename: string; task_id: number; cached?: boolean }) => void;
  onError?: (message: string) => void;
};

async function consumeGenStream(
  response: Response,
  handlers: GenStreamHandlers,
): Promise<string | null> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(body.detail || response.statusText || "生成请求失败");
  }
  if (!response.body) throw new Error("当前运行环境不支持流式生成");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastFilename: string | null = null;

  function consumeBlock(block: string) {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const data = JSON.parse(dataLines.join("\n"));
    switch (eventName) {
      case "task_created":
        lastFilename = data.filename as string;
        handlers.onTaskCreated?.({ filename: data.filename as string, task_id: data.task_id as number });
        break;
      case "file_created":
        handlers.onFileCreated?.({ filename: data.filename as string });
        break;
      case "stage":
        handlers.onStage?.(data.stage as string, data.label as string);
        break;
      case "delta":
        handlers.onDelta?.(data.text as string);
        break;
      case "completed":
        handlers.onCompleted?.({ filename: data.filename as string, task_id: data.task_id as number, cached: data.cached as boolean | undefined });
        break;
      case "error":
        throw new Error(data.message as string || "生成失败");
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) consumeBlock(block);
    if (done) break;
  }
  if (buffer.trim()) consumeBlock(buffer);
  return lastFilename;
}

export async function generateOutlineStream(
  projectId: number,
  scope: LearningScope,
  instructions: string,
  handlers: GenStreamHandlers = {},
  signal?: AbortSignal,
): Promise<string | null> {
  const response = await fetch(httpApiUrl(`/projects/${projectId}/outline/generate/stream`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ scope, instructions }),
    signal,
  });
  return consumeGenStream(response, handlers);
}

export async function generateFileLessonStream(
  projectId: number,
  path: string,
  mode: "brief" | "detailed",
  instructions: string,
  handlers: GenStreamHandlers = {},
  signal?: AbortSignal,
): Promise<string | null> {
  const response = await fetch(httpApiUrl(`/projects/${projectId}/lessons/file/stream`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ path, mode, instructions }),
    signal,
  });
  return consumeGenStream(response, handlers);
}

export async function generateOutlineLessonStream(
  projectId: number,
  lessonNumber: number,
  title: string,
  instructions: string,
  handlers: GenStreamHandlers = {},
  signal?: AbortSignal,
): Promise<string | null> {
  const response = await fetch(httpApiUrl(`/projects/${projectId}/lessons/outline/stream`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ lesson_number: lessonNumber, title, instructions }),
    signal,
  });
  return consumeGenStream(response, handlers);
}

export function importProjectArchive(file: File): Promise<Project> {
  return request<Project>(`/projects/import-archive?filename=${encodeURIComponent(file.name)}`, {
    method: "POST",
    body: file,
  });
}

export function listGenerationTasks(projectId: number): Promise<GenerationTask[]> {
  return request<GenerationTask[]>(`/projects/${projectId}/tasks`);
}

export function getGenerationTask(projectId: number, taskId: number): Promise<GenerationTask> {
  return request<GenerationTask>(`/projects/${projectId}/tasks/${taskId}`);
}

export function retryGenerationTask(projectId: number, taskId: number): Promise<GenerationTask> {
  return request<GenerationTask>(`/projects/${projectId}/tasks/${taskId}/retry`, {
    method: "POST",
  });
}

export function buildProjectIndex(projectId: number): Promise<ProjectIndexStatus> {
  return request<ProjectIndexStatus>(`/projects/${projectId}/index/build`, {
    method: "POST",
  });
}

export function getProjectIndexStatus(projectId: number): Promise<ProjectIndexStatus> {
  return request<ProjectIndexStatus>(`/projects/${projectId}/index/status`);
}

export function getLearningStates(projectId: number): Promise<LearningState[]> {
  return request<LearningState[]>(`/projects/${projectId}/learning-state`);
}

export function updateLearningState(projectId: number, payload: LearningStateUpdate): Promise<LearningState> {
  return request<LearningState>(`/projects/${projectId}/learning-state`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function resetLearningStates(projectId: number): Promise<{ deleted: number }> {
  return request<{ deleted: number }>(`/projects/${projectId}/learning-state`, { method: "DELETE" });
}

export function searchProject(projectId: number, query: string, sourcePath?: string | null, limit = 8): Promise<ProjectSearchResult[]> {
  return request<ProjectSearchResult[]>(`/projects/${projectId}/search`, {
    method: "POST",
    body: JSON.stringify({ query, source_path: sourcePath ?? null, limit }),
  });
}

export function askQuestion(projectId: number, payload: QAAskPayload): Promise<QARecord> {
  return request<QARecord>(`/projects/${projectId}/qa/ask`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listQARecords(projectId: number, query = "", favorite?: boolean): Promise<QARecord[]> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("query", query.trim());
  }
  if (favorite !== undefined) {
    params.set("favorite", String(favorite));
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<QARecord[]>(`/projects/${projectId}/qa${suffix}`);
}

export function getQARecord(projectId: number, qaId: number): Promise<QARecord> {
  return request<QARecord>(`/projects/${projectId}/qa/${qaId}`);
}

export async function askQuestionStream(
  projectId: number,
  payload: QAAskPayload,
  handlers: QAStreamHandlers = {},
  signal?: AbortSignal,
): Promise<QARecord> {
  if (isAndroidRuntime()) {
    handlers.onStage?.("waiting_model", "等待模型");
    const record = await askQuestion(projectId, payload);
    handlers.onDelta?.(record.answer_md);
    return record;
  }

  const response = await fetch(httpApiUrl(`/projects/${projectId}/qa/stream`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(body.detail || response.statusText || "流式问答请求失败");
  }
  if (!response.body) throw new Error("当前运行环境不支持流式回答");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: QARecord | null = null;

  function consumeBlock(block: string) {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const data = JSON.parse(dataLines.join("\n"));
    if (eventName === "stage") handlers.onStage?.(data.stage as QAStreamStage, String(data.label || ""));
    else if (eventName === "delta") handlers.onDelta?.(String(data.text || ""));
    else if (eventName === "completed") completed = data as QARecord;
    else if (eventName === "error") throw new Error(String(data.message || "生成回答失败"));
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) consumeBlock(block);
    if (done) break;
  }
  if (buffer.trim()) consumeBlock(buffer);
  if (!completed) throw new Error("模型回答已结束，但未收到保存结果");
  return completed;
}

export function getQASessionTree(projectId: number, sessionId: number): Promise<QARecord[]> {
  return request<QARecord[]>(`/projects/${projectId}/qa/sessions/${sessionId}/tree`);
}

export function getLearningAnchor(projectId: number, qaId: number): Promise<LearningAnchor> {
  return request<LearningAnchor>(`/projects/${projectId}/qa/${qaId}/understanding`);
}

export function saveLearningAnchor(
  projectId: number,
  qaId: number,
  summary: string,
  termText?: string | null,
): Promise<LearningAnchor> {
  return request<LearningAnchor>(`/projects/${projectId}/qa/${qaId}/understanding`, {
    method: "POST",
    body: JSON.stringify({ summary, term_text: termText ?? null }),
  });
}

export function deleteLearningAnchor(projectId: number, qaId: number): Promise<{ deleted: boolean; qa_id: number }> {
  return request<{ deleted: boolean; qa_id: number }>(`/projects/${projectId}/qa/${qaId}/understanding`, {
    method: "DELETE",
  });
}

export function listDocumentTerms(projectId: number, sourceType: "course" | "qa", sourcePath: string): Promise<DocumentTerm[]> {
  const params = new URLSearchParams({ source_type: sourceType, source_path: sourcePath });
  return request<DocumentTerm[]>(`/projects/${projectId}/terms?${params.toString()}`);
}

export function markDocumentTermKnown(projectId: number, termId: number): Promise<DocumentTerm> {
  return request<DocumentTerm>(`/projects/${projectId}/terms/${termId}/known`, { method: "POST" });
}

export function dismissDocumentTerm(projectId: number, termId: number): Promise<DocumentTerm> {
  return request<DocumentTerm>(`/projects/${projectId}/terms/${termId}/dismiss`, { method: "POST" });
}

export function updateQARecord(
  projectId: number,
  qaId: number,
  payload: { question?: string; answer_md?: string; display_title?: string },
): Promise<QARecord> {
  return request<QARecord>(`/projects/${projectId}/qa/${qaId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function setQAFavorite(projectId: number, qaId: number, favorite: boolean): Promise<QARecord> {
  return request<QARecord>(`/projects/${projectId}/qa/${qaId}/favorite`, {
    method: "POST",
    body: JSON.stringify({ favorite }),
  });
}

export function deleteQARecord(projectId: number, qaId: number): Promise<{ deleted: boolean; id: number }> {
  return request<{ deleted: boolean; id: number }>(`/projects/${projectId}/qa/${qaId}`, {
    method: "DELETE",
  });
}

export function listHighlights(projectId: number, sourceType?: "course" | "qa", sourcePath?: string): Promise<HighlightRecord[]> {
  const params = new URLSearchParams();
  if (sourceType) {
    params.set("source_type", sourceType);
  }
  if (sourcePath) {
    params.set("source_path", sourcePath);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<HighlightRecord[]>(`/projects/${projectId}/highlights${suffix}`);
}

export function createHighlight(
  projectId: number,
  payload: { source_type: "course" | "qa"; source_path: string; selected_text: string; color?: string; note?: string | null },
): Promise<HighlightRecord> {
  return request<HighlightRecord>(`/projects/${projectId}/highlights`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getPrompts(): Promise<Record<string, string>> {
  return request<Record<string, string>>(`/settings/prompts`);
}

export type PromptTemplateMetadata = {
  key: string;
  label: string;
  description: string;
  required_placeholders: string[];
  default: string;
  current: string;
  is_default: boolean;
  schema_version: number;
  stored_schema_version: number;
  upgrade_status:
    | "default"
    | "current"
    | "current_custom"
    | "migrated"
    | "migrated_with_custom_directives"
    | "outdated_custom"
    | string;
};

export type PromptRevision = {
  id: number;
  prompt_key: string;
  value: string;
  source: string;
  created_at: string;
};

export function getPromptMetadata(): Promise<{ prompts: PromptTemplateMetadata[] }> {
  return request<{ prompts: PromptTemplateMetadata[] }>(`/settings/prompts/metadata`);
}

export function getPromptHistory(key: string): Promise<{ key: string; revisions: PromptRevision[] }> {
  return request<{ key: string; revisions: PromptRevision[] }>(
    `/settings/prompts/history?key=${encodeURIComponent(key)}`,
  );
}

export function previewPrompt(
  key: string,
  value: string,
): Promise<PromptPreview> {
  return request<PromptPreview>(`/settings/prompts/preview`, {
    method: "POST",
    body: JSON.stringify({ key, value }),
  });
}

export type PromptPreview = {
  key: string;
  rendered: string;
  template_rendered: string;
  messages: Array<{ role: "system" | "user" | "assistant" | string; content: string }>;
  notes: string[];
};

export function resetPrompt(key: string): Promise<{ key: string; value: string }> {
  return request<{ key: string; value: string }>(`/settings/prompts/reset`, {
    method: "POST",
    body: JSON.stringify({ key }),
  });
}

export function savePrompts(payload: Record<string, string>): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/settings/prompts`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteHighlight(projectId: number, highlightId: number): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/projects/${projectId}/highlights/${highlightId}`, {
    method: "DELETE",
  });
}

export function getKnowledgeGraph(projectId: number): Promise<KnowledgeGraph> {
  return request<KnowledgeGraph>(`/projects/${projectId}/knowledge/graph`);
}

export function createKnowledgeNode(
  projectId: number,
  payload: {
    node_type?: "term" | "qa" | "course" | "file" | "manual";
    title: string;
    ref_type?: string | null;
    ref_id?: number | null;
    ref_path?: string | null;
    summary?: string | null;
    x?: number | null;
    y?: number | null;
  },
): Promise<KnowledgeNode> {
  return request<KnowledgeNode>(`/projects/${projectId}/knowledge/nodes`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateKnowledgeNode(
  projectId: number,
  nodeId: number,
  payload: { title?: string; summary?: string | null; x?: number | null; y?: number | null },
): Promise<KnowledgeNode> {
  return request<KnowledgeNode>(`/projects/${projectId}/knowledge/nodes/${nodeId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteKnowledgeNode(projectId: number, nodeId: number): Promise<{ deleted: boolean; id: number }> {
  return request<{ deleted: boolean; id: number }>(`/projects/${projectId}/knowledge/nodes/${nodeId}`, {
    method: "DELETE",
  });
}

export function createKnowledgeEdge(
  projectId: number,
  payload: { source_node_id: number; target_node_id: number; relation_type: "explains" | "parent_of" | "related_to" | "references"; label?: string | null },
): Promise<KnowledgeEdge> {
  return request<KnowledgeEdge>(`/projects/${projectId}/knowledge/edges`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateKnowledgeEdge(
  projectId: number,
  edgeId: number,
  payload: { relation_type?: "explains" | "parent_of" | "related_to" | "references"; label?: string | null },
): Promise<KnowledgeEdge> {
  return request<KnowledgeEdge>(`/projects/${projectId}/knowledge/edges/${edgeId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteKnowledgeEdge(projectId: number, edgeId: number): Promise<{ deleted: boolean; id: number }> {
  return request<{ deleted: boolean; id: number }>(`/projects/${projectId}/knowledge/edges/${edgeId}`, {
    method: "DELETE",
  });
}

export function listKnowledgeLinks(projectId: number, sourceType?: string, sourcePath?: string): Promise<KnowledgeLink[]> {
  const params = new URLSearchParams();
  if (sourceType) {
    params.set("source_type", sourceType);
  }
  if (sourcePath) {
    params.set("source_path", sourcePath);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<KnowledgeLink[]>(`/projects/${projectId}/knowledge/links${suffix}`);
}

// ---- Personalization Types ----

export type PersonalizationConcept = {
  id: string;
  conceptKey: string;
  canonicalName: string;
  displayName: string;
  domain: string;
  conceptType: "language_feature" | "framework_api" | "pattern" | "tool" | "theory" | "project_symbol" | string;
  aliases: string[];
  difficulty: number;
  createdAt: string;
};

export type PersonalizationScope = {
  type: "global" | "project" | "session";
  id: string;
};

export type PersonalizationMastery = {
  id: string;
  conceptId: string;
  scope: PersonalizationScope;
  knownEvidence: number;
  unknownEvidence: number;
  mastery: number;
  uncertainty: number;
  manualStatus: "known" | "unknown" | null;
  sequence: number;
  lastSeenAt: string;
  updatedAt: string;
};

export type PersonalizationEvent = {
  eventId: string;
  idempotencyKey: string;
  schemaVersion: number;
  conceptId: string;
  scope: PersonalizationScope;
  eventType: string;
  direction: "known" | "unknown" | "neutral";
  strength: number;
  source: "explicit_user" | "system_inference" | "model_inference" | string;
  targetEventId?: string;
  evidenceText?: string;
  sessionId?: string;
  qaRecordId?: number;
  isVoided: boolean;
  createdAt: string;
};

export type PersonalizationMarkResult = {
  event: PersonalizationEvent;
  mastery: PersonalizationMastery;
  idempotent: boolean;
};

export type LearnerPreferences = {
  scope: PersonalizationScope;
  answerDepth: number;
  codeRatio: number;
  explanationOrder: "balanced" | "example_first" | "principle_first" | "code_first";
  prerequisiteDetail: number;
  terminologyDensity: number;
  feedbackCount: number;
  surveyEnabled: boolean;
  lastSurveyAt?: string | null;
  surveyDue: boolean;
  updatedAt: string;
};

export type PersonalizationProfile = {
  preferences: LearnerPreferences;
  concepts: Array<{
    concept: PersonalizationConcept;
    mastery: PersonalizationMastery;
    judgement: "known" | "unfamiliar" | "uncertain";
  }>;
  preferenceEvidence: Array<{
    id: string;
    dimension: string;
    delta: number;
    source: string;
    evidenceText?: string | null;
    qaRecordId?: number | null;
    createdAt: string;
  }>;
  domainProfiles: DomainProfile[];
  inferences: LearnerInference[];
  relations: ConceptRelation[];
  surveyCandidate?: DynamicSurveyCandidate | null;
  modelCalls: ModelCallAudit[];
  knowledgeStates?: KnowledgeStateV2[];
  learningEvidence?: LearningEvidenceV2[];
  evidenceSummary?: {
    verified: EvidenceSummaryConcept[];
    learning: EvidenceSummaryConcept[];
    insufficient: EvidenceSummaryConcept[];
    teaching: TeachingEvidenceSummary;
  };
};

export type EvidenceSummaryConcept = {
  conceptId: string;
  displayName: string;
  domain: string;
};

export type TeachingStrategyEvidence = {
  strategy: string;
  successful: number;
  partiallySuccessful: number;
  unsuccessful: number;
  evidenceCount: number;
};

export type TeachingEvidenceSummary = {
  verifiedTrialCount: number;
  awaitingEvidenceCount: number;
  effectiveStrategies: TeachingStrategyEvidence[];
  recentTrials: Array<{
    id: string;
    qaRecordId: number;
    teachingGoal: string;
    strategies: string[];
    result?: string | null;
    evidenceType?: string | null;
    policyEligible: boolean;
    createdAt: string;
  }>;
  policyVersion: string;
};

export type TeachingTrial = {
  id: string;
  qaRecordId: number;
  mode: string;
  teachingGoal: string;
  strategies: string[];
  assumedKnown: string[];
  explainBriefly: string[];
  explainInDetail: string[];
  targetConceptIds: string[];
  targetDimensions: KnowledgeDimension[];
  strategyRationale: string;
  policyVersion: string;
  preState: KnowledgeStateV2[] | Record<string, unknown>;
  outcomes: Array<{
    id: string;
    result: string;
    confidence: number;
    reason: string;
    evidenceQuote: string;
    evidenceType: string;
    authority: number;
    policyEligible: boolean;
    createdAt: string;
  }>;
  createdAt: string;
};

export type LearningEvidenceV2 = {
  id: string;
  conceptId: string;
  scopeType: "global" | "project";
  scopeId: string;
  dimension: KnowledgeDimension;
  direction: "positive" | "negative" | "neutral";
  strength: number;
  reliability: number;
  source: string;
  action: string;
  object: Record<string, unknown>;
  result: Record<string, unknown>;
  context: Record<string, unknown>;
  eventTime: string;
  sessionId?: string | null;
  qaRecordId?: number | null;
  targetEvidenceId?: string | null;
  voided: boolean;
};

export type KnowledgeDimension =
  | "familiarity"
  | "conceptual"
  | "code_reading"
  | "implementation"
  | "debugging"
  | "transfer";

export type KnowledgeDimensionState = {
  probability: number;
  uncertainty: number;
  status: "confirmed" | "learning" | "uncertain";
  evidenceCount: number;
  directEvidenceCount: number;
  objectiveAttemptCount: number;
  reliableCorrectSessions: number;
  manualStatus: "known" | "unknown" | null;
  lastEvidenceAt?: string | null;
};

export type KnowledgeStateV2 = {
  conceptId: string;
  scopeType: "global" | "project";
  scopeId: string;
  dimensions: Record<KnowledgeDimension, KnowledgeDimensionState>;
  policyVersion: string;
  evidenceVersion: number;
  updatedAt: string;
};

export type DiagnosticItem = {
  id: string;
  projectId: number;
  sessionId?: string | null;
  sourceQaRecordId?: number | null;
  teachingTrialId?: string | null;
  conceptIds: string[];
  dimension: KnowledgeDimension;
  itemType: "single_choice" | "true_false" | "code_output" | "error_location" | "step_order";
  prompt: string;
  options: Array<{ value: unknown; label: string }>;
  sourceRefs: Array<Record<string, unknown>>;
  rationale: string;
  difficulty: number;
  createdAt: string;
};

export type DomainProfile = {
  domainKey: string;
  summary: string;
  confidence: number;
  confirmed: string[];
  learning: string[];
  likelyPrerequisites: string[];
  evidence: Array<Record<string, unknown>>;
  updatedAt: string;
};

export type LearnerInference = {
  id: string;
  subjectType: "concept" | "domain";
  subjectKey: string;
  displayName?: string | null;
  scopeType: "global" | "project";
  scopeId: string;
  state: "confirmed" | "learning" | "likely_prerequisite" | "insufficient";
  summary: string;
  confidence: number;
  directEvidenceCount: number;
  inferredEvidenceCount: number;
  evidence: Array<Record<string, unknown>>;
  updatedAt: string;
};

export type ConceptRelation = {
  id: string;
  sourceConceptId: string;
  targetConceptId: string;
  relationType: "prerequisite" | "component" | "application" | "sibling" | "alias";
  domain: string;
  confidence: number;
  evidence: Array<Record<string, unknown>>;
};

export type DynamicSurveyCandidate = {
  id: string;
  question: string;
  dimension: string;
  options: Array<{ value: string; label: string }>;
  rationale: string;
  confidence: number;
  createdAt: string;
};

export type ModelCallAudit = {
  id: string;
  projectId?: number | null;
  purpose: string;
  provider?: string | null;
  model?: string | null;
  status: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  estimatedCost?: number | null;
  latencyMs?: number | null;
  errorMessage?: string | null;
  createdAt: string;
};

// ---- Personalization API ----

export function listConcepts(projectId: number, query?: string): Promise<PersonalizationConcept[]> {
  const params = query ? `?query=${encodeURIComponent(query)}` : "";
  return request<PersonalizationConcept[]>(`/projects/${projectId}/personalization/concepts${params}`);
}

export function createConcept(projectId: number, payload: { conceptKey: string; canonicalName: string; displayName: string; domain?: string; conceptType?: string; aliases?: string[]; difficulty?: number }): Promise<PersonalizationConcept> {
  return request<PersonalizationConcept>(`/projects/${projectId}/personalization/concepts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getMasteryBatch(projectId: number, conceptIds: string[]): Promise<Record<string, PersonalizationMastery>> {
  const ids = conceptIds.map(encodeURIComponent).join(",");
  return request<Record<string, PersonalizationMastery>>(`/projects/${projectId}/personalization/mastery?concept_ids=${ids}`);
}

export function markConceptKnown(projectId: number, conceptId: string, idempotencyKey: string, evidenceText?: string): Promise<PersonalizationMarkResult> {
  return request<PersonalizationMarkResult>(`/projects/${projectId}/personalization/mark-known`, {
    method: "POST",
    body: JSON.stringify({ conceptId, idempotencyKey, evidenceText }),
  });
}

export function markConceptUnknown(projectId: number, conceptId: string, idempotencyKey: string, evidenceText?: string): Promise<PersonalizationMarkResult> {
  return request<PersonalizationMarkResult>(`/projects/${projectId}/personalization/mark-unknown`, {
    method: "POST",
    body: JSON.stringify({ conceptId, idempotencyKey, evidenceText }),
  });
}

export function clearConceptOverride(projectId: number, conceptId: string, idempotencyKey: string): Promise<PersonalizationMarkResult> {
  return request<PersonalizationMarkResult>(`/projects/${projectId}/personalization/clear-override`, {
    method: "POST",
    body: JSON.stringify({ conceptId, idempotencyKey }),
  });
}

export async function getTermDisplayProfiles(
  projectId: number,
  conceptKeys: string[],
  signal?: AbortSignal,
): Promise<TermPersonalizationProfile[]> {
  const uniqueKeys = [...new Set(conceptKeys.map((k) => k.trim()).filter(Boolean))];
  if (uniqueKeys.length === 0) return [];

  const profiles: TermPersonalizationProfile[] = [];
  const batchSize = 200;

  for (let i = 0; i < uniqueKeys.length; i += batchSize) {
    const batch = uniqueKeys.slice(i, i + batchSize);
    const response = await request<{ profiles: Array<{
      conceptKey?: string;
      concept_key?: string;
      manualStatus?: TermPersonalizationProfile["manualStatus"];
      manual_status?: TermPersonalizationProfile["manualStatus"];
      mastery?: number | null;
      uncertainty?: number | null;
      shadowFamiliarity?: number | null;
      shadow_familiarity?: number | null;
      shadowConfidence?: number | null;
      shadow_confidence?: number | null;
      shadowEvidenceCount?: number;
      shadow_evidence_count?: number;
      domainPrior?: number | null;
      domain_prior?: number | null;
    }> }>(
      `/projects/${projectId}/personalization/term-display-profiles`,
      {
        method: "POST",
        signal,
        body: JSON.stringify({ concept_keys: batch }),
      },
    );
    profiles.push(...response.profiles
      .map(normalizeTermDisplayProfile)
      .filter((profile) => Boolean(profile.conceptKey)));
  }

  return profiles;
}

export function normalizeTermDisplayProfile(profile: {
  conceptKey?: string;
  concept_key?: string;
  manualStatus?: TermPersonalizationProfile["manualStatus"];
  manual_status?: TermPersonalizationProfile["manualStatus"];
  mastery?: number | null;
  uncertainty?: number | null;
  shadowFamiliarity?: number | null;
  shadow_familiarity?: number | null;
  shadowConfidence?: number | null;
  shadow_confidence?: number | null;
  shadowEvidenceCount?: number;
  shadow_evidence_count?: number;
  domainPrior?: number | null;
  domain_prior?: number | null;
}): TermPersonalizationProfile {
  return {
    conceptKey: profile.conceptKey ?? profile.concept_key ?? "",
    manualStatus: profile.manualStatus ?? profile.manual_status ?? null,
    mastery: profile.mastery ?? null,
    uncertainty: profile.uncertainty ?? null,
    shadowFamiliarity: profile.shadowFamiliarity ?? profile.shadow_familiarity ?? null,
    shadowConfidence: profile.shadowConfidence ?? profile.shadow_confidence ?? null,
    shadowEvidenceCount: profile.shadowEvidenceCount ?? profile.shadow_evidence_count ?? 0,
    domainPrior: profile.domainPrior ?? profile.domain_prior ?? null,
  };
}

export function getPersonalizationEvents(projectId: number, conceptId: string): Promise<PersonalizationEvent[]> {
  return request<PersonalizationEvent[]>(`/projects/${projectId}/personalization/events/${encodeURIComponent(conceptId)}`);
}

export function voidPersonalizationEvent(projectId: number, eventId: string, conceptId: string, idempotencyKey: string, reason?: string): Promise<PersonalizationEvent> {
  return request<PersonalizationEvent>(`/projects/${projectId}/personalization/events/${encodeURIComponent(eventId)}/void`, {
    method: "POST",
    body: JSON.stringify({ conceptId, idempotencyKey, reason }),
  });
}

export function resolvePersonalizationTerms(
  projectId: number,
  terms: Array<{ text: string; source?: string; confidence?: number; context_relevance?: number }>,
): Promise<{ terms: Array<{ text: string; concept: PersonalizationConcept; mastery?: PersonalizationMastery | null; confidence: number }> }> {
  return request<{ terms: Array<{ text: string; concept: PersonalizationConcept; mastery?: PersonalizationMastery | null; confidence: number }> }>(`/projects/${projectId}/personalization/resolve`, {
    method: "POST",
    body: JSON.stringify({ terms }),
  });
}

export function getLearnerPreferences(projectId: number): Promise<LearnerPreferences> {
  return request<LearnerPreferences>(`/projects/${projectId}/personalization/preferences`);
}

export function updateLearnerPreferences(
  projectId: number,
  payload: Partial<{
    answer_depth: number;
    code_ratio: number;
    explanation_order: LearnerPreferences["explanationOrder"];
    prerequisite_detail: number;
    terminology_density: number;
    survey_enabled: boolean;
    scope: "global" | "project";
  }>,
): Promise<LearnerPreferences> {
  return request<LearnerPreferences>(`/projects/${projectId}/personalization/preferences`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function submitAnswerFeedback(
  projectId: number,
  payload: {
    dimension: string;
    choice: string;
    qa_record_id?: number;
    source?: "explicit_user" | "survey" | "implicit_question";
    idempotency_key: string;
    scope?: "global" | "project";
  },
): Promise<LearnerPreferences> {
  return request<LearnerPreferences>(`/projects/${projectId}/personalization/answer-feedback`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function recordTermImpressions(
  projectId: number,
  impressions: Array<Record<string, unknown>>,
): Promise<{ status: string; saved: number }> {
  return request<{ status: string; saved: number }>(`/projects/${projectId}/personalization/term-impressions/batch`, {
    method: "POST",
    body: JSON.stringify({ impressions }),
  });
}

export function getPersonalizationProfile(projectId: number): Promise<PersonalizationProfile> {
  return request<PersonalizationProfile>(`/projects/${projectId}/personalization/profile`);
}

export function getTeachingTrial(
  projectId: number,
  qaRecordId: number,
): Promise<TeachingTrial> {
  return request<TeachingTrial>(
    `/projects/${projectId}/personalization/teaching/${qaRecordId}`,
  );
}

export function submitTeachingFeedback(
  projectId: number,
  qaRecordId: number,
  result: "successful" | "partially_successful" | "unsuccessful",
  reason = "",
): Promise<{
  id: string;
  teachingTrialId: string;
  result: string;
  confidence: number;
  evidenceType: string;
  authority: number;
  policyEligible: boolean;
  createdAt: string;
}> {
  return request(
    `/projects/${projectId}/personalization/teaching/${qaRecordId}/feedback`,
    {
      method: "POST",
      body: JSON.stringify({
        result,
        reason,
        idempotency_key: `teaching-feedback:${qaRecordId}:${result}:${Date.now()}`,
      }),
    },
  );
}

export function voidLearnerInference(projectId: number, inferenceId: string): Promise<{ status: string; id: string }> {
  return request(`/projects/${projectId}/personalization/inferences/${encodeURIComponent(inferenceId)}/void`, {
    method: "POST",
  });
}

export function answerDynamicSurvey(projectId: number, surveyId: string, choice: string): Promise<{ status: string }> {
  return request(`/projects/${projectId}/personalization/surveys/${encodeURIComponent(surveyId)}/answer`, {
    method: "POST",
    body: JSON.stringify({ choice }),
  });
}

export function dismissDynamicSurvey(projectId: number, surveyId: string): Promise<{ status: string }> {
  return request(`/projects/${projectId}/personalization/surveys/${encodeURIComponent(surveyId)}/dismiss`, {
    method: "POST",
  });
}

export function getReusableConceptExplanation(
  projectId: number,
  conceptId: string,
): Promise<{ explanation: { projectId: number; qa: QARecord } | null }> {
  return request(`/projects/${projectId}/personalization/concepts/${encodeURIComponent(conceptId)}/explanation`);
}

export function resetPersonalizationProfile(
  projectId: number,
  scope: "project" | "global" | "all" = "project",
): Promise<{
  status: string;
  deletedMasteryCount: number;
  deletedEventCount: number;
  deletedPreferencesCount?: number;
  deletedPreferenceEventsCount?: number;
  deletedShadowCount?: number;
}> {
  return request<{
    status: string;
    deletedMasteryCount: number;
    deletedEventCount: number;
    deletedPreferencesCount?: number;
    deletedPreferenceEventsCount?: number;
    deletedShadowCount?: number;
  }>(`/projects/${projectId}/personalization/profile?scope=${scope}`, {
    method: "DELETE",
  });
}

export function getKnowledgeStates(
  projectId: number,
  conceptIds: string[] = [],
): Promise<{ policyVersion: string; states: KnowledgeStateV2[] }> {
  const query = conceptIds.length
    ? `?concept_ids=${conceptIds.map(encodeURIComponent).join(",")}`
    : "";
  return request(`/projects/${projectId}/personalization/knowledge-state${query}`);
}

export function submitLearningEvidence(
  projectId: number,
  payload: Record<string, unknown>,
): Promise<{ evidence: Record<string, unknown>; state: KnowledgeStateV2 }> {
  return request(`/projects/${projectId}/personalization/evidence`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function voidLearningEvidence(
  projectId: number,
  evidenceId: string,
  idempotencyKey: string,
  reason?: string,
): Promise<{ evidence: Record<string, unknown>; state: KnowledgeStateV2 }> {
  return request(`/projects/${projectId}/personalization/evidence/${encodeURIComponent(evidenceId)}/void`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey, reason }),
  });
}

export function rebuildKnowledgeProfile(projectId: number): Promise<{
  status: string;
  rebuilt: number;
  policyVersion: string;
}> {
  return request(`/projects/${projectId}/personalization/rebuild`, { method: "POST" });
}

export function getPendingDiagnostic(projectId: number): Promise<{ item: DiagnosticItem | null }> {
  return request(`/projects/${projectId}/personalization/diagnostics/pending`);
}

export function answerDiagnostic(
  projectId: number,
  itemId: string,
  answer: unknown,
): Promise<{ status: string; correct: boolean; attemptId: string }> {
  return request(`/projects/${projectId}/personalization/diagnostics/${encodeURIComponent(itemId)}/answer`, {
    method: "POST",
    body: JSON.stringify({ answer }),
  });
}

export function dismissDiagnostic(projectId: number, itemId: string): Promise<{ status: string }> {
  return request(`/projects/${projectId}/personalization/diagnostics/${encodeURIComponent(itemId)}/dismiss`, {
    method: "POST",
  });
}

export function flagDiagnostic(projectId: number, itemId: string): Promise<{ status: string }> {
  return request(`/projects/${projectId}/personalization/diagnostics/${encodeURIComponent(itemId)}/flag`, {
    method: "POST",
  });
}
