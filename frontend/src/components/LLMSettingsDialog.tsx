import {
  BookOpen,
  BrainCircuit,
  ClipboardPaste,
  ExternalLink,
  KeyRound,
  Save,
  ShieldCheck,
  TestTube2,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import {
  getLLMSettings,
  getLearnerPreferences,
  getPersonalizationRuntimeSettings,
  resetPersonalizationProfile,
  saveLLMSettings,
  savePersonalizationRuntimeSettings,
  testLLMSettings,
  updateLearnerPreferences,
  type LLMSettings,
  type PersonalizationRuntimeSettings,
} from "../api/client";

const DEEPSEEK_API_KEY_URL = "https://platform.deepseek.com/api_keys";

const DEFAULT_RUNTIME_SETTINGS: PersonalizationRuntimeSettings = {
  supported: false,
  teacher_planner_enabled: false,
  observer_enabled: false,
  teacher_planner_mode: "assist",
  observer_mode: "shadow",
};

type Props = {
  open: boolean;
  projectId?: number | null;
  onClose: () => void;
  onConfirm: (title: string, message: string, options?: { confirmText?: string; danger?: boolean; skipKey?: string }) => Promise<boolean>;
  onOpenExternal: (url: string) => void;
  onPreferencesChanged?: (terminologyDensity: number) => void;
};

export default function LLMSettingsDialog({
  open,
  projectId,
  onClose,
  onConfirm,
  onOpenExternal,
  onPreferencesChanged,
}: Props) {
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [runtimeSettings, setRuntimeSettings] = useState<PersonalizationRuntimeSettings | null>(null);
  const [terminologyDensity, setTerminologyDensity] = useState(0.5);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState<"project" | "all" | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setMessage("");
    setApiKey("");
    setClearApiKey(false);
    setSettings(null);
    setRuntimeSettings(null);

    void (async () => {
      const [llmResult, runtimeResult, preferencesResult] = await Promise.allSettled([
        getLLMSettings(),
        getPersonalizationRuntimeSettings(),
        projectId != null ? getLearnerPreferences(projectId) : Promise.resolve(null),
      ]);
      if (cancelled) return;

      if (llmResult.status === "fulfilled") {
        setSettings(llmResult.value);
      } else {
        setMessage(llmResult.reason instanceof Error ? llmResult.reason.message : "读取模型配置失败");
      }

      setRuntimeSettings(
        runtimeResult.status === "fulfilled"
          ? runtimeResult.value
          : DEFAULT_RUNTIME_SETTINGS,
      );

      if (preferencesResult.status === "fulfilled" && preferencesResult.value) {
        setTerminologyDensity(preferencesResult.value.terminologyDensity);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;

    setSaving(true);
    setMessage("");
    const savedParts: string[] = [];
    try {
      const saved = await saveLLMSettings({
        provider: settings.provider,
        base_url: settings.base_url,
        model: settings.model,
        enabled: settings.enabled,
        api_key: apiKey || undefined,
        clear_api_key: clearApiKey,
      });
      setSettings(saved);
      setApiKey("");
      setClearApiKey(false);
      savedParts.push("模型 API");

      if (runtimeSettings?.supported) {
        const savedRuntime = await savePersonalizationRuntimeSettings({
          teacher_planner_enabled: runtimeSettings.teacher_planner_enabled,
          observer_enabled: runtimeSettings.observer_enabled,
        });
        setRuntimeSettings(savedRuntime);
        savedParts.push("个性化教学");
      }

      if (projectId != null) {
        const preferences = await updateLearnerPreferences(projectId, {
          terminology_density: terminologyDensity,
          scope: "global",
        });
        setTerminologyDensity(preferences.terminologyDensity);
        onPreferencesChanged?.(preferences.terminologyDensity);
        savedParts.push("术语提示");
      }

      const needsModel = Boolean(
        runtimeSettings?.supported
        && (runtimeSettings.teacher_planner_enabled || runtimeSettings.observer_enabled),
      );
      const inactiveNotice = needsModel && (!saved.enabled || !saved.has_api_key)
        ? " 个性化开关已保存，但需启用模型 API 并保存 Key 后才会生效。"
        : "";
      setMessage(`已保存：${savedParts.join("、")}。API Key 仅保存在本机。${inactiveNotice}`);
    } catch (caught) {
      const prefix = savedParts.length > 0 ? `已保存 ${savedParts.join("、")}；` : "";
      setMessage(`${prefix}${caught instanceof Error ? caught.message : "保存失败"}`);
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    const ok = await onConfirm("测试模型 API", "将调用模型 API 做连通性测试，可能消耗少量 token。是否继续？", {
      confirmText: "测试",
      skipKey: "confirm.test_api",
    });
    if (!ok) return;

    setTesting(true);
    setMessage("");
    try {
      const result = await testLLMSettings();
      setMessage(result.ok ? `测试成功：${result.message}` : `测试失败：${result.message}`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function clearPersonalization(scope: "project" | "all") {
    if (projectId == null) {
      setMessage("请先打开一个项目。以当前项目作为数据清除入口。 ");
      return;
    }
    const all = scope === "all";
    const ok = await onConfirm(
      all ? "清除全部个性化数据" : "清除当前项目画像",
      all
        ? "将清除所有项目及全局的学习画像、教学历史、观察记录和术语展示记录。课程、代码、问答内容和已生成的术语解释不会删除。"
        : "将清除当前项目的学习画像、教学历史、观察记录和术语展示记录。课程、代码和问答内容不会删除。",
      { confirmText: "清除", danger: true },
    );
    if (!ok) return;

    setClearing(scope);
    setMessage("");
    try {
      const result = await resetPersonalizationProfile(projectId, scope);
      const preferences = await getLearnerPreferences(projectId);
      setTerminologyDensity(preferences.terminologyDensity);
      onPreferencesChanged?.(preferences.terminologyDensity);
      const total = result.deletedMasteryCount
        + result.deletedEventCount
        + (result.deletedShadowCount ?? 0);
      setMessage(all ? `全部个性化数据已清除（${total} 条记录）。` : `当前项目画像已清除（${total} 条记录）。`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "清除失败");
    } finally {
      setClearing(null);
    }
  }

  async function pasteApiKey() {
    setMessage("");
    try {
      let value = "";
      if (document.documentElement.classList.contains("platform-android")) {
        const { Clipboard } = await import("@capacitor/clipboard");
        value = (await Clipboard.read()).value;
      } else if (navigator.clipboard?.readText) {
        value = await navigator.clipboard.readText();
      }

      if (!value.trim()) {
        setMessage("剪贴板中没有可粘贴的文本。");
        return;
      }

      setApiKey(value.trim());
      setClearApiKey(false);
      setMessage("API Key 已从剪贴板粘贴。");
    } catch {
      setMessage("无法读取剪贴板，请长按输入框选择粘贴。");
    }
  }

  const controlsDisabled = saving || testing || clearing !== null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="设置">
      <form className="settings-modal settings-modal--complete" onSubmit={submit}>
        <div className="modal-title">
          <span>
            <KeyRound size={17} />
            设置
          </span>
          <button type="button" className="icon-button" onClick={onClose} title="关闭" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="settings-scroll">
          <section className="settings-section" aria-labelledby="settings-model-title">
            <h3 id="settings-model-title"><KeyRound size={16} />模型 API</h3>
            {settings ? (
              <div className="settings-grid">
                <label>
                  <span>Provider</span>
                  <select value={settings.provider} onChange={(event) => setSettings({ ...settings, provider: event.target.value })}>
                    <option value="deepseek">DeepSeek</option>
                    <option value="openai-compatible">OpenAI Compatible</option>
                  </select>
                </label>
                <label>
                  <span>Base URL</span>
                  <input
                    value={settings.base_url}
                    onChange={(event) => setSettings({ ...settings, base_url: event.target.value })}
                    placeholder="https://api.deepseek.com"
                  />
                </label>
                <label>
                  <span>Model</span>
                  <input
                    value={settings.model}
                    onChange={(event) => setSettings({ ...settings, model: event.target.value })}
                    placeholder="deepseek-v4-flash"
                  />
                </label>
                <label>
                  <span>API Key</span>
                  <div className="settings-secret-row">
                    <input
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      type="password"
                      placeholder={settings.has_api_key ? `已保存：${settings.masked_api_key}` : "sk-..."}
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="done"
                    />
                    <button
                      type="button"
                      className="secondary-button compact settings-paste-button"
                      onClick={() => void pasteApiKey()}
                      title="从剪贴板粘贴 API Key"
                      aria-label="从剪贴板粘贴 API Key"
                    >
                      <ClipboardPaste size={15} />
                      粘贴
                    </button>
                  </div>
                </label>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}
                  />
                  <span>启用模型 API</span>
                </label>
                <label className="toggle-row">
                  <input type="checkbox" checked={clearApiKey} onChange={(event) => setClearApiKey(event.target.checked)} />
                  <span>保存时清除已保存 Key</span>
                </label>
              </div>
            ) : (
              <div className="empty settings-loading">读取中...</div>
            )}
          </section>

          <section className="settings-section" aria-labelledby="settings-personalization-title">
            <h3 id="settings-personalization-title"><BrainCircuit size={16} />个性化教学</h3>
            {runtimeSettings ? (
              runtimeSettings.supported ? (
                <div className="settings-grid settings-grid--single">
                  <label className="toggle-row settings-toggle-card">
                    <input
                      type="checkbox"
                      checked={runtimeSettings.teacher_planner_enabled}
                      onChange={(event) => setRuntimeSettings({ ...runtimeSettings, teacher_planner_enabled: event.target.checked })}
                    />
                    <span>
                      <strong>使用个性化教学</strong>
                      <small>只在连续追问或需要深入讲解时选择讲解方式；普通问题保持原有速度，失败或超时自动回退。</small>
                    </span>
                  </label>
                  <label className="toggle-row settings-toggle-card">
                    <input
                      type="checkbox"
                      checked={runtimeSettings.observer_enabled}
                      onChange={(event) => setRuntimeSettings({ ...runtimeSettings, observer_enabled: event.target.checked })}
                    />
                    <span>
                      <strong>分析学习过程</strong>
                      <small>问答完成后异步提取学习证据，不阻塞当前回答。</small>
                    </span>
                  </label>
                  <p className="settings-note">两个功能会产生额外模型调用。建议先由你自己试用，再开放给其他用户。</p>
                </div>
              ) : (
                <div className="settings-platform-note">
                  当前运行环境未提供 Planner 与 Observer；普通问答和术语反馈仍可使用。
                </div>
              )
            ) : (
              <div className="empty settings-loading">读取中...</div>
            )}
          </section>

          <section className="settings-section" aria-labelledby="settings-reading-title">
            <h3 id="settings-reading-title"><BookOpen size={16} />阅读</h3>
            <div className="settings-grid settings-grid--single">
              <label>
                <span>陌生术语提示</span>
                <select
                  value={String(terminologyDensity)}
                  disabled={projectId == null}
                  onChange={(event) => setTerminologyDensity(Number(event.target.value))}
                >
                  <option value="0">关闭</option>
                  <option value="0.25">少</option>
                  <option value="0.5">标准</option>
                  <option value="0.75">多</option>
                </select>
                <small>只调整自动术语提示数量。手动创建的术语链接仍会显示。</small>
              </label>
            </div>
          </section>

          <section className="settings-section settings-section--danger" aria-labelledby="settings-privacy-title">
            <h3 id="settings-privacy-title"><ShieldCheck size={16} />数据与隐私</h3>
            <div className="settings-danger-actions">
              <button
                type="button"
                className="secondary-button danger"
                disabled={controlsDisabled || projectId == null}
                onClick={() => void clearPersonalization("project")}
              >
                <Trash2 size={15} />
                {clearing === "project" ? "清除中..." : "清除当前项目画像"}
              </button>
              <button
                type="button"
                className="secondary-button danger"
                disabled={controlsDisabled || projectId == null}
                onClick={() => void clearPersonalization("all")}
              >
                <Trash2 size={15} />
                {clearing === "all" ? "清除中..." : "清除全部个性化数据"}
              </button>
            </div>
            <p className="settings-note">不会删除项目文件、课程、问答正文或已生成的术语解释。</p>
          </section>
        </div>

        <div className="settings-actions">
          <button type="button" className="secondary-button" onClick={() => onOpenExternal(DEEPSEEK_API_KEY_URL)}>
            <ExternalLink size={15} />
            DeepSeek
          </button>
          <button type="button" className="secondary-button" onClick={runTest} disabled={controlsDisabled || !settings}>
            <TestTube2 size={15} />
            {testing ? "测试中..." : "测试"}
          </button>
          <button type="submit" className="primary-button" disabled={controlsDisabled || !settings}>
            <Save size={15} />
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
        {message ? <div className="settings-message" role="alert">{message}</div> : null}
      </form>
    </div>
  );
}
