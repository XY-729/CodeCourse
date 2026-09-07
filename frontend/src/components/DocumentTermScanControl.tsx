import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import type { TermScanStatus } from "../api/client";

type Props = {
  status?: TermScanStatus | null;
  onRescan?: () => Promise<void>;
  compact?: boolean;
  showDescription?: boolean;
};

export function termScanDescription(status: TermScanStatus): string {
  if (status.scan_status === "queued") return "正在等待术语标注";
  if (status.scan_status === "running") return "正在结合当前学情标注术语";
  if (status.scan_status === "failed") return "标注未完成，可以重试";
  if (status.scan_status === "missing_source") return "原文暂时无法读取";
  if (status.scan_status === "idle" || status.scan_status === "local_only") {
    return "这篇内容还没有按学情标注，可点击补充";
  }
  return status.candidate_count > 0
    ? "已结合学情选择术语；认识的词会自动收起"
    : "标注已完成，当前内容无需额外术语提示";
}

export default function DocumentTermScanControl({ status, onRescan, compact = false, showDescription = false }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingRef = useRef(false);
  useEffect(() => setError(""), [status?.source_path, status?.content_hash]);
  if (!status || !onRescan) return null;
  const busy = pending || ["queued", "running"].includes(status.scan_status);
  const unavailable = status.scan_status === "missing_source" || !status.model_scan_authorized;
  const description = termScanDescription(status);
  const actionLabel = busy ? "正在标注术语" : "按当前学情标注术语";

  async function rescan() {
    if (pendingRef.current || busy || unavailable) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      await onRescan?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "术语标注失败，请重试");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <span className="document-term-scan-control">
      {showDescription ? <p role="status">{description}</p> : null}
      <button
        type="button"
        className={compact ? "mobile-reader-action-button" : "secondary-button compact"}
        disabled={busy || unavailable}
        aria-label={actionLabel}
        title={unavailable ? "请先在设置中启用并配置模型，才能标注术语" : `${description}。${actionLabel}（调用一次模型）`}
        onClick={(event) => { event.stopPropagation(); void rescan(); }}
      >
        {busy ? <LoaderCircle size={compact ? 17 : 14} aria-hidden="true" /> : <Sparkles size={compact ? 17 : 14} aria-hidden="true" />}
        {!compact ? busy ? "标注中…" : status.scan_status === "failed" ? "重试术语标注" : "标注术语" : null}
      </button>
      {showDescription ? <p>点击后会调用一次模型，结合当前学情更新这篇内容的术语提示。</p> : null}
      {error || (showDescription && status.scan_status === "failed" && status.error_message)
        ? <span className="error-text" role="alert">{error || status.error_message}</span>
        : null}
    </span>
  );
}
