import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Check, Loader2, X } from "lucide-react";
import ProgressiveMarkdown from "./ProgressiveMarkdown";
import AsyncActionButton from "./AsyncActionButton";
import { getGenerationPreview, type GenerationPreview, type GenerationTask } from "../api/client";
import { isGenerationTaskRunning } from "./generationTaskModel";
import "../styles/desktop-generation.css";

export type FileGenerationStatus = {
  projectId: number; filename: string; startedAt: string; finishedAt?: string;
  status: "running" | "completed" | "failed"; label: string; characters: number;
};

export function desktopTaskProgress(task: GenerationTask): number | null {
  if (task.status === "completed") return 100;
  if (task.progress_total <= 0 || task.status === "queued" || ["preparing", "planning"].includes(task.progress_phase ?? "")) return null;
  return Math.max(0, Math.min(99, Math.floor(task.progress_current / task.progress_total * 100)));
}

// 预览快照是按整章落地的（后端章节并行生成，没有字符级数据可推），所以"流畅打
// 字"只能在前端做：把已就绪的 markdown 按固定速度揭示出来。速度是纯观感选择，
// 不改变任何生成或轮询时机。
const PREVIEW_SPEEDS = [
  { key: "slow", label: "慢", charsPerSecond: 45 },
  { key: "normal", label: "标准", charsPerSecond: 110 },
  { key: "fast", label: "快", charsPerSecond: 260 },
] as const;
type PreviewSpeed = (typeof PREVIEW_SPEEDS)[number]["key"];

const PREVIEW_SPEED_STORAGE_KEY = "codecourse.desktop.previewSpeed";
const REVEAL_TICK_MS = 80;

function readPreviewSpeed(): PreviewSpeed {
  try {
    const stored = window.localStorage.getItem(PREVIEW_SPEED_STORAGE_KEY);
    const match = PREVIEW_SPEEDS.find((speed) => speed.key === stored);
    if (match) return match.key;
  } catch { /* 存储不可用时用默认速度 */ }
  return "normal";
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useTypedMarkdown(
  markdown: string,
  charsPerSecond: number,
  instant: boolean,
  revealed: number,
  setRevealed: Dispatch<SetStateAction<number>>,
): string {
  // 揭示进度由父组件持有：关闭面板时只有面板卸载，进度不会跟着丢。
  // 依赖里不能带 revealed——那会让计时器每个 tick 重建，累积步长被清零。
  useEffect(() => {
    if (instant || !markdown) return;
    const perTick = charsPerSecond * (REVEAL_TICK_MS / 1000);
    let carry = 0;
    const timer = setInterval(() => {
      carry += perTick;
      const step = Math.floor(carry);
      if (step <= 0) return;
      carry -= step;
      setRevealed(current => {
        const next = Math.min(markdown.length, current + step);
        if (next === markdown.length) clearInterval(timer);
        return next;
      });
    }, REVEAL_TICK_MS);
    return () => clearInterval(timer);
  }, [markdown, charsPerSecond, instant, setRevealed]);
  // 重试会清空快照，此时记录的字符数可能超过新内容，先收回边界。
  // 空 markdown 不参与：面板刚打开、快照还没到时它是空的，夹一次就会把进度清零。
  useEffect(() => {
    if (!markdown) return;
    setRevealed(current => (current > markdown.length ? markdown.length : current));
  }, [markdown, setRevealed]);
  // 生成结束（或用户减少动效）时直接给全文：此时已经无需再等，逐字揭示只会拖慢阅读。
  return instant ? markdown : markdown.slice(0, Math.min(revealed, markdown.length));
}

function LessonPreview({ task, revealed, setRevealed, onClose, onOpen, onRetry }: {
  task: GenerationTask; revealed: number; setRevealed: Dispatch<SetStateAction<number>>;
  onClose: () => void; onOpen: () => unknown | Promise<unknown>; onRetry: () => void;
}) {
  const [preview, setPreview] = useState<GenerationPreview | null>(null);
  const [error, setError] = useState("");
  const [speed, setSpeed] = useState<PreviewSpeed>(readPreviewSpeed);
  const [showAll, setShowAll] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);  useEffect(() => {
    const previousFocus = document.activeElement;
    closeRef.current?.focus();
    return () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, []);
  // Task polling owns status. This separate, serial loop exists only while reading a preview.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await getGenerationPreview(task.project_id, task.id);
        if (cancelled) return;
        setPreview(previous => previous?.version === next.version ? previous : next);
        setError("");
        if (["completed", "failed", "cancelled"].includes(next.status)) return;
      } catch {
        if (cancelled) return;
        setError("暂时无法同步预读，正在重连；已显示内容仍可阅读。");
      }
      if (!cancelled) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [task.project_id, task.id, task.status]);

  const running = isGenerationTaskRunning(task);
  const charsPerSecond = PREVIEW_SPEEDS.find((option) => option.key === speed)?.charsPerSecond ?? 110;
  const visibleMarkdown = useTypedMarkdown(
    preview?.markdown ?? "",
    charsPerSecond,
    showAll || !running || prefersReducedMotion(),
    revealed,
    setRevealed,
  );

  return <aside className="lesson-preview" aria-label="课件预读" onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  }}>
    <header>
      <strong>{task.status === "completed" ? "预读 · 完整版已就绪" : task.status === "failed" ? "预读 · 生成失败" : "预读 · 生成中"}</strong>
      {running && <div className="lesson-preview-speeds" role="group" aria-label="预读打字速度">
        {PREVIEW_SPEEDS.map((option) => <button key={option.key} type="button"
          aria-pressed={option.key === speed}
          onClick={() => {
            setSpeed(option.key);
            try { window.localStorage.setItem(PREVIEW_SPEED_STORAGE_KEY, option.key); } catch { /* 存储不可用时只影响本次 */ }
          }}>{option.label}</button>)}
      </div>}
      {running && !showAll && <button onClick={() => setShowAll(true)}>立即显示</button>}
      {task.status === "completed" && <AsyncActionButton action={onOpen} pendingLabel="打开中…">查看完整版</AsyncActionButton>}
      {task.status === "failed" && task.retry_available && <button onClick={onRetry}>重试</button>}
      <button ref={closeRef} onClick={onClose} aria-label="关闭课件预读">关闭</button>
    </header>
    {error && <p role="status">{error}</p>}
    {task.status === "failed" && <p role="status">{task.error_message || "生成失败"}。已完成内容保留供预读。</p>}
    <div className="lesson-preview-content">
      {preview?.markdown ? <ProgressiveMarkdown markdown={preview.markdown} visibleLength={visibleMarkdown.length} /> : <p>{task.status === "completed" ? "请打开课件阅读完整内容。" : "正在准备第一章…"}</p>}
    </div>
  </aside>;
}

export default function DesktopGenerationStatus({ task, stream, starting, message, onOpenTask, onOpenStream, onRetry }: {
  task: GenerationTask | null; stream: FileGenerationStatus | null; starting: boolean; message: string;
  onOpenTask: (task: GenerationTask) => unknown | Promise<unknown>; onOpenStream: (filename: string) => unknown | Promise<unknown>; onRetry: (task: GenerationTask) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dismissedKey, setDismissedKey] = useState("");
  // 揭示进度放在这里而不是预读面板里：关闭面板只卸载面板，进度得以保留，
  // 重新打开时只打这次新增的内容；换任务/换生成目标时归零。
  const [revealedCharacters, setRevealedCharacters] = useState(0);
  const [now, setNow] = useState(Date.now());
  const running = stream ? stream.status === "running" : task ? isGenerationTaskRunning(task) : starting;
  const completed = stream ? stream.status === "completed" : task?.status === "completed";
  const resultKey = stream ? `${stream.filename}:${stream.startedAt}` : `task:${task?.id}`;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => { setPreviewOpen(false); setRevealedCharacters(0); }, [task?.id, stream?.filename]);
  if (!task && !stream && !starting) return null;
  if (completed && !starting && dismissedKey === resultKey) return null;
  const start = Date.parse(stream?.startedAt ?? task?.started_at ?? task?.created_at ?? "");
  const finish = Date.parse(stream?.finishedAt ?? task?.finished_at ?? task?.updated_at ?? "");
  const seconds = Math.max(0, Math.floor(((running ? now : finish) - start) / 1000));
  const progress = stream ? stream.status === "completed" ? 100 : null : task ? desktopTaskProgress(task) : null;
  const preparing = starting && !stream && (!task || !isGenerationTaskRunning(task));
  const label = preparing ? message : stream?.label ?? task?.stage_label ?? message;
  return <>
    <section className="desktop-generation-status" aria-label="课程生成进度">
      <div className="desktop-generation-description">
        {completed && !starting ? <Check size={15} aria-hidden="true" /> : running ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null}
        <span role="status">{completed && !starting ? "内容已生成" : label || "正在准备生成"}</span>
        {running && task && !stream && (task.total_sections ?? 0) > 0 && <span>已完成 {task.completed_sections}/{task.total_sections} 章</span>}
        {running && Number.isFinite(seconds) && <span>{seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`}</span>}
      </div>
      {running && <progress aria-label="任务进度（非剩余时间）" max={100} value={preparing ? undefined : progress ?? undefined} />}
      {running && !preparing && progress !== null && <span>{progress}%</span>}
      {completed && !starting ? <AsyncActionButton pendingLabel="打开中…" action={async () => {
        const opened = stream ? await onOpenStream(stream.filename) : task ? await onOpenTask(task) : false;
        if (opened !== false) { setPreviewOpen(false); setDismissedKey(resultKey); }
        return opened;
      }}>打开课件</AsyncActionButton> : stream ? <button onClick={() => void onOpenStream(stream.filename)}>查看生成内容</button>
        : task?.task_type === "outline_lesson" ? <button onClick={() => setPreviewOpen(true)}>查看生成内容</button> : null}
      {completed && !starting && <button aria-label="收起生成提示" title="收起" onClick={() => { setPreviewOpen(false); setDismissedKey(resultKey); }}><X size={14} /></button>}
      {!stream && task?.status === "failed" && task.retry_available && <button disabled={starting} onClick={() => onRetry(task)}>重试</button>}
    </section>
    {previewOpen && task && !stream && <LessonPreview key={`${task.project_id}:${task.id}`} task={task}
      revealed={revealedCharacters} setRevealed={setRevealedCharacters}
      onClose={() => setPreviewOpen(false)} onOpen={async () => {
        const opened = await onOpenTask(task);
        if (opened !== false) { setPreviewOpen(false); setDismissedKey(resultKey); }
        return opened;
      }}
      onRetry={() => { setPreviewOpen(false); onRetry(task); }} />}
  </>;
}
