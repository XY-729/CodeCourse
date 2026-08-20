export const DATA_ARCHIVE_FORMAT = "codecourse-data-archive";
export const DATA_ARCHIVE_VERSION = 1;
export const MAX_DATA_ARCHIVE_BYTES = 160 * 1024 * 1024;
export const MAX_DATA_EXTRACTED_BYTES = 300 * 1024 * 1024;
export const MAX_DATA_ARCHIVE_FILES = 10_000;

export const PORTABLE_TABLES = [
  "projects",
  "qa_sessions",
  "prompt_revisions",
  "concepts",
  "qa_records",
  "teaching_handoffs",
  "generation_tasks",
  "highlights",
  "knowledge_nodes",
  "knowledge_edges",
  "knowledge_links",
  "document_terms",
  "learning_anchors",
  "learning_states",
  "concept_mastery",
  "learning_events",
  "learner_preferences",
  "preference_events",
  "term_impressions",
  "concept_relations",
  "learner_inferences",
  "domain_profiles",
  "concept_explanations",
  "survey_candidates",
  "model_call_audit",
  "term_model_scans",
  "learning_evidence_v2",
  "knowledge_states_v2",
  "diagnostic_items",
  "diagnostic_attempts",
  "observer_jobs",
  "teaching_trials",
  "teaching_outcomes",
] as const;

export type PortableTableName = (typeof PORTABLE_TABLES)[number];
export type PortableValue = string | number | null;

export type PortableTable = {
  columns: string[];
  rows: PortableValue[][];
};

export type DataArchiveSourceFile = {
  path: string;
  size: number;
  language: string;
  is_key_file: boolean;
};

export type DataArchiveCourseFile = {
  filename: string;
  size: number;
  title: string;
  group: string;
};

export type DataArchiveProject = {
  id: number;
  name: string;
  project_type: "repository" | "learning_plan";
  source_files: DataArchiveSourceFile[];
  course_files: DataArchiveCourseFile[];
};

export type DataArchiveManifest = {
  format: typeof DATA_ARCHIVE_FORMAT;
  version: typeof DATA_ARCHIVE_VERSION;
  exported_at: string;
  source_platform: "desktop" | "android";
  secrets_included: false;
  project_count: number;
  file_count: number;
  projects: DataArchiveProject[];
};

export type DataArchiveDatabase = {
  settings: Record<string, string>;
  tables: Partial<Record<PortableTableName, PortableTable>>;
};

export type DataArchiveImportResult = {
  imported: true;
  project_count: number;
  file_count: number;
  message: string;
};

const portableTableNames = new Set<string>(PORTABLE_TABLES);

export function normalizeDataArchivePath(value: unknown): string {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\")) {
    throw new Error("数据包包含无效路径。");
  }
  const normalized = value.replace(/^\.\//, "").replace(/^\/+/, "");
  if (!normalized || normalized !== value || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("数据包包含不安全路径。");
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateFileList(value: unknown, pathKey: "path" | "filename"): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error("数据包文件清单无效。");
  for (const entry of value) {
    if (!isRecord(entry)) throw new Error("数据包文件记录无效。");
    normalizeDataArchivePath(entry[pathKey]);
    if (typeof entry.size !== "number" || !Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error("数据包文件大小无效。");
    }
  }
  return value;
}

export function validateDataArchiveManifest(value: unknown): DataArchiveManifest {
  if (!isRecord(value) || value.format !== DATA_ARCHIVE_FORMAT) throw new Error("这不是 CodeCourse 数据包。");
  if (value.version !== DATA_ARCHIVE_VERSION) throw new Error("数据包版本暂不受支持，请升级 CodeCourse。");
  if (value.secrets_included !== false) throw new Error("数据包声明包含敏感凭据，已拒绝导入。");
  if (value.source_platform !== "desktop" && value.source_platform !== "android") throw new Error("数据包来源平台无效。");
  if (!Array.isArray(value.projects)) throw new Error("数据包项目清单无效。");
  if (value.project_count !== value.projects.length) throw new Error("数据包项目数量与清单不一致。");
  const projectIds = new Set<number>();
  let fileCount = 0;
  for (const project of value.projects) {
    if (
      !isRecord(project)
      || !Number.isInteger(project.id)
      || Number(project.id) <= 0
      || typeof project.name !== "string"
      || (project.project_type !== "repository" && project.project_type !== "learning_plan")
    ) {
      throw new Error("数据包包含无效项目。");
    }
    const projectId = Number(project.id);
    if (projectIds.has(projectId)) throw new Error("数据包包含重复项目编号。");
    projectIds.add(projectId);
    fileCount += validateFileList(project.source_files, "path").length;
    fileCount += validateFileList(project.course_files, "filename").length;
  }
  if (value.file_count !== fileCount) throw new Error("数据包文件数量与清单不一致。");
  return value as DataArchiveManifest;
}

export function validateDataArchiveDatabase(value: unknown): DataArchiveDatabase {
  if (!isRecord(value) || !isRecord(value.settings) || !isRecord(value.tables)) {
    throw new Error("数据包数据库结构无效。");
  }
  const tables: Partial<Record<PortableTableName, PortableTable>> = {};
  for (const [name, rawTable] of Object.entries(value.tables)) {
    if (!portableTableNames.has(name)) continue;
    if (!isRecord(rawTable) || !Array.isArray(rawTable.columns) || !rawTable.columns.length || !Array.isArray(rawTable.rows)) {
      throw new Error(`数据表 ${name} 的内容无效。`);
    }
    const columns = rawTable.columns;
    if (!columns.every((column) => typeof column === "string") || new Set(columns).size !== columns.length) {
      throw new Error(`数据表 ${name} 的列定义无效。`);
    }
    for (const row of rawTable.rows) {
      if (!Array.isArray(row) || row.length !== columns.length) throw new Error(`数据表 ${name} 存在损坏记录。`);
      if (!row.every((entry) => entry === null || typeof entry === "string" || typeof entry === "number")) {
        throw new Error(`数据表 ${name} 包含不支持的字段。`);
      }
    }
    tables[name as PortableTableName] = rawTable as unknown as PortableTable;
  }
  if (!tables.projects) throw new Error("数据包缺少项目数据。");
  const settings = Object.fromEntries(
    Object.entries(value.settings).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return { settings, tables };
}

export function validateDataArchiveProjectIds(
  manifest: DataArchiveManifest,
  database: DataArchiveDatabase,
): void {
  const projects = database.tables.projects;
  if (!projects) throw new Error("数据包缺少项目数据。");
  const idIndex = projects.columns.indexOf("id");
  if (idIndex < 0) throw new Error("数据包项目表缺少编号。");
  const databaseIds = new Set<number>();
  for (const row of projects.rows) {
    const projectId = row[idIndex];
    if (typeof projectId !== "number" || !Number.isInteger(projectId) || projectId <= 0 || databaseIds.has(projectId)) {
      throw new Error("数据包项目表包含无效编号。");
    }
    databaseIds.add(projectId);
  }
  const manifestIds = new Set(manifest.projects.map((project) => project.id));
  if (databaseIds.size !== manifestIds.size || [...databaseIds].some((id) => !manifestIds.has(id))) {
    throw new Error("数据包清单与项目数据库不一致。");
  }
}

export function portableArchiveFilename(date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
  return `CodeCourse-data-${stamp}.zip`;
}
