import { useCallback, useState } from "react";
import { askQuestionStream } from "../api/client";
import type { QAAskPayload, QARecord } from "../api/client";

export type QAGenerationState = {
  label: string;
  partial: string;
};

export function useQAGenerationController(projectId: number | null) {
  const [generations, setGenerations] = useState<Record<string, QAGenerationState>>({});
  const [draftId, setDraftId] = useState(1);

  const runStreamingQuestion = useCallback(async (
    payload: QAAskPayload,
    generationKey: string,
  ): Promise<QARecord> => {
    if (!projectId) throw new Error("Project is not open");
    setGenerations((current) => ({
      ...current,
      [generationKey]: { label: "检索上下文", partial: "" },
    }));
    try {
      return await askQuestionStream(projectId, payload, {
        onStage: (_stage, label) => {
          setGenerations((current) => current[generationKey]
            ? {
              ...current,
              [generationKey]: { ...current[generationKey], label },
            }
            : current);
        },
        onDelta: (text) => {
          setGenerations((current) => current[generationKey]
            ? {
              ...current,
              [generationKey]: {
                ...current[generationKey],
                partial: current[generationKey].partial + text,
              },
            }
            : current);
        },
      });
    } finally {
      setGenerations((current) => {
        const next = { ...current };
        delete next[generationKey];
        return next;
      });
    }
  }, [projectId]);

  const startNewDraft = useCallback(() => {
    setDraftId((value) => value + 1);
  }, []);

  return {
    generations,
    draftId,
    startNewDraft,
    runStreamingQuestion,
    anyLoading: Object.keys(generations).length > 0,
  };
}
