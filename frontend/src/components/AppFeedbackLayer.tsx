import { FileArchive, X } from "lucide-react";
import type { PermissionNotice } from "../platform/android/generationState";
import TaskFeedback from "./TaskFeedback";

type Props = {
  permissionNotice: PermissionNotice;
  permissionNoticeDismissed: boolean;
  error: string;
  busy: boolean;
  label: string;
  progressCurrent?: number;
  progressTotal?: number;
  toast: string;
  desktopDropActive: boolean;
  gestureHint: { id: number; text: string } | null;
  onOpenNotificationSettings: () => void;
  onDismissPermissionNotice: () => void;
  onDismissError: () => void;
};

export default function AppFeedbackLayer(props: Props) {
  return (
    <>
      {props.permissionNotice && !props.permissionNoticeDismissed ? (
        <div className="permission-notice-banner">
          <span>{props.permissionNotice.message}</span>
          <div className="permission-notice-actions">
            {props.permissionNotice.showSettingsAction ? (
              <button className="secondary-button" onClick={props.onOpenNotificationSettings}>
                前往通知设置
              </button>
            ) : null}
            <button className="icon-button" onClick={props.onDismissPermissionNotice} title="关闭">
              <X size={14} />
            </button>
          </div>
        </div>
      ) : null}
      <TaskFeedback
        error={props.error}
        busy={props.busy}
        label={props.label}
        progressCurrent={props.progressCurrent}
        progressTotal={props.progressTotal}
        toast={props.toast}
        onDismissError={props.onDismissError}
      />
      {props.desktopDropActive ? (
        <div className="desktop-import-drop" role="status" aria-live="polite">
          <div>
            <FileArchive size={28} />
            <strong>松开以导入项目</strong>
            <span>支持本地文件夹或 ZIP 压缩包</span>
          </div>
        </div>
      ) : null}
      {props.gestureHint ? (
        <div key={props.gestureHint.id} className="gesture-hint" role="status" aria-live="polite">
          {props.gestureHint.text}
        </div>
      ) : null}
    </>
  );
}
