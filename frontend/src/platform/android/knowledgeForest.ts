/**
 * Authoritative Android concept forest. Mirrors backend knowledge_tree_service:
 * generation proposes identities and parents, this service allocates identity,
 * validates topology, stores facts and versions. It never calls a model.
 */
import type { MobileDatabase } from "./database";
import { ensureRange, canonicalEvidence, rangeCatalog, type RangeRow } from './learningRanges';
import { expandPromptReferences, serializePromptForest, PROMPT_FOREST_INSTRUCTION } from "../../personalization/promptForest";
import {
  type ConceptCoverageSummary,
  type ConceptForestNode,
  type ConceptForestSnapshot,
  type ConceptRangeState,
  type FamiliarityState,
  type PlanConceptRoots,
  type TeachingCoverageKind,
  type TeachingDimension,
  type TeachingSourceVersion,
} from "../../personalization/conceptForest";
import {
  validateTeachingManifest,
  type ManifestConcept,
  type TeachingManifestV2,
} from "../../personalization/teachingManifest";
import {
  resolveKnowledgeState,
  type LearningEvidenceV2,
} from "../../personalization/knowledgeState";

type Row = Record<string, unknown>;
type ScopeType = "global" | "project";
type ArtifactKind = "outline" | "lesson" | "answer";
type ManifestStatus = "complete" | "pending" | "invalid" | "legacy";

export type ForestIdentity = {
  id: string;
  key: string;
  canonical: string;
  display: string;
  domain: string;
  aliases: string[];
  scopeType: ScopeType;
  scopeId: string;
  parentId: string | null;
  placement: "root" | "placed" | "pending";
};

export type SavedManifest = {
  status: ManifestStatus;
  error: string | null;
  artifactKind: ArtifactKind;
  contentHash: string;
  generationId: string;
  conceptMap: Record<string, string>;
  manifest: TeachingManifestV2 | null;
  topologyVersion: number;
  stateVersion: number;
};

export type PublishInput = {
  sourceType: "course" | "qa";
  sourcePath: string;
  artifactKind: ArtifactKind;
  contentHash: string;
  generationId: string;
  manifest: TeachingManifestV2;
  /** Visible body used for quote validation; hidden metadata must already be removed. */
  body: string;
  /**
   * Archive replay only: imported topology is already authoritative, so the
   * manuscript's parent proposals and structural changes are not re-applied.
   */
  preserveTopology?: boolean;
};

type Tx = {
  query: <T extends Row>(sql: string, values?: unknown[]) => Promise<T[]>;
  run: (sql: string, values?: unknown[]) => Promise<number>;
};

function txOf(db: MobileDatabase, inTx: boolean): Tx {
  return {
    query: <T extends Row>(sql: string, values: unknown[] = []) => inTx
      ? db.queryInTx(sql, values) as unknown as Promise<T[]>
      : db.query(sql, values) as unknown as Promise<T[]>,
    run: (sql, values = []) => inTx ? db.runInTx(sql, values) : db.run(sql, values),
  };
}

const stamp = () => new Date().toISOString();

/** Casefolded lexical identity; the model never supplies a canonical key. */
export function normalizeIdentity(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function conceptScope(key: string, scopeType?: unknown, scopeId?: unknown): { scopeType: ScopeType; scopeId: string } {
  if (scopeType === "project") return { scopeType: "project", scopeId: String(scopeId ?? "") };
  if (scopeType === "global") return { scopeType: "global", scopeId: String(scopeId ?? "local-user") };
  const match = key.match(/^project:(\d+):/);
  if (match) return { scopeType: "project", scopeId: match[1] };
  return { scopeType: "global", scopeId: "local-user" };
}

export function artifactKindOf(sourceType: string, sourcePath: string): ArtifactKind {
  if (sourceType === "qa") return "answer";
  return /(^|\/)outline\.md$/.test(sourcePath) || /sub-outline-/.test(sourcePath) ? "outline" : "lesson";
}

export class KnowledgeForest {
  constructor(private db: MobileDatabase) {}

  private async versions(tx: Tx): Promise<{ topologyVersion: number; stateVersion: number }> {
    await tx.run("INSERT OR IGNORE INTO knowledge_tree_versions(id,topology_version,state_version) VALUES(1,0,0)");
    const row = (await tx.query<Row>("SELECT topology_version,state_version FROM knowledge_tree_versions WHERE id=1"))[0];
    return { topologyVersion: Number(row?.topology_version ?? 0), stateVersion: Number(row?.state_version ?? 0) };
  }

  async versionsFor(projectId: number, inTx = false): Promise<{ topologyVersion: number; stateVersion: number }> {
    await this.project(projectId);
    return this.versions(txOf(this.db, inTx));
  }

  private async project(projectId: number): Promise<void> {
    const row = (await this.db.query<Row>("SELECT id FROM projects WHERE id=?", [projectId]))[0];
    if (!row) throw new Error("项目不存在");
  }

  /** Bumps the factual state version after evidence or feedback changes. */
  async bumpState(): Promise<void> {
    await this.db.transaction(async () => {
      const tx = txOf(this.db, true);
      const versions = await this.versions(tx);
      void versions;
      await tx.run("UPDATE knowledge_tree_versions SET state_version=state_version+1 WHERE id=1");
    });
  }

  /** Same bump, for callers already inside a database transaction. */
  async bumpStateInTransaction(): Promise<void> {
    await this.db.runInTx("INSERT OR IGNORE INTO knowledge_tree_versions(id,topology_version,state_version) VALUES(1,0,0)");
    await this.db.runInTx("UPDATE knowledge_tree_versions SET state_version=state_version+1 WHERE id=1");
  }

  // ---- identities ----

  private async loadIdentities(tx: Tx): Promise<Map<string, ForestIdentity>> {
    const concepts = await tx.query<Row>(
      "SELECT id,concept_key,canonical_name,display_name,domain,aliases_json,scope_type,scope_id FROM concepts WHERE concept_type<>'archived' ORDER BY id",
    );
    const placements = await tx.query<Row>("SELECT concept_id,parent_concept_id,placement_status FROM concept_placements");
    const placementById = new Map(placements.map(row => [String(row.concept_id), row]));
    const aliasRows = await tx.query<Row>("SELECT alias,concept_id FROM concept_aliases");
    const aliasesById = new Map<string, string[]>();
    for (const row of aliasRows) {
      const id = String(row.concept_id);
      aliasesById.set(id, [...(aliasesById.get(id) ?? []), String(row.alias)]);
    }
    const identities = new Map<string, ForestIdentity>();
    for (const row of concepts) {
      const id = String(row.id);
      const key = String(row.concept_key);
      const scope = conceptScope(key, row.scope_type, row.scope_id);
      const placement = placementById.get(id);
      const stored = (() => {
        try {
          const parsed: unknown = JSON.parse(String(row.aliases_json ?? "[]"));
          return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
        } catch { return []; }
      })();
      identities.set(id, {
        id, key,
        canonical: String(row.canonical_name ?? ""),
        display: String(row.display_name ?? ""),
        domain: String(row.domain ?? "general").toLocaleLowerCase(),
        aliases: [...new Set([...stored, ...(aliasesById.get(id) ?? [])])],
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        parentId: placement?.parent_concept_id == null ? null : String(placement.parent_concept_id),
        placement: (placement?.placement_status as ForestIdentity["placement"]) ?? "pending",
      });
    }
    return identities;
  }

  private visible(identity: ForestIdentity, projectId: number): boolean {
    return identity.scopeType === "global"
      || (identity.scopeType === "project" && identity.scopeId === String(projectId));
  }

  private identityIndex(identities: Map<string, ForestIdentity>) {
    const byName = new Map<string, string[]>();
    const byAlias = new Map<string, string>();
    for (const identity of identities.values()) {
      const scopeKey = `${identity.scopeType}:${identity.scopeId}:${identity.domain}`;
      const nameKey = `${scopeKey}:${normalizeIdentity(identity.canonical)}`;
      byName.set(nameKey, [...(byName.get(nameKey) ?? []), identity.id]);
      byAlias.set(`${scopeKey}:${normalizeIdentity(identity.display)}`, identity.id);
      for (const alias of identity.aliases) byAlias.set(`${scopeKey}:${normalizeIdentity(alias)}`, identity.id);
    }
    return { byName, byAlias };
  }

  /** Explicit user selection of existing roots; never creates or guesses a domain. */
  async associateRoots(projectId: number, conceptIds: string[], options: { inTx?: boolean } = {}): Promise<void> {
    await this.project(projectId);
    const work = async (tx: Tx) => {
      const identities = await this.loadIdentities(tx);
      const unique = [...new Set(conceptIds.map(String))];
      if (!unique.length) throw new Error("领域根尚未识别，请重试");
      for (const id of unique) {
        const identity = identities.get(id);
        if (!identity || !this.visible(identity, projectId)) throw new Error("无法关联不可访问的概念根");
        if (identity.parentId !== null) throw new Error("项目根必须引用森林根节点");
      }
      for (const id of unique) {
        await tx.run("INSERT OR IGNORE INTO plan_concept_roots(project_id,concept_id) VALUES(?,?)", [projectId, id]);
      }
      await this.setRootStatus(tx, projectId, "ready", null);
    };
    if (options.inTx) return work(txOf(this.db, true));
    return this.db.transaction(() => work(txOf(this.db, true)));
  }

  async markRootsPending(projectId: number, error?: string | null): Promise<void> {
    await this.project(projectId);
    await this.db.transaction(async () => {
      await this.setRootStatus(txOf(this.db, true), projectId, "pending", error ?? null);
    });
  }

  private async setRootStatus(tx: Tx, projectId: number, status: string, error: string | null): Promise<void> {
    await tx.run(
      `INSERT INTO plan_root_status(project_id,status,error_message) VALUES(?,?,?)
       ON CONFLICT(project_id) DO UPDATE SET status=excluded.status,error_message=excluded.error_message`,
      [projectId, status, error],
    );
  }

  async roots(projectId: number): Promise<PlanConceptRoots> {
    const status = (await this.db.query<Row>("SELECT * FROM plan_root_status WHERE project_id=?", [projectId]))[0];
    const rows = await this.db.query<Row>("SELECT concept_id FROM plan_concept_roots WHERE project_id=? ORDER BY concept_id", [projectId]);
    const raw = status ? String(status.status) : "pending";
    return {
      project_id: projectId,
      root_concept_ids: rows.map(row => String(row.concept_id)),
      status: raw === "ready" ? "ready" : raw === "failed" ? "failed" : "pending",
      error: status?.error_message == null ? null : String(status.error_message),
    };
  }

  // ---- manifest application ----

  private validateTopology(identities: Map<string, ForestIdentity>): void {
    for (const identity of identities.values()) {
      const parentId = identity.parentId;
      if (parentId === null) continue;
      if (parentId === identity.id) throw new Error("Concept cannot parent itself");
      const parent = identities.get(parentId);
      if (!parent) throw new Error("Parent concept is missing");
      if (identity.scopeType === "global" && parent.scopeType !== "global") {
        throw new Error("Global concepts cannot have private ancestors");
      }
      if (parent.scopeType === "project"
        && (identity.scopeType !== parent.scopeType || identity.scopeId !== parent.scopeId)) {
        throw new Error("Cross-project parent is forbidden");
      }
    }
    for (const identity of identities.values()) {
      const path = new Set<string>();
      let current: ForestIdentity | undefined = identity;
      while (current) {
        if (path.has(current.id)) throw new Error("Concept parent cycle");
        path.add(current.id);
        current = current.parentId === null ? undefined : identities.get(current.parentId);
      }
    }
  }

  /** Applies one v2 manifest: identity resolution, alias binding and authoritative parent edges. */
  async applyManifest(projectId: number, manifest: TeachingManifestV2, options: { inTx?: boolean; preserveTopology?: boolean } = {}): Promise<Map<string, string>> {
    await this.project(projectId);
    if (options.inTx) return this.applyInTx(projectId, manifest, txOf(this.db, true), options.preserveTopology);
    return this.db.transaction(() => this.applyInTx(projectId, manifest, txOf(this.db, true), options.preserveTopology));
  }

  private async applyInTx(projectId: number, manifest: TeachingManifestV2, tx: Tx, preserveTopology = false): Promise<Map<string, string>> {
    if (!manifest || manifest.schema_version !== 2) throw new Error("TeachingManifest schema_version must be 2");
    const identities = await this.loadIdentities(tx);
    manifest = await expandPromptReferences(manifest, identities.keys());
    const redirects = new Map((await tx.query<{ source_id: string; target_id: string }>('SELECT * FROM concept_redirects')).map(r => [r.source_id, r.target_id]));
    manifest = { ...manifest, concepts: manifest.concepts.map(c => ({ ...c, existing_id: c.existing_id ? redirects.get(c.existing_id) ?? c.existing_id : null })),
      placement_changes: manifest.placement_changes?.map(c => ({ ...c, from_parent_id: c.from_parent_id ? redirects.get(c.from_parent_id) ?? c.from_parent_id : null })) };
    const { byName, byAlias } = this.identityIndex(identities);
    const refs = new Map<string, string>();
    const planned: Array<{ id: string; concept: ManifestConcept; created: boolean }> = [];
    const created = new Set<string>();
    const aliasWrites: Array<{ scopeType: ScopeType; scopeId: string; domain: string; alias: string; conceptId: string }> = [];
    const at = stamp();

    for (const raw of manifest.concepts ?? []) {
      const concept = raw as ManifestConcept;
      const ref = String(concept.ref ?? "").trim();
      const name = String(concept.name ?? "").trim();
      if (!ref || !name) throw new Error("Manifest concept requires ref and name");
      if (refs.has(ref)) throw new Error("Duplicate manifest ref");
      const domain = String(concept.domain ?? "").trim().toLocaleLowerCase() || "general";
      if (concept.scope !== "global" && concept.scope !== "project") throw new Error("Concept scope must be global or project");
      const scopeType: ScopeType = concept.scope;
      const scopeId = scopeType === "global" ? "local-user" : String(projectId);
      const aliases = (concept.aliases ?? []).map(alias => String(alias).trim()).filter(Boolean);

      let identityId: string;
      let isNew = false;
      if (concept.existing_id) {
        const existing = identities.get(String(concept.existing_id));
        if (!existing || !this.visible(existing, projectId)) throw new Error("Inaccessible existing_id");
        if (existing.scopeType !== scopeType || existing.scopeId !== scopeId || existing.domain !== domain) {
          throw new Error("Existing concept scope/domain cannot be changed by a manifest");
        }
        identityId = existing.id;
      } else {
        const scopeKey = `${scopeType}:${scopeId}:${domain}`;
        const matches = byName.get(`${scopeKey}:${normalizeIdentity(name)}`) ?? [];
        if (matches.length > 1) throw new Error("Ambiguous canonical identity requires explicit existing_id");
        identityId = matches[0] ?? byAlias.get(`${scopeKey}:${normalizeIdentity(name)}`) ?? "";
        if (!identityId) {
          const id = crypto.randomUUID();
          // Private identity includes its domain: the same symbol name in another
          // domain/language is a different concept, never a reused identity.
          let key = scopeType === "project"
            ? `project:${projectId}:${domain}:symbol:${normalizeIdentity(name)}`
            : `global:${domain}:${normalizeIdentity(name)}`;
          let duplicateKey: Row | undefined = (await tx.query<Row>("SELECT id,concept_type FROM concepts WHERE concept_key=?", [key]))[0];
          if (duplicateKey?.concept_type === "archived") {
            key += ":replacement:" + id;
            duplicateKey = undefined;
          }
          if (duplicateKey) {
            identityId = String(duplicateKey.id);
            identities.set(identityId, {
              ...(identities.get(identityId) ?? {
                id: identityId, key, canonical: name, display: name, domain, aliases: [],
                scopeType, scopeId, parentId: null, placement: "pending" as const,
              }),
            });
          } else {
            identityId = id;
            await tx.run(
              `INSERT INTO concepts(id,concept_key,canonical_name,display_name,domain,concept_type,aliases_json,difficulty,created_at,scope_type,scope_id)
               VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
              [id, key, name, name, domain, scopeType === "project" ? "project_symbol" : "theory",
                JSON.stringify(aliases), 0.5, at, scopeType, scopeId],
            );
            identities.set(id, {
              id, key, canonical: name, display: name, domain, aliases: [], scopeType, scopeId,
              parentId: null, placement: "pending",
            });
            created.add(id);
            isNew = true;
          }
        }
      }
      refs.set(ref, identityId);
      planned.push({ id: identityId, concept, created: isNew });

      for (const alias of [name, ...aliases]) {
        const normalized = normalizeIdentity(alias);
        if (!normalized) continue;
        const bound = (await tx.query<Row>(
          "SELECT concept_id FROM concept_aliases WHERE scope_type=? AND scope_id=? AND domain=? AND alias_key=?",
          [scopeType, scopeId, domain, normalized],
        ))[0];
        if (bound && String(bound.concept_id) !== identityId) throw new Error("Alias is already bound to another concept");
        const canonicalOwner = (byName.get(`${scopeType}:${scopeId}:${domain}:${normalized}`) ?? [])
          .find(id => id !== identityId);
        if (canonicalOwner) throw new Error("Alias is already bound to another concept");
        if (!bound) aliasWrites.push({ scopeType, scopeId, domain, alias: normalized, conceptId: identityId });
      }
    }

    // Explicit topology proposals only apply to existing nodes and only when the
    // proposer saw the same authoritative edge; stale proposals keep the edge and
    // are recorded for later reconciliation instead of silently reordering.
    const explicitChanges = new Map<string, { from: string | null; to: string; reason: string }>();
    for (const change of preserveTopology ? [] : manifest.placement_changes ?? []) {
      const id = refs.get(String(change.concept_ref));
      const target = refs.get(String(change.to_parent_ref));
      if (!id || !target) throw new Error("Structural change must reference manifest concepts");
      if (id === target) throw new Error("Concept cannot parent itself");
      explicitChanges.set(id, { from: change.from_parent_id ?? null, to: target, reason: String(change.reason ?? "") });
    }

    const conflicts: Array<{ conceptId: string; from: string | null; to: string; reason: string }> = [];
    const parentUpdates: Array<{ id: string; parent: string | null }> = [];
    const requestedParents = new Map<string, string | null>();
    for (const item of planned) {
      const identity = identities.get(item.id)!;
      const parentRef = item.concept.parent_ref ?? null;
      const parentId = parentRef === null ? null : refs.get(String(parentRef)) ?? null;
      if (parentRef !== null && parentId === null) throw new Error("Unresolved parent_ref");
      if (requestedParents.has(item.id) && requestedParents.get(item.id) !== parentId) {
        throw new Error("Same concept has multiple proposed parents");
      }
      requestedParents.set(item.id, parentId);
      if (item.created) {
        identity.parentId = parentId;
        identity.placement = parentId === null ? "root" : "placed";
        parentUpdates.push({ id: item.id, parent: parentId });
        continue;
      }
      if (preserveTopology) {
        // Imported edges win; the manuscript only restores coverage and terms.
        continue;
      }
      const change = explicitChanges.get(item.id);
      if ((identity.parentId ?? null) === parentId && !change) continue;
      if (!change) throw new Error("Existing parent requires explicit topology change");
      if ((identity.parentId ?? null) !== change.from) {
        conflicts.push({ conceptId: item.id, from: change.from, to: change.to, reason: change.reason });
        continue;
      }
      if ((identity.parentId ?? null) === change.to) continue;
      identity.parentId = change.to;
      identity.placement = "placed";
      parentUpdates.push({ id: item.id, parent: change.to });
    }
    // A placement change may target an existing node that is not listed again.
    for (const [id, change] of explicitChanges) {
      if (planned.some(item => item.id === id)) continue;
      const identity = identities.get(id);
      if (!identity) continue;
      if ((identity.parentId ?? null) !== change.from) {
        conflicts.push({ conceptId: id, from: change.from, to: change.to, reason: change.reason });
        continue;
      }
      identity.parentId = change.to;
      identity.placement = "placed";
      parentUpdates.push({ id, parent: change.to });
    }
    this.validateTopology(identities);

    const versions = await this.versions(tx);
    for (const alias of aliasWrites) {
      await tx.run(
        "INSERT OR IGNORE INTO concept_aliases(scope_type,scope_id,domain,alias_key,alias,concept_id) VALUES(?,?,?,?,?,?)",
        [alias.scopeType, alias.scopeId, alias.domain, alias.alias, alias.alias, alias.conceptId],
      );
    }
    for (const update of parentUpdates) {
      await tx.run(
        `INSERT INTO concept_placements(concept_id,parent_concept_id,placement_status,provenance_json)
         VALUES(?,?,?,?)
         ON CONFLICT(concept_id) DO UPDATE SET parent_concept_id=excluded.parent_concept_id,
           placement_status=excluded.placement_status,provenance_json=excluded.provenance_json`,
        [update.id, update.parent, update.parent === null ? "root" : "placed",
          JSON.stringify({ source: "teaching_manifest", project_id: projectId, at })],
      );
    }
    for (const conflict of conflicts) {
      await tx.run(
        `INSERT OR IGNORE INTO knowledge_topology_conflicts
           (id,project_id,concept_id,expected_topology_version,actual_topology_version,from_parent_id,to_parent_id,reason,status)
         VALUES(?,?,?,?,?,?,?,?,'pending')`,
        [crypto.randomUUID(), projectId, conflict.conceptId, versions.topologyVersion,
          versions.topologyVersion + 1, conflict.from, conflict.to,
          conflict.reason.slice(0, 500) || "stale placement proposal"],
      );
    }
    // Structural ancestors carry no coverage or familiarity claim.
    for (const item of planned) {
      if (!item.created) continue;
      await tx.run(
        `INSERT INTO concept_placements(concept_id,parent_concept_id,placement_status,provenance_json)
         VALUES(?,?,?,?) ON CONFLICT(concept_id) DO NOTHING`,
        [item.id, null, "pending", JSON.stringify({ source: "teaching_manifest", project_id: projectId, classification_only: true, at })],
      );
    }
    if (parentUpdates.some(update => update.parent !== null || created.has(update.id))) {
      await tx.run("UPDATE knowledge_tree_versions SET topology_version=topology_version+1 WHERE id=1");
    }
    for (const id of new Set(refs.values())) await tx.run("INSERT OR IGNORE INTO project_concept_links VALUES(?,?,'manifest','')", [projectId, id]);
    return refs;
  }

  // ---- publication ----

  async saveInvalidManifest(
    projectId: number,
    input: { sourceType: "course" | "qa"; sourcePath: string; artifactKind: ArtifactKind; contentHash: string; generationId: string; error: string },
  ): Promise<void> {
    await this.db.transaction(async () => {
      const tx = txOf(this.db, true);
      const versions = await this.versions(tx);
      await tx.run(
        `INSERT INTO teaching_manifests(project_id,source_type,source_path,artifact_kind,content_hash,generation_id,
           manifest_json,concept_map_json,topology_version,state_version,metadata_status,error_message,updated_at)
         VALUES(?,?,?,?,?,?,'{}','{}',?,?,'invalid',?,?)
         ON CONFLICT(project_id,source_type,source_path) DO UPDATE SET
           artifact_kind=excluded.artifact_kind,content_hash=excluded.content_hash,
           generation_id=excluded.generation_id,manifest_json='{}',concept_map_json='{}',
           topology_version=excluded.topology_version,state_version=excluded.state_version,
           metadata_status='invalid',error_message=excluded.error_message,updated_at=excluded.updated_at`,
        [projectId, input.sourceType, input.sourcePath, input.artifactKind, input.contentHash,
          input.generationId, versions.topologyVersion, versions.stateVersion,
          input.error.slice(0, 500), stamp()],
      );
    });
  }

  async publish(
    projectId: number,
    input: PublishInput,
    options: { inTx?: boolean } = {},
  ): Promise<{ conceptMap: Map<string, string>; topologyVersion: number; stateVersion: number }> {
    await this.project(projectId);
    const validated = validateTeachingManifest(input.manifest, input.body, { validate_quotes: true });
    if (!validated.manifest) throw new Error(validated.errors[0]?.message ?? "知识清单未通过校验");
    const work = async () => {
      const tx = txOf(this.db, true);
      const conceptMap = await this.applyInTx(projectId, validated.manifest!, tx, input.preserveTopology);
      for (const item of validated.manifest!.coverage) await ensureRange(this.db, conceptMap.get(item.concept_ref)!, item.dimension, item.aspect, item.aspect_id, true);
      const versions = await this.versions(tx);
      await tx.run(
        `INSERT INTO teaching_manifests(project_id,source_type,source_path,artifact_kind,content_hash,generation_id,
           manifest_json,concept_map_json,topology_version,state_version,metadata_status,error_message,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,'complete',NULL,?)
         ON CONFLICT(project_id,source_type,source_path) DO UPDATE SET
           artifact_kind=excluded.artifact_kind,content_hash=excluded.content_hash,
           generation_id=excluded.generation_id,manifest_json=excluded.manifest_json,
           concept_map_json=excluded.concept_map_json,topology_version=excluded.topology_version,
           state_version=excluded.state_version,metadata_status='complete',error_message=NULL,
           updated_at=excluded.updated_at`,
        [projectId, input.sourceType, input.sourcePath, input.artifactKind, input.contentHash, input.generationId,
          JSON.stringify(validated.manifest), JSON.stringify(Object.fromEntries(conceptMap)),
          versions.topologyVersion, versions.stateVersion, stamp()],
      );
      await tx.run("UPDATE knowledge_tree_versions SET state_version=state_version+1 WHERE id=1");
      return { conceptMap, topologyVersion: versions.topologyVersion, stateVersion: versions.stateVersion + 1 };
    };
    return options.inTx ? work() : this.db.transaction(work);
  }

  async manifest(projectId: number, sourceType: string, sourcePath: string): Promise<SavedManifest | null> {
    const row = (await this.db.query<Row>(
      "SELECT * FROM teaching_manifests WHERE project_id=? AND source_type=? AND source_path=?",
      [projectId, sourceType, sourcePath.replace(/\\/g, "/")],
    ))[0];
    if (!row) return null;
    let manifest: TeachingManifestV2 | null = null;
    try {
      const parsed: unknown = JSON.parse(String(row.manifest_json ?? "{}"));
      manifest = validateTeachingManifest(parsed).manifest;
    } catch { manifest = null; }
    let conceptMap: Record<string, string> = {};
    try {
      const parsed: unknown = JSON.parse(String(row.concept_map_json ?? "{}"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        conceptMap = Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      }
    } catch { conceptMap = {}; }
    return {
      status: String(row.metadata_status) as ManifestStatus,
      error: row.error_message == null ? null : String(row.error_message),
      artifactKind: String(row.artifact_kind) as ArtifactKind,
      contentHash: String(row.content_hash),
      generationId: String(row.generation_id),
      conceptMap,
      manifest,
      topologyVersion: Number(row.topology_version ?? 0),
      stateVersion: Number(row.state_version ?? 0),
    };
  }

  // ---- facts ----

  /** Every active factual event visible from this project, including global ones. */
  private async evidenceRows(projectId: number): Promise<Row[]> {
    return this.db.query<Row>(
      `SELECT e.* FROM learning_evidence_v2 e
       WHERE e.voided=0
         AND ((e.scope_type='global' AND e.scope_id='local-user') OR (e.scope_type='project' AND e.scope_id=?))
         AND NOT EXISTS (SELECT 1 FROM learning_evidence_v2 v
           WHERE v.target_evidence_id=e.id AND v.action='void_evidence' AND v.voided=0)
       ORDER BY e.event_time,e.id`,
      [String(projectId)],
    );
  }

  private evidence(row: Row): LearningEvidenceV2 {
    const json = (value: unknown): Record<string, unknown> => {
      try {
        const parsed: unknown = JSON.parse(String(value ?? "{}"));
        return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
      } catch { return {}; }
    };
    return {
      id: String(row.id),
      idempotencyKey: String(row.idempotency_key ?? row.id),
      schemaVersion: 2,
      conceptId: String(row.concept_id),
      scopeType: String(row.scope_type) as "global" | "project",
      scopeId: String(row.scope_id),
      dimension: String(row.dimension) as LearningEvidenceV2["dimension"],
      direction: String(row.direction) as LearningEvidenceV2["direction"],
      strength: Number(row.strength ?? 0),
      reliability: Number(row.reliability ?? 0),
      source: String(row.source) as LearningEvidenceV2["source"],
      action: String(row.action),
      object: json(row.object_json),
      result: json(row.result_json),
      context: json(row.context_json),
      eventTime: String(row.event_time ?? ""),
      sessionId: row.session_id == null ? null : String(row.session_id),
      qaRecordId: row.qa_record_id == null ? null : Number(row.qa_record_id),
      diagnosticAttemptId: null,
      objectiveCorrect: null,
      targetEvidenceId: row.target_evidence_id == null ? null : String(row.target_evidence_id),
      voided: Number(row.voided ?? 0) === 1,
      modelVersion: null,
      policyVersion: String(row.policy_version ?? "knowledge-facts-v1"),
    };
  }

  async snapshot(projectId: number): Promise<ConceptForestSnapshot> {
    const identities = await this.loadIdentities(txOf(this.db, false));
    const versions = await this.versions(txOf(this.db, false));
    const evidence = await this.evidenceRows(projectId);
    // Global knowledge ranges stay visible across plans; only other plans'
    // private symbols are isolated.
    const coverageRows = await this.db.query<Row>(
      `SELECT p.concept_id,p.aspect,p.dimension,p.kind,p.id passage_id,p.quote,
              d.source_type,d.source_path,d.content_hash,m.generation_id,m.artifact_kind,
              m.topology_version,m.state_version
       FROM teaching_passages p
       JOIN teaching_documents d ON d.id=p.document_id
       JOIN concepts c ON c.id=p.concept_id
       LEFT JOIN teaching_manifests m ON m.project_id=d.project_id AND m.source_type=d.source_type AND m.source_path=d.source_path
       WHERE p.active=1 AND d.index_status='complete'
         AND (c.concept_key LIKE 'global:%' OR d.project_id=?)
       ORDER BY p.concept_id,p.aspect,p.dimension,p.start_line`,
      [projectId],
    );
    const evidenceByConcept = new Map<string, Row[]>();
    for (const row of evidence) {
      const id = String(row.concept_id);
      evidenceByConcept.set(id, [...(evidenceByConcept.get(id) ?? []), row]);
    }
    const coverageByConcept = new Map<string, ConceptCoverageSummary[]>();
    for (const row of coverageRows) {
      const id = String(row.concept_id);
      const artifactKind = (String(row.artifact_kind ?? "")
        || artifactKindOf(String(row.source_type), String(row.source_path))) as ArtifactKind;
      const source: TeachingSourceVersion = {
        source_type: String(row.source_type) as "course" | "qa",
        source_path: String(row.source_path),
        artifact_kind: artifactKind,
        content_hash: String(row.content_hash),
        generation_id: String(row.generation_id ?? ""),
        tree_version: {
          topology_version: Number(row.topology_version ?? 0),
          state_version: Number(row.state_version ?? 0),
        },
      };
      const entry: ConceptCoverageSummary = {
        ...await ensureRange(this.db, id, String(row.dimension), String(row.aspect)),
        dimension: String(row.dimension) as TeachingDimension,
        kind: String(row.kind) as TeachingCoverageKind,
        source,
        passage_id: String(row.passage_id),
        quote: String(row.quote),
      };
      coverageByConcept.set(id, [...(coverageByConcept.get(id) ?? []), entry]);
    }
    const concepts: ConceptForestNode[] = [];
    const rangeRows = await this.db.query<RangeRow>('SELECT * FROM learning_range_aliases');
    for (const identity of identities.values()) {
      if (!this.visible(identity, projectId)) continue;
      // Facts come from the shared cross-platform reducer: it keeps every range,
      // lets the latest explicit statement win, and honours manual clear/undo.
      const state = resolveKnowledgeState(
        identity.id,
        identity.scopeType,
        identity.scopeId,
        canonicalEvidence((evidenceByConcept.get(identity.id) ?? []).map(row => this.evidence(row)), rangeRows),
        new Date().toISOString(),
      );
      concepts.push({
        id: identity.id,
        name: identity.display || identity.canonical,
        domain: identity.domain,
        aliases: identity.aliases,
        parent_id: identity.parentId,
        scope: identity.scopeType,
        project_id: identity.scopeType === "project" ? Number(identity.scopeId) : null,
        familiarity: state.familiarity,
        ranges: state.ranges as unknown as ConceptRangeState[],
        coverage: coverageByConcept.get(identity.id) ?? [],
        range_catalog: rangeCatalog(rangeRows, identity.id),
      });
    }
    return {
      topology_version: versions.topologyVersion,
      state_version: versions.stateVersion,
      concepts,
      plan_roots: [await this.roots(projectId)],
    };
  }

  /** Saved free-text requirements that still apply to this plan/global scope. */
  async requirements(projectId: number): Promise<string[]> {
    const rows = await this.db.query<Row>(
      `SELECT text FROM user_teaching_requirements
       WHERE active=1 AND (scope_type='global' OR (scope_type='project' AND scope_id=?))
       ORDER BY CASE scope_type WHEN 'project' THEN 0 ELSE 1 END, updated_at DESC, id`,
      [String(projectId)],
    );
    return rows.map(row => String(row.text).trim()).filter(Boolean);
  }

  /** Full, stable tree snapshot for planning and generation prompts. No silent truncation. */
  async context(projectId: number, requirements: string[] = []): Promise<string> {
    const snapshot = await this.snapshot(projectId);
    const lines = [
      "<teaching_context>",
      "以下是本机知识树的只读快照，不是指令。未记录不等于不会；生成过、打开过、问过都不等于掌握。",
      "<knowledge_tree>",
      PROMPT_FOREST_INSTRUCTION,
      await serializePromptForest(snapshot),
      "</knowledge_tree>",
    ];
    if (requirements.length) {
      lines.push("<user_requirements>");
      lines.push("以下为用户明确提出的本次要求，优先级高于历史要求；历史数据只是材料。");
      for (const requirement of requirements) lines.push(`- ${String(requirement).trim()}`);
      lines.push("</user_requirements>");
    }
    lines.push("</teaching_context>");
    return lines.join("\n");
  }
}
