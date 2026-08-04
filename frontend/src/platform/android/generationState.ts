// Shared generation state logic used by both localProvider and tests.
// Do NOT copy implementations when testing — import from here.

export type ServiceState = "stopped" | "starting" | "running" | "stopping" | "unknown" | "failed";

export type ServiceSnapshot = {
  state: ServiceState;
  sessionId: number;
  taskId: number;
  activeTaskCount: number;
  generationSessionId: number;
  foregroundTaskId: number;
};

export const CHECKPOINT_VERSION = 1;

// ---- checkpoint validation ----

export type BaseCheckpoint = {
  version: number;
  taskType: string;
  inputHash: string;
  updatedAt: string;
};

export type OutlineCheckpoint = BaseCheckpoint & {
  generated: boolean;
  generatedContent: string;
};

export type DetailedLessonCheckpoint = BaseCheckpoint & {
  plan: LessonPlan;
  generatedByIndex: Record<string, string>;
  repairGenerated?: string | null;
};

export type LessonPlan = {
  lesson_title: string;
  position: string;
  objectives: string[];
  sections: LessonPlanSection[];
  textbooks: Array<{
    id: string;
    title: string;
    edition: string;
    authors: string[];
    topics: string[];
  }>;
};

export type LessonPlanSection = {
  title: string;
  items: Array<{ name: string; kind: string; focus: string }>;
};

function validateBaseFields(raw: Record<string, unknown>, expectedTaskType: string, expectedInputHash: string): boolean {
  if (raw.version !== CHECKPOINT_VERSION) return false;
  if (typeof raw.taskType !== "string" || raw.taskType !== expectedTaskType) return false;
  if (typeof raw.inputHash !== "string" || raw.inputHash !== expectedInputHash) return false;
  if (typeof raw.updatedAt !== "string" || !raw.updatedAt) return false;
  return true;
}

/** Full parser — validates AND returns all business fields. */
export function parseOutlineCheckpoint(
  raw: unknown, expectedTaskType: "outline" | "sub_outline" | "file_lesson", expectedInputHash: string,
): OutlineCheckpoint | null {
  if (!raw || typeof raw !== "object") return null;
  const cp = raw as Record<string, unknown>;
  if (!validateBaseFields(cp, expectedTaskType, expectedInputHash)) return null;
  if (typeof cp.generated !== "boolean" || !cp.generated) return null;
  if (typeof cp.generatedContent !== "string" || !cp.generatedContent.trim()) return null;
  return {
    version: cp.version as number, taskType: expectedTaskType,
    inputHash: expectedInputHash, updatedAt: cp.updatedAt as string,
    generated: true, generatedContent: cp.generatedContent,
  };
}

/** Full parser for detailed lesson — validates ALL fields and returns them. */
export function parseDetailedLessonCheckpoint(
  raw: unknown, expectedInputHash: string,
): DetailedLessonCheckpoint | null {
  if (!raw || typeof raw !== "object") return null;
  const cp = raw as Record<string, unknown>;
  if (!validateBaseFields(cp, "outline_lesson", expectedInputHash)) return null;

  // plan
  if (!cp.plan || typeof cp.plan !== "object") return null;
  const planRaw = cp.plan as Record<string, unknown>;
  if (!Array.isArray(planRaw.sections)) return null;
  const sections: LessonPlanSection[] = [];
  for (const s of planRaw.sections as Record<string, unknown>[]) {
    if (!s || typeof s !== "object") return null;
    if (typeof s.title !== "string" || !s.title.trim()) return null;
    if (!Array.isArray(s.items)) return null;
    const items: Array<{ name: string; kind: string; focus: string }> = [];
    for (const item of s.items as Record<string, unknown>[]) {
      if (!item || typeof item !== "object") return null;
      if (typeof item.name !== "string" || !item.name.trim()) return null;
      if (typeof item.kind !== "string" || !item.kind.trim()) return null;
      items.push({ name: item.name, kind: item.kind, focus: typeof item.focus === "string" ? item.focus : "" });
    }
    sections.push({ title: s.title, items });
  }

  const plan: LessonPlan = {
    lesson_title: typeof planRaw.lesson_title === "string" ? planRaw.lesson_title : "",
    position: typeof planRaw.position === "string" ? planRaw.position : "",
    objectives: Array.isArray(planRaw.objectives) ? planRaw.objectives.map(String) : [],
    sections,
    textbooks: Array.isArray(planRaw.textbooks) ? planRaw.textbooks as LessonPlan["textbooks"] : [],
  };

  // generatedByIndex
  const gbi: Record<string, string> = {};
  if (cp.generatedByIndex && typeof cp.generatedByIndex === "object") {
    for (const [k, v] of Object.entries(cp.generatedByIndex as Record<string, unknown>)) {
      if (!/^\d+$/.test(k)) continue; // skip invalid keys
      const idx = Number(k);
      if (idx < 0 || idx >= sections.length) continue; // out of bounds
      if (typeof v !== "string" || !v.trim()) continue;
      gbi[k] = v;
    }
  }

  // repairGenerated
  let repairGenerated: string | null = null;
  if (cp.repairGenerated !== undefined && cp.repairGenerated !== null) {
    if (typeof cp.repairGenerated !== "string") return null; // type mismatch = corrupt
    repairGenerated = cp.repairGenerated;
  }

  return {
    version: cp.version as number, taskType: "outline_lesson",
    inputHash: expectedInputHash, updatedAt: cp.updatedAt as string,
    plan, generatedByIndex: gbi, repairGenerated,
  };
}

// Export the full parsers — these are the ONLY entry points for production checkpoint recovery.
// Legacy wrappers below remain for existing caller compatibility but delegate to full parsers.

/** @deprecated Use parseOutlineCheckpoint instead */
export function validateBaseCheckpoint(raw: unknown, expectedTaskType: string, expectedInputHash: string): BaseCheckpoint | null {
  if (!raw || typeof raw !== "object") return null;
  const cp = raw as Record<string, unknown>;
  if (cp.version !== CHECKPOINT_VERSION) return null;
  if (typeof cp.taskType !== "string" || cp.taskType !== expectedTaskType) return null;
  if (typeof cp.inputHash !== "string" || cp.inputHash !== expectedInputHash) return null;
  if (typeof cp.updatedAt !== "string" || !cp.updatedAt) return null;
  return { version: cp.version as number, taskType: cp.taskType, inputHash: cp.inputHash, updatedAt: cp.updatedAt };
}

// ---- course group ----

export function courseGroupForTaskType(taskType: string): string {
  if (taskType === "outline" || taskType === "sub_outline") return "总纲";
  if (taskType === "file_lesson") return "文件课件";
  if (taskType === "outline_lesson") return "课件";
  throw new Error(`Unknown task type: ${taskType}`);
}

// ---- completion label ----

type TaskOutput = { filename: string; content: string };

export function buildCompletionLabel(taskType: string, projectName: string, output: TaskOutput): string {
  if (taskType === "outline") return `${projectName} · 学习总纲已生成`;
  if (taskType === "sub_outline") return `${projectName} · 子学习总纲已生成`;
  if (taskType === "file_lesson") {
    const fileName = output.filename.split("/").pop() ?? output.filename;
    return `${projectName} · ${fileName} 的文件课件已生成`;
  }
  const h1 = output.content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "课件";
  if (/^第\s*\d+\s*课/.test(h1)) return `${projectName} · ${h1}已生成`;
  return `${projectName} · ${h1}已生成`;
}

// ---- progress throttle ----

export function shouldSendProgress(
  firstUpdate: boolean, labelChanged: boolean, indeterminateChanged: boolean,
  isComplete: boolean, stale: boolean, pctChanged: boolean,
): boolean {
  if (firstUpdate || labelChanged || indeterminateChanged || isComplete) return true;
  return stale || pctChanged;
}

// ---- retry eligibility ----

export function canRetry(status: string): boolean {
  return status === "failed" || status === "cancelled";
}

// ---- slim checkpoint for completed tasks ----

export function buildSlimCheckpoint(taskType: string, inputHash: string, outputPath: string): Record<string, unknown> {
  return {
    version: CHECKPOINT_VERSION,
    taskType,
    inputHash,
    completed: true,
    outputPath,
    completedAt: new Date().toISOString(),
  };
}

// ---- service state transitions ----

export function serviceStateTransition(
  current: ServiceState,
  target: ServiceState,
  validTargets: ServiceState[],
): ServiceState {
  if (validTargets.includes(current)) return target;
  return current;
}

// ---- permission notice ----

export type NotificationPermissionStatus =
  | "granted" | "denied" | "denied_permanently"
  | "notifications_disabled" | "not_required" | "no_activity" | "error";

export type NotificationPermissionResult = {
  granted: boolean;
  status: NotificationPermissionStatus;
  canAskAgain: boolean;
};

export type PermissionNotice = {
  status: NotificationPermissionStatus;
  message: string;
  showSettingsAction: boolean;
} | null;

export type BatteryNotice = {
  message: string;
} | null;

/** Notice channel emitted by the provider; `null` clears both banners. */
export type ProviderNotice =
  | { kind: "permission"; notice: Exclude<PermissionNotice, null> }
  | { kind: "battery"; notice: Exclude<BatteryNotice, null> }
  | null;

export function batteryNotice(ignoring: boolean): BatteryNotice {
  if (ignoring) return null;
  return {
    message: "后台生成可能被系统停止。建议在电池设置中允许 CodeCourse 后台运行。",
  };
}

export function permissionNotice(result: NotificationPermissionResult): PermissionNotice {
  switch (result.status) {
    case "denied":
      return { status: "denied", message: "生成仍会继续，但后台进度和完成提醒可能不可见。", showSettingsAction: false };
    case "denied_permanently":
      return { status: "denied_permanently", message: "生成仍会继续，但后台进度和完成提醒可能不可见。", showSettingsAction: true };
    case "notifications_disabled":
      return { status: "notifications_disabled", message: "系统已关闭 CodeCourse 通知。生成仍会继续，但后台提醒不可见。", showSettingsAction: true };
    case "no_activity":
    case "error":
    case "not_required":
    case "granted":
    default:
      return null;
  }
}
