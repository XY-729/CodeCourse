import { Check, ChevronDown, CircleHelp, X } from "lucide-react";
import { useState } from "react";
import {
  getTeachingTrial,
  submitTeachingFeedback,
} from "../api/client";
import type { TeachingTrial } from "../api/client";

type Props = {
  projectId: number;
  qaRecordId: number;
  onChanged?: () => void;
  compact?: boolean;
};

const STRATEGY_LABELS: Record<string, string> = {
  direct_answer: "直接回答",
  overview_map: "先给全局地图",
  execution_sequence: "按执行顺序解释",
  role_comparison: "对比角色和职责",
  contrast_table: "使用对照表",
  minimal_code: "使用最小代码",
  project_code: "结合当前项目代码",
  worked_example: "结合完整例子",
  analogy: "使用类比",
  counterexample: "补充反例",
  error_diagnosis: "从错误原因切入",
  boundary_case: "解释边界情况",
  progressive_hint: "逐步提示",
  prerequisite_bridge: "先补前置知识",
  brief_definition: "只给简短定义",
  detailed_derivation: "详细推导",
  summary_check: "最后检查理解",
};

export default function TeachingRationale({
  projectId,
  qaRecordId,
  onChanged,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [trial, setTrial] = useState<TeachingTrial | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function toggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen || trial || loading) return;
    setLoading(true);
    setMessage("");
    try {
      setTrial(await getTeachingTrial(projectId, qaRecordId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取教学依据失败");
    } finally {
      setLoading(false);
    }
  }

  async function sendFeedback(
    result: "successful" | "partially_successful" | "unsuccessful",
  ) {
    setLoading(true);
    setMessage("");
    try {
      await submitTeachingFeedback(projectId, qaRecordId, result);
      setTrial(await getTeachingTrial(projectId, qaRecordId));
      setMessage("已记录，你的反馈会影响后续讲解方式");
      onChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存反馈失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`teaching-rationale ${open ? "open" : ""}`}>
      <button
        type="button"
        className={`secondary-button compact teaching-rationale-trigger ${compact ? "icon-only" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          void toggle();
        }}
        aria-expanded={open}
        aria-label={compact ? "查看老师为何这样讲" : undefined}
        title={compact ? "老师为何这样讲" : undefined}
      >
        <CircleHelp size={14} />
        {compact ? null : (
          <>
            老师为何这样讲
            <ChevronDown size={13} />
          </>
        )}
      </button>
      {open ? (
        <section className="teaching-rationale-popover" onClick={(event) => event.stopPropagation()}>
          {loading && !trial ? <span>正在整理教学依据...</span> : null}
          {trial ? (
            <>
              <header>
                <strong>{trial.teachingGoal || "围绕当前问题组织回答"}</strong>
                <small>{trial.mode === "assist" ? "智能规划" : "直接结合学习档案"}</small>
              </header>
              <div className="teaching-rationale-strategies">
                {trial.strategies.map((strategy) => (
                  <span key={strategy}>{STRATEGY_LABELS[strategy] || strategy}</span>
                ))}
              </div>
              {trial.strategyRationale ? <p>{trial.strategyRationale}</p> : null}
              {trial.explainInDetail.length ? (
                <p><b>本次详细讲：</b>{trial.explainInDetail.join("、")}</p>
              ) : null}
              {trial.assumedKnown.length ? (
                <p><b>本次简化：</b>{trial.assumedKnown.join("、")}</p>
              ) : null}
              <div className="teaching-rationale-feedback" aria-label="这次讲解是否有效">
                <button type="button" disabled={loading} onClick={() => void sendFeedback("successful")}><Check size={13} />讲懂了</button>
                <button type="button" disabled={loading} onClick={() => void sendFeedback("partially_successful")}>部分明白</button>
                <button type="button" disabled={loading} onClick={() => void sendFeedback("unsuccessful")}><X size={13} />仍不懂</button>
              </div>
            </>
          ) : null}
          {message ? <small className="teaching-rationale-message">{message}</small> : null}
        </section>
      ) : null}
    </div>
  );
}
