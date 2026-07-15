import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import JSZip from "jszip";
import type { TreeNode } from "../../api/client";

const IGNORED_DIRS = new Set([
  ".git", "node_modules", "build", "dist", "target", "__pycache__", ".venv", "venv", ".next", "coverage",
]);
const KEY_FILES = new Set([
  "README.md", "README", "package.json", "pyproject.toml", "requirements.txt", "CMakeLists.txt", "Cargo.toml",
  "go.mod", "Dockerfile", "docker-compose.yml", "docker-compose.yaml", "Makefile",
]);
const MAX_FILES = 5_000;
const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const LANGUAGE_BY_SUFFIX: Record<string, string> = {
  py: "python", js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", json: "json",
  md: "markdown", toml: "toml", yml: "yaml", yaml: "yaml", html: "html", css: "css", scss: "scss",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", rs: "rust", go: "go", java: "java", kt: "kotlin",
  sh: "shell", sql: "sql", vue: "html", svelte: "html", xml: "xml",
};

export type ImportedTextFile = {
  path: string;
  language: string;
  content: string;
  size: number;
  isKeyFile: boolean;
};

export function inferLanguage(path: string): string {
  const name = path.split("/").pop() ?? path;
  if (name === "Dockerfile") return "dockerfile";
  if (name === "Makefile") return "makefile";
  if (name === "CMakeLists.txt") return "cmake";
  return LANGUAGE_BY_SUFFIX[name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""] ?? "plaintext";
}

function normalizeEntryPath(input: string): string {
  const normalized = input.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0") || normalized.split("/").some((part: string) => part === "..")) {
    throw new Error("压缩包包含不安全路径，已停止导入。");
  }
  return normalized;
}

function commonRoot(paths: string[]): string {
  if (!paths.length) return "";
  const first = paths[0].split("/")[0];
  return paths.every((path) => path.startsWith(`${first}/`)) ? `${first}/` : "";
}

function shouldIgnore(path: string): boolean {
  return path.split("/").some((part) => IGNORED_DIRS.has(part)) || path.startsWith(".generated_course/");
}

export async function readZipFiles(data: ArrayBuffer): Promise<ImportedTextFile[]> {
  if (data.byteLength > MAX_ARCHIVE_BYTES) throw new Error("ZIP 文件超过 40 MB，手机版暂不支持导入。");
  const zip = await JSZip.loadAsync(data, { checkCRC32: true, createFolders: false });
  const rawPaths = Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => normalizeEntryPath(entry.name));
  const prefix = commonRoot(rawPaths);
  const candidates = Object.values(zip.files).filter((entry) => !entry.dir);
  if (candidates.length > MAX_FILES) throw new Error(`仓库文件数超过 ${MAX_FILES}，请缩小后再导入。`);
  const declaredSize = candidates.reduce((total, entry) => total + Number((entry as typeof entry & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0), 0);
  if (declaredSize > MAX_TOTAL_BYTES) throw new Error("压缩包声明的解压内容超过 80 MB，已停止导入。");

  let totalBytes = 0;
  const files: ImportedTextFile[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const entry of candidates) {
    const normalized = normalizeEntryPath(entry.name);
    const path = prefix && normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
    if (!path || shouldIgnore(path)) continue;
    const bytes = await entry.async("uint8array");
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("解压后内容超过 80 MB，已停止导入。");
    if (bytes.byteLength > MAX_TEXT_BYTES || bytes.includes(0)) continue;
    let content: string;
    try {
      content = decoder.decode(bytes);
    } catch {
      continue;
    }
    const name = path.split("/").pop() ?? path;
    files.push({ path, content, size: bytes.byteLength, language: inferLanguage(path), isKeyFile: KEY_FILES.has(name) });
  }
  if (!files.length) throw new Error("压缩包中没有可阅读的 UTF-8 文本文件。");
  return files;
}

export function parseGitHubUrl(url: string): { owner: string; repo: string } {
  const match = url.trim().match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!match) throw new Error("手机版第一版仅支持公开 GitHub HTTPS 仓库地址。");
  return { owner: match[1], repo: match[2] };
}

export async function downloadGitHubSnapshot(url: string): Promise<{ files: ImportedTextFile[]; name: string }> {
  const { owner, repo } = parseGitHubUrl(url);
  const metadataResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  const metadata = metadataResponse.ok ? await metadataResponse.json() as { default_branch?: string } : {};
  const branches = [...new Set([metadata.default_branch, "main", "master"].filter((branch): branch is string => Boolean(branch)))];
  let archiveResponse: Response | null = null;
  for (const branch of branches) {
    const encodedBranch = branch.split("/").map(encodeURIComponent).join("/");
    const candidate = await fetch(`https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${encodedBranch}`);
    if (candidate.ok) { archiveResponse = candidate; break; }
  }
  if (!archiveResponse) throw new Error("仓库快照下载失败，请确认仓库公开且地址正确。");
  const declaredLength = Number(archiveResponse.headers.get("content-length") || 0);
  if (declaredLength > MAX_ARCHIVE_BYTES) throw new Error("仓库压缩包超过 40 MB，手机版暂不支持导入。");
  const archive = await archiveResponse.arrayBuffer();
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error("仓库压缩包超过 40 MB，手机版暂不支持导入。");
  return { files: await readZipFiles(archive), name: `${owner}-${repo}` };
}

export function buildTree(projectName: string, files: Array<{ path: string; is_key_file?: number | boolean }>): TreeNode {
  const root: TreeNode = { name: projectName, path: "", type: "directory", children: [], is_key_file: false };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      let child = current.children.find((item) => item.name === part && item.type === (isFile ? "file" : "directory"));
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, index + 1).join("/"),
          type: isFile ? "file" : "directory",
          children: [],
          is_key_file: isFile ? Boolean(file.is_key_file) : false,
        };
        current.children.push(child);
        current.children.sort((a, b) => Number(a.type === "file") - Number(b.type === "file") || a.name.localeCompare(b.name));
      }
      current = child;
    });
  }
  return root;
}

export async function writeRepoFile(projectId: number, path: string, content: string): Promise<void> {
  await Filesystem.writeFile({
    path: `codecourse/projects/${projectId}/repo/${normalizeEntryPath(path)}`,
    data: content,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  });
}

export async function readRepoFile(projectId: number, path: string): Promise<string> {
  const result = await Filesystem.readFile({
    path: `codecourse/projects/${projectId}/repo/${normalizeEntryPath(path)}`,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
  });
  return String(result.data);
}

export async function writeGeneratedFile(projectId: number, filename: string, content: string): Promise<void> {
  await Filesystem.writeFile({
    path: `codecourse/generated/${projectId}/${normalizeEntryPath(filename)}`,
    data: content,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  });
}

export async function writeGeneratedFileAtomic(projectId: number, filename: string, content: string): Promise<void> {
  const safeFilename = normalizeEntryPath(filename);
  const target = `codecourse/generated/${projectId}/${safeFilename}`;
  const temporary = `${target}.tmp-${Date.now()}`;
  const backup = `${target}.bak-${Date.now()}`;
  let hasBackup = false;

  await Filesystem.writeFile({
    path: temporary,
    data: content,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  });

  try {
    await Filesystem.rename({ from: target, to: backup, directory: Directory.Data });
    hasBackup = true;
  } catch {
    // A newly generated course has no previous file to preserve.
  }

  try {
    await Filesystem.rename({ from: temporary, to: target, directory: Directory.Data });
    if (hasBackup) {
      await Filesystem.deleteFile({ path: backup, directory: Directory.Data }).catch(() => undefined);
    }
  } catch (error) {
    if (hasBackup) {
      await Filesystem.rename({ from: backup, to: target, directory: Directory.Data }).catch(() => undefined);
    }
    await Filesystem.deleteFile({ path: temporary, directory: Directory.Data }).catch(() => undefined);
    throw error;
  }
}

export async function readGeneratedFile(projectId: number, filename: string): Promise<string> {
  const result = await Filesystem.readFile({
    path: `codecourse/generated/${projectId}/${normalizeEntryPath(filename)}`,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
  });
  return String(result.data);
}

export async function removeGeneratedFile(projectId: number, filename: string): Promise<void> {
  await Filesystem.deleteFile({ path: `codecourse/generated/${projectId}/${normalizeEntryPath(filename)}`, directory: Directory.Data }).catch(() => undefined);
}

export async function removeProjectFiles(projectId: number): Promise<void> {
  await Filesystem.rmdir({ path: `codecourse/projects/${projectId}`, directory: Directory.Data, recursive: true }).catch(() => undefined);
  await Filesystem.rmdir({ path: `codecourse/generated/${projectId}`, directory: Directory.Data, recursive: true }).catch(() => undefined);
}
