import { describe, expect, it } from "vitest";
import {
  DATA_ARCHIVE_FORMAT,
  DATA_ARCHIVE_VERSION,
  normalizeDataArchivePath,
  portableArchiveFilename,
  validateDataArchiveDatabase,
  validateDataArchiveManifest,
  validateDataArchiveProjectIds,
  type DataArchiveDatabase,
  type DataArchiveManifest,
} from "./archive";

function fixture(): { manifest: DataArchiveManifest; database: DataArchiveDatabase } {
  return {
    manifest: {
      format: DATA_ARCHIVE_FORMAT,
      version: DATA_ARCHIVE_VERSION,
      exported_at: "2026-08-20T12:00:00.000Z",
      source_platform: "desktop",
      secrets_included: false,
      project_count: 1,
      file_count: 2,
      projects: [{
        id: 7,
        name: "Portable",
        project_type: "repository",
        source_files: [{ path: "src/main.ts", size: 12, language: "typescript", is_key_file: true }],
        course_files: [{ filename: "outline.md", size: 20, title: "总纲", group: "总纲" }],
      }],
    },
    database: {
      settings: { "reader.font_size": "18" },
      tables: { projects: { columns: ["id", "name"], rows: [[7, "Portable"]] } },
    },
  };
}

describe("CodeCourse data archive contract", () => {
  it("validates matching manifests and logical database snapshots", () => {
    const { manifest, database } = fixture();
    const parsedManifest = validateDataArchiveManifest(manifest);
    const parsedDatabase = validateDataArchiveDatabase(database);
    expect(() => validateDataArchiveProjectIds(parsedManifest, parsedDatabase)).not.toThrow();
  });

  it("rejects unsafe paths and mismatched project identities", () => {
    expect(() => normalizeDataArchivePath("../secret.txt")).toThrow(/不安全路径/);
    expect(() => normalizeDataArchivePath("src\\main.ts")).toThrow(/无效路径/);
    const { manifest, database } = fixture();
    database.tables.projects!.rows[0][0] = 8;
    expect(() => validateDataArchiveProjectIds(manifest, database)).toThrow(/不一致/);
  });

  it("rejects archives that claim to include secrets or lie about counts", () => {
    const { manifest } = fixture();
    expect(() => validateDataArchiveManifest({ ...manifest, secrets_included: true })).toThrow(/敏感凭据/);
    expect(() => validateDataArchiveManifest({ ...manifest, file_count: 3 })).toThrow(/文件数量/);
  });

  it("uses a portable timestamped zip filename", () => {
    expect(portableArchiveFilename(new Date("2026-08-20T12:34:56.000Z"))).toBe("CodeCourse-data-20260820-123456Z.zip");
  });
});
