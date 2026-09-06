import { test, expect, type Page } from '@playwright/test';

async function ready(page: Page, scene = 'source', preview = true, sidebar = true) {
  await page.goto(`/?scene=${scene}${preview ? '&preview=reading' : ''}${sidebar ? '&sidebar=open' : ''}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.game-root')).toHaveAttribute('data-phase', 'idle');
  await page.locator('.scene-background').evaluate(async el => {
    const img = new Image(); img.src = getComputedStyle(el).backgroundImage.slice(5, -2); await img.decode();
  });
}

for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]]) {
  test(`merged workspace visual review ${width}x${height}`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height });
    await ready(page, 'source', false);
    const old = (await page.locator('.source-workspace').boundingBox())!;
    await ready(page);
    const workspace = (await page.getByLabel('合并阅读工作区', { exact: true }).boundingBox())!;
    expect(workspace.width).toBeGreaterThan(old.width * 1.1);
    expect(workspace.height).toBeGreaterThan(old.height * 1.06);
    const panes = page.locator('.reading-group');
    await expect(panes).toHaveCount(2);
    for (const pane of await panes.all()) expect((await pane.boundingBox())!.width).toBeGreaterThan(440);
    await expect(page.getByRole('heading', { name: '从入口理解应用' })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: 'App.tsx' })).toBeVisible();
    const readingBottom = (await page.getByRole('button', { name: '向 AI 提问' }).boundingBox())!;
    const footer = (await page.locator('.game-footer').boundingBox())!;
    expect(workspace.y + workspace.height + 10).toBeLessThan(readingBottom.y);
    expect(readingBottom.y + readingBottom.height).toBeLessThanOrEqual(footer.y);
    const title = (await page.locator('.title-reading').boundingBox())!;
    expect(title.x + title.width).toBeLessThan(workspace.x);
    const overflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.reading-workspace,.reading-directory,.reading-bottom,.scene-menu,button')].flatMap(el => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') return [];
      return r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 ? [el.className] : [];
    }));
    expect(overflow).toEqual([]);
    await page.mouse.move(width - 10, height - 130);
    await page.screenshot({ path: `artifacts/reading-preview/sidebar-open-${width}x${height}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: '源码', exact: true }).click();
    await expect(page.getByRole('heading', { name: '从入口理解应用' })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: 'App.tsx' })).toBeVisible();
    await page.screenshot({ path: `artifacts/reading-preview/source-directory-${width}x${height}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: '收起文档侧栏' }).click();
    await expect(page.getByLabel('文档目录', { exact: true })).toHaveCount(0);
    const expandedWorkspace = (await page.getByLabel('合并阅读工作区', { exact: true }).boundingBox())!;
    expect(expandedWorkspace.width).toBeGreaterThan(width * .9);
    await page.mouse.move(width - 10, height - 130);
    await page.screenshot({ path: `artifacts/reading-preview/read-${width}x${height}.png`, animations: 'disabled' });
    expect(errors).toEqual([]);
  });
}

test('directory types open in the active group, mixed tabs retain independent content', async ({ page }) => {
  await ready(page);
  const left = page.locator('[data-group="reading-left"]');
  const right = page.locator('[data-group="reading-right"]');
  await left.getByLabel('从入口理解应用 正文', { exact: true }).click();
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await page.locator('.reading-directory').getByRole('button', { name: '02 SceneTransition.tsx' }).click();
  await expect(left.getByRole('tab')).toHaveCount(2);
  await expect(left.getByRole('tabpanel', { name: 'SceneTransition.tsx' })).toBeVisible();
  await expect(right.getByRole('tabpanel', { name: 'App.tsx' })).toBeVisible();
  await left.getByRole('tab', { name: '从入口理解应用' }).click();
  await expect(left.getByRole('heading', { name: '从入口理解应用' })).toBeVisible();
  await page.getByRole('button', { name: '课程', exact: true }).click();
  await page.locator('.reading-directory').getByRole('button', { name: '02 场景切换与状态' }).click();
  await expect(left.getByRole('tab')).toHaveCount(3);
  await left.getByRole('tab', { name: '场景切换与状态' }).press('Home');
  await expect(left.getByRole('tab', { name: '从入口理解应用' })).toBeFocused();
  await left.getByRole('button', { name: '关闭 SceneTransition.tsx' }).click();
  await expect(left.getByRole('tab')).toHaveCount(2);
  await expect(right.getByRole('tabpanel', { name: 'App.tsx' })).toBeVisible();
});

test('resizing, ASK transition and return preserve tabs, scroll and split ratio', async ({ page }) => {
  await ready(page);
  const scroll = page.getByLabel('从入口理解应用 正文', { exact: true });
  await scroll.evaluate(el => { el.scrollTop = 286; });
  const separator = page.getByRole('separator');
  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200); await page.mouse.down();
  await page.mouse.move(box.x + 55, box.y + 200, { steps: 10 }); await page.mouse.up();
  const ratio = await separator.getAttribute('aria-valuenow');
  expect(Number(ratio)).toBeGreaterThan(53);
  await page.getByRole('button', { name: '向 AI 提问' }).click();
  await expect(page.locator('.application-plane')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('.game-root')).toHaveAttribute('data-scene', 'ask');
  await expect(page.locator('.game-root')).toHaveAttribute('data-phase', 'idle');
  await expect(page.locator('#scene-heading')).toHaveCount(1);
  await expect(page.locator('#scene-heading')).toBeFocused();
  await expect(page.locator('.reading-preview-host')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.game-root')).toHaveAttribute('data-phase', 'idle');
  await expect(page.locator('.game-root')).toHaveAttribute('data-scene', 'source');
  await expect(separator).toHaveAttribute('aria-valuenow', ratio!);
  expect(await scroll.evaluate(el => el.scrollTop)).toBe(286);
  await expect(page.getByRole('tabpanel', { name: 'App.tsx' })).toBeVisible();
  await separator.focus(); await page.keyboard.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', `${Number(ratio) - 2}`);
});

test('dragging a tab between groups preserves mixed documents and close/split work', async ({ page }) => {
  await ready(page);
  const right = page.locator('[data-group="reading-right"]');
  const left = page.locator('[data-group="reading-left"]');
  const tab = right.getByRole('tab', { name: 'useScene.ts' });
  const target = left.locator('.reading-documents');
  const box = (await target.boundingBox())!;
  await tab.dragTo(target, { targetPosition: { x: box.width / 2, y: box.height / 2 } });
  await expect(left.getByRole('tab')).toHaveCount(2);
  await expect(left.getByRole('tabpanel', { name: 'useScene.ts' })).toBeVisible();
  await expect(right.getByRole('tab')).toHaveCount(1);
  await right.getByRole('button', { name: '关闭 App.tsx' }).click();
  await expect(page.locator('.reading-group')).toHaveCount(1);
  await left.getByRole('button', { name: '向右分栏' }).click();
  await expect(page.locator('.reading-group')).toHaveCount(2);
  await expect(page.getByRole('tabpanel', { name: 'useScene.ts' })).toHaveCount(2);
});

test('single READ entry and command palette support reduced-motion transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page, 'project');
  await expect(page.getByRole('navigation').getByRole('button')).toHaveCount(5);
  await expect(page.getByRole('navigation').getByRole('button', { name: /READ/ })).toHaveCount(1);
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: '搜索场景' }).fill('课程');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.locator('.game-root')).toHaveAttribute('data-scene', 'source');
  await expect(page.locator('.transition-cover')).toBeHidden();
  await expect(page.locator('#scene-heading')).toBeFocused();
  expect(await page.locator('.scene-background').evaluate(el => getComputedStyle(el).transform)).toBe('none');
  await page.getByRole('button', { name: '向 AI 提问' }).click();
  await expect(page.locator('#scene-heading')).toHaveText('ASK.');
  await expect(page.locator('#scene-heading')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#scene-heading')).toHaveText('READ.');
});

test('PROJECT and ASK keep the original composition', async ({ page }) => {
  for (const scene of ['project', 'ask']) {
    const selectors = scene === 'project' ? ['.project-scene .scene-title', '.project-track', '.project-progress', '.project-actions'] : ['.ask-scene .scene-title', '.ask-main', '.ask-history', '.ask-composer'];
    await ready(page, scene, false);
    const original = await Promise.all(selectors.map(s => page.locator(s).boundingBox()));
    await ready(page, scene);
    const preview = await Promise.all(selectors.map(s => page.locator(s).boundingBox()));
    expect(preview).toEqual(original);
    await expect(page.locator('#scene-heading')).toHaveCount(1);
    await expect(page.locator('.reading-preview-host')).toBeHidden();
    await page.screenshot({ path: `artifacts/reading-preview/${scene}-unchanged.png`, animations: 'disabled' });
  }
});

test('sidebar reveal pushes the workspace and closes accessibly without losing reading state', async ({ page }) => {
  await ready(page, 'source', true, false);
  const sidebar = page.getByRole('button', { name: '展开文档侧栏' });
  await expect(sidebar).toHaveAttribute('aria-expanded', 'false');
  const scroll = page.getByLabel('从入口理解应用 正文', { exact: true });
  await scroll.evaluate(el => { el.scrollTop = 248; });
  const width = (await page.locator('.reading-workspace').boundingBox())!.width;
  await sidebar.click();
  await expect(page.locator('.reading-directory')).toBeVisible();
  await expect(page.getByRole('button', { name: '收起文档侧栏' })).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await page.locator('.reading-workspace').boundingBox())!.width).toBeLessThan(width - 100);
  await expect.poll(async () => (await page.locator('.reading-workspace').boundingBox())!.x - ((await page.locator('.reading-directory').boundingBox())!.x + (await page.locator('.reading-directory').boundingBox())!.width)).toBeGreaterThan(12);
  await page.getByRole('button', { name: '源码', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.reading-directory')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '展开文档侧栏' })).toBeFocused();
  expect(await scroll.evaluate(el => el.scrollTop)).toBe(248);
  await expect(page.locator('.game-root')).toHaveAttribute('data-scene', 'source');
  await page.getByRole('button', { name: '展开文档侧栏' }).click();
  await page.getByRole('button', { name: '收起文档侧栏' }).click();
  await page.getByRole('button', { name: '展开文档侧栏' }).click();
  await expect(page.locator('.reading-directory')).toHaveCount(1);
  await expect(page.getByRole('tabpanel', { name: 'App.tsx' })).toBeVisible();
});

test('merged scene numbering agrees across navigation, title, commands and transition', async ({ page }) => {
  await ready(page);
  await expect(page.locator('.scene-menu .nav-number')).toHaveText(['01', '02', '03', '04', '05']);
  await expect(page.locator('.scene-menu .nav-label')).toHaveText(['PROJECT项目', 'READ阅读', 'GENERATE生成', 'ASK提问', 'SYSTEM设置']);
  await expect(page.locator('.title-reading .title-eyebrow > span')).toHaveText('02');
  await page.getByRole('button', { name: '向 AI 提问' }).click();
  await expect(page.locator('.transition-cover > span')).toHaveText('04');
  await expect(page.locator('.game-root')).toHaveAttribute('data-phase', 'idle');
  await expect(page.locator('.title-ask .title-eyebrow > span')).toHaveText('04');
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: '搜索场景' }).fill('课程');
  await expect(page.locator('.command-list button > span')).toHaveText('02');
  await expect(page.locator('.command-list button > strong')).toHaveText('READ');
  await page.keyboard.press('Enter');
  await expect(page.locator('.transition-cover > span')).toHaveText('02');
  await expect(page.locator('.game-root')).toHaveAttribute('data-phase', 'idle');
  await ready(page, 'source', false);
  await expect(page.locator('.scene-menu .nav-number')).toHaveText(['01', '02', '03', '04', '05', '06']);
});

test('selection ASK uses the original transition and keeps the workspace', async ({ page }) => {
  await ready(page, 'source', true, false);
  await page.locator('.lesson-lead').evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await page.getByLabel('从入口理解应用 正文', { exact: true }).dispatchEvent('mouseup');
  await page.getByRole('button', { name: '选区提问', exact: true }).click();
  await expect(page.locator('.application-plane')).toHaveAttribute('inert', '');
  await expect(page.locator('.game-root')).toHaveAttribute('data-scene', 'ask');
  await expect(page.locator('.game-root')).toHaveAttribute('data-phase', 'idle');
  await expect(page.locator('#scene-heading')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.game-root')).toHaveAttribute('data-scene', 'source');
  await expect(page.locator('.game-root')).toHaveAttribute('data-phase', 'idle');
  await expect(page.getByRole('button', { name: '展开文档侧栏' })).toBeVisible();
  await expect(page.locator('.reading-group')).toHaveCount(2);
});
