// Visual audit against the real renderer and an isolated backend profile.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { _electron } = require('../experiments/direction-c/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build', `ui-audit-${process.argv[2] || 'review'}`);
fs.mkdirSync(output, { recursive: true });

(async () => {
  const env = { ...process.env, CODECOURSE_DIRECTION_DATA: path.join(output, 'profile'), CODECOURSE_FRONTEND_URL: 'http://127.0.0.1:5173' };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.CODECOURSE_AUDIT_APP;
  if (packaged) delete env.CODECOURSE_FRONTEND_URL;
  const executablePath = packaged || process.env.CODECOURSE_AUDIT_ELECTRON || path.resolve(root, '../github-project-learner/node_modules/.ignored_electron/dist/electron.exe');
  const app = await _electron.launch({ executablePath, args: packaged ? [] : [root], cwd: root, env });
  const errors = [], surfaces = [];
  try {
    let page;
    for (let i = 0; i < 120; i++) {
      page = app.windows().find(p => p.url().includes(':5173') || p.url().includes('index.html'));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(page, 'main window opened');
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.direction-nav').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => /:5173|index\.html/.test(w.webContents.getURL())).setContentSize(1440, 900));
    const capture = async (name, selector = '.direction-app', target = page) => {
      await target.locator(selector).waitFor();
      await target.evaluate(() => document.fonts.ready);
      await target.screenshot({ path: path.join(output, `${name}.png`) });
      const details = await target.locator(selector).evaluate(el => {
        const css = getComputedStyle(el), box = el.getBoundingClientRect();
        return { className: el.className, background: css.backgroundColor, radius: css.borderRadius, box: { x: box.x, y: box.y, width: box.width, height: box.height }, rounded: [...el.querySelectorAll('*')].filter(e => e.getClientRects().length && parseFloat(getComputedStyle(e).borderRadius) >= 6).map(e => e.className).filter(x => typeof x === 'string').slice(0, 60) };
      });
      surfaces.push({ name, ...details });
      console.log(name);
    };
    const scene = async label => { await page.locator('.direction-nav button').filter({ hasText: label }).click(); await page.waitForFunction(label => document.querySelector('.direction-nav button[aria-current=page]')?.textContent.includes(label) && !document.querySelector('.direction-app[data-moving]'), label); };
    if (process.argv.includes('--details')) {
      assert(!packaged, 'detailed fixtures run in the development-only audit entry');
      await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route => route.abort());
      await page.route('**/api/projects/1/knowledge/graph', route => route.fulfill({ json: {
        nodes: ['请求与响应', '身份验证', '路由与中间件', '数据库访问', '错误处理'].map((title, i) => ({ id: i + 1, project_id: 1, node_type: i === 0 ? 'course' : 'term', title, summary: '把请求的数据流与具体实现连接起来。', x: (i % 3) * 220, y: Math.floor(i / 3) * 180, created_at: '', updated_at: '' })),
        edges: [2,3,4,5].map(id => ({ id, project_id: 1, source_node_id: 1, target_node_id: id, relation_type: 'parent_of', created_at: '', updated_at: '' })),
      } }));
      const cases = ['markdown', 'workspace-menu', 'files', 'questionnaire', 'questionnaire-error', 'term-action', 'term-feedback', 'selection', 'import', 'call-guide', 'call-guide-stale', 'graph', 'code'];
      for (const which of cases) {
        await page.goto(`http://127.0.0.1:5173/audit/index.html?case=${which}`);
        await page.locator(`[data-audit="${which}"]`).waitFor();
        if (which === 'questionnaire') await page.getByRole('button', { name: /理解一次请求/ }).click();
        if (which === 'graph') await page.locator('.knowledge-node-label').first().waitFor();
        if (which === 'code') {
          await page.locator('.monaco-editor').waitFor({ timeout: 45000 });
          await page.waitForFunction(() => document.querySelector('.monaco-editor')?.getBoundingClientRect().height > 300);
          await page.waitForFunction(() => getComputedStyle(document.querySelector('.monaco-editor .view-lines')).position === 'absolute');
        }
        await capture(which);
        if (which.startsWith('term-')) {
          for (const size of [[1100,720],[1440,900]]) {
            await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(w => /:5173/.test(w.webContents.getURL())).setContentSize(...size), size);
            await page.waitForFunction(() => {
              const box = document.querySelector('.term-action-popover,.term-feedback-popover').getBoundingClientRect();
              return box.left >= 11 && box.top >= 43 && box.right <= innerWidth - 11 && box.bottom <= innerHeight - 11;
            });
            await capture(`${which}-${size.join('x')}`);
          }
        }
        if (which === 'files') {
          await page.getByRole('textbox', { name: '搜索文件' }).fill('auth.ts');
          assert.equal(await page.locator('.context-file-picker-item').count(), 1);
          await page.getByRole('checkbox', { name: 'src/auth.ts', exact: true }).check();
          await page.locator('.context-file-picker-actions button').last().click();
          assert((await page.locator('[data-audit-result]').textContent()).includes('src/auth.ts'));
        }
        if (which === 'call-guide') {
          await page.locator('.call-guide-node').filter({ hasText: 'authenticate' }).click();
          await capture('call-guide-selected');
        }
        if (which === 'code') { await page.locator('.monaco-editor').click(); await page.keyboard.press('Control+f'); await capture('code-search'); }
      }
      fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ errors, surfaces }, null, 2));
      assert.deepEqual(errors, []);
      return;
    }
    await capture('project');
    await page.getByRole('button', { name: '新建学习计划', exact: true }).click();
    await capture('create-plan', '.app-dialog');
    await page.locator('.app-dialog input:not([type=checkbox])').fill('界面巡检学习计划');
    await page.locator('.app-dialog button[type=submit]').click();
    await page.locator('.app-dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('.direction-app')?.getAttribute('data-scene') === 'reader');
    await scene('PROJECT');
    await page.locator('.direction-project-row.selected').waitFor();
    if (process.argv.includes('--generation')) {
      await scene('GENERATE');
      await page.locator('.direction-generation-modes button').first().click();
      const textarea = page.locator('.direction-generation-instructions textarea');
      await textarea.fill('从零理解 React，重点讲解组件、状态与数据流。');
      await page.locator('.generation-heading h2').click();
      for (const size of [[1440,900],[1280,720],[1100,720],[1920,1080]]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(w => /:5173|index\.html/.test(w.webContents.getURL())).setContentSize(...size), size);
        await capture(`generation-${size.join('x')}`, '.direction-generation-panel');
        const layout = await page.evaluate(() => {
          const panel = document.querySelector('.direction-generation-panel').getBoundingClientRect();
          const button = document.querySelector('.generation-submit').getBoundingClientRect();
          const nav = document.querySelector('.direction-nav').getBoundingClientRect();
          const body = document.querySelector('.generation-form-body');
          const modes = document.querySelector('.direction-generation-modes');
          return { horizontalOverflow: document.querySelector('.direction-generation-panel').scrollWidth > panel.width + 1, bodyOverflow: body.scrollHeight - body.clientHeight, modesOverflow: modes.scrollHeight - modes.clientHeight, bottom: button.bottom, navTop: nav.top, panelLeft: panel.left };
        });
        assert(!layout.horizontalOverflow, 'generation panel has no horizontal overflow');
        assert(layout.bottom < layout.navTop, 'generate action stays above navigation');
        assert(layout.bodyOverflow <= 1, `idle generation form fits without scrolling: ${JSON.stringify(layout)}`);
        assert(layout.modesOverflow <= 1, 'all four generation modes fit without scrolling');
      }
      await page.getByRole('button', { name: '编辑生成提示词' }).click();
      await page.locator('.prompt-editor-modal').waitFor();
      await page.locator('.prompt-editor-modal').getByRole('button', { name: '关闭', exact: true }).click();
      assert.equal(await textarea.inputValue(), '从零理解 React，重点讲解组件、状态与数据流。');
      await scene('READ');
      await scene('GENERATE');
      assert.equal(await textarea.inputValue(), '从零理解 React，重点讲解组件、状态与数据流。');
      fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ errors, surfaces }, null, 2));
      assert.deepEqual(errors, []);
      return;
    }
    for (const label of ['READ', 'GENERATE', 'ASK', 'SYSTEM']) { await scene(label); await capture(label.toLowerCase()); }
    for (const [label, selector, name] of [
      ['模型与应用设置', '.settings-modal', 'settings'],
      ['提示词工作室', '.prompt-editor-modal', 'prompts'],
      ['学习档案', '.learner-profile-sheet', 'profile'],
      ['鼠标手势', '.gesture-guide-card', 'gestures'],
    ]) {
      await page.locator('.direction-system button').filter({ hasText: label }).click();
      if (name === 'settings') await page.locator('.settings-modal').getByLabel('Base URL', { exact: true }).waitFor();
      if (name === 'prompts') await page.locator('.prompt-editor-textarea').waitFor();
      if (name === 'profile') await page.locator('.learner-profile-loading').waitFor({ state: 'hidden' });
      await capture(name, selector);
      if (name === 'profile') {
        for (const tab of await page.locator('.learner-profile-tabs button').all()) { await tab.click(); await capture(`profile-${await tab.textContent()}`, selector); }
      }
      await page.locator(selector).getByRole('button', { name: /^关闭/ }).click();
    }
    await page.keyboard.press('Control+k');
    await capture('commands', '.command-palette');
    await page.keyboard.press('Escape');
    await scene('PROJECT');
    await scene('GENERATE');
    await capture('generation-form', '.generation-sheet');
    await scene('ASK');
    await capture('assistant-with-project');
    const detachedPromise = app.waitForEvent('window');
    await page.evaluate(() => window.codecourseDesktop.detachTab({ type: 'course', title: '学习文档 · 窗口检查', path: 'course/overview.md', content: '# 阅读工作区\n\n统一的文档窗口，保留舒适的阅读排版。\n\n## 学习目标\n\n- 阅读项目结构\n- 理解数据流\n\n```typescript\nconst course = { title: "CodeCourse" };\n```' }));
    const detached = await detachedPromise;
    await capture('detached', '.detached-document-shell', detached);
    await detached.close();
    const codeWindowPromise = app.waitForEvent('window');
    await page.context().route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route => route.abort());
    await page.evaluate(() => window.codecourseDesktop.detachTab({ type: 'file', title: '源码窗口检查', path: 'src/example.ts', language: 'typescript', content: 'export function greet(name: string) {\n  return `Hello ${name}`;\n}\n'.repeat(20) }));
    const codeWindow = await codeWindowPromise;
    await codeWindow.waitForFunction(() => {
      const editor = document.querySelector('.monaco-editor');
      const lines = editor?.querySelector('.view-lines');
      return editor?.getBoundingClientRect().height > 250 && lines && getComputedStyle(lines).position === 'absolute';
    });
    await codeWindow.locator('.monaco-editor').click();
    await codeWindow.keyboard.press('Control+f');
    await capture('detached-code-offline', '.detached-document-shell', codeWindow);
    await codeWindow.close();
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ errors, surfaces }, null, 2));
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
