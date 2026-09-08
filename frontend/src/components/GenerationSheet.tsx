import { useEffect, useState } from "react";
import { ArrowUpRight, Check, FileText, FolderGit2, Loader2, Route, SlidersHorizontal, X } from "lucide-react";
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
  activeTitle?: string;
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

const intentMeta = {
  outline: { number: "01", label: "LEARNING OUTLINE" },
  lesson: { number: "02", label: "COURSE CONTENT" },
  brief: { number: "03", label: "QUICK INTRODUCTION" },
  detailed: { number: "04", label: "DEEP ANALYSIS" },
};
const scopes = [
  { value: "full_project", title: "全项目", detail: "串联整个仓库", icon: FolderGit2 },
  { value: "files", title: "指定文件", detail: "聚焦选中的源码", icon: FileText },
  { value: "learning_plan", title: "学习计划", detail: "从一个学习目标开始", icon: Route },
] as const;

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
  useEffect(() => setInstructionsDraft(instructions), [instructions]);
  useEffect(() => {
    document.body.classList.toggle("has-sheet", open);
    return () => document.body.classList.remove("has-sheet");
  }, [open]);

  if (!open) return null;
  const copy = labels[intent];
  const learningPlan = project?.project_type === "learning_plan";
  const progress = activeTask ? generationTaskProgress(activeTask) : null;
  const currentScope = learningPlan ? "learning_plan" : scope;
  const meta = intentMeta[intent];

  return (
    <div className="apple-sheet-layer direction-generation-layer">
      <section className="generation-sheet direction-generation-panel" aria-label={copy.title} aria-busy={running}>
        <header className="generation-heading">
          <div>
            <div className="generation-eyebrow"><span>{meta.number}</span><i />{meta.label}</div>
            <h2>{copy.title}</h2>
            <p>{copy.help}</p>
          </div>
          <button className="generation-close" onClick={onClose} title="收起生成面板" aria-label="关闭"><X size={20} /></button>
        </header>
        <div className="generation-form-body">
          <div className="generation-project"><FolderGit2 size={15} /><span>当前项目</span><strong title={project?.name}>{project?.name || "尚未选择项目"}</strong></div>
          {intent === "outline" ? (
            <fieldset className="generation-scope" disabled={!project || running}>
              <legend><span>01</span>选择学习范围</legend>
              <div className="generation-scope-options">
                {scopes.map(({ value, title, detail, icon: Icon }) => (
                  <label key={value} className={`generation-scope-option ${currentScope === value ? "selected" : ""} ${learningPlan && value !== "learning_plan" ? "unavailable" : ""}`}>
                    <input type="radio" name="generation-scope" value={value} checked={currentScope === value} disabled={learningPlan && value !== "learning_plan"} onChange={() => onScopeChange(value)} />
                    <Icon size={20} aria-hidden="true" />
                    <strong>{title}</strong><small>{detail}</small>
                    {currentScope === value ? <Check className="generation-scope-check" size={14} aria-hidden="true" /> : null}
                  </label>
                ))}
              </div>
              <p className="generation-scope-hint">
                {learningPlan || scope === "learning_plan"
                  ? "根据学习目标生成课程路线，不读取仓库文件。"
                  : scope === "files"
                    ? selectedFileCount ? `已选择 ${selectedFileCount} 个文件。` : "请先从左侧源码导航中选择文件。"
                    : "结合 README、目录结构和关键文件生成。"}
              </p>
            </fieldset>
          ) : <div className="generation-target"><span>01</span><div><small>{intent === "lesson" ? "当前课件" : "当前源码"}</small><strong>{props.activeTitle || "请先在阅读工作区打开要生成的文档"}</strong></div><FileText size={22} /></div>}
          <label className="direction-generation-instructions">
            <span className="generation-field-title"><b>02</b>{currentScope === "learning_plan" && intent === "outline" ? "描述学习目标" : "补充你的要求"}<small>{currentScope === "learning_plan" && intent === "outline" ? "让路线更贴近你" : "选填"}</small></span>
            <DeferredLiftTextarea
              value={instructions}
              onLift={onInstructionsChange}
              onDraftChange={setInstructionsDraft}
              liftDelayMs={250}
              placeholder={currentScope === "learning_plan" && intent === "outline" ? "想学什么，学到什么程度？\n例如：从零理解 React，用一个小项目掌握组件、状态和数据流。" : "你希望重点理解什么？\n例如：面向初学者，优先解释请求如何流经后端。"}
              disabled={!project || running}
            />
          </label>
          <button className="generation-prompt-link" onClick={onOpenPrompts}><SlidersHorizontal size={14} />编辑生成提示词<ArrowUpRight size={14} /></button>
          {taskMessage && (activeTask || running || taskMessage !== "待生成") ? (
            <div className={`generation-sheet-status ${activeTask?.status === "failed" ? "failed" : ""}`} role="status" aria-live="polite">
              <span>{taskMessage}</span>
              {progress != null ? (
                <div className="generation-sheet-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: `${progress}%` }} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <footer className="generation-footer">
          <p>{!project ? "先到「项目」选择或创建一个项目" : running ? "正在生成，你可以切换到其他页面" : "确认后开始生成，内容保存到当前项目"}</p>
          <button className="generation-submit" onClick={() => onGenerate(instructionsDraft)} disabled={!project || running}>
            <span>{running ? "生成中…" : copy.action}<small>{running ? "CREATING" : "LET’S BEGIN"}</small></span>
            {running ? <Loader2 size={24} className="spin" /> : <ArrowUpRight size={28} />}
          </button>
        </footer>
      </section>
    </div>
  );
}
