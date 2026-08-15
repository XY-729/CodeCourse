import { useCallback, useRef, useState } from "react";
import type { GenerationTask } from "../api/client";
import {
  isGenerationTaskRunning,
  selectPrimaryGenerationTask,
  sortGenerationTasks,
  upsertGenerationTask,
} from "../components/generationTaskModel";

type Options = {
  getCurrentProjectId: () => number | null;
  taskMessage: (task: GenerationTask) => string;
  onMessage: (message: string) => void;
};

export function useGenerationTaskController({
  getCurrentProjectId,
  taskMessage,
  onMessage,
}: Options) {
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [activeTask, setActiveTask] = useState<GenerationTask | null>(null);
  const [starting, setStarting] = useState(false);
  const tasksRef = useRef<GenerationTask[]>([]);
  const startLockRef = useRef(false);
  const trackedTasksRef = useRef<Set<string>>(new Set());

  const publish = useCallback((next: GenerationTask[]) => {
    tasksRef.current = next;
    setTasks(next);
    const primary = selectPrimaryGenerationTask(next);
    setActiveTask(primary);
    onMessage(primary ? taskMessage(primary) : "待生成");
  }, [onMessage, taskMessage]);

  const replaceTasks = useCallback((projectId: number, nextTasks: GenerationTask[]) => {
    const sorted = sortGenerationTasks(nextTasks);
    if (getCurrentProjectId() === projectId) publish(sorted);
    return sorted;
  }, [getCurrentProjectId, publish]);

  const upsertTask = useCallback((projectId: number, task: GenerationTask) => {
    if (getCurrentProjectId() !== projectId) return false;
    publish(upsertGenerationTask(tasksRef.current, task));
    return true;
  }, [getCurrentProjectId, publish]);

  const isBusy = useCallback(() => (
    startLockRef.current || tasksRef.current.some(isGenerationTaskRunning)
  ), []);

  const acquireStart = useCallback(() => {
    if (isBusy()) return false;
    startLockRef.current = true;
    setStarting(true);
    return true;
  }, [isBusy]);

  const releaseStart = useCallback(() => {
    startLockRef.current = false;
    setStarting(false);
  }, []);

  const beginTracking = useCallback((projectId: number, taskId: number) => {
    const key = `${projectId}:${taskId}`;
    if (trackedTasksRef.current.has(key)) return false;
    trackedTasksRef.current.add(key);
    return true;
  }, []);

  const endTracking = useCallback((projectId: number, taskId: number) => {
    trackedTasksRef.current.delete(`${projectId}:${taskId}`);
  }, []);

  const reset = useCallback(() => {
    tasksRef.current = [];
    startLockRef.current = false;
    trackedTasksRef.current.clear();
    setTasks([]);
    setActiveTask(null);
    setStarting(false);
  }, []);

  return {
    tasks,
    activeTask,
    starting,
    busy: starting || tasks.some(isGenerationTaskRunning),
    replaceTasks,
    upsertTask,
    isBusy,
    acquireStart,
    releaseStart,
    beginTracking,
    endTracking,
    reset,
  };
}
