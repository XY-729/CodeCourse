import type {
  GenerationTask,
} from "../api/client";

export const TERMINAL_GENERATION_STATUSES =
  new Set([
    "completed",
    "failed",
    "cancelled",
  ]);

export function isGenerationTaskRunning(
  task: GenerationTask,
): boolean {
  return !TERMINAL_GENERATION_STATUSES.has(
    task.status,
  );
}

export function isRetryableGenerationTask(
  task: GenerationTask,
): boolean {
  return (
    task.status === "failed" ||
    task.status === "cancelled"
  );
}

function taskTime(
  task: GenerationTask,
): number {
  const value = Date.parse(
    task.updated_at ||
      task.created_at,
  );

  return Number.isFinite(value)
    ? value
    : task.id;
}

export function sortGenerationTasks(
  tasks: GenerationTask[],
): GenerationTask[] {
  return [...tasks].sort(
    (left, right) => {
      const timeDifference =
        taskTime(right) -
        taskTime(left);

      if (timeDifference !== 0) {
        return timeDifference;
      }

      return right.id - left.id;
    },
  );
}

export function upsertGenerationTask(
  tasks: GenerationTask[],
  task: GenerationTask,
): GenerationTask[] {
  return sortGenerationTasks([
    task,

    ...tasks.filter(
      (item) =>
        item.id !== task.id,
    ),
  ]);
}

export function selectPrimaryGenerationTask(
  tasks: GenerationTask[],
): GenerationTask | null {
  const sorted =
    sortGenerationTasks(tasks);

  return (
    sorted.find(
      isGenerationTaskRunning,
    ) ??
    sorted[0] ??
    null
  );
}

export function generationTaskProgress(
  task: GenerationTask,
): number | null {
  if (
    task.progress_total <= 0
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (
          task.progress_current /
          task.progress_total
        ) * 100,
      ),
    ),
  );
}

function fileName(
  path: string,
): string {
  const normalized =
    path.replace(/\\/g, "/");

  return (
    normalized
      .split("/")
      .filter(Boolean)
      .pop() ??
    normalized
  );
}

export function generationTaskTitle(
  task: GenerationTask,
): string {
  if (
    task.task_type ===
    "outline"
  ) {
    return "学习总纲";
  }

  if (
    task.task_type ===
    "outline_lesson"
  ) {
    if (task.output_path) {
      return fileName(
        task.output_path,
      );
    }

    return "课程课件";
  }

  if (
    task.task_type ===
    "file_lesson"
  ) {
    const mode =
      task.mode === "detailed"
        ? "详细分析"
        : "粗略介绍";

    if (task.source_path) {
      return (
        `${fileName(
          task.source_path,
        )} · ${mode}`
      );
    }

    return mode;
  }

  return "生成任务";
}

export function generationTaskStatusText(
  task: GenerationTask,
): string {
  if (task.stage_label) {
    if (
      task.progress_total > 0
    ) {
      return (
        `${task.stage_label} ` +
        `${task.progress_current}/` +
        `${task.progress_total}`
      );
    }

    return task.stage_label;
  }

  switch (task.status) {
    case "queued":
      return "正在排队";

    case "running":
      return "正在生成";

    case "completed":
      return "生成完成";

    case "failed":
      return "生成失败";

    case "cancelled":
      return "生成已取消";

    default:
      return task.status;
  }
}

export function generationTaskDate(
  task: GenerationTask,
): string {
  const date = new Date(
    task.updated_at ||
      task.created_at,
  );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "";
  }

  return date.toLocaleString(
    "zh-CN",
    {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );
}
