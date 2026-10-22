import { describe, expect, it } from "vitest";
import {
  DATA_ARCHIVE_FORMAT,
  DATA_ARCHIVE_VERSION,
  PORTABLE_TABLES,
  normalizeDataArchivePath,
  portableArchiveFilename,
  sanitizePortableSettings,
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

  it("carries the authoritative concept forest instead of the old document graph", () => {
    // Both desktop and Android forest tables travel so a restore keeps the same
    // concepts, parents and plan roots instead of rebuilding them.
    expect(PORTABLE_TABLES).toEqual(expect.arrayContaining([
      "concepts",
      "concept_tree_nodes",
      "concept_placements",
      "project_knowledge_roots",
      "plan_concept_roots",
      "knowledge_tree_versions",
      "user_teaching_requirements",
    ]));
    expect(PORTABLE_TABLES.indexOf("concepts")).toBeLessThan(
      PORTABLE_TABLES.indexOf("concept_tree_nodes"),
    );
    expect(PORTABLE_TABLES.indexOf("projects")).toBeLessThan(
      PORTABLE_TABLES.indexOf("project_knowledge_roots"),
    );
  });

  it("validates a forest snapshot table and drops unknown tables", () => {
    const { database } = fixture();
    const parsed = validateDataArchiveDatabase({
      ...database,
      tables: {
        ...database.tables,
        concept_tree_nodes: {
          columns: ["concept_id", "parent_id", "scope_type", "scope_id"],
          rows: [["concept-vector", "concept-stl", "global", "local-user"]],
        },
        retired_observations: { columns: ["id"], rows: [[1]] },
      },
    });
    expect(parsed.tables.concept_tree_nodes?.rows).toHaveLength(1);
    expect(parsed.tables).not.toHaveProperty("retired_observations");
  });

  it("never restores a switch that would turn teaching or evidence analysis off", () => {
    const sanitized = sanitizePortableSettings({
      "personalization.teacher_planner.enabled": "false",
      "personalization.observer.enabled": "false",
      "personalization.terminology_density": "0",
      "learner.answer_depth": "0.2",
      "reader.font_size": "18",
    });
    expect(sanitized["personalization.teacher_planner.enabled"]).toBe("true");
    expect(sanitized["personalization.observer.enabled"]).toBe("true");
    expect(sanitized).not.toHaveProperty("personalization.terminology_density");
    expect(sanitized).not.toHaveProperty("learner.answer_depth");
    expect(sanitized["reader.font_size"]).toBe("18");
  });

  it("applies the always-on rule while validating an imported archive", () => {
    const { database } = fixture();
    const parsed = validateDataArchiveDatabase({
      ...database,
      settings: {
        ...database.settings,
        "personalization.teacher_planner.enabled": "false",
        "personalization.observer.enabled": "false",
      },
    });
    expect(parsed.settings["personalization.teacher_planner.enabled"]).toBe("true");
    expect(parsed.settings["personalization.observer.enabled"]).toBe("true");
  });
});
