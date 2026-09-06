import { lazy, Suspense } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { QARecord } from '../api/client';
const MarkdownViewer = lazy(() => import('../components/MarkdownViewer'));

export default function DirectionAnswerView({ record, loading, partial, onOpenRecord }: { record: QARecord | null; loading: boolean; partial?: string; onOpenRecord: (record: QARecord) => void }) {
  if (!record && !loading) return <div className="direction-ask-invitation"><span>A QUESTION OPENS A WORLD.</span><h2>越过表面。<br/><em>问到深处。</em></h2></div>;
  return <section className="direction-answer-view" aria-label="回答阅读区">
    <header><span>{loading ? '正在整理思路' : '回答'}</span>{record && !loading && <button onClick={() => onOpenRecord(record)}>在工作区阅读<ArrowUpRight size={14}/></button>}</header>
    {record && <h2>{record.question}</h2>}
    <Suspense fallback={<div className="empty small">正在打开回答…</div>}><MarkdownViewer embedded title={null} sourceType="qa" sourcePath={record?.output_path} content={loading ? partial || '正在生成回答…' : record?.answer_md || ''}/></Suspense>
  </section>;
}
