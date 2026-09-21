import { providerRequest } from "../platform/provider";

export type UnderstandingStatus = "pending" | "partial" | "understood" | "mastered" | "needs_help";
export type TeachingPassage = {
  id: string; concept_id: string; display_name: string; aspect: string;
  kind: "mentioned" | "planned" | "brief" | "explained"; core: number;
  dimension: string; quote: string; start_line: number; understanding: UnderstandingStatus;
};
export type TeachingDocument = {
  documentId: string; sourceType: "course" | "qa"; sourcePath: string;
  contentHash: string; indexStatus: "complete" | "partial" | "pending";
  documentConfirmed?: boolean;
  status: UnderstandingStatus; coreCount: number; understoodCount: number;
  passages: TeachingPassage[];
  feedback: Array<{ id: string; passage_id: string | null; result: string }>;
};
export type TeachingReference = {
  id: string; projectId: number; sourceType: "course" | "qa";
  sourcePath: string; content: string; quote: string; line: number; title: string;
};
export const understandingLabels: Record<UnderstandingStatus, string> = {
  pending: "", partial: "部分理解", understood: "已理解", mastered: "已掌握", needs_help: "仍有疑问",
};
export const TEACHING_CHANGED = "codecourse-teaching-changed";
export const OPEN_TEACHING = "codecourse-open-teaching";

export function getTeachingDocument(projectId: number, sourceType: "course" | "qa", sourcePath: string) {
  return providerRequest<TeachingDocument>(`/projects/${projectId}/teaching/document?${new URLSearchParams({ sourceType, sourcePath })}`);
}
export function getCourseUnderstanding(projectId: number) {
  return providerRequest<TeachingDocument[]>(`/projects/${projectId}/teaching/courses`);
}
export function getTeachingReference(projectId: number, id: string) {
  return providerRequest<TeachingReference>(`/projects/${projectId}/teaching/reference/${encodeURIComponent(id)}`);
}
export function saveUnderstanding(projectId: number, document: TeachingDocument, result: "understood" | "partial" | "needs_help" | "clear", passageIds: string[], requestKey: string) {
  return providerRequest<TeachingDocument>(`/projects/${projectId}/teaching/understanding`, {
    method: "POST", body: JSON.stringify({ sourceType: document.sourceType, sourcePath: document.sourcePath,
      contentHash: document.contentHash, result, passageIds, requestKey }),
  });
}
