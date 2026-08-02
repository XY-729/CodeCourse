import {
  BrainCircuit,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Link2,
  RotateCcw,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  answerDynamicSurvey,
  clearConceptOverride,
  dismissDynamicSurvey,
  getLearnerPreferences,
  getPersonalizationProfile,
  markConceptKnown,
  markConceptUnknown,
  resetPersonalizationProfile,
  updateLearnerPreferences,
  voidLearningEvidence,
  voidLearnerInference,
  type KnowledgeDimension,
  type KnowledgeStateV2,
  type LearnerInference,
  type LearnerPreferences,
  type LearningEvidenceV2,
  type PersonalizationProfile,
  type TermScanStatus,
} from "../api/client";
import type { TermDisplayDiagnostics } from "../personalization/useDocumentTermsController";

type Props = {
  open: boolean;
  projectId: number | null;
  onClose: () => void;
  onChanged?: () => void;
  onConfirm?: (title: string, message: string, options?: { confirmText?: string; danger?: boolean }) => Promise<boolean>;
  termScanStatus?: TermScanStatus | null;
  termDiagnostics?: TermDisplayDiagnostics | null;
  onRescanTerms?: () => Promise<void>;
};

type View = "overview" | "concepts" | "evidence" | "calls" | "preferences";

const STATE_LABELS: Record<LearnerInference["state"], string> = {
  confirmed: "有直接掌握证据",
  learning: "正在学习",
  likely_prerequisite: "可能具备的前置知识",
  insufficient: "证据不足",
};

const DIMENSIONS: KnowledgeDimension[] = [
  "familiarity",
  "conceptual",
  "code_reading",
  "implementation",
  "debugging",
  "transfer",
];

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

const STRATEGY_LABELS: Record<string, string> = {
  direct_answer: "直接回答",
  worked_example: "结合例子",
  execution_sequence: "按执行顺序",
  role_comparison: "角色对比",
  contrast_table: "对照表",
  project_code: "结合项目代码",
  counterexample: "反例说明",
  error_diagnosis: "错误诊断",
  prerequisite_bridge: "补充前置知识",
  brief_definition: "简短定义",
  detailed_derivation: "详细推导",
};

function dimensionStatusLabel(
  status: KnowledgeStateV2["dimensions"][KnowledgeDimension]["status"],
): string {
  if (status === "confirmed") return "有可靠证据";
  if (status === "learning") return "正在学习";
  return "证据不足";
}

function evidenceSummary(evidence: LearningEvidenceV2): string {
  const candidates = [
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
  onClose,
  onChanged,
  onConfirm,
  termScanStatus,
  termDiagnostics,
  onRescanTerms,
}: Props) {
  const [profile, setProfile] = useState<PersonalizationProfile | null>(null);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedInference, setExpandedInference] = useState<string | null>(null);
  const [expandedEvidence, setExpandedEvidence] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<LearnerPreferences | null>(null);
  const [preferencesSaving, setPreferencesSaving] = useState(false);

  async function load() {
    if (projectId == null) return;
    setLoading(true);
    setMessage("");
    try {
      setProfile(await getPersonalizationProfile(projectId));
      setPreferences(await getLearnerPreferences(projectId));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "读取学习档案失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setView("overview");
    void load();
  }, [open, projectId]);

  const conceptsById = useMemo(
    () => new Map(profile?.concepts.map((item) => [item.concept.id, item.concept.displayName]) ?? []),
    [profile],
  );
  const statesByConceptId = useMemo(
    () => new Map((profile?.knowledgeStates ?? []).map((state) => [state.conceptId, state])),
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
  const domainSummaries = useMemo(() => {
    if (!profile) return [];
    const legacyByKey = new Map(profile.domainProfiles.map((domain) => [domain.domainKey, domain]));
    const groups = new Map<string, {
      domainKey: string;
      confirmed: string[];
      learning: string[];
      insufficient: string[];
      likelyPrerequisites: string[];
      updatedAt: string;
    }>();
    for (const item of profile.concepts) {
      const domainKey = item.concept.domain || "未分类";
      const group = groups.get(domainKey) ?? {
        domainKey,
        confirmed: [],
        learning: [],
        insufficient: [],
        likelyPrerequisites: legacyByKey.get(domainKey)?.likelyPrerequisites ?? [],
        updatedAt: statesByConceptId.get(item.concept.id)?.updatedAt ?? new Date(0).toISOString(),
      };
      const state = statesByConceptId.get(item.concept.id);
      const dimensions = state?.dimensions;
      const status = dimensions?.conceptual.status === "confirmed"
        || dimensions?.familiarity.status === "confirmed"
        ? "confirmed"
        : dimensions?.conceptual.status === "learning"
          || dimensions?.familiarity.status === "learning"
          ? "learning"
          : "insufficient";
      group[status].push(item.concept.displayName);
      if (state && state.updatedAt > group.updatedAt) group.updatedAt = state.updatedAt;
      groups.set(domainKey, group);
    }
    return [...groups.values()].sort((left, right) => (
      right.learning.length - left.learning.length || left.domainKey.localeCompare(right.domainKey)
    ));
  }, [profile, statesByConceptId]);

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

  async function answerSurvey(choice: string) {
    if (projectId == null || !profile?.surveyCandidate) return;
    try {
      await answerDynamicSurvey(projectId, profile.surveyCandidate.id, choice);
      await load();
      onChanged?.();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "保存选择失败");
    }
  }

  async function dismissSurvey() {
    if (projectId == null || !profile?.surveyCandidate) return;
    await dismissDynamicSurvey(projectId, profile.surveyCandidate.id);
    await load();
  }

  async function disableSurveys() {
    if (projectId == null) return;
    try {
      if (profile?.surveyCandidate) {
        await dismissDynamicSurvey(projectId, profile.surveyCandidate.id);
      }
      await updateLearnerPreferences(projectId, {
        survey_enabled: false,
        scope: "global",
      });
      await load();
      onChanged?.();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "关闭风格询问失败");
    }
  }

  async function setConceptStatus(
    conceptId: string,
    status: "known" | "unknown" | "clear",
  ) {
    if (projectId == null) return;
    const key = `profile:${status}:${conceptId}:${Date.now()}`;
    try {
      if (status === "known") {
        await markConceptKnown(projectId, conceptId, key, "用户在学习档案中纠正");
      } else if (status === "unknown") {
        await markConceptUnknown(projectId, conceptId, key, "用户在学习档案中纠正");
      } else {
        await clearConceptOverride(projectId, conceptId, key);
      }
      await load();
      onChanged?.();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "修改概念状态失败");
    }
  }

  async function resetProfile(scope: "project" | "all") {
    if (projectId == null) return;
    const approved = onConfirm
      ? await onConfirm(
        scope === "all" ? "重置全部学习档案" : "重置当前项目画像",
        scope === "all"
          ? "将清除本机所有项目的知识判断、偏好证据和后台观察记录。课程与问答正文不会删除。"
          : "将清除当前项目私有符号和当前项目的观察记录。通用知识判断仍会保留。",
        { confirmText: "重置", danger: true },
      )
      : false;
    if (!approved) return;
    await resetPersonalizationProfile(projectId, scope);
    await load();
    onChanged?.();
  }

  async function savePreferences(patch: Partial<{
    answer_depth: number;
    code_ratio: number;
    explanation_order: LearnerPreferences["explanationOrder"];
    prerequisite_detail: number;
    terminology_density: number;
  }>) {
    if (projectId == null) return;
    setPreferencesSaving(true);
    setMessage("");
    try {
      setPreferences(await updateLearnerPreferences(projectId, { ...patch, scope: "global" }));
      setMessage("偏好已保存");
      onChanged?.();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "保存偏好失败");
    } finally {
      setPreferencesSaving(false);
    }
  }

  async function resetPreferences() {
    if (projectId == null || !preferences) return;
    await savePreferences({
      answer_depth: 0.5,
      code_ratio: 0.5,
      explanation_order: "balanced",
      prerequisite_detail: 0.5,
      terminology_density: 0.5,
    });
  }

  return (
    <div className="modal-backdrop learner-profile-backdrop" role="dialog" aria-modal="true" aria-label="我的学习档案">
      <section className="learner-profile-sheet">
        <header className="learner-profile-header">
          <div>
            <span className="learner-profile-icon"><BrainCircuit size={18} /></span>
            <div><strong>我的学习档案</strong><small>老师如何理解你的知识边界</small></div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={17} /></button>
        </header>

        <nav className="segmented-control learner-profile-tabs" aria-label="学习档案视图">
          <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>知识边界</button>
          <button className={view === "concepts" ? "active" : ""} onClick={() => setView("concepts")}>概念状态</button>
          <button className={view === "evidence" ? "active" : ""} onClick={() => setView("evidence")}>判断依据</button>
          <button className={view === "calls" ? "active" : ""} onClick={() => setView("calls")}>模型调用</button>
          <button className={view === "preferences" ? "active" : ""} onClick={() => setView("preferences")}>讲解偏好</button>
        </nav>

        <div className="learner-profile-content">
          {message ? <div className="settings-message">{message}</div> : null}
          {loading && !profile ? <div className="learner-profile-loading">正在整理学习档案...</div> : null}

          {profile && view === "overview" ? (
            <>
              {profile.surveyCandidate ? (
                <section className="learner-survey-card">
                  <div><Sparkles size={16} /><strong>{profile.surveyCandidate.question}</strong></div>
                  <div className="learner-survey-options">
                    {profile.surveyCandidate.options.map((option) => (
                      <button type="button" key={option.value} onClick={() => void answerSurvey(option.value)}>
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="learner-survey-secondary-actions">
                    <button type="button" className="text-button" onClick={() => void dismissSurvey()}>暂时不回答</button>
                    <button type="button" className="text-button" onClick={() => void disableSurveys()}>以后不再询问</button>
                  </div>
                </section>
              ) : null}

              {profile.evidenceSummary ? (
                <section className="learner-evidence-overview" aria-label="学习证据摘要">
                  <article>
                    <CheckCircle2 size={16} />
                    <span>已验证会什么</span>
                    <strong>
                      {profile.evidenceSummary.verified
                        .map((item) => item.displayName)
                        .join("、") || "还没有经过验证的概念"}
                    </strong>
                  </article>
                  <article>
                    <CircleHelp size={16} />
                    <span>正在学习什么</span>
                    <strong>
                      {profile.evidenceSummary.learning
                        .map((item) => item.displayName)
                        .join("、") || "暂未发现明确的学习中概念"}
                    </strong>
                  </article>
                  <article>
                    <RotateCcw size={16} />
                    <span>还缺什么证据</span>
                    <strong>
                      {profile.evidenceSummary.insufficient
                        .map((item) => item.displayName)
                        .join("、") || "当前概念都有可用证据"}
                    </strong>
                  </article>
                  <article>
                    <Sparkles size={16} />
                    <span>最近哪些讲法有效</span>
                    <strong>
                      {profile.evidenceSummary.teaching.effectiveStrategies
                        .filter((item) => item.successful + item.partiallySuccessful > 0)
                        .slice(0, 4)
                        .map((item) => STRATEGY_LABELS[item.strategy] || item.strategy)
                        .join("、") || "等待理解检查或你的反馈"}
                    </strong>
                    <small>
                      已验证 {profile.evidenceSummary.teaching.verifiedTrialCount} 次，
                      另有 {profile.evidenceSummary.teaching.awaitingEvidenceCount} 次讲解等待证据
                    </small>
                  </article>
                </section>
              ) : null}

              <div className="domain-profile-list">
                {domainSummaries.length ? domainSummaries.map((domain) => (
                  <article className="domain-profile-row" key={domain.domainKey}>
                    <header>
                      <div><strong>{domain.domainKey}</strong><span>按可验证证据计算</span></div>
                      <small>{new Date(domain.updatedAt).toLocaleDateString()}</small>
                    </header>
                    <div className="domain-boundaries">
                      <div><CheckCircle2 size={14} /><span>已有证据</span><strong>{domain.confirmed.join("、") || "暂无"}</strong></div>
                      <div><CircleHelp size={14} /><span>正在学习</span><strong>{domain.learning.join("、") || "暂无"}</strong></div>
                      <div><RotateCcw size={14} /><span>证据不足</span><strong>{domain.insufficient.join("、") || "暂无"}</strong></div>
                      <div><Link2 size={14} /><span>可能前置</span><strong>{domain.likelyPrerequisites.join("、") || "暂无"}</strong></div>
                    </div>
                  </article>
                )) : (
                  <div className="learner-profile-empty">
                    <BrainCircuit size={24} />
                    <strong>还没有足够的领域证据</strong>
                    <span>继续提问、追问或标记陌生术语后，老师会逐渐形成可解释的知识边界。</span>
                  </div>
                )}
              </div>
            </>
          ) : null}

          {profile && view === "evidence" ? (
            <div className="learner-evidence-list">
              {(profile.learningEvidence ?? []).length ? (profile.learningEvidence ?? []).map((evidence) => {
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
                  <summary>查看旧版 Observer 判断 ({profile.inferences.length})</summary>
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
                        <small>{confidenceLabel(item.confidence)} · 旧版观察记录</small>
                        <p>{item.summary}</p>
                      </button>
                      <button type="button" className="icon-button" title="撤销旧版判断" onClick={() => void undoInference(item)}>
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
              <div className="learner-concept-list">
                {profile.concepts.length ? profile.concepts.map((item) => {
                  const state = statesByConceptId.get(item.concept.id);
                  const manualStatus = state?.dimensions.familiarity.manualStatus ?? item.mastery.manualStatus;
                  return (
                  <article className="learner-concept-row" key={item.concept.id}>
                    <div className="learner-concept-summary">
                      <div>
                        <strong>{item.concept.displayName}</strong>
                        <small>{item.concept.domain} · {
                          item.judgement === "known"
                            ? "有可靠证据"
                            : item.judgement === "unfamiliar"
                              ? "正在学习或明确陌生"
                              : "证据不足"
                        }</small>
                      </div>
                      {state ? (
                        <div className="knowledge-dimension-grid" aria-label={`${item.concept.displayName}的六维知识状态`}>
                          {DIMENSIONS.map((dimension) => {
                            const dimensionState = state.dimensions[dimension];
                            return (
                              <div
                                className={`knowledge-dimension state-${dimensionState.status}`}
                                key={dimension}
                                title={`${dimensionStatusLabel(dimensionState.status)}，${dimensionState.evidenceCount} 条证据`}
                              >
                                <span>{DIMENSION_LABELS[dimension]}</span>
                                <div>
                                  <i style={{ width: `${Math.round(dimensionState.probability * 100)}%` }} />
                                </div>
                                <small>{dimensionStatusLabel(dimensionState.status)}</small>
                              </div>
                            );
                          })}
                        </div>
                      ) : <small className="knowledge-state-legacy-note">等待 V2 证据重算</small>}
                    </div>
                    <div className="learner-concept-buttons">
                      <button
                        type="button"
                        className={manualStatus === "known" ? "active" : ""}
                        onClick={() => void setConceptStatus(item.concept.id, "known")}
                      >认识</button>
                      <button
                        type="button"
                        className={manualStatus === "unknown" ? "active" : ""}
                        onClick={() => void setConceptStatus(item.concept.id, "unknown")}
                      >不认识</button>
                      {manualStatus ? (
                        <button type="button" onClick={() => void setConceptStatus(item.concept.id, "clear")}>撤销</button>
                      ) : null}
                    </div>
                  </article>
                  );
                }) : <div className="learner-profile-empty"><CircleHelp size={22} /><span>还没有概念记录。</span></div>}
              </div>
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

          {preferences && view === "preferences" ? (
            <div className="learner-preference-view">
              <p className="learner-preference-hint">
                这些偏好决定 AI 老师默认怎样讲解。你可以在一次问答后点"这次讲解是否有效"微调，此处手动调整立即生效。
              </p>
              <label className="learner-preference-row">
                <span><strong>回答深度</strong><small>讲得详细还是紧凑</small></span>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={preferences.answerDepth}
                  onChange={(event) => setPreferences({ ...preferences, answerDepth: Number(event.target.value) })}
                  onBlur={() => void savePreferences({ answer_depth: preferences.answerDepth })}
                />
                <output>{Math.round(preferences.answerDepth * 100)}%</output>
              </label>
              <label className="learner-preference-row">
                <span><strong>代码比例</strong><small>多给代码示例还是少给</small></span>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={preferences.codeRatio}
                  onChange={(event) => setPreferences({ ...preferences, codeRatio: Number(event.target.value) })}
                  onBlur={() => void savePreferences({ code_ratio: preferences.codeRatio })}
                />
                <output>{Math.round(preferences.codeRatio * 100)}%</output>
              </label>
              <label className="learner-preference-row">
                <span><strong>讲解顺序</strong><small>先讲例子还是先讲原理</small></span>
                <select
                  value={preferences.explanationOrder}
                  onChange={(event) => {
                    const next = event.target.value as LearnerPreferences["explanationOrder"];
                    setPreferences({ ...preferences, explanationOrder: next });
                    void savePreferences({ explanation_order: next });
                  }}
                >
                  <option value="balanced">均衡</option>
                  <option value="example_first">例子优先</option>
                  <option value="principle_first">原理优先</option>
                  <option value="code_first">代码优先</option>
                </select>
              </label>
              <label className="learner-preference-row">
                <span><strong>前置知识详细度</strong><small>需要多少前置知识铺垫</small></span>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={preferences.prerequisiteDetail}
                  onChange={(event) => setPreferences({ ...preferences, prerequisiteDetail: Number(event.target.value) })}
                  onBlur={() => void savePreferences({ prerequisite_detail: preferences.prerequisiteDetail })}
                />
                <output>{Math.round(preferences.prerequisiteDetail * 100)}%</output>
              </label>
              <label className="learner-preference-row">
                <span><strong>术语密度</strong><small>专业名词解释到什么程度</small></span>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={preferences.terminologyDensity}
                  onChange={(event) => setPreferences({ ...preferences, terminologyDensity: Number(event.target.value) })}
                  onBlur={() => void savePreferences({ terminology_density: preferences.terminologyDensity })}
                />
                <output>{Math.round(preferences.terminologyDensity * 100)}%</output>
              </label>
              <div className="learner-term-diagnostics" aria-label="当前文档术语提示状态">
                <div>
                  <strong>当前文档术语提示</strong>
                  <small>
                    {termScanStatus
                      ? termScanStatus.scan_status === "local_only"
                        ? "仅使用本地识别"
                        : termScanStatus.scan_status === "failed"
                          ? "智能补扫失败"
                          : ["queued", "running", "idle"].includes(termScanStatus.scan_status)
                            ? "正在分析"
                            : "分析完成"
                      : "打开课件或回答后可查看"}
                  </small>
                </div>
                {termDiagnostics ? (
                  <p>
                    候选 {termDiagnostics.candidateCount} · 正文匹配 {termDiagnostics.occurrenceCount} · 显示 {termDiagnostics.visibleCount}
                  </p>
                ) : null}
                {termScanStatus?.error_message ? <p className="error-text">{termScanStatus.error_message}</p> : null}
                {onRescanTerms && termScanStatus ? (
                  <button type="button" className="secondary-button compact" onClick={() => void onRescanTerms()}>
                    <RotateCcw size={14} />重新分析
                  </button>
                ) : null}
              </div>
              <div className="learner-preference-actions">
                <button type="button" className="secondary-button" disabled={preferencesSaving} onClick={() => void resetPreferences()}>重置为默认</button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
