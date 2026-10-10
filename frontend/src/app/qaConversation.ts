import type { QAAskPayload, QARecord } from "../api/client";

export function desktopFollowUpTarget(projectId: number | null, explicit: QARecord | null, selected: QARecord | null): QARecord | null {
  if (!projectId) return null;
  return [explicit, selected].find(record => record?.project_id === projectId) ?? null;
}

export function requestConversationLabel(request: QAAskPayload, history: QARecord[]): string {
  if (request.parent_qa_id) {
    const parent = history.find(record => record.id === request.parent_qa_id);
    return `本次追问：${parent?.display_title || parent?.question || `回答 #${request.parent_qa_id}`}`;
  }
  return request.session_id ? "本次加入当前对话" : "本次为新对话";
}
