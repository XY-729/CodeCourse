export type PromptTemplateMetadata = {
  key: string;
  label: string;
  description: string;
  required_placeholders: string[];
  default?: string;
  current?: string;
};

const DEFINITIONS: Record<string, Omit<PromptTemplateMetadata, "key">> = {
  "prompt.system": {
    label: "总体要求",
    description: "可编辑的通用教学原则。不可变安全规则和任务输出格式由系统另行注入。",
    required_placeholders: [],
  },
  "prompt.outline": {
    label: "总纲生成",
    description: "根据真实仓库材料生成项目地图和课程总纲。",
    required_placeholders: ["model", "scope_text", "user_instructions", "prompt_input"],
  },
  "prompt.file_lesson.template": {
    label: "课件模板",
    description: "把文件内容与详细/粗略教学要求组合成文件课件。",
    required_placeholders: [
      "mode_label", "relative_path", "user_instructions",
      "model", "expected", "prompt_input",
    ],
  },
  "prompt.file_lesson.detailed_expected": {
    label: "详细生成",
    description: "详细文件课件需要优先覆盖的教学内容。",
    required_placeholders: [],
  },
  "prompt.file_lesson.brief_expected": {
    label: "粗略介绍",
    description: "快速文件导读的教学内容和证据边界。",
    required_placeholders: [],
  },
  "prompt.outline_lesson": {
    label: "项目课件生成",
    description: "根据项目总纲与真实检索证据展开一节项目课件。",
    required_placeholders: [
      "lesson_number", "lesson_title", "user_instructions", "lesson_input",
    ],
  },
  "prompt.learning_plan.outline": {
    label: "学习计划总纲",
    description: "生成不绑定仓库的学习路线和可验证目标。",
    required_placeholders: ["model", "user_instructions"],
  },
  "prompt.learning_plan.lesson": {
    label: "学习计划课件",
    description: "控制分章节正文与最终整合阶段共同遵守的教学原则。",
    required_placeholders: [],
  },
  "prompt.qa.answer": {
    label: "AI 助手",
    description: "根据问题目标、画像和项目上下文选择回答尺度。",
    required_placeholders: [
      "source_type", "source_path", "question", "session_context", "context_text",
    ],
  },
};

export const PROMPT_TEMPLATE_KEYS = Object.keys(DEFINITIONS);

export const PROMPT_PREVIEW_VALUES: Record<string, string> = {
  model: "example-model",
  scope_text: "full_project",
  user_instructions: "重点解释真实控制流。",
  prompt_input: "[示例仓库材料]",
  mode_label: "详细分析",
  relative_path: "src/example.ts",
  expected: "[详细生成要求]",
  lesson_number: "2",
  lesson_title: "请求到响应的主流程",
  lesson_input: "[示例总纲与代码证据]",
  source_type: "course",
  source_path: "lessons/lesson_02.md",
  question: "这段逻辑为什么需要队列？",
  session_context: "[示例会话记忆]",
  context_text: "[示例选区与检索上下文]",
};

export function promptTemplateMetadata(
  defaults: Record<string, string>,
  current: Record<string, string>,
): PromptTemplateMetadata[] {
  return PROMPT_TEMPLATE_KEYS.map((key) => ({
    key,
    ...DEFINITIONS[key],
    default: defaults[key] || "",
    current: current[key] ?? defaults[key] ?? "",
  }));
}

export function validatePromptTemplate(key: string, value: string): string[] {
  const definition = DEFINITIONS[key];
  if (!definition) return ["未知提示词模板。"];
  if (!value.trim()) return ["提示词不能为空。"];
  const fields = new Set<string>();
  for (const match of value.matchAll(/\{([a-z_][a-z0-9_]*)\}/gi)) fields.add(match[1]);
  const remainder = value
    .replace(/\{([a-z_][a-z0-9_]*)\}/gi, "")
    .replace(/\{\{/g, "")
    .replace(/\}\}/g, "");
  const errors: string[] = [];
  if (/[{}]/.test(remainder)) errors.push("花括号格式无效或包含不支持的占位符。");
  const required = new Set(definition.required_placeholders);
  const missing = [...required].filter((field) => !fields.has(field));
  const unexpected = [...fields].filter((field) => !required.has(field));
  if (missing.length) {
    errors.push(`缺少必要占位符：${missing.map((field) => `{${field}}`).join("、")}`);
  }
  if (unexpected.length) {
    errors.push(`存在未知占位符：${unexpected.map((field) => `{${field}}`).join("、")}`);
  }
  return errors;
}

export function previewPromptTemplate(key: string, value: string): string {
  const errors = validatePromptTemplate(key, value);
  if (errors.length) throw new Error(errors.join("\n"));
  return value.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (_match, field: string) =>
    PROMPT_PREVIEW_VALUES[field] ?? `{${field}}`
  );
}
