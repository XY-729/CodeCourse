import type {
  CourseFile,
  GenerationTask,
  LearningScope,
  ProjectIndexStatus,
  QARecord,
  TreeNode,
} from "../api/client";

type ScopeType = LearningScope["type"];

export function parseScopePaths(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

export function parentDir(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

export function taskLabel(task: GenerationTask): string {
  const type = task.task_type === "file_lesson" ? "文件课件" : task.task_type === "outline_lesson" ? "按课课件" : "项目总纲";
  return `${type} / ${task.status}`;
}

export function isLessonPath(path: string): boolean {
  return /^lessons\/lesson_\d+\.md$/i.test(path);
}

export function pickDefaultCourse(courses: CourseFile[], recentCourse: CourseFile | null | undefined): CourseFile | null {
  return courses.find((file) => file.filename === "outline.md")
    ?? recentCourse
    ?? courses.find((file) => isLessonPath(file.filename))
    ?? courses[0]
    ?? null;
}

export function resetGenerationScope(
  isLearningPlanProject: boolean,
  currentScope: ScopeType,
): { scopeType: ScopeType; selectedScopeFiles: string[] } {
  if (isLearningPlanProject) return { scopeType: currentScope, selectedScopeFiles: [] };
  return { scopeType: "full_project", selectedScopeFiles: [] };
}

export function flattenTree(node: TreeNode | null): TreeNode[] {
  if (!node) return [];
  return [node, ...node.children.flatMap((child) => flattenTree(child))];
}

export function taskStatusMessage(task: GenerationTask): string {
  if (task.stage_label) {
    const progress = task.progress_total > 0 ? ` (${task.progress_current}/${task.progress_total})` : "";
    return `${task.stage_label}${progress}`;
  }
  return taskLabel(task);
}

export function indexStatusMessage(status: ProjectIndexStatus | null): string {
  if (!status) return "索引未构建";
  const stageLabel: Record<string, string> = {
    scanning: "正在扫描文件",
    comparing: "正在对比文件变化",
    building_text_index: "正在构建文本索引",
    building_structural_index: "正在分析调用关系",
    switching_generation: "正在切换索引版本",
    cleaning_old_generation: "正在清理旧索引",
    completed: "索引完成",
    failed: "索引失败",
    cancelled: "索引已取消",
  };
  if (status.stage && stageLabel[status.stage]) {
    const parts = [stageLabel[status.stage]];
    if (status.progress_total && status.progress_total > 0) {
      parts.push(`(${status.progress_current}/${status.progress_total})`);
    }
    return parts.join(" ");
  }
  if (status.text_status === "building") return "正在构建基础索引";
  if (status.structural_status === "building") return "基础索引完成，正在分析调用关系";
  if (status.structural_status === "completed") {
    const graphSize = status.node_count ? ` · ${status.node_count} 个结构节点` : "";
    return `结构索引已完成${graphSize}`;
  }
  if (status.text_status === "completed") {
    const degraded = status.degraded_reason ? `（${status.degraded_reason.slice(0, 60)}）` : "";
    return `基础索引已完成${degraded}`;
  }
  if (status.status === "failed") {
    if (status.active_generation && status.active_generation > 1) {
      return "新版索引构建失败，当前仍在使用上一版索引。";
    }
    return "索引失败";
  }
  if (status.status === "building" && status.active_generation && status.active_generation > 0) {
    const buildGen = status.building_generation ? ` gen ${status.building_generation}` : "";
    return `正在构建新版索引${buildGen}，搜索仍使用 gen ${status.active_generation}。`;
  }
  if (status.status === "completed") {
    const parts: string[] = [status.chunk_count ? `${status.chunk_count} 个片段` : ""];
    if (status.active_generation) parts.push(`gen ${status.active_generation}`);
    if (status.degraded_reason) parts.push(`(${status.degraded_reason.slice(0, 40)})`);
    if (status.failed_files) parts.push(`${status.failed_files} 个文件失败`);
    if (status.last_good_index_at) {
      try {
        const date = new Date(status.last_good_index_at);
        parts.push(date.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
      } catch {
        // Invalid diagnostic timestamps should not obscure the usable index state.
      }
    }
    return parts.join(" · ") || "索引完成";
  }
  return `${status.status} · ${status.chunk_count} 个文本片段`;
}

export function qaTitle(record: QARecord): string {
  return record.display_title?.trim() || `回答 #${record.id}`;
}

export function normalizeOutputPath(
  outputPath: string | null | undefined,
  recordId: number,
  projectId: number,
): string {
  if (!outputPath) return `qa/${recordId}`;
  const normalized = outputPath.replace(/\\/g, "/");
  if (!normalized.startsWith("/")) return normalized;
  const marker = `generated/${projectId}/`;
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex !== -1) return normalized.slice(markerIndex + marker.length);
  const generatedIndex = normalized.lastIndexOf("generated/");
  if (generatedIndex !== -1) {
    const afterGenerated = normalized.slice(generatedIndex + "generated/".length);
    const slashIndex = afterGenerated.indexOf("/");
    return slashIndex !== -1 ? afterGenerated.slice(slashIndex + 1) : afterGenerated;
  }
  return `qa/${recordId}`;
}
