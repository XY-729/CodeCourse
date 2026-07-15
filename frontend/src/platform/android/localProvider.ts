import { CodeCourseSecureStore } from "../runtime";
import type { CodeCourseProvider } from "../provider";
import type {
  CourseFile, GenerationTask, HighlightRecord, KnowledgeEdge, KnowledgeGraph, KnowledgeLink, KnowledgeNode,
  LearningAnchor, LLMSettings, Project, ProjectIndexStatus, ProjectSearchResult, QAAskPayload, QARecord, TreeNode,
} from "../../api/client";
import promptDefaults from "./default-prompts.json";
import { MobileDatabase } from "./database";
import {
  buildTree, downloadGitHubSnapshot, inferLanguage, readGeneratedFile, readRepoFile, readZipFiles, removeGeneratedFile,
  removeProjectFiles, writeGeneratedFileAtomic, writeRepoFile,
} from "./workspace";

type Row = Record<string, any>;

type LessonPlanItem = {
  name: string;
  kind: "function" | "concept";
  focus: string;
};

type LessonPlanSection = {
  title: string;
  items: LessonPlanItem[];
};

type LessonPlan = {
  lesson_title: string;
  position: string;
  objectives: string[];
  sections: LessonPlanSection[];
  textbooks: Array<{ title: string; author: string; topics: string }>;
};

const db = new MobileDatabase();
const DEFAULT_MODEL = { provider: "deepseek", base_url: "https://api.deepseek.com", model: "deepseek-chat", enabled: false };
const KNOWN_TECH_TERMS = ["FastAPI", "Pydantic", "Uvicorn", "React", "TypeScript", "JavaScript", "Electron", "SQLite", "FTS5", "Cytoscape", "Monaco", "Tree-sitter", "Docker", "CMake", "Cargo", "WebSocket", "REST", "RAG", "LLM", "API", "Git", "依赖注入", "异步任务", "全文检索", "知识图谱", "调用关系", "路由", "中间件"];
const STOP_TERMS = new Set(["markdown", "github", "codecourse", "readme", "todo", "true", "false", "null", "项目", "文件", "代码", "课件", "回答", "问题", "学习", "用户", "模型", "内容"]);

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
function compactText(value: string, limit = 12_000): string {
  if (value.length <= limit) return value;
  const half = Math.floor(limit / 2);
  return `${value.slice(0, half)}\n\n...（中间内容已省略）...\n\n${value.slice(-half)}`;
}
function renderPrompt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-z_]+)\}/gi, (match, key: string) => Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match);
}
function sourceNodeTitle(sourceType: string, sourcePath?: string | null): string {
  if (!sourcePath) return "项目上下文";
  if (sourceType === "course" && sourcePath === "outline.md") return "总纲";
  const lesson = sourceType === "course" ? sourcePath.match(/^lessons\/lesson_(\d+)\.md$/) : null;
  if (lesson) return `第${Number(lesson[1])}课`;
  return sourcePath.split("/").pop() || sourcePath;
}

function extractJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  if (!candidate) throw new Error("课件规划没有返回有效 JSON。");
  return JSON.parse(candidate);
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
        focus: String(entry.focus || "完整讲清").trim(),
      };
    }).filter((item): item is LessonPlanItem => item !== null);
    if (!items.length) throw new Error(`课件规划第 ${index + 1} 章没有知识项。`);
    return { title: String(record.title || `第 ${index + 1} 章`).trim(), items };
  });
  if (parsedSections.length < 4) throw new Error("课件规划必须包含 4-10 个可生成章节。");
  const textbooks = (Array.isArray(value.textbooks) ? value.textbooks : []).map((book) => {
    const entry = book && typeof book === "object" ? book as Record<string, unknown> : {};
    return { title: String(entry.title || "").trim(), author: String(entry.author || "").trim(), topics: String(entry.topics || "").trim() };
  }).filter((book) => book.title && book.author).slice(0, 12);
  return {
    lesson_title: String(value.lesson_title || "").trim(),
    position: String(value.position || "").trim(),
    objectives: (Array.isArray(value.objectives) ? value.objectives : []).map(String).map((item) => item.trim()).filter(Boolean),
    sections: parsedSections,
    textbooks,
  };
}

function missingLessonItems(markdown: string, sections: LessonPlanSection[]): LessonPlanItem[] {
  const normalized = markdown.toLocaleLowerCase();
  return sections.flatMap((section) => section.items).filter((item) => !normalized.includes(item.name.toLocaleLowerCase()));
}

function cleanTerm(value: string): string {
  const term = value.trim().replace(/^[`*_#\[\](){}<>，。；：、]+|[`*_#\[\](){}<>，。；：、]+$/g, "").replace(/\s+/g, " ");
  if (term.length < 2 || term.length > 80 || /^\d+$/.test(term) || STOP_TERMS.has(term.toLocaleLowerCase())) return "";
  return term;
}

function localTermCandidates(content: string): Array<{ term: string; source: "rule"; confidence: number }> {
  const visible = content.replace(/```[\s\S]*?```/g, " ");
  const weighted: Array<{ term: string; source: "rule"; confidence: number }> = [];
  const add = (raw: string, confidence: number) => {
    const term = cleanTerm(raw);
    if (term && visible.includes(term) && !weighted.some((item) => item.term.toLocaleLowerCase() === term.toLocaleLowerCase())) weighted.push({ term, source: "rule", confidence });
  };
  for (const match of visible.matchAll(/`([^`\n]{2,80})`/g)) add(match[1], 0.76);
  for (const term of KNOWN_TECH_TERMS) if (visible.includes(term)) add(term, 0.84);
  for (const match of visible.matchAll(/\b(?:[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]*)+|[A-Z]{2,}[A-Z0-9_-]*|[A-Za-z]+\.[A-Za-z0-9_.-]+)\b/g)) add(match[0], 0.72);
  return weighted.sort((a, b) => b.term.length - a.term.length).slice(0, 20);
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

export class AndroidLocalProvider implements CodeCourseProvider {
  private runningTasks = new Set<number>();
  private runningIndexes = new Set<number>();

  static async create(): Promise<AndroidLocalProvider> {
    const provider = new AndroidLocalProvider();
    await db.init();
    await provider.resumeTasks();
    await provider.resumeIndexes();
    return provider;
  }

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
    if (path === "/settings/prompts" && method === "GET") return this.getPrompts() as Promise<T>;
    if (path === "/settings/prompts" && method === "PUT") return this.savePrompts(body) as Promise<T>;

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
    if ((match = path.match(/^\/projects\/(\d+)\/outline\/generate$/))) return this.queueTask(Number(match[1]), "outline", body) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/lessons\/file$/))) return this.queueTask(Number(match[1]), "file_lesson", body) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/lessons\/outline$/))) return this.queueTask(Number(match[1]), "outline_lesson", body) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/tasks$/))) return this.listTasks(Number(match[1])) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/tasks\/(\d+)$/))) return this.getTask(Number(match[1]), Number(match[2])) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/index\/build$/))) return this.buildIndex(Number(match[1])) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/index\/status$/))) return this.indexStatus(Number(match[1])) as Promise<T>;
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
    if ((match = path.match(/^\/projects\/(\d+)\/terms$/))) return this.listTerms(Number(match[1]), url.searchParams) as Promise<T>;
    if ((match = path.match(/^\/projects\/(\d+)\/terms\/(\d+)\/(known|dismiss)$/))) return this.setTermStatus(Number(match[2]), match[3] === "known" ? "known" : "dismissed") as Promise<T>;

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
    throw new Error(`移动端尚未实现此操作：${method} ${path}`);
  }

  private async courseNames(projectId: number): Promise<string[]> {
    return (await db.query<Row>("SELECT filename FROM course_files WHERE project_id = ? ORDER BY filename", [projectId])).map((row) => String(row.filename));
  }
  private async getProject(projectId: number): Promise<Project> {
    const row = (await db.query<Row>("SELECT * FROM projects WHERE id = ?", [projectId]))[0];
    if (!row) throw new Error("项目不存在。");
    return projectFromRow(row, await this.courseNames(projectId));
  }
  private async listProjects(): Promise<Project[]> {
    const rows = await db.query<Row>("SELECT * FROM projects ORDER BY updated_at DESC");
    return Promise.all(rows.map(async (row) => projectFromRow(row, await this.courseNames(Number(row.id)))));
  }
  private async createLearningPlan(name: string): Promise<Project> {
    const clean = String(name || "").trim(); if (!clean) throw new Error("请输入学习计划名称。");
    const stamp = now();
    const id = await db.run("INSERT INTO projects(name,url,status,project_type,created_at,updated_at) VALUES(?,?,?,?,?,?)", [clean, "", "learning_plan", "learning_plan", stamp, stamp]);
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
    await db.run("DELETE FROM code_chunks_fts WHERE project_id = ?", [projectId]).catch(() => undefined);
    await db.run("DELETE FROM projects WHERE id = ?", [projectId]); await removeProjectFiles(projectId);
    return { id: projectId, status: "deleted", message: "项目已删除", course_files: [] };
  }
  private async getTree(projectId: number): Promise<TreeNode> {
    const project = await this.getProject(projectId);
    const rows = await db.query<Row>("SELECT path,is_key_file FROM project_files WHERE project_id = ? ORDER BY path", [projectId]);
    return buildTree(project.name, rows.map((row) => ({ path: String(row.path), is_key_file: row.is_key_file })));
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
    await db.run("DELETE FROM highlights WHERE project_id = ? AND source_type = 'course' AND source_path = ?", [projectId, filename]);
    await db.run("DELETE FROM knowledge_links WHERE project_id = ? AND source_type = 'course' AND source_path = ?", [projectId, filename]);
    await db.run("DELETE FROM document_terms WHERE project_id = ? AND source_type = 'course' AND source_path = ?", [projectId, filename]);
    await db.run("DELETE FROM knowledge_nodes WHERE project_id = ? AND ref_type = 'course' AND ref_path = ?", [projectId, filename]);
    await removeGeneratedFile(projectId, filename); return { deleted: true, filename };
  }
  private async writeRuleCourse(projectId: number, name: string, paths: string[]): Promise<void> {
    const key = paths.filter((path) => /(^|\/)(README[^/]*|package\.json|pyproject\.toml|CMakeLists\.txt|Cargo\.toml|go\.mod|Dockerfile)$/i.test(path));
    const map = `# 项目结构说明\n\n> 生成方式：本地规则\n\n## 项目\n\n${name}\n\n## 关键文件\n\n${(key.length ? key : paths.slice(0, 12)).map((path) => `- \`${path}\``).join("\n")}\n`;
    const outline = `# 项目学习总纲\n\n> 生成方式：本地规则，占位内容可通过“生成 AI 总纲”替换。\n\n## 学习路线\n\n1. 阅读 README 和构建配置，确认项目目标。\n2. 找到程序入口和核心目录。\n3. 沿关键符号阅读主要流程。\n4. 阅读测试与部署配置，验证理解。\n`;
    await this.upsertCourse(projectId, "project_map.md", map, "总纲");
    await this.upsertCourse(projectId, "outline.md", outline, "总纲");
  }
  private async regenerate(projectId: number): Promise<any> {
    const project = await this.getProject(projectId);
    if (project.project_type === "repository") {
      const rows = await db.query<Row>("SELECT path FROM project_files WHERE project_id = ?", [projectId]);
      await this.writeRuleCourse(projectId, project.name, rows.map((row) => String(row.path)));
    }
    return { id: projectId, status: "scanned", message: "规则课程已更新", course_files: await this.courseNames(projectId) };
  }

  private async setting(key: string): Promise<string | null> { return (await db.query<Row>("SELECT value FROM settings WHERE key = ?", [key]))[0]?.value ?? null; }
  private async setSetting(key: string, value: string): Promise<void> { await db.run("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", [key, value]); }
  private async getLLMSettings(): Promise<LLMSettings> {
    const saved = JSON.parse((await this.setting("llm.config")) || JSON.stringify(DEFAULT_MODEL));
    const apiKey = (await CodeCourseSecureStore.get({ key: "llm_api_key" })).value;
    return { ...saved, has_api_key: Boolean(apiKey), masked_api_key: apiKey ? `****${apiKey.slice(-4)}` : null };
  }
  private async saveLLMSettings(payload: any): Promise<LLMSettings> {
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
    const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 240_000);
    try {
      const response = await fetch(`${settings.base_url.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: settings.model, messages, temperature: 0.25 }), signal: controller.signal,
      });
      if (!response.ok) throw new Error(`模型调用失败（${response.status}）：${await response.text()}`);
      const data = await response.json() as any;
      const content = String(data.choices?.[0]?.message?.content || "").trim();
      if (!content) throw new Error("模型返回了空内容。"); return content;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("模型响应超时，请检查网络后重试。");
      throw error;
    } finally { window.clearTimeout(timeout); }
  }
  private async testLLMSettings(): Promise<any> {
    await this.callLLM([{ role: "user", content: "只回答 OK" }]);
    const settings = await this.getLLMSettings(); return { ok: true, provider: settings.provider, message: "模型连接成功" };
  }
  private async getPrompts(): Promise<Record<string, string>> {
    const prompts = { ...(promptDefaults as Record<string, string>) };
    const rows = await db.query<Row>("SELECT key,value FROM settings WHERE key LIKE 'prompt.%'");
    rows.forEach((row) => { prompts[String(row.key)] = String(row.value); }); return prompts;
  }
  private async savePrompts(payload: Record<string, string>): Promise<{ ok: boolean }> {
    for (const [key, value] of Object.entries(payload)) if (key.startsWith("prompt.")) await this.setSetting(key, value);
    return { ok: true };
  }

  private async queueTask(projectId: number, taskType: string, payload: any): Promise<GenerationTask> {
    const settings = await this.getLLMSettings();
    const project = await this.getProject(projectId); const prompts = await this.getPrompts();
    let sourceFingerprint = ""; let promptFingerprint = "";
    if (taskType === "file_lesson" && payload.path) {
      sourceFingerprint = hashText(await readRepoFile(projectId, payload.path));
      promptFingerprint = `${prompts["prompt.file_lesson.template"] || ""}\n${prompts[`prompt.file_lesson.${payload.mode}_expected`] || ""}`;
    } else if (taskType === "outline_lesson") {
      sourceFingerprint = hashText(await readGeneratedFile(projectId, "outline.md"));
      promptFingerprint = prompts[project.project_type === "learning_plan" ? "prompt.learning_plan.lesson" : "prompt.outline_lesson"] || "";
    } else {
      promptFingerprint = prompts[project.project_type === "learning_plan" ? "prompt.learning_plan.outline" : "prompt.outline"] || "";
    }
    const stamp = now(); const serialized = JSON.stringify(payload);
    const inputHash = hashText(JSON.stringify({ taskType, payload, model: settings.model, promptFingerprint, sourceFingerprint }));
    const cached = (await db.query<Row>(`SELECT t.* FROM generation_tasks t JOIN course_files c ON c.project_id=t.project_id AND c.filename=t.output_path WHERE t.project_id=? AND t.task_type=? AND t.status='completed' AND t.input_hash=? ORDER BY t.id DESC LIMIT 1`, [projectId, taskType, inputHash]))[0];
    if (cached) return taskFromRow(cached);
    const id = await db.run(`INSERT INTO generation_tasks(project_id,task_type,status,source_path,mode,model,prompt_version,input_hash,payload_json,stage_label,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [projectId, taskType, "queued", payload.path || null, payload.mode || null, settings.model, "mobile-v2", inputHash, serialized, "等待生成", stamp, stamp]);
    void this.runTask(id); return this.getTask(projectId, id);
  }
  private async resumeTasks(): Promise<void> {
    const rows = await db.query<Row>("SELECT id FROM generation_tasks WHERE status IN ('queued','running')");
    for (const row of rows) { await db.run("UPDATE generation_tasks SET status='queued',stage_label='恢复任务' WHERE id=?", [row.id]); void this.runTask(Number(row.id)); }
  }
  private async listTasks(projectId: number): Promise<GenerationTask[]> { return (await db.query<Row>("SELECT * FROM generation_tasks WHERE project_id=? ORDER BY id DESC", [projectId])).map(taskFromRow); }
  private async getTask(projectId: number, taskId: number): Promise<GenerationTask> {
    const row = (await db.query<Row>("SELECT * FROM generation_tasks WHERE project_id=? AND id=?", [projectId, taskId]))[0];
    if (!row) throw new Error("生成任务不存在。"); return taskFromRow(row);
  }
  private async runTask(taskId: number): Promise<void> {
    if (this.runningTasks.has(taskId)) return; this.runningTasks.add(taskId);
    try {
      const task = (await db.query<Row>("SELECT * FROM generation_tasks WHERE id=?", [taskId]))[0]; if (!task) return;
      const payload = JSON.parse(task.payload_json || "{}");
      await db.run("UPDATE generation_tasks SET status='running',progress_current=0,progress_total=1,stage_label='准备上下文',updated_at=? WHERE id=?", [now(), taskId]);
      let output: { filename: string; content: string };
      if (task.task_type === "outline") output = await this.generateOutline(Number(task.project_id), payload, taskId);
      else if (task.task_type === "file_lesson") output = await this.generateFileLesson(Number(task.project_id), payload);
      else output = await this.generateOutlineLesson(Number(task.project_id), payload, taskId);
      await this.upsertCourse(Number(task.project_id), output.filename, output.content, output.filename.startsWith("lessons/") ? "课件" : "总纲");
      await this.ensureCourseNode(Number(task.project_id), output.filename, titleFromMarkdown(output.filename, output.content));
      await db.run("UPDATE generation_tasks SET status='completed',progress_current=progress_total,stage_label='已完成',output_path=?,updated_at=? WHERE id=?", [output.filename, now(), taskId]);
    } catch (error) {
      await db.run("UPDATE generation_tasks SET status='failed',stage_label='生成失败',error_message=?,updated_at=? WHERE id=?", [error instanceof Error ? error.message : String(error), now(), taskId]);
    } finally { this.runningTasks.delete(taskId); }
  }
  private async projectContext(projectId: number, paths?: string[]): Promise<string> {
    const rows = await db.query<Row>(`SELECT path,language,is_key_file FROM project_files WHERE project_id=? ${paths?.length ? `AND path IN (${paths.map(() => "?").join(",")})` : ""} ORDER BY is_key_file DESC,path LIMIT 60`, [projectId, ...(paths || [])]);
    const blocks: string[] = [];
    for (const row of rows.slice(0, 16)) {
      const content = await readRepoFile(projectId, String(row.path));
      blocks.push(`## ${row.path}\n\n${compactText(content, 5000)}`);
    }
    return blocks.join("\n\n");
  }
  private async generateOutline(projectId: number, payload: any, taskId: number): Promise<{ filename: string; content: string }> {
    const project = await this.getProject(projectId); const prompts = await this.getPrompts();
    const key = project.project_type === "learning_plan" ? "prompt.learning_plan.outline" : "prompt.outline";
    const context = project.project_type === "learning_plan" ? "" : await this.projectContext(projectId, payload.scope?.paths);
    await db.run("UPDATE generation_tasks SET stage_label='生成学习总纲',updated_at=? WHERE id=?", [now(), taskId]);
    const settings = await this.getLLMSettings();
    const prompt = renderPrompt(prompts[key] || "生成详细学习总纲", {
      model: settings.model,
      scope_text: payload.scope?.type || (project.project_type === "learning_plan" ? "learning_plan" : "full_project"),
      user_instructions: payload.instructions || "无",
      prompt_input: context,
    });
    let content = await this.callLLM([{ role: "system", content: prompts["prompt.system"] || "你是学习助手。" }, { role: "user", content: prompt }]);
    if (!content.startsWith("#")) content = `# ${project.project_type === "learning_plan" ? "学习计划总纲" : "项目学习总纲"}\n\n${content}`;
    if (project.project_type === "repository" && content.includes("## FILE:")) {
      const outlinePart = content.match(/## FILE:\s*outline\.md\s*([\s\S]*)/i)?.[1]?.trim(); if (outlinePart) content = outlinePart;
    }
    return { filename: "outline.md", content };
  }
  private async generateFileLesson(projectId: number, payload: any): Promise<{ filename: string; content: string }> {
    const prompts = await this.getPrompts(); const content = await readRepoFile(projectId, payload.path);
    const mode = payload.mode === "detailed" ? "detailed" : "brief";
    const expected = prompts[`prompt.file_lesson.${mode}_expected`] || "详细解释文件职责、结构、关键符号和练习。";
    const settings = await this.getLLMSettings();
    const prompt = renderPrompt(prompts["prompt.file_lesson.template"] || "生成文件课件", {
      mode_label: mode === "detailed" ? "详细分析" : "粗略介绍",
      relative_path: payload.path,
      user_instructions: payload.instructions || "无",
      model: settings.model,
      expected,
      prompt_input: compactText(content, mode === "detailed" ? 24000 : 10000),
    });
    let lesson = await this.callLLM([{ role: "system", content: prompts["prompt.system"] || "你是软件工程讲师。" }, { role: "user", content: prompt }]);
    const title = `${payload.path} ${mode === "detailed" ? "详细分析" : "粗略介绍"}`; if (!lesson.startsWith("#")) lesson = `# ${title}\n\n${lesson}`;
    return { filename: `files/${payload.path.replace(/[^\p{L}\p{N}_.-]+/gu, "_")}_${mode}.md`, content: lesson };
  }
  private async generateOutlineLesson(projectId: number, payload: any, taskId: number): Promise<{ filename: string; content: string }> {
    const project = await this.getProject(projectId); const prompts = await this.getPrompts();
    const outline = await readGeneratedFile(projectId, "outline.md");
    const key = project.project_type === "learning_plan" ? "prompt.learning_plan.lesson" : "prompt.outline_lesson";
    const settings = await this.getLLMSettings();
    let lessonInput = `项目学习总纲：\n${compactText(outline, 16000)}`;
    if (project.project_type === "repository") {
      const hits = await this.search(projectId, `${payload.title} ${payload.instructions || ""}`, undefined, 8).catch(() => []);
      const evidence = hits.map((item) => `### ${item.path}:${item.start_line}-${item.end_line}\n${item.content}`).join("\n\n");
      lessonInput += `\n\nRAG 索引检索片段：\n${evidence || await this.projectContext(projectId)}`;
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
    if (project.project_type === "learning_plan") {
      return this.generateLearningPlanLesson(projectId, payload, taskId, base, prompts["prompt.system"] || "你是学习课程设计师。");
    }
    await db.run("UPDATE generation_tasks SET progress_total=2,stage_label='规划课件章节',updated_at=? WHERE id=?", [now(), taskId]);
    const plan = await this.callLLM([{ role: "system", content: prompts["prompt.system"] || "你是学习课程设计师。" }, { role: "user", content: `${base}\n\n先列出本课必须逐项讲解的章节计划。` }]);
    await db.run("UPDATE generation_tasks SET progress_current=1,stage_label='生成完整课件',updated_at=? WHERE id=?", [now(), taskId]);
    let content = await this.callLLM([{ role: "system", content: prompts["prompt.system"] || "你是学习课程设计师。" }, { role: "user", content: `${base}\n\n章节计划：\n${plan}\n\n逐项展开，给出例子、常见错误、练习和教材参照。` }]);
    if (!content.startsWith("#")) content = `# 第 ${payload.lesson_number} 课：${payload.title}\n\n${content}`;
    return { filename: `lessons/lesson_${String(payload.lesson_number).padStart(2, "0")}.md`, content };
  }

  private async generateLearningPlanLesson(
    projectId: number,
    payload: any,
    taskId: number,
    base: string,
    systemPrompt: string,
  ): Promise<{ filename: string; content: string }> {
    await db.run("UPDATE generation_tasks SET progress_current=0,progress_total=12,stage_label='正在规划课件',updated_at=? WHERE id=?", [now(), taskId]);
    const planner = `${base}\n\n请先制定章节计划。只输出 JSON 对象，不要输出 Markdown 或解释。\n\nJSON 结构：\n{\n  "lesson_title": "课程标题",\n  "position": "本课在学习路线中的位置",\n  "objectives": ["可验证目标"],\n  "sections": [{"title": "章节标题", "items": [{"name": "必须逐项讲解的知识", "kind": "function 或 concept", "focus": "讲解重点"}]}],\n  "textbooks": [{"title": "确信存在的书名", "author": "作者", "topics": "相关章节主题"}]\n}\n\n章节必须为 4-10 个，覆盖总纲中本课的全部知识项。教材不确定时返回空数组，不得编造页码、版次或书目。`;
    const checkpoint = payload._checkpoint && typeof payload._checkpoint === "object" ? payload._checkpoint as { plan?: LessonPlan; generated?: string[] } : {};
    const plan = checkpoint.plan
      ? parseLessonPlan(JSON.stringify(checkpoint.plan))
      : parseLessonPlan(await this.callLLM([{ role: "system", content: systemPrompt }, { role: "user", content: planner }]));
    let totalCalls = 1 + plan.sections.length;
    const generated: string[] = Array.isArray(checkpoint.generated) ? checkpoint.generated.slice(0, plan.sections.length).map(String) : [];
    const saveCheckpoint = async () => db.run("UPDATE generation_tasks SET payload_json=?,updated_at=? WHERE id=?", [JSON.stringify({ ...payload, _checkpoint: { plan, generated } }), now(), taskId]);
    if (!checkpoint.plan) await saveCheckpoint();
    await db.run("UPDATE generation_tasks SET progress_current=?,progress_total=?,stage_label=?,updated_at=? WHERE id=?", [1 + generated.length, totalCalls, generated.length ? `已恢复 ${generated.length}/${plan.sections.length} 个章节` : "章节计划已完成", now(), taskId]);

    for (let index = generated.length; index < plan.sections.length; index += 1) {
      const section = plan.sections[index];
      const itemLines = section.items.map((item) => `- ${item.name}（类型：${item.kind}；重点：${item.focus}）`).join("\n");
      await db.run("UPDATE generation_tasks SET progress_current=?,progress_total=?,stage_label=?,updated_at=? WHERE id=?", [index + 1, totalCalls, `正在生成 ${index + 1}/${plan.sections.length}：${section.title}`, now(), taskId]);
      const sectionPrompt = `${base}\n\n现在只生成其中一个章节。\n\n章节标题：${section.title}\n本章必须逐项讲解：\n${itemLines}\n\n直接以 \`## ${section.title}\` 开始，只输出本章 Markdown。每个知识项必须以包含完整名称的 \`###\` 小节单独展开，不能省略或用一句定义代替。教学代码必须明确标注为教学示例，不得声称读过教材全文。`;
      let markdown = (await this.callLLM([{ role: "system", content: systemPrompt }, { role: "user", content: sectionPrompt }])).trim();
      if (!markdown.startsWith("##")) markdown = `## ${section.title}\n\n${markdown}`;
      generated.push(markdown);
      await saveCheckpoint();
      await db.run("UPDATE generation_tasks SET progress_current=?,stage_label=?,updated_at=? WHERE id=?", [index + 2, `已完成 ${index + 1}/${plan.sections.length}：${section.title}`, now(), taskId]);
    }

    let body = generated.join("\n\n");
    const missing = missingLessonItems(body, plan.sections);
    if (missing.length) {
      totalCalls += 1;
      if (totalCalls > 12) throw new Error("课件仍有遗漏知识项，但已达到 12 次 API 调用上限，旧课件已保留。");
      await db.run("UPDATE generation_tasks SET progress_current=?,progress_total=?,stage_label=?,updated_at=? WHERE id=?", [totalCalls - 1, totalCalls, `正在补全 ${missing.length} 个遗漏项`, now(), taskId]);
      const missingLines = missing.map((item) => `- ${item.name}（${item.kind}）：${item.focus}`).join("\n");
      let supplement = (await this.callLLM([{ role: "system", content: systemPrompt }, { role: "user", content: `${base}\n\n以下知识项在正文中遗漏。请输出 \`## 遗漏知识补全\`，并为每项建立包含完整名称的独立 \`###\` 小节，完整讲解。\n\n${missingLines}` }])).trim();
      if (!supplement.startsWith("##")) supplement = `## 遗漏知识补全\n\n${supplement}`;
      body += `\n\n${supplement}`;
      if (missingLessonItems(body, plan.sections).length) throw new Error("模型补全后仍未覆盖全部规划知识项，旧课件已保留。");
    }

    const title = plan.lesson_title || String(payload.title || `第 ${payload.lesson_number} 课`);
    const objectiveLines = plan.objectives.length ? plan.objectives.map((item) => `- ${item}`).join("\n") : "- 完成本课知识地图中的全部项目。";
    const mapLines = ["| 章节 | 必须掌握的知识项 |", "|---|---|", ...plan.sections.map((section) => `| ${section.title} | ${section.items.map((item) => item.name).join("、")} |`)];
    const textbookLines = plan.textbooks.length
      ? ["> 以下书目来自模型已知的正式出版物，仅作为建议参阅；课件未直接读取教材原文。", "", ...plan.textbooks.map((book) => `- 《${book.title}》— ${book.author}${book.topics ? `；相关主题：${book.topics}` : ""}`)].join("\n")
      : "本课未列出能够确认书目信息的教材。";
    const content = `# 第 ${payload.lesson_number} 课：${title}\n\n> 生成方式：AI 分章节生成  \n> 教材说明：书目仅作为建议参阅，模型未直接读取教材原文。\n\n## 本课定位\n\n${plan.position || "本课承接学习总纲中的对应阶段。"}\n\n## 本课目标\n\n${objectiveLines}\n\n## 知识地图\n\n${mapLines.join("\n")}\n\n${body}\n\n## 教材参照\n\n${textbookLines}\n`;
    return { filename: `lessons/lesson_${String(payload.lesson_number).padStart(2, "0")}.md`, content };
  }

  private async buildIndex(projectId: number): Promise<ProjectIndexStatus> {
    if (this.runningIndexes.has(projectId)) return this.indexStatus(projectId);
    this.runningIndexes.add(projectId);
    await this.setSetting(`index.${projectId}.status`, JSON.stringify({ status: "building", chunk_count: 0, updated_at: now() }));
    try {
      await db.run("DELETE FROM code_chunks WHERE project_id=?", [projectId]); await db.run("DELETE FROM code_chunks_fts WHERE project_id=?", [projectId]);
      const files = await db.query<Row>("SELECT path,language FROM project_files WHERE project_id=? ORDER BY path", [projectId]); let count = 0;
      for (const file of files) {
        const content = await readRepoFile(projectId, file.path); const lines = content.split("\n");
        for (let start = 0; start < lines.length; start += 70) {
          const block = lines.slice(start, start + 80).join("\n"); if (!block.trim()) continue;
          const symbol = block.match(/(?:class|interface|struct|def|function|fn|func)\s+([A-Za-z_$][\w$]*)/)?.[1] || null;
          const id = await db.run("INSERT INTO code_chunks(project_id,path,language,start_line,end_line,chunk_type,symbol_name,content) VALUES(?,?,?,?,?,?,?,?)", [projectId, file.path, file.language, start + 1, Math.min(lines.length, start + 80), symbol ? "symbol" : "block", symbol, block]);
          await db.run("INSERT INTO code_chunks_fts(rowid,project_id,path,symbol_name,content) VALUES(?,?,?,?,?)", [id, projectId, file.path, symbol, block]); count += 1;
        }
      }
      const result = { project_id: projectId, status: "ready", chunk_count: count, updated_at: now(), error_message: null };
      await this.setSetting(`index.${projectId}.status`, JSON.stringify(result)); return result;
    } catch (error) {
      const result = { project_id: projectId, status: "failed", chunk_count: 0, updated_at: now(), error_message: error instanceof Error ? error.message : String(error) };
      await this.setSetting(`index.${projectId}.status`, JSON.stringify(result)); return result;
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
    let rows: Row[] = [];
    try {
      rows = await db.query<Row>(`SELECT c.* FROM code_chunks_fts f JOIN code_chunks c ON c.id=f.rowid WHERE f.project_id=? AND code_chunks_fts MATCH ? ORDER BY CASE WHEN c.path=? THEN 0 ELSE 1 END LIMIT ?`, [projectId, ftsQuery, sourcePath || "", limit]);
    } catch {
      rows = await db.query<Row>("SELECT * FROM code_chunks WHERE project_id=? AND (content LIKE ? OR symbol_name LIKE ? OR path LIKE ?) ORDER BY CASE WHEN path=? THEN 0 ELSE 1 END LIMIT ?", [projectId, `%${query}%`, `%${query}%`, `%${query}%`, sourcePath || "", limit]);
    }
    return rows.map((row, index) => ({ path: row.path, language: row.language, start_line: Number(row.start_line), end_line: Number(row.end_line), chunk_type: row.chunk_type, symbol_name: row.symbol_name, content: row.content, score: 1 / (index + 1) }));
  }

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
        try { summaries.push(`## ${filename}\n${compactText(await readGeneratedFile(projectId, filename), 5000)}`); } catch { /* optional project context */ }
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
  private parseAnswer(raw: string, payload: QAAskPayload): { title: string; answer: string; terms: string[] } {
    const titleLine = raw.match(/^TITLE:\s*(.+)$/mi)?.[1]?.trim();
    const termsLine = raw.match(/^TERMS:\s*(.+)$/mi)?.[1] || "";
    const answer = raw.replace(/^TITLE:.*$/mi, "").replace(/^TERMS:.*$/mi, "").trim();
    const selected = String(payload.selected_text || "").trim().split(/\s+/)[0];
    const title = (titleLine || selected || payload.question || "AI 回答").slice(0, 48);
    let parsedTerms: unknown = [];
    try { parsedTerms = JSON.parse(termsLine); } catch { parsedTerms = termsLine.split(/[,，、]/); }
    const terms = (Array.isArray(parsedTerms) ? parsedTerms : []).map((term) => cleanTerm(String(term))).filter(Boolean).slice(0, 20);
    return { title, answer, terms };
  }
  private formatQA(record: QARecord): string {
    return `# ${record.display_title || record.question}\n\n## 问题\n\n${record.question}\n\n## 附带上下文\n\n${record.selected_text || "无选区内容"}\n\n## 回答\n\n${record.answer_md}\n\n---\n\n来源：${record.source_type} ${record.source_path || "项目"}  \n模型：${record.model}  \n创建时间：${record.created_at}\n`;
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
    const raw = await this.callLLM([
      { role: "system", content: prompts["prompt.system"] || "你是项目学习助手。" },
      { role: "user", content: questionPrompt },
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
    if (payload.term_candidate_id) await db.run("UPDATE document_terms SET status='linked',qa_record_id=?,updated_at=? WHERE project_id=? AND id=?", [id, stamp, projectId, payload.term_candidate_id]);
    record = await this.getQA(projectId, id); return record;
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
  private async updateQA(projectId: number, qaId: number, payload: any): Promise<QARecord> {
    const current = await this.getQA(projectId, qaId);
    const next = { question: payload.question ?? current.question, answer_md: payload.answer_md ?? current.answer_md, display_title: payload.display_title ?? current.display_title };
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
  private async saveAnchor(projectId: number, qaId: number, payload: any): Promise<LearningAnchor> {
    const stamp = now(); await db.run("INSERT OR REPLACE INTO learning_anchors(project_id,qa_record_id,term_text,summary,created_at,updated_at) VALUES(?,?,?,?,COALESCE((SELECT created_at FROM learning_anchors WHERE qa_record_id=?),?),?)", [projectId, qaId, payload.term_text || null, payload.summary, qaId, stamp, stamp]);
    const qa = await this.getQA(projectId, qaId);
    const qaNode = await this.createNode(projectId, { node_type: "qa", title: qa.display_title || qa.question, ref_type: "qa", ref_id: qa.id, ref_path: qa.output_path });
    const anchorNode = await this.createNode(projectId, { node_type: "anchor", title: payload.term_text || `理解 #${qaId}`, ref_type: "learning_anchor", ref_id: qaId, summary: payload.summary });
    await this.createEdge(projectId, { source_node_id: qaNode.id, target_node_id: anchorNode.id, relation_type: "related_to", label: null });
    return this.getAnchor(projectId, qaId);
  }
  private async deleteAnchor(projectId: number, qaId: number): Promise<any> { await db.run("DELETE FROM learning_anchors WHERE project_id=? AND qa_record_id=?", [projectId, qaId]); await db.run("DELETE FROM knowledge_nodes WHERE project_id=? AND ref_type='learning_anchor' AND ref_id=?", [projectId, qaId]); return { deleted: true, qa_id: qaId }; }

  private async listHighlights(projectId: number, params: URLSearchParams): Promise<HighlightRecord[]> {
    let sql = "SELECT * FROM highlights WHERE project_id=?"; const values: unknown[] = [projectId];
    if (params.get("source_type")) { sql += " AND source_type=?"; values.push(params.get("source_type")); }
    if (params.get("source_path")) { sql += " AND source_path=?"; values.push(params.get("source_path")); }
    return await db.query<Row>(`${sql} ORDER BY id`, values) as HighlightRecord[];
  }
  private async createHighlight(projectId: number, payload: any): Promise<HighlightRecord> {
    const stamp = now(); const id = await db.run("INSERT INTO highlights(project_id,source_type,source_path,selected_text,color,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)", [projectId, payload.source_type, payload.source_path, payload.selected_text, payload.color || "yellow", payload.note || null, stamp, stamp]); return (await db.query<Row>("SELECT * FROM highlights WHERE id=?", [id]))[0] as HighlightRecord;
  }
  private async registerTerms(projectId: number, sourceType: "course" | "qa", sourcePath: string, content: string, modelTerms: string[] = []): Promise<void> {
    const weighted = [
      ...modelTerms.map((term) => ({ term: cleanTerm(term), source: "model", confidence: 0.94 })),
      ...localTermCandidates(content),
    ].filter((item) => item.term && content.includes(item.term));
    const seen = new Set<string>();
    for (const item of weighted.sort((a, b) => b.term.length - a.term.length)) {
      const key = item.term.toLocaleLowerCase(); if (seen.has(key)) continue; seen.add(key);
      await db.run("INSERT OR IGNORE INTO document_terms(project_id,source_type,source_path,term_text,detection_source,confidence,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", [projectId, sourceType, sourcePath, item.term, item.source, item.confidence, "candidate", now(), now()]);
      if (seen.size >= 20) break;
    }
  }
  private async listTerms(projectId: number, params: URLSearchParams): Promise<any[]> {
    const sourceType = params.get("source_type") as "course" | "qa";
    const sourcePath = params.get("source_path") || "";
    let rows = await db.query<Row>("SELECT * FROM document_terms WHERE project_id=? AND source_type=? AND source_path=? ORDER BY length(term_text) DESC", [projectId, sourceType, sourcePath]);
    if (!rows.length && sourcePath) {
      try {
        const content = sourceType === "qa"
          ? ((await db.query<Row>("SELECT answer_md FROM qa_records WHERE project_id=? AND (output_path=? OR CAST(id AS TEXT)=?)", [projectId, sourcePath, sourcePath]))[0]?.answer_md || "")
          : await readGeneratedFile(projectId, sourcePath);
        if (content) await this.registerTerms(projectId, sourceType, sourcePath, String(content));
        rows = await db.query<Row>("SELECT * FROM document_terms WHERE project_id=? AND source_type=? AND source_path=? ORDER BY length(term_text) DESC", [projectId, sourceType, sourcePath]);
      } catch { /* Missing source documents simply have no term candidates. */ }
    }
    return rows;
  }
  private async setTermStatus(termId: number, status: string): Promise<any> { await db.run("UPDATE document_terms SET status=?,updated_at=? WHERE id=?", [status, now(), termId]); return (await db.query<Row>("SELECT * FROM document_terms WHERE id=?", [termId]))[0]; }

  private nodeFromRow(row: Row): KnowledgeNode { return { ...row, id: Number(row.id), project_id: Number(row.project_id), ref_id: row.ref_id == null ? null : Number(row.ref_id), x: row.x == null ? null : Number(row.x), y: row.y == null ? null : Number(row.y) } as KnowledgeNode; }
  private edgeFromRow(row: Row): KnowledgeEdge { return { ...row, id: Number(row.id), project_id: Number(row.project_id), source_node_id: Number(row.source_node_id), target_node_id: Number(row.target_node_id) } as KnowledgeEdge; }
  private async getGraph(projectId: number): Promise<KnowledgeGraph> {
    await db.run("UPDATE knowledge_nodes SET title='总纲',updated_at=? WHERE project_id=? AND ref_type='course' AND ref_path='outline.md' AND title IN ('outline.md','outline','项目学习总纲','学习计划总纲')", [now(), projectId]);
    return { nodes: (await db.query<Row>("SELECT * FROM knowledge_nodes WHERE project_id=?", [projectId])).map((row) => this.nodeFromRow(row)), edges: (await db.query<Row>("SELECT * FROM knowledge_edges WHERE project_id=?", [projectId])).map((row) => this.edgeFromRow(row)) };
  }
  private async createNode(projectId: number, payload: any): Promise<KnowledgeNode> {
    if (payload.ref_type && payload.ref_id != null) {
      const existing = (await db.query<Row>("SELECT * FROM knowledge_nodes WHERE project_id=? AND ref_type=? AND ref_id=? ORDER BY id LIMIT 1", [projectId, payload.ref_type, payload.ref_id]))[0];
      if (existing) return this.nodeFromRow(existing);
    } else if (payload.ref_type && payload.ref_path) {
      const existing = (await db.query<Row>("SELECT * FROM knowledge_nodes WHERE project_id=? AND ref_type=? AND ref_path=? ORDER BY id LIMIT 1", [projectId, payload.ref_type, payload.ref_path]))[0];
      if (existing) return this.nodeFromRow(existing);
    }
    const stamp = now(); const id = await db.run("INSERT INTO knowledge_nodes(project_id,node_type,title,ref_type,ref_id,ref_path,summary,x,y,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [projectId, payload.node_type || "manual", payload.title, payload.ref_type || null, payload.ref_id ?? null, payload.ref_path || null, payload.summary || null, payload.x ?? null, payload.y ?? null, stamp, stamp]); return this.nodeFromRow((await db.query<Row>("SELECT * FROM knowledge_nodes WHERE id=?", [id]))[0]);
  }
  private async ensureCourseNode(projectId: number, filename: string, _title: string): Promise<KnowledgeNode> { return this.createNode(projectId, { node_type: "course", title: sourceNodeTitle("course", filename), ref_type: "course", ref_path: filename }); }
  private async ensureSourceNode(projectId: number, payload: QAAskPayload): Promise<KnowledgeNode | null> {
    if (payload.parent_qa_id) { const parent = await this.getQA(projectId, payload.parent_qa_id); return this.createNode(projectId, { node_type: "qa", title: parent.display_title || parent.question, ref_type: "qa", ref_id: parent.id, ref_path: parent.output_path }); }
    if (!payload.source_path) return this.createNode(projectId, { node_type: "manual", title: (await this.getProject(projectId)).name, ref_type: "project", ref_id: projectId });
    if (payload.source_type === "qa") {
      const parent = (await db.query<Row>("SELECT * FROM qa_records WHERE project_id=? AND output_path=?", [projectId, payload.source_path]))[0];
      if (parent) return this.createNode(projectId, { node_type: "qa", title: parent.display_title || parent.question, ref_type: "qa", ref_id: parent.id, ref_path: parent.output_path });
    }
    const type = payload.source_type === "file" ? "file" : "course"; return this.createNode(projectId, { node_type: type, title: sourceNodeTitle(type, payload.source_path), ref_type: type, ref_path: payload.source_path });
  }
  private async updateNode(projectId: number, nodeId: number, payload: any): Promise<KnowledgeNode> { const current = this.nodeFromRow((await db.query<Row>("SELECT * FROM knowledge_nodes WHERE project_id=? AND id=?", [projectId, nodeId]))[0]); await db.run("UPDATE knowledge_nodes SET title=?,summary=?,x=?,y=?,updated_at=? WHERE project_id=? AND id=?", [payload.title ?? current.title, payload.summary ?? current.summary, payload.x ?? current.x, payload.y ?? current.y, now(), projectId, nodeId]); return this.nodeFromRow((await db.query<Row>("SELECT * FROM knowledge_nodes WHERE id=?", [nodeId]))[0]); }
  private async deleteNode(projectId: number, nodeId: number): Promise<any> {
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
  private async createEdge(projectId: number, payload: any): Promise<KnowledgeEdge> { const nodes = await db.query<Row>("SELECT id FROM knowledge_nodes WHERE project_id=? AND id IN (?,?)", [projectId, payload.source_node_id, payload.target_node_id]); if (nodes.length !== 2) throw new Error("连线两端必须属于当前项目。"); const existing = (await db.query<Row>("SELECT * FROM knowledge_edges WHERE project_id=? AND source_node_id=? AND target_node_id=? AND relation_type=?", [projectId, payload.source_node_id, payload.target_node_id, payload.relation_type]))[0]; if (existing) return this.edgeFromRow(existing); const stamp = now(); const id = await db.run("INSERT INTO knowledge_edges(project_id,source_node_id,target_node_id,relation_type,label,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", [projectId, payload.source_node_id, payload.target_node_id, payload.relation_type, payload.label || null, stamp, stamp]); return this.edgeFromRow((await db.query<Row>("SELECT * FROM knowledge_edges WHERE id=?", [id]))[0]); }
  private async updateEdge(projectId: number, edgeId: number, payload: any): Promise<KnowledgeEdge> { const row = (await db.query<Row>("SELECT * FROM knowledge_edges WHERE project_id=? AND id=?", [projectId, edgeId]))[0]; await db.run("UPDATE knowledge_edges SET relation_type=?,label=?,updated_at=? WHERE project_id=? AND id=?", [payload.relation_type ?? row.relation_type, payload.label ?? row.label, now(), projectId, edgeId]); return this.edgeFromRow((await db.query<Row>("SELECT * FROM knowledge_edges WHERE id=?", [edgeId]))[0]); }
  private async listLinks(projectId: number, params: URLSearchParams): Promise<KnowledgeLink[]> { let sql = "SELECT * FROM knowledge_links WHERE project_id=?"; const values: unknown[] = [projectId]; if (params.get("source_type")) { sql += " AND source_type=?"; values.push(params.get("source_type")); } if (params.get("source_path")) { sql += " AND source_path=?"; values.push(params.get("source_path")); } return db.query<Row>(sql, values) as Promise<KnowledgeLink[]>; }
  private async deleteById(table: "highlights" | "knowledge_edges", id: number): Promise<any> { await db.run(`DELETE FROM ${table} WHERE id=?`, [id]); return { deleted: true, id }; }
}
