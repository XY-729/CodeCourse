/** Authoritative cross-platform DTOs. Model output never supplies familiarity. */
export const FAMILIARITY_STATES = [
  "unrecorded", "encountered", "studied", "self_reported_understood",
  "partially_understood", "declared_known", "needs_help", "mixed",
] as const;
export type FamiliarityState = typeof FAMILIARITY_STATES[number];
export type TeachingDimension = "conceptual" | "code_reading" | "implementation" | "debugging" | "transfer";
export type TeachingCoverageKind = "planned" | "mentioned" | "brief" | "explained";
export interface TreeSnapshotVersion { topology_version: number; state_version: number }
export interface TeachingSourceVersion {
  source_type: "course" | "qa";
  source_path: string;
  artifact_kind: "outline" | "lesson" | "answer";
  /** SHA-256 of the exact persisted UTF-8 Markdown, including hidden metadata. */
  content_hash: string;
  generation_id: string;
  tree_version: TreeSnapshotVersion;
}
export interface ConceptRangeState {
  aspect_id?: string;
  aspect: string;
  dimension: TeachingDimension;
  familiarity: FamiliarityState;
  evidence_ids: string[];
  last_evidence_at?: string | null;
  sources?: TeachingSourceVersion[];
}
export interface ConceptCoverageSummary {
  aspect_id?: string;
  aspect: string;
  dimension: TeachingDimension;
  kind: TeachingCoverageKind;
  source: TeachingSourceVersion;
  passage_id?: string;
  quote?: string;
}
export interface ConceptForestNode {
  range_catalog?: Array<{ aspect_id: string; aspect: string; dimension: string; aliases: string[] }>;
  id: string;
  name: string;
  domain: string;
  aliases: string[];
  parent_id: string | null;
  scope: "global" | "project";
  project_id?: number | null;
  familiarity: FamiliarityState;
  ranges: ConceptRangeState[];
  coverage: ConceptCoverageSummary[];
}
export interface PlanConceptRoots {
  project_id: number;
  root_concept_ids: string[];
  status: "ready" | "pending" | "failed";
  error?: string | null;
}
export interface ConceptForestSnapshot extends TreeSnapshotVersion {
  concepts: ConceptForestNode[];
  plan_roots: PlanConceptRoots[];
}
export interface TeachingFeedbackAction {
  action_id: string;
  request_key: string;
  source: TeachingSourceVersion;
  passage_ids: string[];
  result: "understood" | "partial" | "needs_help" | "clear";
  feedback_text?: string;
}
export interface TermSidecarAnnotation {
  concept_id: string;
  text: string;
  /** UTF-16 offsets into the visible body; never offsets into hidden metadata. */
  start: number;
  end: number;
  quote: string;
  familiarity: FamiliarityState;
}
export interface TermAnnotationSidecar {
  content_hash: string;
  tree_version: TreeSnapshotVersion;
  rules_version: string;
  annotations: TermSidecarAnnotation[];
}

export const familiarityLabel: Record<FamiliarityState, string> = {
  unrecorded: "暂无学习记录", encountered: "已接触", studied: "已学完",
  self_reported_understood: "已理解（自述）", partially_understood: "部分理解",
  declared_known: "已声明会", needs_help: "需要帮助", mixed: "各范围状态不同",
};

/** Object keys are sorted; array order is retained unless a DTO gives it set semantics. */
export function stableSerialize(value: unknown): string {
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") return Object.fromEntries(
      Object.entries(item).filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, visit(v)]),
    );
    return item;
  };
  return JSON.stringify(visit(value));
}

/**
 * Stable topology first, then factual state. No timestamps or activity ordering
 * are added, and unchanged trees serialize to identical bytes so a prompt
 * prefix can be reused.
 */
export function serializeConceptForest(snapshot: ConceptForestSnapshot): string {
  const byId = [...snapshot.concepts].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const topology = byId.map(({ id, name, domain, aliases, parent_id, scope, project_id }) => ({
    id, name, domain, aliases: [...aliases].sort(), parent_id, scope, project_id,
  }));
  const planRoots = [...snapshot.plan_roots].sort((a, b) => a.project_id - b.project_id)
    .map((root) => ({ ...root, root_concept_ids: [...root.root_concept_ids].sort() }));
  const states = byId.map(({ id, familiarity, ranges, coverage }) => ({
    id, familiarity,
    ranges: [...ranges].sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b))),
    coverage: [...coverage].sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b))),
  }));
  // Key order is written explicitly: topology is the reusable prefix, state
  // lives at the end where a version bump only invalidates the suffix.
  return `{"topology":${stableSerialize(topology)},"topology_version":${JSON.stringify(snapshot.topology_version)},`
    + `"plan_roots":${stableSerialize(planRoots)},"state_version":${JSON.stringify(snapshot.state_version)},`
    + `"states":${stableSerialize(states)}}`;
}
