import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeachingIndexControl from './TeachingIndexControl';
import { getCourseUnderstanding } from '../../personalization/teachingApi';
import { listBackfills, prepareBackfill, applyBackfill, undoKnowledgeChange } from '../../personalization/knowledgeMaintenance';
vi.mock('../../personalization/teachingApi',()=>({getCourseUnderstanding:vi.fn(),TEACHING_CHANGED:'teaching-change'}));
vi.mock('../../personalization/knowledgeMaintenance',()=>({listBackfills:vi.fn(),prepareBackfill:vi.fn(),applyBackfill:vi.fn(),undoKnowledgeChange:vi.fn()}));
const preview = { id:'preview',sourceType:'course' as const,sourcePath:'old.md',contentHash:'hash',status:'preview' as const,createdAt:'2026-10-23',concepts:[{ref:'v',existing_id:null,name:'vector',parent_ref:null}],coverage:[{concept_ref:'v',aspect:'扩容机制',dimension:'conceptual',kind:'explained',quote:'vector 在扩容时会分配新的连续内存空间。'}],termCount:1 };
afterEach(cleanup);
beforeEach(()=>{
  vi.clearAllMocks(); vi.mocked(getCourseUnderstanding).mockResolvedValue([{sourceType:'course',sourcePath:'old.md',indexStatus:'complete',schemaVersion:1}] as never);
  vi.mocked(listBackfills).mockResolvedValue([]); vi.mocked(prepareBackfill).mockResolvedValue(preview);
  vi.mocked(applyBackfill).mockResolvedValue({...preview,status:'applied',changeId:'change'}); vi.mocked(undoKnowledgeChange).mockResolvedValue({});
});
describe('historical teaching backfill controls',()=>{
  it('checks legacy complete indexes, previews without applying, and applies only on confirmation',async()=>{
    render(<TeachingIndexControl projectId={1}/>);
    fireEvent.click(screen.getByRole('button',{name:'检查历史知识关联'}));
    await screen.findByRole('button',{name:'生成所选文档的清单预览'});
    expect(prepareBackfill).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'生成所选文档的清单预览'}));
    await screen.findByText(/已生成 1 份清单预览/);
    expect(applyBackfill).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'确认应用预览清单'}));
    await screen.findByText(/已应用 1 份补录/);
    expect(applyBackfill).toHaveBeenCalledWith(1,'preview');
    fireEvent.click(screen.getByRole('button',{name:'撤销这次补录'}));
    await screen.findByText(/已撤销本次补录/);
    expect(undoKnowledgeChange).toHaveBeenCalledWith(1,'change');
  });
  it('does not display an old project scan after switching projects',async()=>{
    let resolve!: (value: typeof preview) => void;
    vi.mocked(prepareBackfill).mockReturnValue(new Promise(r=>{resolve=r;}));
    const rendered=render(<TeachingIndexControl projectId={1}/>);
    fireEvent.click(screen.getByRole('button',{name:'检查历史知识关联'}));
    fireEvent.click(await screen.findByRole('button',{name:'生成所选文档的清单预览'}));
    await waitFor(()=>expect(prepareBackfill).toHaveBeenCalled());
    rendered.rerender(<TeachingIndexControl projectId={2}/>);
    resolve(preview);
    await waitFor(()=>expect(screen.queryByText(/待确认/)).toBeNull());
    expect((screen.getByRole('button',{name:'检查历史知识关联'}) as HTMLButtonElement).disabled).toBe(false);
  });
});
