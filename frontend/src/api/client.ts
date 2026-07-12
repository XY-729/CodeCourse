declare global {
  interface Window {
    codecourseDesktop?: { apiBase?: string };
    __CODECOURSE_API_BASE__?: string;
  }
}

const configuredApiBase =
  (typeof window !== "undefined" && (window.codecourseDesktop?.apiBase || window.__CODECOURSE_API_BASE__)) ||
  import.meta.env.VITE_API_BASE_URL ||
  "/api";
const API_BASE = configuredApiBase.replace(/\/$/, "");

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

export type SourceType = "file" | "course" | "selection";

export type QARecord = {
  id: number;
  project_id: number;
  session_id?: number | null;
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
  selection_range?: {
    start_line: number;
    start_column: number;
    end_line: number;
    end_column: number;
  } | null;
};

export type ProjectIndexStatus = {
  project_id: number;
  status: string;
  chunk_count: number;
  updated_at?: string | null;
  error_message?: string | null;
};

export type ProjectSearchResult = {
  path: string;
  language: string;
  start_line: number;
  end_line: number;
  chunk_type: string;
  symbol_name?: string | null;
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
  created_at: string;
  updated_at: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body != null;
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    const detail = Array.isArray(body.detail) ? body.detail.map((item: { msg?: string }) => item.msg).join("; ") : body.detail;
    if (detail === "Not Found" || response.status === 404) {
      throw new Error("接口未找到，请重启后端服务后重试。");
    }
    throw new Error(detail ?? response.statusText);
  }
  return response.json() as Promise<T>;
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
