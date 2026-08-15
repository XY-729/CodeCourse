import { useCallback, useRef, useState } from "react";
import {
  createCallGuide,
  deleteCallGuide,
  refreshCallGuide,
  resolveCallGuide,
  updateCallGuide,
} from "../api/client";
import type {
  CallGuide,
  CallGuideCandidate,
  Project,
} from "../api/client";
import type { OpenItem } from "../workbench/layout";

type ChoiceOption = {
  value: string;
  label: string;
  description?: string;
};

type Options = {
  project: Project | null;
  mobile: boolean;
  requestChoice: (
    title: string,
    message: string,
    options: ChoiceOption[],
  ) => Promise<string | null>;
  confirmDelete: (guide: CallGuide) => Promise<boolean>;
  onOpen: (guide: CallGuide) => void;
  onChanged: (guide: CallGuide) => void;
  onDeleted: (guide: CallGuide) => void;
  onClearSelection: () => void;
  onError: (message: string) => void;
  onToast: (message: string) => void;
  onTaskMessage: (message: string) => void;
};

export type ResolveCallGuideInput = {
  sourcePath?: string | null;
  line?: number | null;
  selectedText?: string;
  symbolName?: string | null;
};

export function callGuideOpenItem(guide: CallGuide): OpenItem {
  return {
    id: `call-guide:${guide.id}`,
    type: "call_guide",
    path: `call-guide://${guide.id}`,
    title: guide.title,
    content: "",
    callGuideId: guide.id,
    hydrated: true,
  };
}

export function mergeCallGuide(current: CallGuide[], guide: CallGuide): CallGuide[] {
  return [guide, ...current.filter((entry) => entry.id !== guide.id)];
}

export function useCallGuideController({
  project,
  mobile,
  requestChoice,
  confirmDelete,
  onOpen,
  onChanged,
  onDeleted,
  onClearSelection,
  onError,
  onToast,
  onTaskMessage,
}: Options) {
  const [guides, setGuides] = useState<CallGuide[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const busyIdRef = useRef<number | null>(null);

  const replace = useCallback((guide: CallGuide) => {
    setGuides((current) => mergeCallGuide(current, guide));
    onChanged(guide);
  }, [onChanged]);

  const remember = useCallback((guide: CallGuide) => {
    setGuides((current) => mergeCallGuide(current, guide));
  }, []);

  const replaceAll = useCallback((nextGuides: CallGuide[]) => {
    setGuides(nextGuides);
  }, []);

  const reset = useCallback(() => {
    busyIdRef.current = null;
    setBusyId(null);
    setGuides([]);
  }, []);

  const open = useCallback((guide: CallGuide) => {
    replace(guide);
    onOpen(guide);
  }, [onOpen, replace]);

  const resolveAndOpen = useCallback(async (input: ResolveCallGuideInput) => {
    if (!project || mobile || project.project_type !== "repository") return;
    try {
      onTaskMessage("正在解析真实调用关系");
      const result = await resolveCallGuide(project.id, {
        source_path: input.sourcePath,
        line: input.line,
        selected_text: input.selectedText ?? "",
        symbol_name: input.symbolName,
      });
      if (!result.candidates.length) {
        onError(result.reason || "结构索引中没有找到可导览的函数或方法");
        return;
      }

      let candidate: CallGuideCandidate | null = result.candidates[0];
      if (result.candidates.length > 1) {
        const choice = await requestChoice(
          "选择调用链起点",
          "存在多个同名或相邻符号，请选择结构索引中的真实定义。",
          result.candidates.slice(0, 8).map((item, index) => ({
            value: String(index),
            label: item.qualified_name || item.symbol_name,
            description: `${item.path}:${item.start_line}`,
          })),
        );
        candidate = choice === null ? null : result.candidates[Number(choice)] ?? null;
      }
      if (!candidate) return;

      const guide = await createCallGuide(project.id, candidate);
      open(guide);
      onClearSelection();
      onToast(`已创建 ${guide.title}`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "无法创建调用链导览");
    } finally {
      onTaskMessage("");
    }
  }, [mobile, onClearSelection, onError, onTaskMessage, onToast, open, project, requestChoice]);

  const selectNode = useCallback(async (
    guide: CallGuide,
    nodeId: string,
    visitedNodeIds: string[],
  ) => {
    replace({ ...guide, current_node_id: nodeId, visited_node_ids: visitedNodeIds });
    if (!project) return;
    try {
      const saved = await updateCallGuide(project.id, guide.id, {
        current_node_id: nodeId,
        visited_node_ids: visitedNodeIds,
      });
      replace(saved);
    } catch {
      onToast("阅读位置暂未保存，导览仍可继续使用");
    }
  }, [onToast, project, replace]);

  const refresh = useCallback(async (guide: CallGuide) => {
    if (!project || busyIdRef.current != null) return;
    busyIdRef.current = guide.id;
    setBusyId(guide.id);
    try {
      const next = await refreshCallGuide(project.id, guide.id);
      replace(next);
      onToast("调用链导览已按最新索引刷新");
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "刷新导览失败，已保留旧内容");
    } finally {
      busyIdRef.current = null;
      setBusyId(null);
    }
  }, [onError, onToast, project, replace]);

  const remove = useCallback(async (guide: CallGuide) => {
    if (!project || !(await confirmDelete(guide))) return;
    try {
      await deleteCallGuide(project.id, guide.id);
      setGuides((current) => current.filter((entry) => entry.id !== guide.id));
      onDeleted(guide);
      onToast("调用链导览已删除");
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "删除导览失败");
    }
  }, [confirmDelete, onDeleted, onError, onToast, project]);

  return {
    guides,
    busyId,
    replace,
    remember,
    replaceAll,
    reset,
    open,
    resolveAndOpen,
    selectNode,
    refresh,
    remove,
  };
}
