import {
  BrainCircuit,
  Clock3,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getPersonalizationProfile,
  resetPersonalizationProfile,
  voidLearningEvidence,
  voidLearnerInference,
  type KnowledgeDimension,
  type LearnerInference,
  type LearningEvidenceV2,
  type PersonalizationProfile,
  type PlanRootStatus,
  type TermScanStatus,
} from "../../api/client";
import type { TermDisplayDiagnostics } from "../../personalization/useDocumentTermsController";
import DocumentTermScanControl from "../teaching/DocumentTermScanControl";
import ConceptForestPanel from "./ConceptForestPanel";
import { TEACHING_CHANGED } from "../../personalization/teachingApi";

type Props = {
  open: boolean;
  projectId: number | null;
  projectName?: string | null;
  /** Authoritative plan root state from the backend knowledge tree service. */
  planRootStatus?: PlanRootStatus | string | null;
  planRootConceptIds?: string[];
  planRootError?: string | null;
  onClose: () => void;
  onChanged?: () => void;
  onConfirm?: (title: string, message: string, options?: { confirmText?: string; danger?: boolean }) => Promise<boolean>;
  termScanStatus?: TermScanStatus | null;
  termDiagnostics?: TermDisplayDiagnostics | null;
  onRescanTerms?: () => Promise<void>;
};

type View = "concepts" | "evidence" | "calls" | "terms";

const STATE_LABELS: Record<LearnerInference["state"], string> = {
  confirmed: "有直接掌握证据",
  learning: "正在学习",
  likely_prerequisite: "可能具备的前置知识",
  insufficient: "证据不足",
};

const DIMENSION_LABELS: Record<KnowledgeDimension, string> = {
  familiarity: "认识",
  conceptual: "理解",
  code_reading: "读代码",
  implementation: "实现",
  debugging: "调试",
  transfer: "迁移",
};

const EVIDENCE_SOURCE_LABELS: Record<string, string> = {
  manual: "人工判断",
  diagnostic: "理解检查",
  question: "提问与追问",
  summary: "个人总结",
  observer: "Observer 观察",
  course_completion: "课程完成",
  migration: "旧档案迁移",
};

function evidenceSummary(evidence: LearningEvidenceV2): string {
  const candidates = [
    evidence.result.explanation,
    evidence.result.evidenceText,
    evidence.object.evidenceText,
    evidence.context.evidenceText,
    evidence.result.reason,
    evidence.object.question,
  ];
  const text = candidates.find((value) => typeof value === "string" && value.trim());
  if (typeof text === "string") return text;
  if (evidence.action === "void_evidence") return "用户撤销了一条历史证据";
  if (evidence.source === "diagnostic") {
    return evidence.direction === "positive" ? "理解检查回答正确" : "理解检查回答错误";
  }
  return evidence.action.replace(/_/g, " ");
}

function confidenceLabel(value: number): string {
  if (value >= 0.78) return "依据较充分";
  if (value >= 0.58) return "仍在观察";
  return "证据有限";
}

export default function LearnerProfileDialog({
  open,
  projectId,
  projectName,
  planRootStatus,
  planRootConceptIds,
  planRootError,
  onClose,
  onChanged,
  onConfirm,
  termScanStatus,
  termDiagnostics,
  onRescanTerms,
}: Props) {
  const [profile, setProfile] = useState<PersonalizationProfile | null>(null);
  const [view, setView] = useState<View>("concepts");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedInference, setExpandedInference] = useState<string | null>(null);
  const [expandedEvidence, setExpandedEvidence] = useState<string | null>(null);
  const [evidenceFilter, setEvidenceFilter] = useState<string | null>(null);

  async function load() {
    if (projectId == null) return;
    setLoading(true);
    setMessage("");
    try {
      setProfile(await getPersonalizationProfile(projectId));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "读取学习档案失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setView("concepts");
    void load();
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    const refresh = () => { void load(); };
    window.addEventListener(TEACHING_CHANGED, refresh);
    return () => window.removeEventListener(TEACHING_CHANGED, refresh);
  }, [open, projectId]);

  const conceptsById = useMemo(
    () => new Map(profile?.concepts.map((item) => [item.concept.id, item.concept.displayName]) ?? []),
    [profile],
  );
  const voidedEvidenceIds = useMemo(
    () => new Set(
      (profile?.learningEvidence ?? [])
        .map((evidence) => evidence.targetEvidenceId)
        .filter((id): id is string => Boolean(id)),
    ),
    [profile],
  );

  if (!open) return null;

  async function undoInference(inference: LearnerInference) {
    if (projectId == null) return;
    try {
      await voidLearnerInference(projectId, inference.id);
      await load();
      onChanged?.();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "撤销判断失败");
    }
  }

  async function undoEvidence(evidence: LearningEvidenceV2) {
    if (projectId == null) return;
    try {
      await voidLearningEvidence(
        projectId,
        evidence.id,
        `profile:void:${evidence.id}:${Date.now()}`,
        "用户在学习档案中撤销",
      );
      await load();
      onChanged?.();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "撤销证据失败");
    }
  }

  async function resetProfile(scope: "project" | "all") {
    if (projectId == null) return;
    const approved = onConfirm
      ? await onConfirm(
        scope === "all" ? "重置全部学习档案" : "重置当前项目画像",
        scope === "all"
          ? "将清除本机所有项目的知识判断、学习证据和后台观察记录。课程与问答正文不会删除。"
          : "将清除当前项目私有符号和当前项目的观察记录。通用知识判断仍会保留。",
        { confirmText: "重置", danger: true },
      )
      : false;
    if (!approved) return;
    await resetPersonalizationProfile(projectId, scope);
    await load();
    onChanged?.();
  }

  return (
    <div className="modal-backdrop learner-profile-backdrop" role="dialog" aria-modal="true" aria-label="我的学习档案">
      <section className="learner-profile-sheet">
        <header className="learner-profile-header">
          <div>
            <span className="learner-profile-icon"><BrainCircuit size={18} /></span>
            <div><strong>我的学习档案</strong><small>按知识分类查看学习记录与依据</small></div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={17} /></button>
        </header>

        <nav className="segmented-control learner-profile-tabs" aria-label="学习档案视图">
          <button className={view === "concepts" ? "active" : ""} onClick={() => setView("concepts")}>知识树</button>
          <button className={view === "evidence" ? "active" : ""} onClick={() => setView("evidence")}>判断依据</button>
          <button className={view === "calls" ? "active" : ""} onClick={() => setView("calls")}>模型调用</button>
          <button className={view === "terms" ? "active" : ""} onClick={() => setView("terms")}>术语提示</button>
        </nav>

        <div className="learner-profile-content">
          {message ? <div className="settings-message">{message}</div> : null}
          {loading && !profile ? <div className="learner-profile-loading">正在整理学习档案...</div> : null}


          {profile && view === "evidence" ? (
            <div className="learner-evidence-list">
              {evidenceFilter ? (
                <div className="learner-evidence-filter">
                  <span>只看：{conceptsById.get(evidenceFilter) || evidenceFilter}</span>
                  <button type="button" onClick={() => setEvidenceFilter(null)}>显示全部依据</button>
                </div>
              ) : null}
              {(profile.learningEvidence ?? []).filter((evidence) => !evidenceFilter || evidence.conceptId === evidenceFilter).length
                ? (profile.learningEvidence ?? []).filter((evidence) => !evidenceFilter || evidence.conceptId === evidenceFilter).map((evidence) => {
                const voided = evidence.voided || voidedEvidenceIds.has(evidence.id);
                return (
                <article
                  className={`learner-evidence-row direction-${evidence.direction}${voided ? " is-voided" : ""}`}
                  key={evidence.id}
                >
                  <button
                    type="button"
                    className="learner-evidence-main"
                    onClick={() => setExpandedEvidence((current) => current === evidence.id ? null : evidence.id)}
                  >
                    <div>
                      <strong>{conceptsById.get(evidence.conceptId) || evidence.conceptId}</strong>
                      <span>{DIMENSION_LABELS[evidence.dimension]} · {EVIDENCE_SOURCE_LABELS[evidence.source] || evidence.source}</span>
                    </div>
                    <small>
                      {voided ? "已撤销" : evidence.direction === "positive" ? "正向证据" : evidence.direction === "negative" ? "负向证据" : "中性事件"}
                      {" · "}可靠度 {Math.round(evidence.reliability * 100)}%
                      {" · "}{new Date(evidence.eventTime).toLocaleString()}
                    </small>
                    <p>{evidenceSummary(evidence)}</p>
                    {typeof evidence.result.explanation === "string" && typeof (evidence.result.evidenceQuote ?? evidence.result.evidenceText) === "string" ? (
                      <blockquote>依据：{String(evidence.result.evidenceQuote ?? evidence.result.evidenceText)}</blockquote>
                    ) : null}
                  </button>
                  {!voided && evidence.action !== "void_evidence" ? (
                    <button type="button" className="icon-button" title="撤销这条证据" onClick={() => void undoEvidence(evidence)}>
                      <Undo2 size={15} />
                    </button>
                  ) : <span />}
                  {expandedEvidence === evidence.id ? (
                    <pre className="learner-technical-detail">{JSON.stringify(evidence, null, 2)}</pre>
                  ) : null}
                </article>
                );
              }) : <div className="learner-profile-empty"><RotateCcw size={22} /><span>暂无可查看的判断依据。</span></div>}
              {profile.inferences.length ? (
                <details className="learner-legacy-evidence">
                  <summary>查看学习分析与依据 ({profile.inferences.length})</summary>
                  {profile.inferences.map((item) => (
                    <article className={`learner-evidence-row state-${item.state}`} key={item.id}>
                      <button
                        type="button"
                        className="learner-evidence-main"
                        onClick={() => setExpandedInference((current) => current === item.id ? null : item.id)}
                      >
                        <div>
                          <strong>{item.subjectType === "concept" ? item.displayName || conceptsById.get(item.subjectKey) || item.subjectKey : item.subjectKey}</strong>
                          <span>{STATE_LABELS[item.state]}</span>
                        </div>
                      <small>{confidenceLabel(item.confidence)} · 学习分析</small>
                        <p>{item.summary}</p>
                      </button>
                      <button type="button" className="icon-button" title="撤销这条分析" onClick={() => void undoInference(item)}>
                        <Undo2 size={15} />
                      </button>
                      {expandedInference === item.id ? (
                        <pre className="learner-technical-detail">{JSON.stringify(item.evidence, null, 2)}</pre>
                      ) : null}
                    </article>
                  ))}
                </details>
              ) : null}
            </div>
          ) : null}

          {profile && view === "concepts" ? (
            <div className="learner-concept-view">
              <div className="learner-concept-actions">
                <button type="button" className="secondary-button" onClick={() => void resetProfile("project")}>重置当前项目</button>
                <button type="button" className="secondary-button danger" onClick={() => void resetProfile("all")}>重置全部档案</button>
              </div>
              {projectId != null ? (
                <ConceptForestPanel
                  projectId={projectId}
                  projectName={projectName}
                  planRootStatus={planRootStatus}
                  planRootConceptIds={planRootConceptIds}
                  planRootError={planRootError}
                  refreshKey={profile.knowledgeStates?.length ?? 0}
                  onChanged={onChanged}
                  onOpenEvidence={(conceptId) => {
                    setEvidenceFilter(conceptId);
                    setView("evidence");
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {profile && view === "calls" ? (
            <div className="model-call-list">
              {profile.modelCalls.length ? profile.modelCalls.map((call) => (
                <article className="model-call-row" key={call.id}>
                  <div><Clock3 size={14} /><strong>{call.purpose}</strong><span className={`status-${call.status}`}>{call.status}</span></div>
                  <small>{call.model || "继承当前模型"} · {call.latencyMs == null ? "无耗时记录" : `${call.latencyMs}ms`} · {new Date(call.createdAt).toLocaleString()}</small>
                  {call.errorMessage ? <p>{call.errorMessage}</p> : null}
                </article>
              )) : <div className="learner-profile-empty"><Clock3 size={22} /><span>暂无后台模型调用记录。</span></div>}
            </div>
          ) : null}

          {view === "terms" ? (
            <div>
              <div className="learner-term-diagnostics" aria-label="当前文档术语提示状态">
                <div>
                  <strong>当前文档术语提示</strong>
                  {!termScanStatus ? <small>打开课件或回答后可查看</small> : null}
                </div>
                <DocumentTermScanControl status={termScanStatus} onRescan={onRescanTerms} showDescription />
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
