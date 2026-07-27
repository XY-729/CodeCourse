import { useEffect, useState } from "react";
import { isAndroidRuntime } from "../platform/runtime";

interface PersonalizedTeachingSettings {
  teachingEnabled: boolean;
  observationEnabled: boolean;
}

interface Props {
  open: boolean;
  modelConfigured: boolean;
  settings: PersonalizedTeachingSettings;
  onClose: () => void;
  onChangeTeachingEnabled: (enabled: boolean) => Promise<void>;
  onChangeObservationEnabled: (enabled: boolean) => Promise<void>;
  onOpenModelSettings: () => void;
  onResetCurrentProject: () => Promise<void>;
  onResetAllPersonalization: () => Promise<void>;
  onConfirm: (title: string, message: string, options?: { confirmText?: string; danger?: boolean }) => Promise<boolean>;
}

export default function PersonalizedTeachingDialog({
  open, modelConfigured, settings, onClose,
  onChangeTeachingEnabled, onChangeObservationEnabled,
  onOpenModelSettings, onResetCurrentProject, onResetAllPersonalization,
  onConfirm,
}: Props) {
  const [teachingEnabled, setTeachingEnabled] = useState(settings.teachingEnabled);
  const [observationEnabled, setObservationEnabled] = useState(settings.observationEnabled);
  const [savingKey, setSavingKey] = useState<"teaching" | "observation" | null>(null);
  const [observationConsentNeeded, setObservationConsentNeeded] = useState(false);

  useEffect(() => {
    setTeachingEnabled(settings.teachingEnabled);
    setObservationEnabled(settings.observationEnabled);
  }, [settings]);

  if (!open) return null;

  const android = isAndroidRuntime();

  async function updateTeaching(enabled: boolean) {
    const prev = teachingEnabled;
    setTeachingEnabled(enabled);
    setSavingKey("teaching");
    try { await onChangeTeachingEnabled(enabled); }
    catch { setTeachingEnabled(prev); }
    finally { setSavingKey(null); }
  }

  async function updateObservation(enabled: boolean) {
    if (enabled && !modelConfigured) { onOpenModelSettings(); return; }
    if (enabled && !observationEnabled) {
      const confirmed = await onConfirm("开启学习过程分析", "开启后，CodeCourse 会在部分问答完成后使用你配置的模型分析学习过程，可能产生额外 API 费用。分析结果用于逐渐改善后续回答，不会自动修改你明确设置的知识状态。", { confirmText: "确认开启" });
      if (!confirmed) return;
    }
    const prev = observationEnabled;
    setObservationEnabled(enabled);
    setSavingKey("observation");
    try { await onChangeObservationEnabled(enabled); }
    catch { setObservationEnabled(prev); }
    finally { setSavingKey(null); }
  }

  async function handleResetCurrent() {
    const confirmed = await onConfirm("清除当前项目的个性化数据", "将删除当前项目中的概念状态、学习观察、教学计划和个性化记录。全局数据和其他项目不会受到影响。", { danger: true, confirmText: "确认清除" });
    if (!confirmed) return;
    await onResetCurrentProject();
  }

  async function handleResetAll() {
    const confirmed = await onConfirm("清除全部个性化数据", "将删除所有项目和全局范围的个性化数据。该操作不可撤销，但不会删除课程、项目文件或问答记录。", { danger: true, confirmText: "确认清除全部" });
    if (!confirmed) return;
    await onResetAllPersonalization();
  }

  return (
    <div
      className={`personalized-teaching-overlay ${android ? "android" : ""}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <section className={`personalized-teaching-dialog ${android ? "android" : ""}`} role="dialog" aria-modal="true" aria-label="个性化教学">
        <header className="dialog-header">
          <div>
            <h2>个性化教学</h2>
            <p>根据你的学习过程调整回答方式</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><span aria-hidden="true">&times;</span></button>
        </header>

        <div className="dialog-body">
          <section className="settings-card">
            <div className="settings-card-row">
              <div>
                <h3>个性化教学</h3>
                <p>根据当前问题、已有知识和学习过程，动态调整回答重点、解释顺序和教学方式。</p>
              </div>
              <label className="toggle-label">
                <input type="checkbox" checked={teachingEnabled} disabled={savingKey === "teaching"} onChange={(e) => { void updateTeaching(e.target.checked); }} />
                <span className="toggle-track" />
              </label>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-row">
              <div>
                <h3>学习过程分析</h3>
                <p>在问答结束后分析哪些内容已经理解、哪些地方仍然不确定，以及哪种讲解方式更有效。</p>
                <p className="hint">可能使用你当前配置的模型并产生额外 API 调用费用。分析失败不会影响正常回答。</p>
                {!modelConfigured && <button type="button" className="text-link" onClick={onOpenModelSettings}>前往模型设置</button>}
              </div>
              <label className="toggle-label">
                <input type="checkbox" checked={observationEnabled} disabled={savingKey === "observation"} onChange={(e) => { void updateObservation(e.target.checked); }} />
                <span className="toggle-track" />
              </label>
            </div>
          </section>

          <section className="settings-card">
            <h3>数据与隐私</h3>
            <p>个性化数据、概念状态和教学记录仅保存在当前设备。</p>
            <div className="danger-actions">
              <button type="button" className="secondary-button" onClick={() => { void handleResetCurrent(); }}>清除当前项目的个性化数据</button>
              <button type="button" className="secondary-button danger" onClick={() => { void handleResetAll(); }}>清除全部个性化数据</button>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
