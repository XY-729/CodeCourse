import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import type { GenerationTask, Project } from "../api/client";
import type { GenerationIntent } from "./DesktopToolbar";
import { DeferredLiftTextarea } from "./DeferredLiftText";
import { generationTaskProgress } from "./generationTaskModel";

export type GenerationScope = "full_project" | "files" | "learning_plan";

type Props = {
  open: boolean;
  intent: GenerationIntent;
  project: Project | null;
  scope: GenerationScope;
  selectedFileCount: number;
  instructions: string;
  running: boolean;
  activeTask: GenerationTask | null;
  taskMessage: string;
  onClose: () => void;
  onScopeChange: (scope: GenerationScope) => void;
  onInstructionsChange: (value: string) => void;
  onOpenPrompts: () => void;
  onGenerate: (instructions: string) => void;
};

const labels: Record<GenerationIntent, { title: string; action: string; help: string }> = {
  outline: { title: "生成学习总纲", action: "生成总纲", help: "为项目或学习主题规划一条循序渐进的学习路线。" },
  lesson: { title: "生成当前课件", action: "生成课件", help: "按照总纲和当前课程标题生成完整课件。" },
  brief: { title: "生成粗略介绍", action: "生成介绍", help: "用较少 token 快速理解当前源码文件。" },
  detailed: { title: "生成详细分析", action: "生成分析", help: "结合项目上下文逐段讲解当前源码文件。" },
};

export default function GenerationSheet(props: Props) {
  const {
    open,
    intent,
    project,
    scope,
    selectedFileCount,
    instructions,
    running,
    activeTask,
    taskMessage,
    onClose,
    onScopeChange,
    onInstructionsChange,
    onOpenPrompts,
    onGenerate,
  } = props;
  /*
   * The instructions draft lives here instead of App state so typing does not
   * re-render the whole app (which was the source of input lag). The parent
   * hears about the draft via a short debounce (for validation) and receives
   * it directly when the user taps the generate action.
   */
  const [instructionsDraft, setInstructionsDraft] = useState(instructions);
  useEffect(() => {
    document.body.classList.toggle("has-sheet", open);
    return () => document.body.classList.remove("has-sheet");
  }, [open]);

  if (!open) return null;
  const copy = labels[intent];
  const learningPlan = project?.project_type === "learning_plan";
  const progress = activeTask ? generationTaskProgress(activeTask) : null;

  return (
    <div className="apple-sheet-layer" onMouseDown={onClose}>
      <section className="apple-sheet generation-sheet" onMouseDown={(event) => event.stopPropagation()} aria-label={copy.title}>
        <header className="apple-sheet-header">
          <div>
            <strong>{copy.title}</strong>
            <small>仅在确认后调用模型 API</small>
          </div>
          <button className="apple-icon-button" onClick={onClose} title="关闭" aria-label="关闭"><X size={17} /></button>
        </header>
        <div className="apple-sheet-body">
          <p className="generation-sheet-intro">{copy.help}</p>
          {intent === "outline" ? (
            <label className="apple-field">
              <span>学习范围</span>
              <select
                value={learningPlan ? "learning_plan" : scope}
                onChange={(event) => onScopeChange(event.target.value as GenerationScope)}
                disabled={!project || running || learningPlan}
              >
                <option value="full_project">全项目</option>
                <option value="files">指定文件</option>
                <option value="learning_plan">学习计划</option>
              </select>
              <small>
                {learningPlan || scope === "learning_plan"
                  ? "根据学习目标生成课程路线，不读取仓库文件。"
                  : scope === "files"
                    ? selectedFileCount ? `已选择 ${selectedFileCount} 个文件。` : "请先从左侧源码导航中选择文件。"
                    : "结合 README、目录结构和关键文件生成。"}
              </small>
            </label>
          ) : null}
          <label className="apple-field">
            <span>补充要求</span>
            <DeferredLiftTextarea
              value={instructions}
              onLift={onInstructionsChange}
              onDraftChange={setInstructionsDraft}
              liftDelayMs={250}
              placeholder="例如：面向初学者，优先解释请求如何流经后端"
              disabled={!project || running}
            />
          </label>
          <button className="apple-text-button" onClick={onOpenPrompts}>编辑生成提示词</button>
          {taskMessage ? (
            <div className={`generation-sheet-status ${activeTask?.status === "failed" ? "failed" : ""}`}>
              <span>{taskMessage}</span>
              {progress != null ? (
                <div className="generation-sheet-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: `${progress}%` }} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <footer className="apple-sheet-footer">
          <button className="apple-secondary-button" onClick={onClose}>取消</button>
          <button className="apple-primary-button" onClick={() => onGenerate(instructionsDraft)} disabled={!project || running}>
            <Sparkles size={15} />{running ? "生成中…" : copy.action}
          </button>
        </footer>
      </section>
    </div>
  );
}
