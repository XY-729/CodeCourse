import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import GenerationSheet from './GenerationSheet';

afterEach(cleanup);
const defaults = (): ComponentProps<typeof GenerationSheet> => ({
  open: true, intent: 'outline', scope: 'full_project', selectedFileCount: 0,
  project: { id: 1, name: 'Demo', url: '', local_path: '', status: 'ready', project_type: 'repository', course_files: [] },
  instructions: '', running: false, activeTask: null, taskMessage: '待生成',
  onClose: vi.fn(), onScopeChange: vi.fn(), onInstructionsChange: vi.fn(), onOpenPrompts: vi.fn(), onGenerate: vi.fn(),
});

describe('Generation scene', () => {
  it('submits the latest draft immediately, before the debounced parent update', () => {
    const props = defaults();
    render(<GenerationSheet {...props} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '先解释请求如何流经后端' } });
    fireEvent.click(screen.getByRole('button', { name: /生成总纲/ }));
    expect(props.onGenerate).toHaveBeenCalledWith('先解释请求如何流经后端');
    expect(props.onInstructionsChange).not.toHaveBeenCalled();
  });

  it('uses externally restored instructions after switching project or reopening', () => {
    const props = defaults();
    const { rerender } = render(<GenerationSheet {...props} />);
    rerender(<GenerationSheet {...props} instructions="新的学习目标" />);
    fireEvent.click(screen.getByRole('button', { name: /生成总纲/ }));
    expect(props.onGenerate).toHaveBeenCalledWith('新的学习目标');
  });

  it('keeps file selection connected to the existing navigation callback', () => {
    const props = defaults();
    render(<GenerationSheet {...props} />);
    fireEvent.click(screen.getByRole('radio', { name: /指定文件/ }));
    expect(props.onScopeChange).toHaveBeenCalledWith('files');
  });

  it('locks repository scopes for a learning plan and explains the input', () => {
    const props = defaults();
    render(<GenerationSheet {...props} project={{ ...props.project!, project_type: 'learning_plan' }} />);
    expect((screen.getByRole('radio', { name: /学习计划/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: /全项目/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('textbox', { name: /描述学习目标/ })).toBeTruthy();
  });

  it('shows the selected document for other generation modes and blocks repeated generation', () => {
    const props = defaults();
    render(<GenerationSheet {...props} intent="detailed" activeTitle="src/server.ts" running />);
    expect(screen.getByText('src/server.ts')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /生成中/ }));
    expect(props.onGenerate).not.toHaveBeenCalled();
  });

  it('keeps a clear disabled state when there is no project', () => {
    const props = defaults();
    render(<GenerationSheet {...props} project={null} />);
    expect(screen.getByText('先到「项目」选择或创建一个项目')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /生成总纲/ }));
    expect(props.onGenerate).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
