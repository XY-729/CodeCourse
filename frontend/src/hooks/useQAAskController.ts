import { useCallback, useRef } from "react";
import type { LLMSettings, QAAskPayload, QARecord } from "../api/client";
import type { ConfirmActionOptions } from "./useAppDialog";
import type { QAOperationToken } from "./useQAGenerationController";

type SelectionRange = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

type AskContext = Pick<
  QAAskPayload,
  "source_type" | "source_path" | "selected_text" | "context_files"
>;

type Options = {
  projectId: number | null;
  settings: LLMSettings | null;
  sessionId: number | null;
  parentQAId: number | null;
  selectionRange?: SelectionRange;
  generationKey: string;
  interactionBusy: boolean;
  beginOperation: () => QAOperationToken | null;
  endOperation: (token: QAOperationToken) => void;
  isOperationActive: () => boolean;
  runStreamingQuestion: (
    payload: QAAskPayload,
    generationKey: string,
    operationToken: QAOperationToken,
  ) => Promise<QARecord>;
  buildContext: () => AskContext;
  confirm: (
    title: string,
    message: string,
    options?: ConfirmActionOptions,
  ) => Promise<boolean>;
  onToast: (message: string) => void;
  onPanelError: (message: string) => void;
  onAnswerComplete: (record: QARecord, projectId: number) => void | Promise<void>;
};

export function useQAAskController(options: Options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const acquireOperation = useCallback(() => {
    const current = optionsRef.current;
    const token = current.beginOperation();
    if (!token) current.onToast("已有回答正在处理，请等待完成");
    return token;
  }, []);

  const isBusy = useCallback(() => {
    const current = optionsRef.current;
    return current.interactionBusy || current.isOperationActive();
  }, []);

  const rejectProjectMutationWhileBusy = useCallback(() => {
    const current = optionsRef.current;
    if (!current.interactionBusy && !current.isOperationActive()) return false;
    current.onToast("当前回答仍在处理，请完成后再切换或修改项目");
    return true;
  }, []);

  const ask = useCallback(async (question: string) => {
    const current = optionsRef.current;
    const trimmedQuestion = question.trim();
    if (
      !current.projectId
      || !trimmedQuestion
      || !current.settings?.enabled
      || !current.settings.has_api_key
    ) {
      return;
    }

    const operationToken = current.beginOperation();
    if (!operationToken) {
      current.onToast("已有回答正在处理，请等待完成");
      return;
    }

    try {
      const confirmed = await current.confirm(
        "AI 助手询问",
        `将调用模型 API 使用 ${current.settings.model} 回答当前问题，可能消耗 token。是否继续？`,
        { confirmText: "询问", skipKey: "confirm.ask" },
      );
      if (!confirmed) return;

      current.onPanelError("");
      const context = current.buildContext();
      const range = current.selectionRange;
      const record = await current.runStreamingQuestion(
        {
          source_type: context.source_type,
          source_path: context.source_path,
          selected_text: context.selected_text,
          context_files: context.context_files,
          question: trimmedQuestion,
          provider: current.settings.provider,
          base_url: current.settings.base_url,
          model: current.settings.model,
          session_id: current.sessionId,
          parent_qa_id: current.parentQAId,
          relation_type: "follow_up",
          selection_range: range
            ? {
                start_line: range.startLineNumber,
                start_column: range.startColumn,
                end_line: range.endLineNumber,
                end_column: range.endColumn,
              }
            : null,
        },
        current.generationKey,
        operationToken,
      );
      await current.onAnswerComplete(record, current.projectId);
    } catch (caught) {
      current.onPanelError(caught instanceof Error ? caught.message : "生成回答失败");
    } finally {
      current.endOperation(operationToken);
    }
  }, []);

  return {
    acquireOperation,
    isBusy,
    rejectProjectMutationWhileBusy,
    ask,
  };
}
