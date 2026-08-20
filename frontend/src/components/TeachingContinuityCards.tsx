import { ArrowRight, BookOpen, CheckCircle2, CircleHelp, ExternalLink } from "lucide-react";
import type { QARecord, QAThreadSummary, TeachingHandoff, TeachingNextAction } from "../api/client";

export type VisibleQAThreadGroup = {
  summary: QAThreadSummary;
  records: QARecord[];
};

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
  return groups;
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
