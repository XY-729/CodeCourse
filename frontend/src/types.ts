export type AnnotationColor = "yellow" | "blue" | "green" | "red" | "purple";

export type AnnotationStyle = {
  color?: AnnotationColor;
  bold?: boolean;
  underline?: boolean;
};

export type Annotation = {
  id: string;
  courseFile: string;
  selectedText: string;
  style: AnnotationStyle;
  createdAt: string;
};

export const COLOR_VALUES: Record<AnnotationColor, string> = {
  yellow: "#fff59d",
  blue: "#b3e5fc",
  green: "#c8e6c9",
  red: "#ffcdd2",
  purple: "#e1bee7",
};

export const COLOR_LABELS: Record<AnnotationColor, string> = {
  yellow: "黄色",
  blue: "蓝色",
  green: "绿色",
  red: "红色",
  purple: "紫色",
};

export const ALL_COLORS: AnnotationColor[] = ["yellow", "blue", "green", "red", "purple"];
