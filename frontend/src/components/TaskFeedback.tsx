import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";

type Props = {
  error?: string;
  busy?: boolean;
  label?: string;
  progressCurrent?: number;
  progressTotal?: number;
  toast?: string;
  onDismissError?: () => void;
};

export default function TaskFeedback({ error, busy, label, progressCurrent = 0, progressTotal = 0, toast, onDismissError }: Props) {
  return (
    <div className="apple-feedback-stack" aria-live="polite">
      {error ? (
        <div className="apple-feedback error" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
          {onDismissError ? <button onClick={onDismissError} title="关闭"><X size={14} /></button> : null}
        </div>
      ) : null}
      {busy ? (
        <div className="apple-feedback busy">
          <Loader2 size={15} className="spin" />
          <span>{label || "正在处理"}</span>
          {progressTotal > 0 ? (
            <><div className="apple-feedback-progress"><i style={{ width: `${Math.min(100, Math.max(0, (progressCurrent / progressTotal) * 100))}%` }} /></div><small>{progressCurrent}/{progressTotal}</small></>
          ) : null}
        </div>
      ) : null}
      {toast ? <div className="apple-feedback success"><CheckCircle2 size={15} /><span>{toast}</span></div> : null}
    </div>
  );
}
