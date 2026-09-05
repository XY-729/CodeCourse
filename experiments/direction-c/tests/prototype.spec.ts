import { test, expect, type Page } from '@playwright/test';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

async function ready(page: Page, scene = 'project') {
  await page.goto(`/?scene=${scene}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.game-root')).toHaveAttribute('data-phase', 'idle');
  await page.locator('.scene-background').evaluate(async el => {
    const image = new Image();
    image.src = getComputedStyle(el).backgroundImage.slice(5, -2);
    await image.decode();
  });
}

async function bounds(page: Page) {
  return page.evaluate(() => {
    const offenders: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button,textarea,.source-workspace,.ask-composer,.scene-menu')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.x < -1 || r.y < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) offenders.push(`${el.className}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.right)},${Math.round(r.bottom)}`);
    }
    return offenders;
  });
}

for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]]) {
  test(`visual surfaces and no coverage at ${width}x${height}`, async ({ page }) => {
    const errors: string[] = [];
    const externalRequests: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5197/')) externalRequests.push(request.url()); });
    await page.setViewportSize({ width, height });
    for (const scene of ['project', 'source', 'ask']) {
      await ready(page, scene);
      await page.mouse.move(width - 10, height - 130);
      await page.waitForTimeout(350);
      expect(await bounds(page)).toEqual([]);
      expect(await page.locator('.scene-content').count()).toBe(1);
      if (scene === 'ask') {
        const input = await page.locator('.ask-composer').boundingBox();
        const footer = await page.locator('.game-footer').boundingBox();
        expect(input!.y + input!.height).toBeLessThanOrEqual(footer!.y + 1);
        const answer = await page.locator('.answer-stage').boundingBox();
        expect(answer!.height).toBeGreaterThan(120);
        await expect(page.getByRole('button', { name: '发送问题' })).toBeDisabled();
      }
      await page.screenshot({ path: `artifacts/${scene}-${width}x${height}.png` });
    }
    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
}

test('scene changes lock duplicate input and preserve source state', async ({ page }) => {
  await ready(page, 'source');
  await page.getByRole('tab', { name: 'useScene.ts' }).click();
  await page.getByRole('button', { name: '打开分栏演示' }).click();
  await page.getByRole('button', { name: '向 AI 提问' }).click();
  await expect(page.locator('.application-plane')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('.game-root')).toHaveAttribute('data-scene', 'ask');
  await expect(page.locator('.game-root')).toHaveAttribute('data-phase', 'idle');
  await expect(page.locator('#scene-heading')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.game-root')).toHaveAttribute('data-scene', 'source');
  await expect(page.locator('.game-root')).toHaveAttribute('data-phase', 'idle');
  await expect(page.getByRole('tab', { name: 'useScene.ts' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: '关闭分栏演示' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.transition-cover')).toBeHidden();
});

test('ASK handles composition, streaming, stop, history, long text and copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page, 'ask');
  await page.getByRole('button', { name: '当前上下文' }).click();
  await expect(page.locator('#context-detail')).toBeVisible();
  const input = page.getByRole('textbox', { name: 'YOUR QUESTION' });
  await input.fill('场景切换如何避免界面重叠？');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229, bubbles: true });
  await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('场景切换如何避免界面重叠？\n');
  await page.getByRole('button', { name: '发送问题' }).click();
  await expect(page.locator('.answer-paragraphs p')).toHaveCount(1);
  await page.getByRole('button', { name: '停止', exact: true }).click();
  const count = await page.locator('.answer-paragraphs p').count();
  await page.waitForTimeout(1150);
  await expect(page.locator('.answer-paragraphs p')).toHaveCount(count);
  await page.getByRole('button', { name: '重新播放', exact: true }).click();
  await expect(page.locator('.answer-paragraphs p')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '复制', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('场景切换由一个明确的状态机控制');
  await expect(page.locator('.history-choice')).toHaveCount(1);
  await page.mouse.move(30, 300);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/ask-answer-1440x900.png' });
  await page.getByRole('button', { name: '新建演示对话' }).click();
  await expect(page.locator('.ask-invitation')).toBeVisible();
  await input.fill('界面'.repeat(1000));
  await input.press('Enter');
  await expect(page.locator('.question-echo h2')).toHaveText('界面'.repeat(1000));
  expect(await bounds(page)).toEqual([]);
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.locator('.history-choice').last().click();
  await expect(page.locator('.question-echo h2')).toHaveText('场景切换如何避免界面重叠？');
});

test('modal owns focus, closes with Escape, HUD does not intercept controls', async ({ page }) => {
  await ready(page);
  const trigger = page.getByRole('button', { name: '查看按钮与反馈样本' });
  await trigger.click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.locator('.application-plane')).toHaveAttribute('inert', '');
  const close = page.getByRole('button', { name: '关闭弹窗' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: '错误演示' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.getByRole('button', { name: '错误演示' }).click();
  await expect(page.locator('.game-toast')).toContainText('操作未完成');
  await page.mouse.move(30, 300);
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/controls-1440x900.png' });
  const primary = page.getByRole('button', { name: '确认动作' });
  await primary.hover();
  await page.waitForTimeout(250);
  await page.locator('.game-modal').screenshot({ path: 'artifacts/button-hover.png' });
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.locator('.game-modal').screenshot({ path: 'artifacts/button-pressed.png' });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator('.application-plane')).not.toHaveAttribute('inert');
});

test('command palette navigation and reduced motion are usable without a sweep', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: '搜索场景' }).fill('ask');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.game-root')).toHaveAttribute('data-scene', 'ask');
  await expect(page.locator('.game-root')).toHaveAttribute('data-phase', 'idle');
  await expect(page.locator('.transition-cover')).toBeHidden();
  const transform = await page.locator('.scene-background').evaluate(el => getComputedStyle(el).transform);
  expect(transform).toBe('none');
  await page.getByRole('button', { name: '查看按钮与反馈样本' }).click();
  await expect(page.locator('.motion-note')).toContainText('系统减少动态效果已启用');
});

test('record reviewable scene and ASK interaction video', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: 'artifacts/recording', size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5197/');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.locator('.project-choice').nth(1).hover();
  await page.waitForTimeout(400);
  await page.locator('.project-choice').nth(1).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '进入项目' }).hover();
  await page.waitForTimeout(450);
  await page.getByRole('button', { name: '进入项目' }).click();
  await expect(page.locator('.game-root')).toHaveAttribute('data-phase', 'idle');
  await page.getByRole('button', { name: '打开分栏演示' }).click();
  await page.waitForTimeout(650);
  await page.getByRole('button', { name: '向 AI 提问' }).click();
  await expect(page.locator('.game-root')).toHaveAttribute('data-phase', 'idle');
  await page.locator('.suggestion').click();
  await page.getByRole('textbox', { name: 'YOUR QUESTION' }).focus();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '发送问题' }).hover();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '发送问题' }).click();
  await expect(page.locator('.answer-paragraphs p')).toHaveCount(3);
  await page.waitForTimeout(1300);
  const video = page.video()!;
  await context.close();
  await mkdir('artifacts', { recursive: true });
  await copyFile(await video.path(), path.resolve('artifacts/direction-c-interaction.webm'));
});
