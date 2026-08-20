import { Directory, Filesystem } from "@capacitor/filesystem";
import { isAndroidRuntime } from "../platform/runtime";

export type SavedArchive = {
  saved: boolean;
  location?: string;
};

function safeFilename(filename: string): string {
  const cleaned = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim();
  return cleaned && cleaned.toLowerCase().endsWith(".zip") ? cleaned : "CodeCourse-data.zip";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 3 * 16_384;
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    let binary = "";
    for (let index = 0; index < chunk.length; index += 1) binary += String.fromCharCode(chunk[index]);
    parts.push(btoa(binary));
  }
  return parts.join("");
}

function downloadInBrowser(filename: string, blob: Blob): SavedArchive {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return { saved: true, location: filename };
}

async function ensureDocumentsPermission(): Promise<void> {
  const current = await Filesystem.checkPermissions();
  if (current.publicStorage === "granted") return;
  const requested = await Filesystem.requestPermissions();
  if (requested.publicStorage !== "granted") {
    throw new Error("需要存储权限才能把数据包保存到文档目录。");
  }
}

export async function saveDataArchive(filename: string, blob: Blob): Promise<SavedArchive> {
  const normalized = safeFilename(filename);
  if (isAndroidRuntime()) {
    await ensureDocumentsPermission();
    const path = `CodeCourse/${normalized}`;
    await Filesystem.writeFile({
      path,
      data: await blobToBase64(blob),
      directory: Directory.Documents,
      recursive: true,
    });
    const result = await Filesystem.getUri({ path, directory: Directory.Documents });
    return { saved: true, location: result.uri || `Documents/${path}` };
  }

  const desktopSave = window.codecourseDesktop?.saveDataArchive;
  if (desktopSave) return desktopSave(normalized, await blob.arrayBuffer());
  return downloadInBrowser(normalized, blob);
}
