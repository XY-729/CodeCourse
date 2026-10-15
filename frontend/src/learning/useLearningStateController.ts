import { useCallback, useEffect, useRef, useState } from "react";
import {
  resetLearningStates,
  getLearningStates,
  updateLearningState,
} from "../api/client";
import type {
  LearningState,
  LearningStateUpdate,
} from "../api/client";
import type { OpenItem } from "../workbench/layout";
import { TrailingSaveScheduler } from "./trailingSaveScheduler";
import { TEACHING_CHANGED } from "../personalization/teachingApi";

type Options = {
  projectId: number | null;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  /**
   * Course paths currently being streamed. While a course is being generated
   * the backend keeps the file unpublished (writes a `.streaming` temp file),
   * so PUT learning-state would 404 "Learning source not found". Skip saves
   * until generation finishes and the file is published.
   */
  streamingPaths?: () => ReadonlySet<string>;
};

function stateKey(
  sourceType: LearningState["source_type"],
  sourcePath: string,
) {
  return `${sourceType}:${sourcePath}`;
}

function clampPosition(
  kind: LearningState["position_kind"],
  value: number,
) {
  return kind === "scroll_ratio"
    ? Math.min(1, Math.max(0, value))
    : Math.max(1, Math.round(value));
}

export function useLearningStateController({
  projectId,
  onError,
  onStatus,
  streamingPaths,
}: Options) {
  const [states, setStates] = useState<LearningState[]>([]);
  const statesRef = useRef<LearningState[]>([]);
  const saveScheduler = useRef(new TrailingSaveScheduler(800));
  const pendingUpdates = useRef<Map<string, LearningStateUpdate>>(new Map());
  const updateSequences = useRef<Map<string, number>>(new Map());
  const inFlightSequences = useRef<Map<string, number>>(new Map());
  const inFlightPromises = useRef<Map<string, Promise<boolean>>>(new Map());
  const completionRequests = useRef(new Set<string>());
  const currentProjectId = useRef(projectId);
  currentProjectId.current = projectId;
  const statusCallback = useRef(onStatus);
  statusCallback.current = onStatus;
  const profilePending = states.some((state) => ["pending", "running"].includes(state.profile_status ?? ""));

  useEffect(() => {
    if (!projectId) return;
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const saved = await getLearningStates(projectId);
        if (disposed || currentProjectId.current !== projectId) return;
        let changed = false;
        let finished = false;
        const next = statesRef.current.map((old) => {
          const latest = saved.find((item) => item.id === old.id && item.status === old.status && item.completed_at === old.completed_at);
          if (!latest || (old.profile_status === latest.profile_status && old.profile_error === latest.profile_error && old.profile_concept_count === latest.profile_concept_count)) return old;
          changed = true;
          if (latest.profile_status === "completed" && ["pending", "running"].includes(old.profile_status ?? "")) {
            finished = true;
            statusCallback.current(`学习画像已更新，记录了 ${latest.profile_concept_count ?? 0} 个已学知识点，理解程度待验证`);
          }
          return { ...old, profile_status: latest.profile_status, profile_error: latest.profile_error, profile_concept_count: latest.profile_concept_count };
        });
        if (changed) { statesRef.current = next; setStates(next); }
        if (finished) window.dispatchEvent(new CustomEvent(TEACHING_CHANGED, { detail: { projectId } }));
      } catch { /* Progress stays saved; the next poll or reopening retries the read. */ }
      finally { refreshing = false; }
    };
    const onChanged = () => { void refresh(); };
    window.addEventListener(TEACHING_CHANGED, onChanged);
    const timer = profilePending ? window.setInterval(onChanged, 1500) : undefined;
    return () => { disposed = true; window.removeEventListener(TEACHING_CHANGED, onChanged); if (timer) window.clearInterval(timer); };
  }, [projectId, profilePending]);

  useEffect(() => {
    statesRef.current = states;
  }, [states]);

  useEffect(() => () => saveScheduler.current.cancelAll(), []);

  const replaceStates = useCallback((next: LearningState[]) => {
    statesRef.current = next;
    setStates(next);
  }, []);

  const findState = useCallback((
    sourceType: LearningState["source_type"],
    sourcePath: string,
  ) => (
    statesRef.current.find(
      (entry) => (
        entry.source_type === sourceType
        && entry.source_path === sourcePath
      ),
    )
  ), []);

  const persist = useCallback((
    targetProjectId: number,
    key: string,
    payload: LearningStateUpdate,
    sequence: number,
  ): Promise<boolean> => {
    const existing = inFlightPromises.current.get(key);
    if (inFlightSequences.current.get(key) === sequence && existing) return existing;
    inFlightSequences.current.set(key, sequence);
    const operation = (async () => {
      try {
        const saved = await updateLearningState(targetProjectId, payload);
        if (currentProjectId.current !== targetProjectId || updateSequences.current.get(key) !== sequence) return false;
        const previous = statesRef.current.find(
          (entry) => stateKey(entry.source_type, entry.source_path) === key,
        );
        const next = [
          ...statesRef.current.filter(
            (entry) => stateKey(entry.source_type, entry.source_path) !== key,
          ),
          saved,
        ];
        statesRef.current = next;

        // Ordinary scrolling only updates the ref. Course completion changes
        // render state because it affects visible progress controls.
        if (
          !previous
          || previous.status !== saved.status
          || previous.completed_at !== saved.completed_at
        ) {
          setStates(next);
        }
        return true;
      } catch (error) {
        if (currentProjectId.current === targetProjectId) onError(error instanceof Error ? error.message : "保存学习位置失败");
        return false;
      } finally {
        if (inFlightSequences.current.get(key) === sequence) {
          inFlightSequences.current.delete(key);
          inFlightPromises.current.delete(key);
        }
        if (updateSequences.current.get(key) === sequence) {
          pendingUpdates.current.delete(key);
        }
      }
    })();
    inFlightPromises.current.set(key, operation);
    return operation;
  }, [onError]);

  const queueUpdate = useCallback((
    sourceType: LearningState["source_type"],
    sourcePath: string,
    positionKind: LearningState["position_kind"],
    positionValue: number,
    status?: LearningState["status"],
    immediate = false,
  ) => {
    if (!projectId || !sourcePath) return;
    if (completionRequests.current.has(`${projectId}:${stateKey(sourceType, sourcePath)}`)) return;
    // A course that is still being streamed has no published file yet; the
    // backend would reject the save with 404. Drop the update (schedule it
    // again once the file exists).
    if (sourceType === "course" && streamingPaths?.().has(sourcePath)) return;
    const key = stateKey(sourceType, sourcePath);
    const existing = findState(sourceType, sourcePath);
    const payload: LearningStateUpdate = {
      source_type: sourceType,
      source_path: sourcePath,
      status: status ?? existing?.status ?? "in_progress",
      position_kind: positionKind,
      position_value: clampPosition(positionKind, positionValue),
    };
    pendingUpdates.current.set(key, payload);
    const sequence = (updateSequences.current.get(key) ?? 0) + 1;
    updateSequences.current.set(key, sequence);

    if (immediate) {
      saveScheduler.current.cancel(key);
      void persist(projectId, key, payload, sequence);
      return;
    }
    saveScheduler.current.schedule(key, () => {
      const latest = pendingUpdates.current.get(key);
      const latestSequence = updateSequences.current.get(key);
      if (latest && latestSequence != null) {
        void persist(projectId, key, latest, latestSequence);
      }
    });
  }, [findState, persist, projectId, streamingPaths]);

  const flushUpdate = useCallback((
    sourceType: LearningState["source_type"],
    sourcePath: string,
  ) => {
    if (!projectId) return;
    const key = stateKey(sourceType, sourcePath);
    const payload = pendingUpdates.current.get(key);
    const sequence = updateSequences.current.get(key);
    if (!payload || sequence == null) return;
    saveScheduler.current.flush(key, () => {
      void persist(projectId, key, payload, sequence);
    });
  }, [persist, projectId]);

  const flushAll = useCallback(async () => {
    if (!projectId) return;
    const saves: Promise<boolean>[] = [];
    for (const key of pendingUpdates.current.keys()) {
      const separator = key.indexOf(":");
      if (separator <= 0) continue;
      const payload = pendingUpdates.current.get(key);
      const sequence = updateSequences.current.get(key);
      if (!payload || sequence == null) continue;
      saveScheduler.current.cancel(key);
      saves.push(persist(projectId, key, payload, sequence));
    }
    await Promise.all(saves);
  }, [persist, projectId]);

  const touchOpenItem = useCallback((item: OpenItem) => {
    if (item.qaPreview || item.type === "file" || item.type === "knowledge_graph") return;
    const sourceType = item.type === "qa" || item.qaRecordId ? "qa" : "course";
    const existing = findState(sourceType, item.path);
    queueUpdate(
      sourceType,
      item.path,
      "scroll_ratio",
      existing?.position_value ?? 0,
      existing?.status,
    );
  }, [findState, queueUpdate]);

  const toggleLessonComplete = useCallback(async (filename: string) => {
    if (!projectId || streamingPaths?.().has(filename)) return false;
    const key = stateKey("course", filename);
    const requestKey = `${projectId}:${key}`;
    if (completionRequests.current.has(requestKey)) return false;
    completionRequests.current.add(requestKey);
    saveScheduler.current.cancel(key);
    pendingUpdates.current.delete(key);
    try {
    // Let an older scroll save settle before the explicit completion update.
    await inFlightPromises.current.get(key);
    if (currentProjectId.current !== projectId) return false;
    const existing = findState("course", filename);
    const nextStatus = existing?.status === "completed"
      ? "in_progress"
      : "completed";
    const sequence = (updateSequences.current.get(key) ?? 0) + 1;
    updateSequences.current.set(key, sequence);
    const saved = await persist(projectId, key, {
      source_type: "course",
      source_path: filename,
      status: nextStatus,
      position_kind: "scroll_ratio",
      position_value: existing?.position_value ?? 0,
    }, sequence);
    if (saved) {
      onStatus(nextStatus === "completed" ? "本课已完成，正在更新学习画像" : "已恢复为学习中，并撤销本课完成产生的画像证据");
      window.dispatchEvent(new CustomEvent(TEACHING_CHANGED, { detail: { projectId } }));
    }
    return saved;
    } finally { completionRequests.current.delete(requestKey); }
  }, [findState, onStatus, persist, projectId, streamingPaths]);

  const reset = useCallback(async () => {
    if (!projectId) return;
    await resetLearningStates(projectId);
    pendingUpdates.current.clear();
    updateSequences.current.clear();
    inFlightSequences.current.clear();
    saveScheduler.current.cancelAll();
    replaceStates([]);
    window.dispatchEvent(new CustomEvent(TEACHING_CHANGED, { detail: { projectId } }));
  }, [projectId, replaceStates]);

  return {
    states,
    replaceStates,
    findState,
    queueUpdate,
    flushUpdate,
    flushAll,
    touchOpenItem,
    toggleLessonComplete,
    reset,
  };
}
