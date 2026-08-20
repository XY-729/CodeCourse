import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import JSZip from "jszip";
import {
  DATA_ARCHIVE_FORMAT,
  DATA_ARCHIVE_VERSION,
  MAX_DATA_ARCHIVE_BYTES,
  MAX_DATA_ARCHIVE_FILES,
  MAX_DATA_EXTRACTED_BYTES,
  PORTABLE_TABLES,
  normalizeDataArchivePath,
  portableArchiveFilename,
  validateDataArchiveDatabase,
  validateDataArchiveManifest,
  validateDataArchiveProjectIds,
  type DataArchiveDatabase,
  type DataArchiveImportResult,
  type DataArchiveManifest,
  type DataArchiveProject,
  type PortableTable,
  type PortableTableName,
  type PortableValue,
} from "../../dataTransfer/archive";
import { MobileDatabase } from "./database";
import { readGeneratedFile, readRepoFile } from "./workspace";

type Row = Record<string, unknown>;
type ExtractedFile = { archivePath: string; data: string };

const SECRET_SETTING_MARKERS = ["api_key", "access_token", "password", "secret"];
const encoder = new TextEncoder();

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function isSecretSetting(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_SETTING_MARKERS.some((marker) => lower.includes(marker));
}

async function tableExists(db: MobileDatabase, table: string): Promise<boolean> {
  const rows = await db.query<Row>("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", [table]);
  return rows.length > 0;
}

async function tableColumns(db: MobileDatabase, table: string): Promise<string[]> {
  return (await db.query<Row>(`PRAGMA table_info(${quoteIdentifier(table)})`)).map((row) => String(row.name));
}

async function exportTable(db: MobileDatabase, table: PortableTableName): Promise<PortableTable | null> {
  if (!(await tableExists(db, table))) return null;
  const columns = await tableColumns(db, table);
  if (!columns.length) return null;
  const selected = columns.map(quoteIdentifier).join(",");
  const rows = await db.query<Row>(`SELECT ${selected} FROM ${quoteIdentifier(table)}`);
  return {
    columns,
    rows: rows.map((row) => columns.map((column) => {
      const value = row[column];
      if (value == null) return null;
      return typeof value === "number" ? value : String(value);
    })),
  };
}

async function portableSettings(db: MobileDatabase): Promise<Record<string, string>> {
  const settings: Record<string, string> = {};
  for (const row of await db.query<Row>("SELECT key,value FROM settings")) {
    const key = String(row.key);
    if (!isSecretSetting(key)) settings[key] = String(row.value);
  }
  let llm: Record<string, unknown> = {};
  try {
    llm = JSON.parse(settings["llm.config"] || "{}") as Record<string, unknown>;
  } catch {
    llm = {};
  }
  settings["llm.config"] = JSON.stringify({
    provider: llm.provider || "deepseek",
    base_url: llm.base_url || "https://api.deepseek.com",
    model: llm.model || "deepseek-chat",
    enabled: false,
  });
  return settings;
}

async function synthesizeQASessions(db: MobileDatabase): Promise<PortableTable | null> {
  const rows = await db.query<Row>(
    `SELECT session_id AS id, project_id,
            COALESCE(MAX(display_title), '迁移的问答') AS title,
            '' AS memory_summary,
            MAX(source_path) AS active_source_path,
            MIN(created_at) AS created_at,
            MAX(updated_at) AS updated_at
       FROM qa_records
      WHERE session_id IS NOT NULL
      GROUP BY project_id,session_id`,
  );
  if (!rows.length) return null;
  const columns = ["id", "project_id", "title", "memory_summary", "active_source_path", "created_at", "updated_at"];
  return {
    columns,
    rows: rows.map((row) => columns.map((column) => row[column] == null ? null : typeof row[column] === "number" ? row[column] as number : String(row[column]))),
  };
}

function ensurePortableSize(fileCount: number, bytes: number) {
  if (fileCount > MAX_DATA_ARCHIVE_FILES || bytes > MAX_DATA_EXTRACTED_BYTES) {
    throw new Error("项目数据超过可迁移上限（10000 个文件或 300 MB）。");
  }
}

export async function exportAndroidDataArchive(db: MobileDatabase): Promise<{ blob: Blob; filename: string }> {
  await db.init();
  const active = await db.query<Row>("SELECT 1 AS active FROM generation_tasks WHERE status IN ('queued','running') LIMIT 1");
  if (active.length) throw new Error("仍有内容正在生成，请完成后再导出数据。");

  const tables: DataArchiveDatabase["tables"] = {};
  for (const table of PORTABLE_TABLES) {
    const snapshot = table === "qa_sessions" ? await synthesizeQASessions(db) : await exportTable(db, table);
    if (snapshot) tables[table] = snapshot;
  }

  const zip = new JSZip();
  const projects: DataArchiveProject[] = [];
  let fileCount = 0;
  let totalBytes = 0;
  const projectRows = await db.query<Row>("SELECT id,name,project_type FROM projects ORDER BY id");
  for (const projectRow of projectRows) {
    const projectId = Number(projectRow.id);
    const sourceFiles: DataArchiveProject["source_files"] = [];
    const sourceRows = await db.query<Row>(
      "SELECT path,language,size,is_key_file FROM project_files WHERE project_id=? ORDER BY path",
      [projectId],
    );
    for (const file of sourceRows) {
      const path = normalizeDataArchivePath(String(file.path));
      const content = await readRepoFile(projectId, path);
      const size = encoder.encode(content).byteLength;
      fileCount += 1;
      totalBytes += size;
      ensurePortableSize(fileCount, totalBytes);
      zip.file(`projects/${projectId}/repo/${path}`, content);
      sourceFiles.push({
        path,
        size,
        language: String(file.language || "plaintext"),
        is_key_file: Boolean(file.is_key_file),
      });
    }

    const courseFiles: DataArchiveProject["course_files"] = [];
    const courseRows = await db.query<Row>(
      "SELECT filename,title,group_name FROM course_files WHERE project_id=? ORDER BY filename",
      [projectId],
    );
    for (const file of courseRows) {
      const filename = normalizeDataArchivePath(String(file.filename));
      const content = await readGeneratedFile(projectId, filename);
      const size = encoder.encode(content).byteLength;
      fileCount += 1;
      totalBytes += size;
      ensurePortableSize(fileCount, totalBytes);
      zip.file(`projects/${projectId}/generated/${filename}`, content);
      courseFiles.push({
        filename,
        size,
        title: String(file.title || filename),
        group: String(file.group_name || "课程"),
      });
    }

    projects.push({
      id: projectId,
      name: String(projectRow.name),
      project_type: projectRow.project_type === "learning_plan" ? "learning_plan" : "repository",
      source_files: sourceFiles,
      course_files: courseFiles,
    });
  }

  const manifest: DataArchiveManifest = {
    format: DATA_ARCHIVE_FORMAT,
    version: DATA_ARCHIVE_VERSION,
    exported_at: new Date().toISOString(),
    source_platform: "android",
    secrets_included: false,
    project_count: projects.length,
    file_count: fileCount,
    projects,
  };
  zip.file("manifest.json", JSON.stringify(manifest));
  zip.file("database.json", JSON.stringify({ settings: await portableSettings(db), tables } satisfies DataArchiveDatabase));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (blob.size > MAX_DATA_ARCHIVE_BYTES) throw new Error("生成的数据包超过手机版 160 MB 上限。");
  return { blob, filename: portableArchiveFilename() };
}

function declaredUncompressedSize(entry: JSZip.JSZipObject): number {
  return Number((entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0);
}

async function parseAndroidArchive(blob: Blob): Promise<{
  zip: JSZip;
  manifest: DataArchiveManifest;
  database: DataArchiveDatabase;
  files: ExtractedFile[];
}> {
  if (!blob.size || blob.size > MAX_DATA_ARCHIVE_BYTES) throw new Error("CodeCourse 数据包为空或超过 160 MB。");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await blob.arrayBuffer(), { checkCRC32: true, createFolders: false });
  } catch {
    throw new Error("文件不是有效的 CodeCourse ZIP 数据包。");
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > MAX_DATA_ARCHIVE_FILES + 2) throw new Error("数据包文件数量超过 10000 个。");
  let totalBytes = 0;
  for (const entry of entries) {
    normalizeDataArchivePath(entry.name);
    totalBytes += declaredUncompressedSize(entry);
    if (totalBytes > MAX_DATA_EXTRACTED_BYTES) throw new Error("数据包解压后超过 300 MB。");
  }
  const manifestEntry = zip.file("manifest.json");
  const databaseEntry = zip.file("database.json");
  if (!manifestEntry || !databaseEntry) throw new Error("数据包缺少清单或数据库快照。");
  let manifest: DataArchiveManifest;
  let database: DataArchiveDatabase;
  try {
    manifest = validateDataArchiveManifest(JSON.parse(await manifestEntry.async("string")));
    database = validateDataArchiveDatabase(JSON.parse(await databaseEntry.async("string")));
    validateDataArchiveProjectIds(manifest, database);
  } catch (error) {
    throw error instanceof Error ? error : new Error("数据包内容无效。");
  }

  const expected = new Set(["manifest.json", "database.json"]);
  const declaredSizes = new Map<string, number>();
  for (const project of manifest.projects) {
    project.source_files.forEach((file) => {
      const path = `projects/${project.id}/repo/${normalizeDataArchivePath(file.path)}`;
      if (expected.has(path)) throw new Error("数据包包含重复文件记录。");
      expected.add(path);
      declaredSizes.set(path, file.size);
    });
    project.course_files.forEach((file) => {
      const path = `projects/${project.id}/generated/${normalizeDataArchivePath(file.filename)}`;
      if (expected.has(path)) throw new Error("数据包包含重复文件记录。");
      expected.add(path);
      declaredSizes.set(path, file.size);
    });
  }
  for (const entry of entries) {
    if (!expected.has(entry.name)) throw new Error("数据包包含未声明文件，已停止导入。");
  }
  if ([...expected].some((path) => !zip.file(path))) throw new Error("数据包缺少清单中声明的文件。");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files: ExtractedFile[] = [];
  let extractedBytes = 0;
  for (const path of expected) {
    if (path === "manifest.json" || path === "database.json") continue;
    const bytes = await zip.file(path)!.async("uint8array");
    extractedBytes += bytes.byteLength;
    if (extractedBytes > MAX_DATA_EXTRACTED_BYTES) throw new Error("数据包实际内容超过安全上限。");
    if (bytes.byteLength !== declaredSizes.get(path)) throw new Error(`数据包文件大小与清单不一致：${path}`);
    try {
      files.push({ archivePath: path, data: decoder.decode(bytes) });
    } catch {
      throw new Error(`数据包文件不是 UTF-8 文本：${path}`);
    }
  }
  return { zip, manifest, database, files };
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const info = await Filesystem.stat({ path, directory: Directory.Data });
    return info.type === "directory";
  } catch {
    return false;
  }
}

async function backupDirectory(from: string, to: string): Promise<boolean> {
  if (!(await directoryExists(from))) return false;
  await Filesystem.rename({ from, to, directory: Directory.Data });
  return true;
}

async function installDirectory(from: string, to: string): Promise<void> {
  await Filesystem.rename({ from, to, directory: Directory.Data });
}

async function removeDirectory(path: string, ignoreErrors = true): Promise<void> {
  try {
    if (!(await directoryExists(path))) return;
    await Filesystem.rmdir({ path, directory: Directory.Data, recursive: true });
  } catch (error) {
    if (!ignoreErrors) throw error;
  }
}

async function restoreDirectory(target: string, backup: string, hadTarget: boolean): Promise<void> {
  await removeDirectory(target, false);
  if (hadTarget) {
    await installDirectory(backup, target);
  }
}

async function restoreBothDirectories(
  projectsBackup: string,
  generatedBackup: string,
  hadProjects: boolean,
  hadGenerated: boolean,
): Promise<void> {
  const failures = await Promise.allSettled([
    restoreDirectory("codecourse/projects", projectsBackup, hadProjects),
    restoreDirectory("codecourse/generated", generatedBackup, hadGenerated),
  ]);
  const rejected = failures.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (rejected) throw rejected.reason;
}

async function replaceAndroidDirectories(
  stageRoot: string,
  projectsBackup: string,
  generatedBackup: string,
): Promise<{ hadProjects: boolean; hadGenerated: boolean }> {
  let hadProjects = false;
  let hadGenerated = false;
  let projectsChanged = false;
  let generatedChanged = false;
  try {
    hadProjects = await backupDirectory("codecourse/projects", projectsBackup);
    projectsChanged = hadProjects;
    hadGenerated = await backupDirectory("codecourse/generated", generatedBackup);
    generatedChanged = hadGenerated;
    await installDirectory(`${stageRoot}/projects`, "codecourse/projects");
    projectsChanged = true;
    await installDirectory(`${stageRoot}/generated`, "codecourse/generated");
    generatedChanged = true;
    return { hadProjects, hadGenerated };
  } catch (error) {
    const restores: Promise<void>[] = [];
    if (projectsChanged) restores.push(restoreDirectory("codecourse/projects", projectsBackup, hadProjects));
    if (generatedChanged) restores.push(restoreDirectory("codecourse/generated", generatedBackup, hadGenerated));
    const failures = await Promise.allSettled(restores);
    if (failures.some((result) => result.status === "rejected")) {
      throw new Error("无法替换且无法完整还原 Android 项目文件。请保留原数据包并停止继续操作。");
    }
    throw error;
  }
}

async function cleanupBackupDirectories(projectsBackup: string, generatedBackup: string): Promise<void> {
  await Promise.all([
    removeDirectory(projectsBackup),
    removeDirectory(generatedBackup),
  ]);
}

async function rollbackImportedDirectories(
  projectsBackup: string,
  generatedBackup: string,
  hadProjects: boolean,
  hadGenerated: boolean,
): Promise<void> {
  try {
    await restoreBothDirectories(projectsBackup, generatedBackup, hadProjects, hadGenerated);
  } catch {
    throw new Error("数据库恢复失败，且无法还原导入前的 Android 项目文件。请勿继续使用并从原数据包重试。");
  }
}

function normalizeImportedTaskRows(table: string, snapshot: PortableTable): PortableValue[][] {
  if (table !== "generation_tasks") return snapshot.rows;
  const statusIndex = snapshot.columns.indexOf("status");
  const errorIndex = snapshot.columns.indexOf("error_message");
  const stageIndex = snapshot.columns.indexOf("stage_label");
  if (statusIndex < 0) return snapshot.rows;
  return snapshot.rows.map((original) => {
    const row = [...original];
    if (row[statusIndex] === "queued" || row[statusIndex] === "running") {
      row[statusIndex] = "failed";
      if (errorIndex >= 0) row[errorIndex] = "设备迁移中断了未完成任务，请手动重试。";
      if (stageIndex >= 0) row[stageIndex] = "迁移后待重试";
    }
    return row;
  });
}

async function insertSnapshotTable(db: MobileDatabase, table: PortableTableName, snapshot: PortableTable): Promise<void> {
  if (!(await tableExists(db, table))) return;
  const targetColumns = new Set(await tableColumns(db, table));
  const selected = snapshot.columns.filter((column) => targetColumns.has(column));
  if (!selected.length || !snapshot.rows.length) return;
  const indexes = selected.map((column) => snapshot.columns.indexOf(column));
  const rows = normalizeImportedTaskRows(table, snapshot).map((row) => indexes.map((index) => row[index]));
  const columnsSql = selected.map(quoteIdentifier).join(",");
  const placeholders = selected.map(() => "?").join(",");
  await db.runSetInTx(
    `INSERT INTO ${quoteIdentifier(table)} (${columnsSql}) VALUES (${placeholders})`,
    rows,
  );
}

async function replaceAndroidDatabase(
  db: MobileDatabase,
  manifest: DataArchiveManifest,
  database: DataArchiveDatabase,
): Promise<void> {
  await db.setForeignKeys(false);
  try {
    await db.transaction(async () => {
      const tables = await db.queryInTx<Row>("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
      for (const row of tables) {
        const name = String(row.name);
        const sql = String(row.sql || "").toUpperCase();
        if (name === "settings" || sql.includes("VIRTUAL TABLE") || name.startsWith("code_chunks_fts")) continue;
        await db.runInTx(`DELETE FROM ${quoteIdentifier(name)}`);
      }
      if (await tableExists(db, "code_chunks_fts")) {
        await db.runInTx("DELETE FROM code_chunks_fts").catch(() => 0);
      }
      await db.runInTx("DELETE FROM settings");
      const portableSettings = Object.entries(database.settings)
        .filter(([key]) => !isSecretSetting(key))
        .map(([key, value]) => [key, value] as PortableValue[]);
      const llmIndex = portableSettings.findIndex(([key]) => key === "llm.config");
      if (llmIndex >= 0) {
        try {
          const config = JSON.parse(String(portableSettings[llmIndex][1])) as Record<string, unknown>;
          portableSettings[llmIndex][1] = JSON.stringify({ ...config, enabled: false });
        } catch {
          portableSettings.splice(llmIndex, 1);
        }
      }
      if (portableSettings.length) await db.runSetInTx("INSERT INTO settings(key,value) VALUES(?,?)", portableSettings);

      for (const table of PORTABLE_TABLES) {
        const snapshot = database.tables[table];
        if (snapshot) await insertSnapshotTable(db, table, snapshot);
      }

      const sourceMetadata: PortableValue[][] = [];
      const courseMetadata: PortableValue[][] = [];
      const stamp = new Date().toISOString();
      for (const project of manifest.projects) {
        for (const file of project.source_files) {
          sourceMetadata.push([project.id, file.path, file.language, file.size, file.is_key_file ? 1 : 0]);
        }
        for (const file of project.course_files) {
          courseMetadata.push([project.id, file.filename, file.title, file.group, stamp]);
        }
      }
      if (sourceMetadata.length) {
        await db.runSetInTx(
          "INSERT INTO project_files(project_id,path,language,size,is_key_file) VALUES(?,?,?,?,?)",
          sourceMetadata,
        );
      }
      if (courseMetadata.length) {
        await db.runSetInTx(
          "INSERT INTO course_files(project_id,filename,title,group_name,updated_at) VALUES(?,?,?,?,?)",
          courseMetadata,
        );
      }
    });
  } finally {
    await db.setForeignKeys(true);
  }
}

export async function importAndroidDataArchive(db: MobileDatabase, blob: Blob): Promise<DataArchiveImportResult> {
  await db.init();
  const active = await db.query<Row>("SELECT 1 AS active FROM generation_tasks WHERE status IN ('queued','running') LIMIT 1");
  if (active.length) throw new Error("仍有内容正在生成，请完成后再导入数据。");
  const { manifest, database, files } = await parseAndroidArchive(blob);

  const token = crypto.randomUUID().replaceAll("-", "");
  const stageRoot = `codecourse/.data-transfer-stage-${token}`;
  const projectsBackup = `codecourse/.data-transfer-projects-backup-${token}`;
  const generatedBackup = `codecourse/.data-transfer-generated-backup-${token}`;
  await Filesystem.mkdir({ path: `${stageRoot}/projects`, directory: Directory.Data, recursive: true });
  await Filesystem.mkdir({ path: `${stageRoot}/generated`, directory: Directory.Data, recursive: true });
  try {
    for (const file of files) {
      const match = file.archivePath.match(/^projects\/(\d+)\/(repo|generated)\/(.+)$/);
      if (!match) throw new Error("数据包文件路径无效。");
      const folder = match[2] === "repo" ? `projects/${match[1]}/repo` : `generated/${match[1]}`;
      await Filesystem.writeFile({
        path: `${stageRoot}/${folder}/${normalizeDataArchivePath(match[3])}`,
        data: file.data,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    }

    const { hadProjects, hadGenerated } = await replaceAndroidDirectories(
      stageRoot,
      projectsBackup,
      generatedBackup,
    );
    try {
      await replaceAndroidDatabase(db, manifest, database);
    } catch (error) {
      await rollbackImportedDirectories(projectsBackup, generatedBackup, hadProjects, hadGenerated);
      throw error;
    }
    await cleanupBackupDirectories(projectsBackup, generatedBackup);
  } finally {
    await removeDirectory(stageRoot);
  }

  return {
    imported: true,
    project_count: manifest.projects.length,
    file_count: manifest.file_count,
    message: `已恢复 ${manifest.projects.length} 个项目，CodeCourse 将重新加载。`,
  };
}
