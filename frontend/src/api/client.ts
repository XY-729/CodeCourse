const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api";

export type Project = {
  id: number;
  name: string;
  url: string;
  local_path: string;
  status: string;
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
};

export type FileContent = {
  path: string;
  language: string;
  content: string;
};

export type ExplainResponse = {
  provider: string;
  explanation: string;
};

export type ProjectActionResponse = {
  id: number;
  status: string;
  message: string;
  course_files: string[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    const detail = Array.isArray(body.detail) ? body.detail.map((item: { msg?: string }) => item.msg).join("; ") : body.detail;
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
  return request<{ filename: string; content: string }>(`/projects/${projectId}/course/${encodeURIComponent(filename)}`);
}

export function explainCurrent(
  projectId: number,
  path: string | null,
  mode: "file" | "course" | "selection",
  selection?: string,
): Promise<ExplainResponse> {
  return request<ExplainResponse>("/explain", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, path, mode, selection }),
  });
}
