import {
  useCallback,
  useRef,
  useState,
} from "react";

import {
  askQuestionStream,
} from "../api/client";

import type {
  QAAskPayload,
  QARecord,
} from "../api/client";

export type QAGenerationState = {
  label: string;
  partial: string;
};

export type QAOperationToken =
  symbol;

const QA_BUSY_MESSAGE =
  "已有回答正在处理，请等待当前回答完成";

export function useQAGenerationController(
  projectId: number | null,
) {
  const [
    generations,
    setGenerations,
  ] = useState<
    Record<
      string,
      QAGenerationState
    >
  >({});

  const [
    draftId,
    setDraftId,
  ] = useState(1);

  const [
    operationPending,
    setOperationPending,
  ] = useState(false);

  /*
   * activeOperationRef:
   * 从确认框出现前一直持有到整个操作结束。
   *
   * generationRunningRef:
   * 防止同一个 token 重复调用流式生成。
   */
  const activeOperationRef =
    useRef<
      QAOperationToken | null
    >(null);

  const generationRunningRef =
    useRef(false);

  const beginOperation =
    useCallback(
      (): QAOperationToken | null => {
        if (
          activeOperationRef.current ||
          generationRunningRef.current
        ) {
          return null;
        }

        const token:
          QAOperationToken =
          Symbol("qa-operation");

        activeOperationRef.current =
          token;

        setOperationPending(true);

        return token;
      },
      [],
    );

  const endOperation =
    useCallback(
      (
        token:
          QAOperationToken,
      ) => {
        /*
         * 旧操作不能释放一个更新的操作。
         */
        if (
          activeOperationRef.current !==
          token
        ) {
          return;
        }

        activeOperationRef.current =
          null;

        setOperationPending(false);
      },
      [],
    );

  const isOperationActive =
    useCallback(() => {
      return (
        activeOperationRef.current !==
          null ||
        generationRunningRef.current
      );
    }, []);

  const runStreamingQuestion =
    useCallback(
      async (
        payload: QAAskPayload,
        generationKey: string,
        operationToken:
          QAOperationToken,
      ): Promise<QARecord> => {
        if (!projectId) {
          throw new Error(
            "Project is not open",
          );
        }

        /*
         * 不能绕过 beginOperation() 直接生成。
         */
        if (
          activeOperationRef.current !==
          operationToken
        ) {
          throw new Error(
            QA_BUSY_MESSAGE,
          );
        }

        /*
         * 同一个操作也只能启动一次流式请求。
         */
        if (
          generationRunningRef.current
        ) {
          throw new Error(
            QA_BUSY_MESSAGE,
          );
        }

        generationRunningRef.current =
          true;

        setGenerations(
          (current) => ({
            ...current,

            [generationKey]: {
              label: "检索上下文",
              partial: "",
            },
          }),
        );

        try {
          return await askQuestionStream(
            projectId,
            payload,
            {
              onStage: (
                _stage,
                label,
              ) => {
                setGenerations(
                  (current) =>
                    current[
                      generationKey
                    ]
                      ? {
                          ...current,

                          [generationKey]:
                            {
                              ...current[
                                generationKey
                              ],

                              label,
                            },
                        }
                      : current,
                );
              },

              onDelta: (text) => {
                setGenerations(
                  (current) =>
                    current[
                      generationKey
                    ]
                      ? {
                          ...current,

                          [generationKey]:
                            {
                              ...current[
                                generationKey
                              ],

                              partial:
                                current[
                                  generationKey
                                ]
                                  .partial +
                                text,
                            },
                        }
                      : current,
                );
              },
            },
          );
        } finally {
          generationRunningRef.current =
            false;

          setGenerations(
            (current) => {
              const next = {
                ...current,
              };

              delete next[
                generationKey
              ];

              return next;
            },
          );
        }
      },
      [projectId],
    );

  const startNewDraft =
    useCallback(() => {
      setDraftId(
        (value) => value + 1,
      );
    }, []);

  const anyLoading =
    Object.keys(generations)
      .length > 0;

  return {
    generations,
    draftId,

    startNewDraft,
    runStreamingQuestion,

    operationPending,
    beginOperation,
    endOperation,
    isOperationActive,

    anyLoading,

    busy:
      operationPending ||
      anyLoading,
  };
}
