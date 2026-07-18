import { httpApiUrl, providerRequest } from "../platform/provider";
import { isAndroidRuntime } from "../platform/runtime";

declare global {
  interface Window {
    codecourseDesktop?: { apiBase?: string; openExternal?: (url: string) => void };
    __CODECOURSE_API_BASE__?: string;
  }
}

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

export type DocumentTerm = {
  id: number;
  project_id: number;
  source_type: "course" | "qa";
  source_path: string;
  term_text: string;
  detection_source: "model" | "index" | "rule" | string;
  confidence: number;
  status: "candidate" | "linked" | "known" | "dismissed" | string;
  qa_record_id?: number | null;
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

export type LearningScope = {
  type: "full_project" | "files" | "learning_plan";
  paths: string[];
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

export function generateOutline(projectId: number, scope: LearningScope, instructions: string): Promise<GenerationTask> {
  return request<GenerationTask>(`/projects/${projectId}/outline/generate`, {
    method: "POST",
    body: JSON.stringify({ scope, instructions }),
  });
}

export function generateFileLesson(projectId: number, path: string, mode: "brief" | "detailed", instructions: string): Promise<GenerationTask> {
  return request<GenerationTask>(`/projects/${projectId}/lessons/file`, {
    method: "POST",
    body: JSON.stringify({ path, mode, instructions }),
  });
}

export function importProjectArchive(file: File): Promise<Project> {
  return request<Project>("/projects/import-archive", {
    method: "POST",
    body: file,
  });
}

export function generateOutlineLesson(projectId: number, lessonNumber: number, title: string, instructions: string): Promise<GenerationTask> {
  return request<GenerationTask>(`/projects/${projectId}/lessons/outline`, {
    method: "POST",
    body: JSON.stringify({ lesson_number: lessonNumber, title, instructions }),
  });
}

export function listGenerationTasks(projectId: number): Promise<GenerationTask[]> {
  return request<GenerationTask[]>(`/projects/${projectId}/tasks`);
}

export function getGenerationTask(projectId: number, taskId: number): Promise<GenerationTask> {
  return request<GenerationTask>(`/projects/${projectId}/tasks/${taskId}`);
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
