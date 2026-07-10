export type AnnotationType = "highlight" | "important" | "question" | "concept" | "code";

export type Annotation = {
  id: string;
  courseFile: string;
  selectedText: string;
  type: AnnotationType;
  note?: string;
  createdAt: string;
};

export const ANNOTATION_COLORS: Record<AnnotationType, string> = {
  highlight: "#fff59d",
  important: "#ffcdd2",
  question: "#b3e5fc",
  concept: "#c8e6c9",
  code: "#e1bee7",
};

export const ANNOTATION_LABELS: Record<AnnotationType, string> = {
  highlight: "高亮",
  important: "重点",
  question: "疑问",
  concept: "概念",
  code: "代码",
};
