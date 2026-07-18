import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { getPrompts, savePrompts } from "../api/client";

const PROMPT_LABELS: Record<string, string> = {
  "prompt.system": "总体要求",
  "prompt.outline": "总纲生成",
  "prompt.file_lesson.template": "课件模板",
  "prompt.file_lesson.detailed_expected": "详细生成",
  "prompt.file_lesson.brief_expected": "粗略介绍",
  "prompt.outline_lesson": "项目课件生成",
  "prompt.learning_plan.outline": "学习计划总纲",
  "prompt.learning_plan.lesson": "学习计划课件",
  "prompt.qa.answer": "AI 助手",
};

type Props = {
  onClose: () => void;
};

export default function PromptEditor({ onClose }: Props) {
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("prompt.system");
  const [error, setError] = useState("");

  useEffect(() => {
    getPrompts()
      .then((data) => {
        setPrompts(data);
        setEdited(data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await savePrompts(edited);
      setPrompts({ ...edited });
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function handleReset(key: string) {
    getPrompts().then((data) => {
      if (data[key] !== undefined) {
        setEdited((prev) => ({ ...prev, [key]: data[key] }));
      }
    });
  }

  const keys = Object.keys(PROMPT_LABELS);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="settings-modal prompt-editor-modal"
        style={{ maxWidth: 800 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">
          <span>提示词编辑</span>
          <button className="icon-button" onClick={onClose} title="关闭"><X size={16} /></button>
        </div>

        {loading ? (
          <div className="empty" style={{ padding: 32, textAlign: "center" }}>
            <Loader2 size={20} className="spin" />
          </div>
        ) : (
          <>
            <div className="prompt-tabs">
              {keys.map((key) => (
                <button
                  key={key}
                  className={`prompt-tab ${activeTab === key ? "active" : ""}`}
                  onClick={() => setActiveTab(key)}
                >
                  {PROMPT_LABELS[key]}
                </button>
              ))}
            </div>

            <div className="prompt-editor-body">
              <div className="prompt-editor-label">
                {PROMPT_LABELS[activeTab]}
                <button
                  className="secondary-button compact"
                  onClick={() => handleReset(activeTab)}
                  title="重置为默认值"
                >
                  重置
                </button>
              </div>
              <textarea
                className="prompt-editor-textarea"
                value={edited[activeTab] || ""}
                onChange={(e) =>
                  setEdited((prev) => ({ ...prev, [activeTab]: e.target.value }))
                }
              />
            </div>

            {error ? <div className="qa-local-error" style={{ padding: "0 16px" }}>{error}</div> : null}

            <div className="settings-actions">
              <button className="secondary-button" onClick={onClose}>
                取消
              </button>
              <button className="primary-button" onClick={handleSave} disabled={saving}>
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
