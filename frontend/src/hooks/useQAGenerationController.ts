import { useCallback, useRef, useState } from "react";
import { askQuestionStream, type QAAskPayload, type QARecord } from "../api/client";
import { markDesktopPerformance } from "../performance/desktopPerformance";
import type { QAStreamTiming } from "../performance/qaTiming";
import { isAndroidRuntime } from "../platform/runtime";

export type QAGenerationState = { label: string; partial: string };
export type QAOperationToken = symbol;
type Events = {
  onStart?: (key: string, payload: QAAskPayload, timing: QAStreamTiming) => void;
  onUpdate?: (key: string, state: QAGenerationState, timing: QAStreamTiming) => void;
  onComplete?: (key: string, record: QARecord, timing: QAStreamTiming) => void;
  onError?: (key: string, message: string) => void;
};
const BUSY = "已有回答正在处理，请等待当前回答完成";

export function useQAGenerationController(projectId: number | null, events: Events = {}) {
  const [generations, setGenerations] = useState<Record<string, QAGenerationState>>({});
  const [draftId, setDraftId] = useState(1);
  const [operationPending, setOperationPending] = useState(false);
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
    let state: QAGenerationState = { label: "准备回答", partial: "" };
    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstDelta = true;
    const publish = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const snapshot = { ...state };
      setGenerations(current => ({ ...current, [generationKey]: snapshot }));
      eventsRef.current.onUpdate?.(generationKey, snapshot, timing);
    };
    try {
      eventsRef.current.onStart?.(generationKey, payload, timing);
      publish();
      markDesktopPerformance("qa-request-sent", { request_id: timing.requestId, elapsed_ms: performance.now() - timing.startedAt });
      const requestPayload = isAndroidRuntime() ? payload : { ...payload, defer_metadata: true, request_id: timing.requestId };
      const record = await askQuestionStream(projectId, requestPayload, {
        onStage: (stage, label, elapsedMs) => {
          markDesktopPerformance("qa-server-stage", { request_id: timing.requestId, stage, server_elapsed_ms: elapsedMs });
          state = { ...state, label }; publish();
        },
        onDelta: text => {
          state = { ...state, partial: state.partial + text };
          if (firstDelta && text.trim()) {
            firstDelta = false;
            timing = { ...timing, firstDeltaAt: performance.now() };
            markDesktopPerformance("qa-first-delta", { request_id: timing.requestId, elapsed_ms: timing.firstDeltaAt! - timing.startedAt });
            publish();
          } else if (!timer) timer = setTimeout(publish, 50);
        },
      });
      publish();
      eventsRef.current.onComplete?.(generationKey, record, timing);
      markDesktopPerformance("qa-completed", { request_id: timing.requestId, elapsed_ms: performance.now() - timing.startedAt });
      return record;
    } catch (error) {
      publish();
      eventsRef.current.onError?.(generationKey, error instanceof Error ? error.message : "生成回答失败");
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      generationRunningRef.current = false;
      setGenerations(current => { const next = { ...current }; delete next[generationKey]; return next; });
    }
  }, [projectId]);
  const startNewDraft = useCallback(() => setDraftId(value => value + 1), []);
  const anyLoading = Object.keys(generations).length > 0;
  return { generations, draftId, startNewDraft, runStreamingQuestion, operationPending,
    beginOperation, endOperation, isOperationActive, anyLoading, busy: operationPending || anyLoading };
}
