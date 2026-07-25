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

export function validateBaseCheckpoint(raw: unknown, expectedTaskType: string, expectedInputHash: string): BaseCheckpoint | null {
  if (!raw || typeof raw !== "object") return null;
  const cp = raw as Record<string, unknown>;
  if (cp.version !== CHECKPOINT_VERSION) return null;
  if (typeof cp.taskType !== "string" || cp.taskType !== expectedTaskType) return null;
  if (typeof cp.inputHash !== "string" || cp.inputHash !== expectedInputHash) return null;
  if (typeof cp.updatedAt !== "string" || !cp.updatedAt) return null;
  return { version: cp.version as number, taskType: cp.taskType, inputHash: cp.inputHash, updatedAt: cp.updatedAt };
}

export function validateOutlineCheckpoint(cp: BaseCheckpoint | null): cp is (BaseCheckpoint & { generated: boolean; generatedContent: string }) | null {
  if (!cp) return false;
  const raw = cp as Record<string, unknown>;
  if (typeof raw.generated !== "boolean" || !raw.generated) return false;
  if (typeof raw.generatedContent !== "string" || !raw.generatedContent.trim()) return false;
  return true;
}

export function validateDetailedLessonCheckpoint(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const cp = raw as Record<string, unknown>;
  // plan is required
  if (!cp.plan || typeof cp.plan !== "object") return null;
  const plan = cp.plan as Record<string, unknown>;
  if (!Array.isArray(plan.sections)) return null;
  // Each section must have title + items
  for (const s of plan.sections as Record<string, unknown>[]) {
    if (!s || typeof s !== "object") return null;
    if (typeof s.title !== "string") return null;
    if (!Array.isArray(s.items)) return null;
    for (const item of s.items as Record<string, unknown>[]) {
      if (!item || typeof item !== "object") return null;
      if (typeof item.name !== "string") return null;
      if (typeof item.kind !== "string") return null;
    }
  }
  // generatedByIndex is a map of index→string
  if (cp.generatedByIndex && typeof cp.generatedByIndex === "object") {
    for (const [k, v] of Object.entries(cp.generatedByIndex as Record<string, unknown>)) {
      if (!/^\d+$/.test(k)) return null;
      if (typeof v !== "string" || !v.trim()) return null;
    }
  }
  // repairGenerated is optional string
  if (cp.repairGenerated !== undefined && cp.repairGenerated !== null && typeof cp.repairGenerated !== "string") return null;
  return cp;
}

// ---- course group ----

export function courseGroupForTaskType(taskType: string): string {
  if (taskType === "outline") return "总纲";
  if (taskType === "file_lesson") return "文件课件";
  if (taskType === "outline_lesson") return "课件";
  throw new Error(`Unknown task type: ${taskType}`);
}

// ---- completion label ----

type TaskOutput = { filename: string; content: string };

export function buildCompletionLabel(taskType: string, projectName: string, output: TaskOutput): string {
  if (taskType === "outline") return `${projectName} · 学习总纲已生成`;
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
