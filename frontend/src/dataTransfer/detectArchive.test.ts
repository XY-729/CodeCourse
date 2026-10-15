// @vitest-environment node
import JSZip from "jszip";
import { expect, it, vi } from "vitest";
import { DATA_ARCHIVE_FORMAT } from "./archive";
import { routeArchiveImport } from "./detectArchive";
import { readZipFiles } from "../platform/android/workspace";

async function zipFile(manifest?: unknown): Promise<File> {
  const zip = new JSZip();
  if (manifest) { zip.file("manifest.json", JSON.stringify(manifest)); zip.file("database.json", "{}"); }
  zip.file("projects/11/generated/lesson.md", "# 课件\n\n**正文**");
  return new File([await zip.generateAsync({ type: "arraybuffer" })], "renamed.zip");
}
const manifest = { format: DATA_ARCHIVE_FORMAT, version: 1, secrets_included: false, source_platform: "desktop", project_count: 2, file_count: 1, projects: [
  { id: 11, name: "项目一", project_type: "repository", source_files: [], course_files: [{ filename: "lesson.md", size: 1 }] },
  { id: 12, name: "项目二", project_type: "learning_plan", source_files: [], course_files: [] },
] };

it("routes renamed desktop data archives to a multiple-project restore instead of source import", async () => {
  const data = vi.fn(), project = vi.fn();
  await routeArchiveImport(await zipFile(manifest), { data, project });
  expect(data).toHaveBeenCalledWith(expect.objectContaining({ project_count: 2 }));
  expect(project).not.toHaveBeenCalled();
});

it("rejects invalid CodeCourse manifests without falling back to one source project", async () => {
  const data = vi.fn(), project = vi.fn();
  await expect(routeArchiveImport(await zipFile({ ...manifest, project_count: 1 }), { data, project })).rejects.toThrow("项目数量");
  expect(data).not.toHaveBeenCalled(); expect(project).not.toHaveBeenCalled();
});

it("still imports ordinary repository ZIP files through the source path", async () => {
  const data = vi.fn(), project = vi.fn();
  await routeArchiveImport(await zipFile({ name: "ordinary package manifest" }), { data, project });
  expect(project).toHaveBeenCalledTimes(1); expect(data).not.toHaveBeenCalled();
});

it("blocks bypassing the UI and flattening a backup through the Android source reader", async () => {
  const file = await zipFile(manifest);
  await expect(readZipFiles(await file.arrayBuffer())).rejects.toThrow("按原项目恢复");
});
