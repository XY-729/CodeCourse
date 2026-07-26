import { useEffect, useRef, useState } from "react";
import { Check, CircleHelp, RotateCcw, Undo2, X } from "lucide-react";
import {
  clearConceptOverride,
  getPersonalizationProfile,
  markConceptKnown,
  markConceptUnknown,
  resetPersonalizationProfile,
  updateLearnerPreferences,
  type PersonalizationProfile,
} from "../api/client";
import { isAndroidRuntime } from "../platform/runtime";

type Props = {
  open: boolean;
  projectId: number | null;
  onClose: () => void;
};

export default function LearnerPreferencesDialog({ open, projectId, onClose }: Props) {
  const [profile, setProfile] = useState<PersonalizationProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingReset, setPendingReset] = useState<"project" | "global" | null>(null);
  const [busyConceptId, setBusyConceptId] = useState<string | null>(null);
  const pendingPreferencePayload = useRef<Record<string, unknown>>({});
  const saveTimer = useRef<number | null>(null);
  const saveSequence = useRef(0);

  async function load(showLoading = true) {
    if (!projectId) return;
    if (showLoading) setLoading(true);
    setError("");
    try {
      setProfile(await getPersonalizationProfile(projectId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "学习档案加载失败");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
    const activeProjectId = projectId;
    return () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const payload = pendingPreferencePayload.current;
      pendingPreferencePayload.current = {};
      if (activeProjectId && Object.keys(payload).length > 0) {
        void updateLearnerPreferences(activeProjectId, { ...payload, scope: "global" });
      }
    };
  }, [open, projectId]);

  if (!open) return null;

  async function persistPreferences() {
    if (!projectId) return;
    const payload = pendingPreferencePayload.current;
    pendingPreferencePayload.current = {};
    if (Object.keys(payload).length === 0) return;
    const sequence = ++saveSequence.current;
    setSaving(true);
    try {
      await updateLearnerPreferences(projectId, { ...payload, scope: "global" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "偏好保存失败");
    } finally {
      if (sequence === saveSequence.current) setSaving(false);
    }
  }

  function updatePreference(
    profileKey: "answerDepth" | "codeRatio" | "prerequisiteDetail" | "terminologyDensity" | "explanationOrder" | "surveyEnabled",
    apiKey: "answer_depth" | "code_ratio" | "prerequisite_detail" | "terminology_density" | "explanation_order" | "survey_enabled",
    value: number | string | boolean,
  ) {
    setProfile((current) => current ? {
      ...current,
      preferences: { ...current.preferences, [profileKey]: value },
    } : current);
    pendingPreferencePayload.current = {
      ...pendingPreferencePayload.current,
      [apiKey]: value,
    };
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void persistPreferences();
    }, 220);
  }

  function closeDialog() {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    void persistPreferences();
    onClose();
  }

  async function reset(scope: "project" | "global") {
    if (!projectId) return;
    if (pendingReset !== scope) {
      setPendingReset(scope);
      return;
    }
    try {
      await resetPersonalizationProfile(projectId, scope);
      setPendingReset(null);
      await load(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "学习档案重置失败");
    }
  }

  async function setConceptStatus(conceptId: string, status: "known" | "unknown" | "clear") {
    if (!projectId) return;
    setBusyConceptId(conceptId);
    setError("");
    const key = `profile-${status}:${projectId}:${conceptId}:${Date.now()}`;
    try {
      if (status === "known") await markConceptKnown(projectId, conceptId, key, "在学习偏好中手动标记");
      else if (status === "unknown") await markConceptUnknown(projectId, conceptId, key, "在学习偏好中手动标记");
      else await clearConceptOverride(projectId, conceptId, key);
      await load(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "概念判断更新失败");
    } finally {
      setBusyConceptId(null);
    }
  }

  const preferences = profile?.preferences;
  const groups = {
    unfamiliar: profile?.concepts.filter((item) => item.judgement === "unfamiliar") ?? [],
    uncertain: profile?.concepts.filter((item) => item.judgement === "uncertain") ?? [],
    known: profile?.concepts.filter((item) => item.judgement === "known") ?? [],
  };
  return (
    <div className={`preferences-layer ${isAndroidRuntime() ? "android" : ""}`} onMouseDown={closeDialog}>
      <section className="preferences-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><strong>学习偏好</strong><small>仅保存在当前设备</small></div>
          <span className={`preference-save-status ${saving ? "visible" : ""}`} aria-live="polite">
            {saving ? "保存中" : ""}
          </span>
          <button className="icon-button" onClick={closeDialog}><X size={17} /></button>
        </header>
        {loading && !profile ? <div className="viewer-loading">正在读取学习档案...</div> : null}
        {error ? <div className="form-error">{error}</div> : null}
        {preferences ? (
          <div className="preferences-content">
            <section>
              <h3>回答风格</h3>
              <label><span>回答深度</span><input type="range" min="0" max="1" step="0.05" value={preferences.answerDepth} onChange={(event) => updatePreference("answerDepth", "answer_depth", Number(event.target.value))} onPointerUp={() => void persistPreferences()} /></label>
              <label><span>代码比例</span><input type="range" min="0" max="1" step="0.05" value={preferences.codeRatio} onChange={(event) => updatePreference("codeRatio", "code_ratio", Number(event.target.value))} onPointerUp={() => void persistPreferences()} /></label>
              <label><span>前置知识</span><input type="range" min="0" max="1" step="0.05" value={preferences.prerequisiteDetail} onChange={(event) => updatePreference("prerequisiteDetail", "prerequisite_detail", Number(event.target.value))} onPointerUp={() => void persistPreferences()} /></label>
              <label><span>术语密度</span><input type="range" min="0" max="1" step="0.05" value={preferences.terminologyDensity} onChange={(event) => updatePreference("terminologyDensity", "terminology_density", Number(event.target.value))} onPointerUp={() => void persistPreferences()} /></label>
              <label><span>讲解顺序</span><select value={preferences.explanationOrder} onChange={(event) => updatePreference("explanationOrder", "explanation_order", event.target.value)}><option value="balanced">平衡</option><option value="example_first">先看例子</option><option value="principle_first">先讲原理</option><option value="code_first">先看代码</option></select></label>
              <label className="preference-toggle"><input type="checkbox" checked={preferences.surveyEnabled} onChange={(event) => updatePreference("surveyEnabled", "survey_enabled", event.target.checked)} /><span>允许低频风格选择题</span></label>
            </section>
            <section>
              <h3>概念判断</h3>
              <div className="concept-summary">
                <span>陌生 <strong>{groups.unfamiliar.length}</strong></span>
                <span>不确定 <strong>{groups.uncertain.length}</strong></span>
                <span>已掌握 <strong>{groups.known.length}</strong></span>
              </div>
              <div className="concept-list">
                {[...groups.unfamiliar, ...groups.uncertain, ...groups.known].slice(0, 80).map((item) => (
                  <div key={item.concept.id} className="concept-row">
                    <span>
                      <strong>{item.concept.displayName}</strong>
                      <small>{item.judgement === "unfamiliar" ? "陌生" : item.judgement === "known" ? "已掌握" : "不确定"}</small>
                    </span>
                    <div className="concept-actions" aria-label={`${item.concept.displayName} 掌握状态`}>
                      <button
                        type="button"
                        className={item.judgement === "known" ? "active" : ""}
                        disabled={busyConceptId === item.concept.id}
                        onClick={() => void setConceptStatus(item.concept.id, "known")}
                        title="我认识"
                      ><Check size={13} /></button>
                      <button
                        type="button"
                        className={item.judgement === "unfamiliar" ? "active" : ""}
                        disabled={busyConceptId === item.concept.id}
                        onClick={() => void setConceptStatus(item.concept.id, "unknown")}
                        title="我不认识"
                      ><CircleHelp size={13} /></button>
                      <button
                        type="button"
                        disabled={busyConceptId === item.concept.id}
                        onClick={() => void setConceptStatus(item.concept.id, "clear")}
                        title="撤销人工判断"
                      ><Undo2 size={13} /></button>
                    </div>
                  </div>
                ))}
                {!profile?.concepts.length ? <p>完成几次提问后，这里会逐渐形成你的学习档案。</p> : null}
              </div>
            </section>
            <section>
              <h3>判断依据</h3>
              <div className="preference-evidence">
                {profile?.preferenceEvidence.slice(0, 20).map((item) => <div key={item.id}><span>{item.evidenceText || item.dimension}</span><small>{item.source}</small></div>)}
                {!profile?.preferenceEvidence.length ? <p>尚无回答风格证据。</p> : null}
              </div>
            </section>
          </div>
        ) : null}
        <footer>
          {pendingReset ? (
            <span className="reset-confirmation">
              {pendingReset === "global" ? "再次点击将重置全部学习档案" : "再次点击将重置当前项目档案"}
              <button type="button" className="quiet" onClick={() => setPendingReset(null)}>取消</button>
            </span>
          ) : null}
          <button className="secondary-button danger" onClick={() => void reset("project")}><RotateCcw size={14} />重置当前项目</button>
          <button className="secondary-button danger" onClick={() => void reset("global")}><RotateCcw size={14} />重置全部档案</button>
        </footer>
      </section>
    </div>
  );
}
