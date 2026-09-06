import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const course = '# 从请求到响应\n\n阅读代码时，先沿着输入、处理、输出这条路径理解职责。\n\n' + Array.from({ length: 24 }, (_, i) => `## ${i + 1}. 理解处理流程\n\n课件与源码可以放在不同工作区对照阅读。每个工作区有自己的标签，切换目录不会替换其他区域的内容。\n\n\x60\x60\x60typescript\nconst result = await handleRequest(input);\n\x60\x60\x60\n`).join('\n');
const file = Array.from({ length: 90 }, (_, i) => `export const step${i + 1} = (input: string) => input.trim();`).join('\n');
const project = { id: 901, name: '阅读工作区审查', url: 'https://example.invalid/reader', local_path: '/fixture', status: 'ready', project_type: 'repository', course_files: ['outline.md', 'notes.md'] };
const courses = [{ filename: 'outline.md', title: '从请求到响应', group: '课程', is_outline: true }, { filename: 'notes.md', title: '阅读笔记', group: '课程' }];
const record = { id: 1, project_id: 901, source_type: 'file', source_path: 'src/request.ts', selected_text: 'input.trim()', question: '输入是如何处理的？', answer_md: '# 输入处理\n\n先去除两侧空白，再交给后续处理函数。', output_path: 'qa/answer.md', display_title: '输入处理', model: 'fixture', favorite: false, created_at: '2026-09-06T00:00:00Z' };

async function prepare(page: Page, split = true) {
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api/, '');
    let value: unknown = [];
    if (p === '/projects') value = [project];
    else if (p === '/projects/901') value = project;
    else if (p.endsWith('/tree')) value = { name: 'reader', path: '', type: 'directory', is_key_file: false, children: [{ name: 'src', path: 'src', type: 'directory', is_key_file: false, children: [{ name: 'request.ts', path: 'src/request.ts', type: 'file', children: [], is_key_file: true }] }] };
    else if (p.endsWith('/course')) value = courses;
    else if (p.includes('/course/')) value = { filename: p.split('/course/')[1], content: p.includes('/qa/') ? record.answer_md : course };
    else if (p.endsWith('/file')) value = { path: url.searchParams.get('path'), content: file, language: 'typescript' };
    else if (p === '/settings/llm') value = { enabled: true, has_api_key: true, provider: 'openai', base_url: 'https://example.invalid', model: 'fixture', temperature: .7 };
    else if (p === '/settings/personalization') value = { supported: false };
    else if (p.endsWith('/index/status')) value = { status: 'missing', file_count: 0, chunk_count: 0 };
    else if (p.endsWith('/qa/continuity')) value = null;
    else if (p.endsWith('/qa/1')) value = record;
    else if (p.endsWith('/qa')) value = [record];
    else if (p.endsWith('/qa/stream')) {
      await route.fulfill({ contentType: 'text/event-stream', body: `event: stage\ndata: {"stage":"generating","label":"正在回答"}\n\nevent: delta\ndata: {"text":"先处理输入。"}\n\nevent: completed\ndata: ${JSON.stringify(record)}\n\n` }); return;
    } else if (p.endsWith('/personalization/preferences')) value = { terminologyDensity: 0, answerDepth: .5, codeRatio: .5 };
    else if (p.endsWith('/personalization/resolve')) value = { terms: [] };
    else if (p.endsWith('/terms/status')) value = { status: 'completed', count: 0 };
    else if (p.endsWith('/learning-state') && route.request().method() !== 'GET') value = { ...route.request().postDataJSON(), project_id: 901 };
    else if (p.includes('/knowledge') && !p.endsWith('/links')) value = { nodes: [], edges: [] };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
  });
  await page.addInitScript(({ split }) => {
    if (sessionStorage.getItem('reader-fixture')) return;
    sessionStorage.setItem('reader-fixture', '1');
    const a = { type: 'group', group: { id: 'group-1', activeItemId: 'course:outline.md', items: [{ id: 'course:outline.md', type: 'course', path: 'outline.md', title: '从请求到响应', content: '' }] } };
    const b = { type: 'group', group: { id: 'group-2', activeItemId: 'file:src/request.ts', items: [{ id: 'file:src/request.ts', type: 'file', path: 'src/request.ts', title: 'request.ts', content: '' }] } };
    localStorage.setItem('codecourse-last-project', '901');
    localStorage.setItem('codecourse.workbench.v1.901', JSON.stringify({ version: 1, layout: split ? { type: 'split', id: 'split-1', direction: 'row', ratio: .55, first: a, second: b } : a, activeGroupId: 'group-1', navigationView: 'courses', navigationOpen: true, sidebarWidth: 264 }));
  }, { split });
  await page.goto('/');
  await expect(page.locator('.direction-app')).toHaveAttribute('data-scene', 'reader');
  await expect(page.locator('.direction-input-lock')).toHaveCount(0);
  await expect(page.locator('.reader-pane')).toHaveCount(split ? 2 : 1);
  await expect(page.locator('.reader-pane .markdown-body').first()).toContainText('从请求到响应');
  return errors;
}

for (const [width, height] of [[1280,720],[1440,900],[1920,1080]]) {
  test(`original mixed reader + game surfaces ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = await prepare(page);
    await expect(page.getByRole('tab', { name: /request.ts/ })).toBeVisible();
    // Original two-way directory tabs only change the directory, never the stage.
    await page.locator('.navigation-segmented').getByRole('button', { name: '源码' }).click();
    await expect(page.locator('.direction-app')).toHaveAttribute('data-scene', 'reader');
    await expect(page.locator('.reader-pane')).toHaveCount(2);
    await page.locator('.navigation-segmented').getByRole('button', { name: '课程' }).click();
    const rect = await page.locator('.direction-workspace').boundingBox();
    expect(rect!.height).toBeGreaterThan(height * .58);
    await expect(page.locator('.direction-reader-toolbar')).toHaveCount(0);
    await expect(page.locator('.direction-nav b')).toHaveText(['01', '02', '03', '04', '05']);
    expect(await page.locator('.reader-pane .markdown-body').first().evaluate(el => getComputedStyle(el).fontFamily)).not.toContain('Barlow');
    await mkdir('artifacts/reader', { recursive: true });
    await page.screenshot({ path: `artifacts/reader/reading-${width}x${height}.png` });
    await page.getByRole('button', { name: '打开 AI 助手', exact: true }).click();
    await expect(page.locator('.direction-ask-stage')).toBeVisible();
    await page.getByRole('textbox', { name: '输入问题' }).fill('请结合当前选区解释输入处理。');
    await page.locator('.selection-card summary').click();
    await page.getByRole('button', { name: '选择参考文件' }).click();
    await expect(page.getByRole('dialog', { name: '选择参考文件' })).toBeVisible();
    await page.getByRole('checkbox', { name: 'src/request.ts', exact: true }).check();
    await page.screenshot({ path: `artifacts/reader/picker-${width}x${height}.png` });
    await page.keyboard.press('Escape');
    await expect(page.locator('.context-file-picker-dialog')).toHaveCount(0);
    await expect(page.locator('.direction-ask-stage')).toBeVisible();
    await expect(page.getByRole('textbox', { name: '输入问题' })).toHaveValue('请结合当前选区解释输入处理。');
    await expect(page.getByRole('button', { name: '选择参考文件' })).toBeFocused();
    await page.screenshot({ path: `artifacts/reader/ask-${width}x${height}.png` });
    await page.locator('.qa-panel-tabs').getByRole('button', { name: '关闭 AI 助手' }).click();
    await page.locator('.direction-nav').getByRole('button', { name: /PROJECT/ }).click();
    await expect(page.locator('.direction-app')).toHaveAttribute('data-scene', 'project');
    await expect(page.locator('.direction-input-lock')).toHaveCount(0);
    await page.screenshot({ path: `artifacts/reader/project-${width}x${height}.png` });
    await page.getByRole('button', { name: '继续学习' }).click();
    await expect(page.locator('.direction-app')).toHaveAttribute('data-scene', 'reader');
    await expect(page.locator('.reader-pane')).toHaveCount(2);
    await page.locator('.direction-nav').getByRole('button', { name: /SYSTEM/ }).click();
    await expect(page.locator('.direction-app')).toHaveAttribute('data-scene', 'system');
    await page.getByRole('button', { name: /模型与应用设置/ }).click();
    await expect(page.locator('.settings-modal')).toBeVisible();
    await page.screenshot({ path: `artifacts/reader/settings-${width}x${height}.png` });
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-modal')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('original drag split, resize, history answer and reload persist in one reader', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await prepare(page, false);
  await page.locator('.navigation-segmented').getByRole('button', { name: '源码' }).click();
  const target = page.locator('.reader-pane').first();
  const box = await target.boundingBox();
  const data = await page.evaluateHandle(() => { const d = new DataTransfer(); d.setData('application/codecourse-item', JSON.stringify({ kind: 'file', path: 'src/request.ts' })); return d; });
  await target.dispatchEvent('dragover', { dataTransfer: data, clientX: box!.x + box!.width - 12, clientY: box!.y + box!.height / 2 });
  await target.dispatchEvent('drop', { dataTransfer: data, clientX: box!.x + box!.width - 12, clientY: box!.y + box!.height / 2 });
  await expect(page.locator('.reader-pane')).toHaveCount(2);
  const divider = page.locator('.split-resizer').first();
  const drag = await divider.boundingBox();
  await page.mouse.move(drag!.x + 2, drag!.y + 150); await page.mouse.down();
  await page.mouse.move(drag!.x + 85, drag!.y + 150, { steps: 12 }); await page.mouse.up();
  const resized = await divider.boundingBox();
  expect(resized!.x).toBeGreaterThan(drag!.x + 40);
  await page.getByRole('button', { name: '打开 AI 助手', exact: true }).click();
  await page.locator('.qa-history-row').first().dblclick();
  await expect(page.getByRole('tab', { name: /输入处理/ })).toBeVisible();
  await expect(page.locator('.reader-pane')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('codecourse.workbench.v1.901'))).toContain('qa/answer.md');
  await page.reload();
  await expect(page.locator('.reader-pane')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: /输入处理/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('reduced motion and rapid scene requests never strand an input cover', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await prepare(page);
  for (let i = 0; i < 3; i++) {
    await page.locator('.direction-nav').getByRole('button', { name: /PROJECT/ }).click();
    await page.getByRole('button', { name: '继续学习' }).click();
  }
  await expect(page.locator('.direction-input-lock')).toHaveCount(0);
  await expect(page.locator('.reader-pane')).toHaveCount(2);
  expect(errors).toEqual([]);
});
