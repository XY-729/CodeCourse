import { useCallback, useRef, useState } from "react";
import { askQuestionStream, type QAAskPayload, type QARecord } from "../api/client";
import { markDesktopPerformance } from "../performance/desktopPerformance";
import type { QAStreamTiming } from "../performance/qaTiming";
import { isAndroidRuntime } from "../platform/runtime";

export type QAGenerationState = { label: string; partial: string; request?: QAAskPayload };
export type QAOperationToken = symbol;
type Events = {
  onStart?: (key: string, payload: QAAskPayload, timing: QAStreamTiming) => void;
  onUpdate?: (key: string, state: QAGenerationState, timing: QAStreamTiming) => void;
  onComplete?: (key: string, record: QARecord, timing: QAStreamTiming) => void;
  onError?: (key: string, message: string) => void;
  onStop?: (key: string) => void;
};
export class QAStoppedError extends Error {
  constructor() { super("回答已停止，已生成内容保留在预览中"); this.name = "QAStoppedError"; }
}
const BUSY = "已有回答正在处理，请等待当前回答完成";

export function useQAGenerationController(projectId: number | null, events: Events = {}) {
  const [generations, setGenerations] = useState<Record<string, QAGenerationState>>({});
  const [draftId, setDraftId] = useState(1);
  const [operationPending, setOperationPending] = useState(false);
  const [canStop, setCanStop] = useState(false);
  const activeRequestRef = useRef<{ key: string; stop: () => void } | null>(null);
  const activeOperationRef = useRef<QAOperationToken | null>(null);
  const generationRunningRef = useRef(false);
  const operationTimingRef = useRef<QAStreamTiming | null>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const beginOperation = useCallback(() => {
    if (activeOperationRef.current || generationRunningRef.current) return null;
    const token = Symbol("qa-operation");
    activeOperationRef.current = token;
    operationTimingRef.current = { requestId: crypto.randomUUID(), startedAt: performance.now() };
    markDesktopPerformance("qa-clicked", { request_id: operationTimingRef.current.requestId, elapsed_ms: 0 });
    setOperationPending(true);
    return token;
  }, []);
  const endOperation = useCallback((token: QAOperationToken) => {
    if (activeOperationRef.current !== token) return;
    activeOperationRef.current = null;
    setOperationPending(false);
  }, []);
  const isOperationActive = useCallback(() => Boolean(activeOperationRef.current || generationRunningRef.current), []);
  const runStreamingQuestion = useCallback(async (
    payload: QAAskPayload, generationKey: string, operationToken: QAOperationToken,
  ): Promise<QARecord> => {
    if (!projectId) throw new Error("Project is not open");
    if (activeOperationRef.current !== operationToken || generationRunningRef.current) throw new Error(BUSY);
    generationRunningRef.current = true;
    let timing = operationTimingRef.current!;
    let state: QAGenerationState = { label: "准备回答", partial: "", request: payload };
    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstDelta = true;
    const abortController = new AbortController();
    let saving = false;
    const publish = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const snapshot = { ...state };
      setGenerations(current => ({ ...current, [generationKey]: snapshot }));
      eventsRef.current.onUpdate?.(generationKey, snapshot, timing);
    };
    try {
      if (!isAndroidRuntime()) {
        activeRequestRef.current = { key: generationKey, stop: () => {
          if (saving || abortController.signal.aborted) return;
          state = { ...state, label: "正在停止回答" }; publish();
          abortController.abort();
          setCanStop(false);
        } };
        setCanStop(true);
      }
      eventsRef.current.onStart?.(generationKey, payload, timing);
      publish();
      markDesktopPerformance("qa-request-sent", { request_id: timing.requestId, elapsed_ms: performance.now() - timing.startedAt });
      const requestPayload = isAndroidRuntime() ? payload : { ...payload, defer_metadata: true, request_id: timing.requestId };
      const record = await askQuestionStream(projectId, requestPayload, {
        onStage: (stage, label, elapsedMs) => {
          if (abortController.signal.aborted) return;
          if (stage === "saving") { saving = true; setCanStop(false); }
          markDesktopPerformance("qa-server-stage", { request_id: timing.requestId, stage, server_elapsed_ms: elapsedMs });
          state = { ...state, label }; publish();
        },
        onDelta: text => {
          if (abortController.signal.aborted) return;
          state = { ...state, partial: state.partial + text };
          if (firstDelta && text.trim()) {
            firstDelta = false;
            timing = { ...timing, firstDeltaAt: performance.now() };
            markDesktopPerformance("qa-first-delta", { request_id: timing.requestId, elapsed_ms: timing.firstDeltaAt! - timing.startedAt });
            publish();
          } else if (!timer) timer = setTimeout(publish, 50);
        },
      }, isAndroidRuntime() ? undefined : abortController.signal);
      if (abortController.signal.aborted) throw new QAStoppedError();
      publish();
      eventsRef.current.onComplete?.(generationKey, record, timing);
      markDesktopPerformance("qa-completed", { request_id: timing.requestId, elapsed_ms: performance.now() - timing.startedAt });
      return record;
    } catch (error) {
      publish();
      if (abortController.signal.aborted) {
        eventsRef.current.onStop?.(generationKey);
        throw new QAStoppedError();
      }
      eventsRef.current.onError?.(generationKey, error instanceof Error ? error.message : "生成回答失败");
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      activeRequestRef.current = null;
      setCanStop(false);
      generationRunningRef.current = false;
      setGenerations(current => { const next = { ...current }; delete next[generationKey]; return next; });
    }
  }, [projectId]);
  const stopGeneration = useCallback((key?: string) => {
    const request = activeRequestRef.current;
    if (request && (!key || request.key === key)) request.stop();
  }, []);
  const startNewDraft = useCallback(() => setDraftId(value => value + 1), []);
  const anyLoading = Object.keys(generations).length > 0;
  return { generations, draftId, startNewDraft, runStreamingQuestion, operationPending, stopGeneration, canStop,
    beginOperation, endOperation, isOperationActive, anyLoading, busy: operationPending || anyLoading };
}
