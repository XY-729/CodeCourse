import { ArrowRight, BookOpen, CheckCircle2, CircleHelp, ExternalLink } from "lucide-react";
import type { QARecord, QAThreadSummary, TeachingHandoff, TeachingNextAction } from "../api/client";

export type VisibleQAThreadGroup = {
  summary: QAThreadSummary;
  records: QARecord[];
};

export function compactTopicLabel(topic: string, records: QARecord[] = []): string {
  const raw = topic.replace(/\s+/g, " ").trim();
  const rules: Array<[RegExp, string]> = [
    [/shared[_\s-]*ptr|unique[_\s-]*ptr|weak[_\s-]*ptr|智能指针|constexpr|consteval|constinit|override|lambda|结构化绑定|concepts?\b|ranges?\b/, "C++ 新特性"],
    [/std::atomic|\batomic\b|memory[_\s-]*order|内存序|内存模型|并发|线程同步|volatile/, "并发与内存模型"],
    [/\bcgroup|namespace|seccomp|sandbox|容器隔离|linux\s*沙箱/, "Linux 沙箱"],
    [/\bclone\b|\bfork\b|子进程|进程栈|进程管理|kchildstacksize/, "进程与执行"],
    [/react|use(state|effect|memo|callback)/, "React 状态管理"],
  ];
  const classify = (value: string) => rules.find(([pattern]) => pattern.test(value.toLowerCase()))?.[1];
  const directCategory = classify(raw);
  if (directCategory) return directCategory;
  if (!raw) return "未分类";
  const evidence = [raw, ...records.flatMap((record) => [record.display_title || "", record.question])].join(" ");
  const matchesRecordTitle = records.some((record) => {
    const question = record.question.replace(/\s+/g, " ").trim();
    const title = record.display_title?.replace(/\s+/g, " ").trim();
    return raw === question || raw === title;
  });
  if (!matchesRecordTitle && raw.length <= 20 && !/[？?]$/.test(raw)) return raw;
  const inferredCategory = classify(evidence);
  if (inferredCategory) return inferredCategory;
  const simplified = raw
    .replace(/^(请问|请解释|解释一下|介绍一下|如何理解|为什么|什么是)\s*/i, "")
    .replace(/[？?。！!]+$/g, "")
    .split(/[，,；;：:。]/, 1)[0]
    .trim();
  return (simplified || raw).slice(0, 20);
}

export function groupQARecordsByThreads(threads: QAThreadSummary[] = [], records: QARecord[] = []): VisibleQAThreadGroup[] {
  const recordById = new Map(records.map((record) => [record.id, record]));
  const groupedIds = new Set<number>();
  const groups: VisibleQAThreadGroup[] = [];
  for (const summary of [...threads].sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
    return right.updatedAt.localeCompare(left.updatedAt);
  })) {
    const visibleRecords = summary.records.map((id) => recordById.get(id)).filter((record): record is QARecord => Boolean(record));
    if (!visibleRecords.length) continue;
    visibleRecords.forEach((record) => groupedIds.add(record.id));
    groups.push({ summary, records: visibleRecords });
  }
  const legacyBySession = new Map<number, QARecord[]>();
  for (const record of records) {
    if (groupedIds.has(record.id)) continue;
    const sessionId = record.session_id || record.id;
    legacyBySession.set(sessionId, [...(legacyBySession.get(sessionId) || []), record]);
  }
  for (const [sessionId, legacyRecords] of legacyBySession) {
    const ordered = [...legacyRecords].sort((left, right) => left.created_at.localeCompare(right.created_at));
    const latest = [...legacyRecords].sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
    groups.push({
      summary: {
        sessionId,
        topic: ordered[0].display_title?.trim() || ordered[0].question,
        progressSummary: "",
        unresolvedPoints: [],
        turnCount: legacyRecords.length,
        latestQaRecordId: latest.id,
        sourceType: latest.source_type,
        sourcePath: latest.source_path,
        isCurrent: false,
        updatedAt: latest.updated_at,
        records: ordered.map((record) => record.id),
      },
      records: ordered,
    });
  }
  const merged = new Map<string, VisibleQAThreadGroup>();
  for (const group of groups) {
    const topic = compactTopicLabel(group.summary.topic, group.records);
    const existing = merged.get(topic);
    if (!existing) {
      merged.set(topic, { summary: { ...group.summary, topic }, records: [...group.records] });
      continue;
    }
    const records = [...existing.records, ...group.records]
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
    const representative = existing.summary.isCurrent && !group.summary.isCurrent
      ? existing
      : group.summary.isCurrent && !existing.summary.isCurrent
        ? group
        : group.summary.updatedAt > existing.summary.updatedAt ? group : existing;
    existing.records = records;
    existing.summary = {
      ...representative.summary,
      topic,
      isCurrent: existing.summary.isCurrent || group.summary.isCurrent,
      turnCount: records.length,
      updatedAt: group.summary.updatedAt > existing.summary.updatedAt ? group.summary.updatedAt : existing.summary.updatedAt,
      records: records.map((record) => record.id),
    };
  }
  return [...merged.values()].sort((left, right) => {
    if (left.summary.isCurrent !== right.summary.isCurrent) return left.summary.isCurrent ? -1 : 1;
    return right.summary.updatedAt.localeCompare(left.summary.updatedAt);
  });
}

type ResumeCardProps = {
  handoff: TeachingHandoff;
  disabled?: boolean;
  onResume: (handoff: TeachingHandoff) => void;
  onOpenSource: (handoff: TeachingHandoff) => void;
  onDismiss: (handoff: TeachingHandoff) => void;
};

type ClosureCardProps = {
  handoff: TeachingHandoff;
  disabled?: boolean;
  onAction: (action: TeachingNextAction, handoff: TeachingHandoff) => void;
};

function canOpenSource(handoff: TeachingHandoff) {
  return Boolean(
    handoff.sourceAvailable
      && handoff.sourcePath
      && ["course", "file", "qa"].includes(handoff.sourceType || ""),
  );
}

export function TeachingResumeCard({ handoff, disabled = false, onResume, onOpenSource, onDismiss }: ResumeCardProps) {
  return (
    <section className="teaching-continuity-card teaching-resume-card" aria-label="继续上次学习">
      <header>
        <span className="teaching-card-icon"><BookOpen size={17} aria-hidden="true" /></span>
        <div><small>继续上次学习</small><strong>{handoff.topic}</strong></div>
      </header>
      <p>{handoff.progressSummary}</p>
      {handoff.unresolvedPoints[0] ? (
        <div className="teaching-card-unresolved"><CircleHelp size={15} aria-hidden="true" /><span>{handoff.unresolvedPoints[0]}</span></div>
      ) : null}
      <footer>
        <button type="button" className="teaching-card-primary" onClick={() => onResume(handoff)} disabled={disabled}>
          继续学习<ArrowRight size={15} aria-hidden="true" />
        </button>
        {canOpenSource(handoff) ? (
          <button type="button" onClick={() => onOpenSource(handoff)} disabled={disabled}>
            <ExternalLink size={14} aria-hidden="true" />打开关联内容
          </button>
        ) : null}
        <button type="button" onClick={() => onDismiss(handoff)} disabled={disabled}>结束本主题</button>
      </footer>
    </section>
  );
}

export function TeachingClosureCard({ handoff, disabled = false, onAction }: ClosureCardProps) {
  return (
    <section className="teaching-continuity-card teaching-closure-card" aria-label="本轮学习小结">
      <header>
        <span className="teaching-card-icon"><CheckCircle2 size={17} aria-hidden="true" /></span>
        <div><small>本轮学习小结</small><strong>{handoff.topic}</strong></div>
      </header>
      <div className="teaching-card-section">
        <strong>这轮解决了什么</strong>
        <p>{handoff.progressSummary}</p>
        {handoff.establishedPoints.length ? (
          <ul>{handoff.establishedPoints.map((point) => <li key={point}>{point}</li>)}</ul>
        ) : null}
      </div>
      {handoff.unresolvedPoints.length ? (
        <div className="teaching-card-section unresolved">
          <strong>还需要弄清什么</strong>
          <ul>{handoff.unresolvedPoints.map((point) => <li key={point}>{point}</li>)}</ul>
        </div>
      ) : null}
      {handoff.nextActions.length ? (
        <footer>
          {handoff.nextActions.map((action, index) => (
            <button
              type="button"
              key={`${action.kind}:${action.label}:${index}`}
              className={index === 0 ? "teaching-card-primary" : undefined}
              onClick={() => onAction(action, handoff)}
              disabled={disabled}
            >
              {action.label}<ArrowRight size={14} aria-hidden="true" />
            </button>
          ))}
        </footer>
      ) : null}
    </section>
  );
}
