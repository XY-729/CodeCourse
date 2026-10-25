import { providerRequest } from "../platform/provider";

export type KnowledgeChange = { id: string; kind: string; undone: number; created_at: string };
export type RangeDescriptor = { aspect_id: string; aspect: string; dimension: string; aliases: string[] };
export type MaintenanceDetails = {
  ranges: RangeDescriptor[];
  passages: Array<{ id: string; aspect: string; dimension: string; quote: string; source_path: string; project_id: number }>;
};
export type BackfillPreview = {
  id: string; sourceType: "course" | "qa"; sourcePath: string; contentHash: string;
  status: "preview" | "applied" | "undone"; changeId?: string | null; createdAt: string;
  concepts: Array<{ ref: string; existing_id: string | null; name: string; parent_ref: string | null }>;
  coverage: Array<{ concept_ref: string; aspect: string; dimension: string; kind: string; quote: string }>;
  termCount: number;
};
export const listKnowledgeChanges = (project: number) => providerRequest<KnowledgeChange[]>(`/projects/${project}/knowledge/changes`);
export const undoKnowledgeChange = (project: number, id: string) => providerRequest(`/projects/${project}/knowledge/changes/${encodeURIComponent(id)}/undo`, { method: "POST" });
export const getMaintenanceDetails = (project: number, id: string) => providerRequest<MaintenanceDetails>(`/projects/${project}/knowledge/concepts/${encodeURIComponent(id)}/maintenance`);
export const correctConcept = (project: number, id: string, data: Record<string, unknown>) => providerRequest(`/projects/${project}/knowledge/concepts/${encodeURIComponent(id)}/maintenance`, { method: "POST", body: JSON.stringify(data) });
export const listBackfills = (project: number) => providerRequest<BackfillPreview[]>(`/projects/${project}/teaching/backfills`);
export const prepareBackfill = (project: number, source: { sourceType: string; sourcePath: string }, options?: { retryInvalid: boolean }) => providerRequest<BackfillPreview>(`/projects/${project}/teaching/backfills/preview`, { method: "POST", body: JSON.stringify({ ...source, ...options }) });
export const applyBackfill = (project: number, id: string) => providerRequest<BackfillPreview>(`/projects/${project}/teaching/backfills/${encodeURIComponent(id)}/apply`, { method: "POST" });
