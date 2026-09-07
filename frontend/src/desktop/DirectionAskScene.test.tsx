import { useState, type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QARecord } from '../api/client';
import DirectionAskScene from './DirectionAskScene';

vi.mock('framer-motion', () => ({ useReducedMotion: () => true }));

const records: QARecord[] = [1, 2, 3, 4].map(id => ({
  id, project_id: 1, session_id: id, parent_qa_id: null, relation_type: 'follow_up',
  source_type: 'file', source_path: `src/example-${id}.ts`, selected_text: '',
  question: `问题 ${id}`, answer_md: `回答 ${id}`, provider: 'test', model: 'test', favorite: false,
  created_at: '2026-09-07T00:00:00Z', updated_at: '2026-09-07T00:00:00Z',
}));

function props(): ComponentProps<typeof DirectionAskScene> {
  return {
    selection: null, contextSummary: null, contextFiles: [], question: '', loading: false,
    history: records, historyQuery: '', favoriteOnly: false, selectedRecord: records[0],
    followUpRecord: null, settings: null, panelError: '', upperTab: 'history',
    onOpenFilePicker: vi.fn(), onRemoveContextFile: vi.fn(), onUpperTabChange: vi.fn(),
    onQuestionChange: vi.fn(), onSelectionTextChange: vi.fn(), onClearSelection: vi.fn(),
    onAsk: vi.fn(), onNewConversation: vi.fn(), onHistoryQueryChange: vi.fn(),
    onFavoriteOnlyChange: vi.fn(), onSelectRecord: vi.fn(), onFollowUp: vi.fn(),
    onOpenRecord: vi.fn(), onRenameRecord: vi.fn(), onToggleFavorite: vi.fn(), onOpenSettings: vi.fn(),
  };
}

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
afterAll(() => {
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

describe('DirectionAskScene history wheel', () => {
  it('selects one visible record per touchpad gesture without native scrolling or opening collapsed threads', () => {
    const p = props();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    function Harness() {
      const [selectedRecord, setSelectedRecord] = useState(records[0]);
      return <DirectionAskScene {...p} selectedRecord={selectedRecord} onSelectRecord={record => {
        p.onSelectRecord(record);
        setSelectedRecord(record);
      }} />;
    }
    const { container, unmount } = render(<Harness />);
    const rail = container.querySelector<HTMLDivElement>('.game-history-track')!;
    const railScroll = vi.fn();
    Object.defineProperty(rail, 'scrollTo', { configurable: true, value: railScroll });
    const hiddenThread = screen.getByRole('button', { name: '查看回答 问题 2' }).closest('details')!;
    hiddenThread.removeAttribute('open');
    const wheel = (deltaY: number, extra: WheelEventInit = {}) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, ...extra });
      fireEvent(rail, event);
      return event;
    };

    expect(wheel(45).defaultPrevented).toBe(true);
    expect(screen.getByRole('button', { name: '查看回答 问题 3' }).getAttribute('aria-pressed')).toBe('true');
    expect(p.onSelectRecord).toHaveBeenCalledWith(records[2]);
    for (const delta of [38, 31, 24, 18, 13, 8, 4, 1]) {
      now += 20;
      expect(wheel(delta).defaultPrevented).toBe(true);
    }
    expect(p.onSelectRecord).toHaveBeenCalledTimes(1);
    expect(hiddenThread.open).toBe(false);
    expect(railScroll).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));

    expect(wheel(40, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel(20, { deltaX: 80 }).defaultPrevented).toBe(false);
    expect(wheel(40, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(p.onSelectRecord).toHaveBeenCalledTimes(1);

    now += 500;
    wheel(45);
    expect(screen.getByRole('button', { name: '查看回答 问题 4' }).getAttribute('aria-pressed')).toBe('true');
    now += 20;
    wheel(-45);
    expect(screen.getByRole('button', { name: '查看回答 问题 3' }).getAttribute('aria-pressed')).toBe('true');
    expect(p.onSelectRecord).toHaveBeenCalledTimes(3);

    unmount();
    now += 500;
    expect(wheel(-45).defaultPrevented).toBe(false);
    expect(p.onSelectRecord).toHaveBeenCalledTimes(3);
  });
});
