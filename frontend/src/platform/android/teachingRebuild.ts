/**
 * Rebuild local teaching state after an archive import.
 *
 * Desktop archives carry the manuscript plus its hidden TeachingManifest, while
 * Android keeps the manifest sidecar in its own table. Nothing here calls a model:
 * every manifest was already validated by the exporting device, and a damaged one
 * simply stays "not ready" until the user runs the explicit backfill task.
 */
import type { PortableTable } from "../../dataTransfer/archive";
import type { MobileDatabase } from "./database";
import { KnowledgeForest, artifactKindOf } from "./knowledgeForest";
import { TeachingIndex } from "./teachingIndex";
import { parseTeachingManifest, visibleTeachingBody } from "./teachingManifest";
import { readGeneratedFile } from "./workspace";

type Row = Record<string, unknown>;

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Imports canonical alias bindings into the Android binding table. */
export async function importAliasBindings(db: MobileDatabase, snapshot: PortableTable): Promise<void> {
  const tables = await db.query<Row>("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='concept_aliases' LIMIT 1");
  if (!tables.length) return;
  const index = (column: string) => snapshot.columns.indexOf(column);
  const positions = ["alias", "scope_type", "scope_id", "domain", "concept_id"].map(index);
  if (positions.some((position) => position < 0)) return;
  const [aliasIndex, scopeIndex, scopeIdIndex, domainIndex, conceptIndex] = positions;
  const rows = snapshot.rows
    .filter((row) => typeof row[conceptIndex] === "string" && typeof row[aliasIndex] === "string")
    .map((row) => {
      const alias = String(row[aliasIndex]).normalize("NFKC").trim().replace(/\s+/g, " ");
      return [
        String(row[scopeIndex]), String(row[scopeIdIndex]), String(row[domainIndex]),
        alias.toLocaleLowerCase(), alias, String(row[conceptIndex]),
      ];
    });
  if (!rows.length) return;
  await db.runSetInTx(
    "INSERT OR IGNORE INTO concept_aliases(scope_type,scope_id,domain,alias_key,alias,concept_id) VALUES(?,?,?,?,?,?)",
    rows,
  );
}

/** Publishes every imported document's embedded manifest and reindexes locally. */
export async function rebuildTeachingState(db: MobileDatabase): Promise<void> {
  const forest = new KnowledgeForest(db);
  const index = new TeachingIndex(db, {
    read: async (project, type, path) => {
      if (type === "qa") {
        const row = (await db.query<Row>("SELECT id FROM qa_records WHERE project_id=? AND output_path=?", [project, path]))[0];
        if (!row) throw new Error("来源回答已删除");
      }
      return readGeneratedFile(project, path);
    },
    manifest: (project, type, path) => forest.manifest(project, type, path),
    evidence: async () => {
      throw new Error("讲解放回不属于归档恢复步骤");
    },
    stateChanged: async () => undefined,
  });
  const projects = await db.query<Row>("SELECT id FROM projects ORDER BY id");
  for (const project of projects) {
    const projectId = Number(project.id);
    const files = await db.query<Row>("SELECT filename FROM course_files WHERE project_id=? ORDER BY filename", [projectId]);
    for (const file of files) {
      const sourcePath = String(file.filename);
      try {
        const content = await readGeneratedFile(projectId, sourcePath);
        const isQA = (await db.query<Row>('SELECT id FROM qa_records WHERE project_id=? AND output_path=?', [projectId, sourcePath])).length > 0;
        const sourceType = isQA ? 'qa' : 'course';
        const digest = await sha256(content);
        const override = (await db.query<Row>('SELECT manifest_json FROM teaching_manifest_overrides WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=?', [projectId, sourceType, sourcePath, digest]))[0];
        const parsed = override ? parseTeachingManifest(visibleTeachingBody(content) + '\nTEACHING: ' + String(override.manifest_json)) : parseTeachingManifest(content);
        if (parsed.status === "complete" && parsed.manifest) {
          await forest.publish(projectId, {
            sourceType,
            sourcePath,
            artifactKind: artifactKindOf(sourceType, sourcePath),
            contentHash: digest,
            generationId: "archive-import",
            manifest: parsed.manifest,
            body: visibleTeachingBody(content),
            preserveTopology: true,
          });
        }
        await index.index(projectId, sourceType, sourcePath, content);
      } catch (error) {
        // A missing or damaged manuscript stays pending for the explicit backfill.
        console.warn("归档课件未能重建知识状态", sourcePath, error);
      }
    }
  }
}
