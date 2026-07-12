import { ExternalLink, KeyRound, Save, TestTube2, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { getLLMSettings, saveLLMSettings, testLLMSettings, type LLMSettings } from "../api/client";

const DEEPSEEK_API_KEY_URL = "https://platform.deepseek.com/api_keys";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (title: string, message: string, options?: { confirmText?: string; danger?: boolean }) => Promise<boolean>;
  onOpenExternal: (url: string) => void;
};

export default function LLMSettingsDialog({ open, onClose, onConfirm, onOpenExternal }: Props) {
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setMessage("");
    setApiKey("");
    setClearApiKey(false);
    getLLMSettings()
      .then(setSettings)
      .catch((caught) => setMessage(caught instanceof Error ? caught.message : "读取配置失败"));
  }, [open]);

  if (!open) {
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) {
      return;
    }
    setSaving(true);
    setMessage("");
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
      setMessage("已保存。API Key 仅保存在本机，接口不会回显完整 Key。");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    const ok = await onConfirm("测试模型 API", "将调用模型 API 做连通性测试，可能消耗少量 token。是否继续？", {
      confirmText: "测试",
    });
    if (!ok) {
      return;
    }
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

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="模型 API 设置">
      <form className="settings-modal" onSubmit={submit}>
        <div className="modal-title">
          <span>
            <KeyRound size={17} />
            模型 API
          </span>
          <button type="button" className="icon-button" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
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
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                type="password"
                placeholder={settings.has_api_key ? `已保存：${settings.masked_api_key}` : "sk-..."}
                autoComplete="off"
              />
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
              <span>清除已保存 Key</span>
            </label>
          </div>
        ) : (
          <div className="empty">读取中...</div>
        )}
        <div className="settings-actions">
          <button type="button" className="link-button" onClick={() => onOpenExternal(DEEPSEEK_API_KEY_URL)}>
            <ExternalLink size={15} />
            DeepSeek API Key
          </button>
          <button type="button" className="secondary-button" onClick={runTest} disabled={testing || saving}>
            <TestTube2 size={15} />
            {testing ? "测试中..." : "测试"}
          </button>
          <button type="submit" disabled={saving || !settings}>
            <Save size={15} />
            {saving ? "保存中..." : "保存"}
          </button>
          <button type="button" className="secondary-button" onClick={() => setClearApiKey(true)} title="标记清除 Key">
            <Trash2 size={15} />
          </button>
        </div>
        {message ? <div className="settings-message">{message}</div> : null}
      </form>
    </div>
  );
}
