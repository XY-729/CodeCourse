import {
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
  getLearningSettings,
  resetPersonalizationProfile,
  saveLLMSettings,
  saveLearningSettings,
  testLLMSettings,
  type LLMSettings,
  type LearningSettings,
} from "../../api/client";

const DEEPSEEK_API_KEY_URL = "https://platform.deepseek.com/api_keys";

type Props = {
  open: boolean;
  projectId?: number | null;
  onClose: () => void;
  onConfirm: (title: string, message: string, options?: { confirmText?: string; danger?: boolean; skipKey?: string }) => Promise<boolean>;
  onOpenExternal: (url: string) => void;
  onBusyChange?: (busy: boolean) => void;
};

export default function LLMSettingsDialog({
  open,
  projectId,
  onClose,
  onConfirm,
  onOpenExternal,
  onBusyChange,
}: Props) {
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [learningSettings, setLearningSettings] = useState<LearningSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState<"project" | "all" | null>(null);
  const [message, setMessage] = useState("");

  const controlsDisabled =
    saving ||
    testing ||
    clearing !== null;

  useEffect(() => {
    onBusyChange?.(
      controlsDisabled,
    );
  }, [
    controlsDisabled,
    onBusyChange,
  ]);

  useEffect(() => {
    return () => {
      onBusyChange?.(false);
    };
  }, [onBusyChange]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setMessage("");
    setApiKey("");
    setClearApiKey(false);
    setSettings(null);
    setLearningSettings(null);

    void (async () => {
      const [llmResult, learningResult] = await Promise.allSettled([getLLMSettings(), getLearningSettings()]);
      if (cancelled) return;

      if (llmResult.status === "fulfilled") {
        setSettings(llmResult.value);
      } else {
        setMessage(llmResult.reason instanceof Error ? llmResult.reason.message : "读取模型配置失败");
      }
      if (learningResult.status === "fulfilled") {
        setLearningSettings(learningResult.value);
      } else {
        setMessage(learningResult.reason instanceof Error ? learningResult.reason.message : "读取学习设置失败");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || !learningSettings) return;

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

      const savedLearning = await saveLearningSettings({
        primary_programming_language: learningSettings.primary_programming_language.trim(),
      });
      setLearningSettings(savedLearning);
      savedParts.push("学习设置");

      setMessage(`已保存：${savedParts.join("、")}。API Key 仅保存在本机。`);
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

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="设置">
      <form className="settings-modal settings-modal--complete" onSubmit={submit} aria-busy={controlsDisabled}>
        <div className="modal-title">
          <span>
            <KeyRound size={17} />
            设置
          </span>
          <button type="button" className="icon-button" onClick={onClose} disabled={controlsDisabled} title="关闭" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="settings-scroll">
          <section className="settings-section" aria-labelledby="settings-learning-title">
            <h3 id="settings-learning-title">学习设置</h3>
            {learningSettings ? (
              <div className="settings-grid">
                <label>
                  <span>你的主要编程语言是：</span>
                  <input
                    value={learningSettings.primary_programming_language}
                    onChange={(event) => setLearningSettings({ primary_programming_language: event.target.value })}
                    list="primary-programming-languages"
                    maxLength={80}
                    placeholder="留空由 AI 选择，也可以输入其他语言"
                    disabled={controlsDisabled}
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                  <datalist id="primary-programming-languages">
                    {["Python", "JavaScript", "TypeScript", "Java", "C", "C++", "C#", "Go", "Rust", "Kotlin", "Swift", "PHP", "Ruby"].map((language) => (
                      <option key={language} value={language} />
                    ))}
                  </datalist>
                </label>
              </div>
            ) : <div className="empty settings-loading">读取中...</div>}
            <p className="settings-note">课程和问答举例会优先使用这门语言；学习目标语言和本次明确要求优先。项目原有代码保持原语言。清空后保存即可由 AI 选择。</p>
          </section>
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
                    placeholder="deepseek-flash"
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
          <button type="submit" className="primary-button" disabled={controlsDisabled || !settings || !learningSettings}>
            <Save size={15} />
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
        {message ? <div className="settings-message" role="alert">{message}</div> : null}
      </form>
    </div>
  );
}
