import JSZip from "jszip";
import { DATA_ARCHIVE_FORMAT, MAX_DATA_ARCHIVE_BYTES, validateDataArchiveManifest, type DataArchiveManifest } from "./archive";

/** Classify by the embedded format, never by the selected file's name. */
export async function dataArchiveManifest(zip: JSZip): Promise<DataArchiveManifest | null> {
  const entry = zip.file("manifest.json");
  if (!entry) return null;
  const declaredSize = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0;
  if (declaredSize > 4 * 1024 * 1024) throw new Error("压缩包清单超过安全上限。");
  let value: unknown;
  try { value = JSON.parse(await entry.async("string")); }
  catch {
    if (zip.file("database.json")) throw new Error("CodeCourse 数据包清单已损坏，未导入任何项目。");
    return null;
  }
  if (!value || typeof value !== "object" || !("format" in value) || value.format !== DATA_ARCHIVE_FORMAT) return null;
  return validateDataArchiveManifest(value);
}

export async function inspectDataArchive(file: Blob): Promise<DataArchiveManifest | null> {
  if (file.size > MAX_DATA_ARCHIVE_BYTES) throw new Error("ZIP 文件超过 160 MB，无法导入。");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(await file.arrayBuffer(), { createFolders: false }); }
  catch { throw new Error("文件不是有效的 ZIP 压缩包。"); }
  return dataArchiveManifest(zip);
}

export async function routeArchiveImport(file: File, handlers: {
  data: (manifest: DataArchiveManifest) => Promise<void>;
  project: () => Promise<void>;
}): Promise<void> {
  const manifest = await inspectDataArchive(file);
  if (manifest) await handlers.data(manifest);
  else await handlers.project();
}
