import { useEffect, useMemo, useState } from "react";
import { Eye, History, Loader2, RotateCcw, X } from "lucide-react";
import {
  getPromptHistory,
  getPromptMetadata,
  previewPrompt,
  savePrompts,
  type PromptRevision,
  type PromptTemplateMetadata,
} from "../api/client";
import { validatePromptTemplate } from "../personalization/promptTemplateContract";

type Props = {
  onClose: () => void;
};

export default function PromptEditor({ onClose }: Props) {
  const [metadata, setMetadata] = useState<PromptTemplateMetadata[]>([]);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("prompt.system");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [history, setHistory] = useState<PromptRevision[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    getPromptMetadata()
      .then(({ prompts }) => {
        setMetadata(prompts);
        const values = Object.fromEntries(
          prompts.map((item) => [item.key, item.current]),
        );
        setSaved(values);
        setEdited(values);
        if (prompts.length && !prompts.some((item) => item.key === activeTab)) {
          setActiveTab(prompts[0].key);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  const activeMetadata = metadata.find((item) => item.key === activeTab);
  const activeValue = edited[activeTab] || "";
  const validationErrors = useMemo(
    () => activeMetadata ? validatePromptTemplate(activeTab, activeValue) : [],
    [activeMetadata, activeTab, activeValue],
  );
  const dirty = useMemo(
    () => Object.keys(edited).some((key) => edited[key] !== saved[key]),
    [edited, saved],
  );
  const hasErrors = useMemo(
    () => metadata.some((item) =>
      validatePromptTemplate(item.key, edited[item.key] || "").length > 0
    ),
    [edited, metadata],
  );

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  function requestClose() {
    if (dirty && !window.confirm("提示词还有未保存的修改，确定关闭吗？")) return;
    onClose();
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await savePrompts(edited);
      setSaved({ ...edited });
      setHistory(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (!activeMetadata) return;
    setEdited((previous) => ({
      ...previous,
      [activeTab]: activeMetadata.default,
    }));
    setPreview("");
    setHistory(null);
  }

  async function handlePreview() {
    setPreviewing(true);
    setError("");
    try {
      const result = await previewPrompt(activeTab, activeValue);
      setPreview(result.rendered);
      setHistory(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "预览失败");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleHistory() {
    setHistoryLoading(true);
    setError("");
    try {
      const result = await getPromptHistory(activeTab);
      setHistory(result.revisions);
      setPreview("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "历史加载失败");
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div
        className="settings-modal prompt-editor-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-title">
          <span>提示词编辑</span>
          <button className="icon-button" onClick={requestClose} title="关闭" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="empty prompt-editor-loading">
            <Loader2 size={20} className="spin" />
          </div>
        ) : (
          <>
            <div className="prompt-tabs-shell">
              <div className="prompt-tabs">
                {metadata.map((item) => (
                  <button
                    key={item.key}
                    className={`prompt-tab ${activeTab === item.key ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab(item.key);
                      setPreview("");
                      setHistory(null);
                    }}
                  >
                    {item.label}
                    {edited[item.key] !== saved[item.key] ? <span aria-label="未保存">•</span> : null}
                  </button>
                ))}
              </div>
            </div>

            <div className="prompt-editor-body">
              <div className="prompt-editor-heading">
                <div>
                  <div className="prompt-editor-label">{activeMetadata?.label}</div>
                  <p>{activeMetadata?.description}</p>
                </div>
                <div className="prompt-editor-tools">
                  <button className="secondary-button compact" onClick={handlePreview} disabled={previewing || validationErrors.length > 0}>
                    {previewing ? <Loader2 size={14} className="spin" /> : <Eye size={14} />}
                    预览
                  </button>
                  <button className="secondary-button compact" onClick={handleHistory} disabled={historyLoading}>
                    {historyLoading ? <Loader2 size={14} className="spin" /> : <History size={14} />}
                    历史
                  </button>
                  <button className="secondary-button compact" onClick={handleReset} title="载入此版本的真正默认值">
                    <RotateCcw size={14} />
                    默认值
                  </button>
                </div>
              </div>

              {activeMetadata?.required_placeholders.length ? (
                <div className="prompt-placeholders">
                  <span>必要变量</span>
                  {activeMetadata.required_placeholders.map((placeholder) => (
                    <code key={placeholder}>{`{${placeholder}}`}</code>
                  ))}
                </div>
              ) : null}

              <textarea
                className={`prompt-editor-textarea ${validationErrors.length ? "invalid" : ""}`}
                value={activeValue}
                onChange={(event) => {
                  setEdited((previous) => ({
                    ...previous,
                    [activeTab]: event.target.value,
                  }));
                  setPreview("");
                }}
                aria-label={activeMetadata?.label || "提示词"}
                spellCheck={false}
              />

              {validationErrors.length ? (
                <div className="prompt-validation" role="alert">
                  {validationErrors.map((message) => <div key={message}>{message}</div>)}
                </div>
              ) : null}

              {preview ? (
                <div className="prompt-preview">
                  <div className="prompt-preview-title">安全示例预览</div>
                  <pre>{preview}</pre>
                </div>
              ) : null}

              {history ? (
                <div className="prompt-history">
                  <div className="prompt-preview-title">最近版本</div>
                  {history.length ? history.map((revision) => (
                    <button
                      key={revision.id}
                      className="prompt-history-row"
                      onClick={() => {
                        setEdited((previous) => ({
                          ...previous,
                          [activeTab]: revision.value,
                        }));
                        setHistory(null);
                      }}
                    >
                      <span>{revision.source === "reset" ? "恢复默认" : "手动保存"}</span>
                      <time>{new Date(revision.created_at).toLocaleString()}</time>
                      <small>{revision.value.slice(0, 90).replace(/\s+/g, " ")}</small>
                    </button>
                  )) : <div className="prompt-history-empty">还没有保存历史</div>}
                </div>
              ) : null}
            </div>

            {error ? <div className="qa-local-error prompt-editor-error" role="alert">{error}</div> : null}

            <div className="settings-actions">
              <button className="secondary-button" onClick={requestClose}>取消</button>
              <button
                className="primary-button"
                onClick={handleSave}
                disabled={saving || !dirty || hasErrors}
              >
                {saving ? <Loader2 size={15} className="spin" /> : null}
                保存
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
