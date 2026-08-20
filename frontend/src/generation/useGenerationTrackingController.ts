import { useCallback, useRef, useState } from "react";
import {
  getCourseFiles,
  getGenerationTask,
  getProject,
  listGenerationTasks,
  retryGenerationTask,
  type CourseFile,
  type GenerationTask,
  type Project,
} from "../api/client";
import { isGenerationTaskRunning, sortGenerationTasks } from "../components/generationTaskModel";
import { taskLabel } from "../app/appUtils";

type Options = {
  project: Project | null;
  getCurrentProjectId: () => number | null;
  acquireStartLock: () => boolean;
  releaseStartLock: () => void;
  isBusy: () => boolean;
  beginTracking: (projectId: number, taskId: number) => boolean;
  endTracking: (projectId: number, taskId: number) => void;
  replaceTasks: (projectId: number, tasks: GenerationTask[]) => GenerationTask[];
  upsertTask: (projectId: number, task: GenerationTask) => void;
  onProjectData: (project: Project, courses: CourseFile[]) => void;
  onOpenCourse: (projectId: number, path: string) => void | Promise<void>;
  onCompleted: (title: string, body: string) => void;
  onKnowledgeChanged: () => void;
  onShowMobileTasks: () => void;
  onDismissMobileGeneration: () => void;
  onMessage: (message: string) => void;
  onToast: (message: string) => void;
  onError: (message: string) => void;
};

export function useGenerationTrackingController(options: Options) {
  const [retryingTaskId, setRetryingTaskId] = useState<number | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const acquireStart = useCallback(() => {
    const current = optionsRef.current;
    if (!current.acquireStartLock()) {
      current.onToast("当前已有内容正在生成，请等待完成");
      return false;
    }
    return true;
  }, []);

  const rejectProjectMutationWhileBusy = useCallback(() => {
    const current = optionsRef.current;
    if (!current.isBusy()) return false;
    current.onToast("当前内容仍在生成，请完成后再切换或修改项目");
    return true;
  }, []);

  const trackTask = useCallback(async (projectId: number, initialTask: GenerationTask) => {
    const initial = optionsRef.current;
    if (!initial.beginTracking(projectId, initialTask.id)) return;
    let nextTask = initialTask;
    initial.upsertTask(projectId, nextTask);
    const trackingDeadline = Date.now() + 2 * 60 * 60 * 1000;
    let consecutiveErrors = 0;
    try {
      while (Date.now() < trackingDeadline) {
        if (!isGenerationTaskRunning(nextTask)) break;
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        try {
          nextTask = await getGenerationTask(projectId, initialTask.id);
          consecutiveErrors = 0;
          optionsRef.current.upsertTask(projectId, nextTask);
        } catch (caught) {
          consecutiveErrors += 1;
          if (consecutiveErrors >= 5) throw caught;
        }
      }

      const current = optionsRef.current;
      if (isGenerationTaskRunning(nextTask)) {
        if (current.getCurrentProjectId() === projectId) {
          current.onMessage("任务仍在后台生成，稍后会继续同步进度");
        }
        return;
      }
      if (current.getCurrentProjectId() !== projectId) return;
      const [courses, freshProject] = await Promise.all([getCourseFiles(projectId), getProject(projectId)]);
      if (optionsRef.current.getCurrentProjectId() !== projectId) return;
      optionsRef.current.onProjectData(freshProject, courses);

      if (nextTask.status === "completed") {
        const completed = optionsRef.current;
        completed.onMessage("生成完成");
        completed.onToast("内容已生成");
        completed.onCompleted("CodeCourse 生成完成", `${taskLabel(nextTask)}已经可以阅读。`);
        const outputPath = nextTask.output_path ?? (nextTask.task_type === "outline" ? "outline.md" : null);
        const preferred = outputPath
          ? courses.find((item) => item.filename === outputPath || outputPath.endsWith(`/${item.filename}`))
          : null;
        if (preferred) {
          await completed.onOpenCourse(projectId, preferred.filename);
          completed.onDismissMobileGeneration();
        }
        completed.onKnowledgeChanged();
      } else if (nextTask.status === "failed") {
        optionsRef.current.onMessage(`生成失败：${nextTask.error_message ?? "未知错误"}`);
      } else if (nextTask.status === "cancelled") {
        optionsRef.current.onMessage("生成已取消");
      }
    } catch (caught) {
      if (optionsRef.current.getCurrentProjectId() === projectId) {
        optionsRef.current.onError(caught instanceof Error ? `同步生成任务失败：${caught.message}` : "同步生成任务失败");
      }
    } finally {
      optionsRef.current.endTracking(projectId, initialTask.id);
    }
  }, []);

  const resumeTracking = useCallback((projectId: number, tasks: GenerationTask[]) => {
    if (optionsRef.current.getCurrentProjectId() !== projectId) return;
    tasks.forEach((task) => {
      if (isGenerationTaskRunning(task)) void trackTask(projectId, task);
    });
  }, [trackTask]);

  const reloadTasks = useCallback(async (projectId: number, shouldResume = true) => {
    const tasks = await listGenerationTasks(projectId);
    if (optionsRef.current.getCurrentProjectId() !== projectId) return sortGenerationTasks(tasks);
    const sorted = optionsRef.current.replaceTasks(projectId, tasks);
    if (shouldResume) resumeTracking(projectId, sorted);
    return sorted;
  }, [resumeTracking]);

  const retryTask = useCallback(async (task: GenerationTask) => {
    const current = optionsRef.current;
    if (!current.project || task.project_id !== current.project.id || !acquireStart()) return;
    if (retryingTaskId === task.id) {
      current.releaseStartLock();
      return;
    }
    setRetryingTaskId(task.id);
    current.onError("");
    try {
      const retried = await retryGenerationTask(current.project.id, task.id);
      optionsRef.current.upsertTask(current.project.id, retried);
      optionsRef.current.onShowMobileTasks();
      void trackTask(current.project.id, retried);
    } catch (caught) {
      optionsRef.current.onError(`重试失败：${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setRetryingTaskId(null);
      optionsRef.current.releaseStartLock();
    }
  }, [acquireStart, retryingTaskId, trackTask]);

  return {
    retryingTaskId,
    clearRetryingTask: () => setRetryingTaskId(null),
    acquireStart,
    rejectProjectMutationWhileBusy,
    resumeTracking,
    reloadTasks,
    trackTask,
    retryTask,
  };
}
