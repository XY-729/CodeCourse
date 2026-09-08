// Exercise the packaged Electron renderer and bundled backend, with isolated data.
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { _electron } = require("../experiments/direction-c/node_modules/playwright");

async function run() {
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "build", `desktop-smoke-${Date.now()}`);
  const profile = path.join(output, "profile");
  fs.mkdirSync(profile, { recursive: true });
  const env = { ...process.env, CODECOURSE_DIRECTION_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CODECOURSE_FRONTEND_URL;
  delete env.CODECOURSE_PYTHON;
  const executablePath = process.argv[2] || path.join(root, "dist-desktop/win-unpacked/CodeCourse Direction C.exe");
  console.log(JSON.stringify({ executablePath, output }));
  const errors = [];
  const app = await _electron.launch({ executablePath, env, timeout: 30000, cwd: path.dirname(executablePath) });
  try {
    const deadline = Date.now() + 30000;
    let page;
    while (Date.now() < deadline) {
      page = app.windows().find((p) => p.url().includes("index.html"));
      if (page) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert(page, "packaged main window did not open");
    page.on("pageerror", (e) => errors.push(e.message));
    await page.locator(".direction-shell").waitFor({ state: "visible", timeout: 15000 });
    await page.locator(".direction-nav button").last().waitFor({ state: "visible" });
    assert.equal(await page.locator(".direction-nav button").count(), 5);
    assert(page.url().startsWith("file:"), "renderer must use packaged files, not dev server");
    const apiBase = await page.evaluate(() => window.codecourseDesktop.apiBase);
    assert.match(apiBase, /^http:\/\/127\.0\.0\.1:\d+\/api$/);
    assert.equal((await fetch(`${apiBase}/health`)).status, 200);
    const info = await app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged,
      version: app.getVersion(),
      dataPath: app.getPath("userData"),
      windows: BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), url: w.webContents.getURL() })),
    }));
    assert.equal(info.dataPath, profile);
    for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]]) {
      await app.evaluate(({ BrowserWindow }, size) => {
        const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("index.html"));
        w.setContentSize(size[0], size[1]);
      }, [width, height]);
      await page.screenshot({ path: path.join(output, `project-${width}x${height}.png`) });
    }
    for (const label of ["READ", "GENERATE", "ASK", "SYSTEM", "PROJECT"]) {
      await page.locator(".direction-nav button").filter({ hasText: label }).click();
      await page.waitForFunction(() => !document.querySelector(".direction-app[data-moving]"));
      await page.screenshot({ path: path.join(output, `${label.toLowerCase()}.png`) });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator(".direction-nav button").filter({ hasText: "ASK" }).click();
    await page.locator('.direction-app[data-scene="ask"]').waitFor({ state: "visible" });
    assert.equal(await page.locator(".direction-app[data-moving]").count(), 0);
    assert.deepEqual(errors, []);
    const result = { status: "passed", output, apiBase, ...info, errors };
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
