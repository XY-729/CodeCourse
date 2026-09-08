const fs = require("fs");
const path = require("path");

// Keep a tiny, dependency-free boot trace outside app.getPath().  If Electron
// fails before app.whenReady() (or before the normal diagnostic logger is
// installed), this is the only reliable evidence we get from a packaged EXE.
const EARLY_LOG_PATHS = [
  path.join(process.env.LOCALAPPDATA || process.env.TEMP || process.cwd(), "CodeCourse-Direction-C-startup.log"),
  path.join(process.cwd(), "CodeCourse-Direction-C-startup.log"),
];
function earlyLog(scope, value) {
  const raw = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack || ""}` : String(value ?? "");
  for (const logPath of EARLY_LOG_PATHS) {
    try {
      fs.appendFileSync(logPath, `${new Date().toISOString()} [${scope}] ${raw.slice(0, 12000)}\n`, "utf8");
    } catch {
      // Never let diagnostics interfere with application startup.
    }
  }
}
earlyLog("process:boot", `exec=${process.execPath} cwd=${process.cwd()} argv=${JSON.stringify(process.argv)}`);
process.on("uncaughtException", (error) => earlyLog("process:uncaught-early", error));
process.on("unhandledRejection", (error) => earlyLog("process:rejection-early", error));

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, screen, shell, Tray } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
// Direction C is deliberately isolated from the release channel.  Keep the
// updater dependency out of the main-process boot path; this avoids a native
// updater load failure preventing the window from opening in a portable build.
const autoUpdater = null;

earlyLog("electron:loaded", `version=${process.versions.electron} packaged=${app.isPackaged}`);

app.setName("CodeCourse Direction C");
app.setAppUserModelId("com.codecourse.directionc");
if (process.env.CODECOURSE_DIRECTION_DATA) app.setPath("userData", path.resolve(process.env.CODECOURSE_DIRECTION_DATA));
earlyLog("electron:configured", `userData=${process.env.CODECOURSE_DIRECTION_DATA || "<default>"}`);

let backendProcess = null;
let apiBase = "";
let mainWindow = null;
let splashWindow = null;
let tray = null;
let isQuitting = false;
let windowStateSaveTimer = null;
let manualUpdateCheck = false;
const detachedPayloads = new Map();

const DEFAULT_WINDOW_STATE = {
  width: 1280,
  height: 800,
  isMaximized: false,
};

const hasSingleInstanceLock = app.requestSingleInstanceLock();
earlyLog("electron:single-instance", `acquired=${hasSingleInstanceLock}`);
if (!hasSingleInstanceLock) {
  earlyLog("electron:quit", "single instance lock unavailable");
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
}

function projectRoot() {
  return path.resolve(__dirname, "..");
}

function backendDir() {
  if (!app.isPackaged) return path.join(projectRoot(), "backend");
  const bundled = path.join(process.resourcesPath, "backend");
  if (fs.existsSync(bundled)) return bundled;
  // Fall back to the actual source project root (not inside asar)
  return path.join(projectSourceRoot(), "backend");
}

function packagedBackendExecutable() {
  return path.join(backendDir(), "backend.exe");
}

function codeIntelligenceExecutable() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "code-intelligence", "codebase-memory-mcp.exe")
    : path.join(projectRoot(), "resources", "code-intelligence", "codebase-memory-mcp.exe");
}

function addBundledGitToPath(env) {
  if (!app.isPackaged || process.platform !== "win32") {
    return env;
  }
  const gitRoot = path.join(process.resourcesPath, "git");
  const bundledPaths = [path.join(gitRoot, "cmd"), path.join(gitRoot, "bin")].filter(fs.existsSync);
  if (bundledPaths.length === 0) {
    return env;
  }
  return { ...env, PATH: [...bundledPaths, env.PATH || ""].join(path.delimiter) };
}

function frontendIndex() {
  return path.join(projectRoot(), "frontend", "dist-desktop", "index.html");
}

function appIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(projectRoot(), "resources", "direction-c", "icon.ico");
}

function windowStatePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function diagnosticLogPath() {
  return path.join(app.getPath("userData"), "codecourse.log");
}

function diagnosticLog(scope, value) {
  try {
    const raw = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack || ""}`
      : typeof value === "object" ? JSON.stringify(value) : String(value || "");
    const safe = raw
      .replace(/(api[_ -]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
      .slice(0, 12_000);
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.appendFileSync(diagnosticLogPath(), `${new Date().toISOString()} [${scope}] ${safe}\n`, "utf8");
  } catch {
    // Diagnostics must never interrupt startup or shutdown.
  }
}

process.on("uncaughtException", (error) => {
  earlyLog("main:uncaught", error);
  diagnosticLog("main:uncaught", error);
});
process.on("unhandledRejection", (error) => {
  earlyLog("main:rejection", error);
  diagnosticLog("main:rejection", error);
});

function loadWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(windowStatePath(), "utf8"));
    const width = Math.max(1100, Number(saved.width) || DEFAULT_WINDOW_STATE.width);
    const height = Math.max(720, Number(saved.height) || DEFAULT_WINDOW_STATE.height);
    const candidate = {
      width,
      height,
      x: Number.isFinite(saved.x) ? saved.x : undefined,
      y: Number.isFinite(saved.y) ? saved.y : undefined,
      isMaximized: Boolean(saved.isMaximized),
    };
    if (candidate.x == null || candidate.y == null) return candidate;
    const visible = screen.getAllDisplays().some(({ workArea }) => (
      candidate.x < workArea.x + workArea.width - 80
      && candidate.x + candidate.width > workArea.x + 80
      && candidate.y < workArea.y + workArea.height - 80
      && candidate.y + candidate.height > workArea.y + 80
    ));
    if (!visible) {
      delete candidate.x;
      delete candidate.y;
    }
    return candidate;
  } catch {
    return { ...DEFAULT_WINDOW_STATE };
  }
}

function saveWindowState(window) {
  if (!window || window.isDestroyed()) return;
  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
  const state = { ...bounds, isMaximized: window.isMaximized() };
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(windowStatePath(), JSON.stringify(state, null, 2), "utf8");
}

function scheduleWindowStateSave(window) {
  clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = setTimeout(() => saveWindowState(window), 250);
}

function projectSourceRoot() {
  // Derive the actual source project root from the exe path so we can find
  // backend/.venv even when the app is packaged and __dirname is inside asar.
  // packaged: .../github-project-learner/dist-desktop/win-unpacked/CodeCourse.exe
  // dev:      node .../github-project-learner/electron/dev-runner.cjs
  const exeDir = path.dirname(process.execPath);
  const candidate = path.resolve(exeDir, "..", "..");
  const venv = path.join(candidate, "backend", ".venv", "Scripts", "python.exe");
  if (fs.existsSync(venv)) return candidate;
  return projectRoot();
}

function pythonCandidates() {
  const configured = process.env.CODECOURSE_PYTHON;
  const candidates = [];
  if (configured) candidates.push({ command: configured, prefixArgs: [] });
  // Auto-detect venv Python from the actual project source root
  const venv = path.join(projectSourceRoot(), "backend", ".venv", "Scripts", "python.exe");
  if (fs.existsSync(venv)) candidates.push({ command: venv, prefixArgs: [] });
  if (process.platform === "win32") {
    candidates.push({ command: "py", prefixArgs: ["-3"] });
    candidates.push({ command: "python", prefixArgs: [] });
  } else {
    candidates.push({ command: "python3", prefixArgs: [] });
    candidates.push({ command: "python", prefixArgs: [] });
  }
  return candidates;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function waitForHealth(port, child, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (child.exitCode !== null) {
        reject(new Error("后端进程已退出。请查看应用数据目录中的 backend.log。"));
        return;
      }
      const request = http.get(`http://127.0.0.1:${port}/api/health`, (response) => {
        response.resume();
        if (response.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      request.on("error", retry);
      request.setTimeout(1000, () => {
        request.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error("后端启动超时。请查看应用数据目录中的 backend.log。"));
        return;
      }
      setTimeout(tick, 350);
    };
    tick();
  });
}

async function startBackend() {
  earlyLog("backend:start", `packaged=${app.isPackaged} dir=${backendDir()}`);
  const port = await getFreePort();
  const cwd = backendDir();
  const userData = app.getPath("userData");
  fs.mkdirSync(userData, { recursive: true });
  const logPath = path.join(userData, "backend.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  const baseEnv = {
    ...process.env,
    GPL_WORKSPACE_ROOT: userData,
    PYTHONPATH: cwd,
  };
  const intelligenceExecutable = codeIntelligenceExecutable();
  if (fs.existsSync(intelligenceExecutable)) {
    baseEnv.CODECOURSE_CBM_BIN = intelligenceExecutable;
  }
  const env = addBundledGitToPath(baseEnv);

  if (app.isPackaged && process.platform === "win32") {
    const executable = packagedBackendExecutable();
    if (fs.existsSync(executable)) {
      const child = spawn(executable, ["--host", "127.0.0.1", "--port", String(port), "--workspace", userData], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stdout.pipe(logStream, { end: false });
      child.stderr.pipe(logStream, { end: false });
      await waitForHealth(port, child);
      earlyLog("backend:ready", `executable=${executable} port=${port}`);
      backendProcess = child;
      apiBase = `http://127.0.0.1:${port}/api`;
      process.env.CODECOURSE_API_BASE = apiBase;
      return;
    }
    // No packaged backend.exe — fall through to Python source backend below
  }

  let lastError = null;
  for (const candidate of pythonCandidates()) {
    const args = [
      ...candidate.prefixArgs,
      "-m",
      "uvicorn",
      "app.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ];
    const child = spawn(candidate.command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });
    try {
      await new Promise((resolve, reject) => {
        child.once("error", reject);
        setTimeout(resolve, 100);
      });
      await waitForHealth(port, child);
      earlyLog("backend:ready", `python=${candidate.command} port=${port}`);
      backendProcess = child;
      apiBase = `http://127.0.0.1:${port}/api`;
      process.env.CODECOURSE_API_BASE = apiBase;
      return;
    } catch (error) {
      lastError = error;
      if (!child.killed) child.kill();
    }
  }
  throw lastError || new Error("无法启动 Python 后端。请安装 Python 3 和 backend/requirements.txt。日志：" + logPath);
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // Direction C owns its startup surface; keep it dark before the renderer exists.
    backgroundColor: "#031a3a",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.once("ready-to-show", () => splashWindow?.show());
  splashWindow.on("closed", () => { splashWindow = null; });
}

function closeSplashWindow() {
  const splash = splashWindow;
  if (!splash || splash.isDestroyed()) return;
  let opacity = 1;
  const timer = setInterval(() => {
    if (splash.isDestroyed()) {
      clearInterval(timer);
      return;
    }
    opacity -= 0.12;
    if (opacity <= 0) {
      clearInterval(timer);
      splash.close();
    } else {
      splash.setOpacity(opacity);
    }
  }, 18);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (apiBase) createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(appIconPath());
  if (icon.isEmpty()) {
    earlyLog("tray:skip", `icon unavailable: ${appIconPath()}`);
    return;
  }
  tray = new Tray(icon);
  tray.setToolTip("CodeCourse");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 CodeCourse", click: showMainWindow },
    { type: "separator" },
    { label: "退出", click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
}

function setupAutoUpdater() {
  // This independent direction must never install a release from the main channel.
  return;
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", async (info) => {
    manualUpdateCheck = false;
    if (process.env.PORTABLE_EXECUTABLE_FILE) {
      const result = await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "CodeCourse 有新版本",
        message: `发现 ${info.version}，portable 版本需要手动替换。`,
        detail: "是否打开 GitHub Releases 下载最新版？",
        buttons: ["打开下载页", "稍后"],
        defaultId: 0,
        cancelId: 1,
      });
      if (result.response === 0) await shell.openExternal("https://github.com/XY-729/CodeCourse/releases/latest");
      return;
    }
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "CodeCourse 有新版本",
      message: `发现新版本 ${info.version}`,
      detail: "是否现在下载？下载期间可以继续使用 CodeCourse。",
      buttons: ["下载更新", "稍后"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) void autoUpdater.downloadUpdate();
  });
  autoUpdater.on("update-not-available", async () => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "CodeCourse 更新",
      message: `当前已是最新版本 ${app.getVersion()}`,
      buttons: ["知道了"],
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    tray?.setToolTip(`CodeCourse · 正在下载更新 ${Math.round(progress.percent)}%`);
  });
  autoUpdater.on("update-downloaded", async (info) => {
    tray?.setToolTip("CodeCourse");
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "更新已准备好",
      message: `CodeCourse ${info.version} 已下载完成`,
      detail: "现在重启并安装更新吗？",
      buttons: ["重启更新", "下次启动时更新"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      isQuitting = true;
      autoUpdater.quitAndInstall(false, true);
    }
  });
  autoUpdater.on("error", (error) => {
    const wasManual = manualUpdateCheck;
    manualUpdateCheck = false;
    tray?.setToolTip("CodeCourse");
    diagnosticLog("updater", error);
    console.warn("CodeCourse update check failed:", error?.message || error);
    if (wasManual) {
      void dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "检查更新失败",
        message: "暂时无法连接更新服务。",
        detail: error?.message || String(error),
        buttons: ["知道了"],
      });
    }
  });
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 8000);
}

function createWindow() {
  earlyLog("window:create", `frontend=${frontendIndex()}`);
  const savedState = loadWindowState();
  const window = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    ...(savedState.x == null ? {} : { x: savedState.x }),
    ...(savedState.y == null ? {} : { y: savedState.y }),
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: "CodeCourse",
    icon: appIconPath(),
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#031a3a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = window;
  let didRevealWindow = false;
  const revealWindow = () => {
    if (didRevealWindow || window.isDestroyed()) return;
    didRevealWindow = true;
    if (savedState.isMaximized) window.maximize();
    window.show();
    window.focus();
    closeSplashWindow();
    earlyLog("window:revealed", "main window shown");
  };
  const probeRenderer = () => {
    if (window.isDestroyed()) return;
    void window.webContents.executeJavaScript(`(() => ({
      ready: document.readyState,
      rootRect: (() => { const r = document.getElementById('root')?.getBoundingClientRect(); return r ? { width: r.width, height: r.height } : null; })(),
      bodyClass: document.body.className,
      htmlClass: document.documentElement.className,
      appShell: Boolean(document.querySelector('.app-shell')),
      directionShell: Boolean(document.querySelector('.direction-shell')),
    }))()`, true).then((info) => diagnosticLog("renderer:probe", info)).catch((error) => diagnosticLog("renderer:probe-error", error));
  };
  setTimeout(probeRenderer, 1800);
  window.webContents.on("did-finish-load", () => {
    diagnosticLog("renderer:loaded", window.webContents.getURL());
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    diagnosticLog("renderer:load-failed", { errorCode, errorDescription, validatedURL, isMainFrame });
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    diagnosticLog("renderer:gone", details);
  });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) diagnosticLog("renderer:console", { level, message, line, sourceId });
  });
  window.once("ready-to-show", () => {
    revealWindow();
  });
  // Reveal on load as well as first paint; a slow paint should not hide the UI.
  window.webContents.once("did-finish-load", () => setTimeout(revealWindow, 80));
  setTimeout(revealWindow, 4000);
  window.on("move", () => scheduleWindowStateSave(window));
  window.on("resize", () => scheduleWindowStateSave(window));
  window.on("close", (event) => {
    saveWindowState(window);
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.on("maximize", () => {
    scheduleWindowStateSave(window);
    window.webContents.send("codecourse:window-maximize-change", true);
  });
  window.on("unmaximize", () => {
    scheduleWindowStateSave(window);
    window.webContents.send("codecourse:window-maximize-change", false);
  });

  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && (input.key === "F12" || (input.control && input.shift && input.key === "I"))) {
      if (window.webContents.isDevToolsOpened()) {
        window.webContents.closeDevTools();
      } else {
        window.webContents.openDevTools({ mode: "detach" });
      }
      return;
    }
    if (input.type !== "keyDown" || !(input.control || input.meta)) return;
    const key = String(input.key).toLowerCase();
    let action = "";
    if (key === "n" && !input.shift) action = "new-project";
    else if (key === "f" && input.shift) action = "global-search";
    else if (key === "p" && !input.shift) action = "command-palette";
    else if (key === ",") action = "settings";
    if (action) {
      event.preventDefault();
      window.webContents.send("codecourse:shortcut", action);
    }
  });

  const devUrl = process.env.CODECOURSE_FRONTEND_URL;
  if (devUrl) {
    void window.loadURL(devUrl).catch((error) => diagnosticLog("renderer:load-url-error", error));
  } else {
    const indexPath = frontendIndex();
    if (!fs.existsSync(indexPath)) {
      dialog.showErrorBox("前端未构建", "未找到 frontend/dist-desktop/index.html，请先运行 npm --prefix frontend run build。");
      app.quit();
      return;
    }
    void window.loadFile(indexPath).catch((error) => diagnosticLog("renderer:load-file-error", error));
  }
}

function createDetachedWindow(payload) {
  if (!payload || !["file", "course", "qa"].includes(payload.type)) return false;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  detachedPayloads.set(token, {
    type: payload.type,
    path: String(payload.path || "").slice(0, 2000),
    title: String(payload.title || "CodeCourse 文档").slice(0, 300),
    content: String(payload.content || "").slice(0, 8 * 1024 * 1024),
    language: String(payload.language || "plaintext").slice(0, 80),
  });
  const window = new BrowserWindow({
    width: 960,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: payload.title || "CodeCourse",
    icon: appIconPath(),
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#031a3a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.once("ready-to-show", () => window.show());
  window.on("maximize", () => window.webContents.send("codecourse:window-maximize-change", true));
  window.on("unmaximize", () => window.webContents.send("codecourse:window-maximize-change", false));
  window.on("closed", () => detachedPayloads.delete(token));
  const devUrl = process.env.CODECOURSE_FRONTEND_URL;
  if (devUrl) {
    const url = new URL(devUrl);
    url.searchParams.set("detached", token);
    window.loadURL(url.toString());
  } else {
    window.loadFile(frontendIndex(), { query: { detached: token } });
  }
  return true;
}

function stopBackend() {
  if (backendProcess && backendProcess.exitCode === null && !backendProcess.killed) {
    backendProcess.kill();
  }
  backendProcess = null;
}

app.whenReady().then(async () => {
  earlyLog("electron:ready", `lock=${hasSingleInstanceLock}`);
  if (!hasSingleInstanceLock) return;
  try {
    // Keep every first-window operation inside the startup guard.  Tray/icon
    // failures must become a visible startup error instead of an unhandled
    // promise rejection that silently closes the EXE.
    createSplashWindow();
    createTray();
    await startBackend();
    earlyLog("backend:complete", apiBase);
    createWindow();
    earlyLog("window:created", "main window requested");
    setupAutoUpdater();
  } catch (error) {
    earlyLog("electron:start-failed", error);
    splashWindow?.close();
    isQuitting = true;
    dialog.showErrorBox("CodeCourse 启动失败", error instanceof Error ? error.message : String(error));
    app.quit();
  }
});

ipcMain.handle("codecourse:open-external", async (_event, url) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return false;
  }
  await shell.openExternal(url);
  return true;
});

ipcMain.handle("codecourse:window-minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle("codecourse:window-maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});

ipcMain.handle("codecourse:window-close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle("codecourse:window-toggle-fullscreen", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.setFullScreen(!win.isFullScreen());
  }
});

ipcMain.handle("codecourse:toggle-devtools", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win?.webContents.isDevToolsOpened()) {
    win.webContents.closeDevTools();
  } else {
    win?.webContents.openDevTools({ mode: "detach" });
  }
});

app.on("window-all-closed", () => {
  // The tray owns the app lifetime. Keeping the backend alive makes reopening instant.
});

ipcMain.handle("codecourse:check-for-updates", async () => {
  if (app.getName() === "CodeCourse Direction C") return { status: "development", version: app.getVersion() };
  if (!app.isPackaged) return { status: "development", version: app.getVersion() };
  manualUpdateCheck = true;
  const result = await autoUpdater.checkForUpdates();
  return { status: "checking", version: app.getVersion(), latest: result?.updateInfo?.version || null };
});

ipcMain.handle("codecourse:get-version", () => app.getVersion());

ipcMain.handle("codecourse:open-logs", async () => {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  await shell.openPath(app.getPath("userData"));
  return true;
});

ipcMain.handle("codecourse:save-data-archive", async (event, filename, data) => {
  const safeName = typeof filename === "string"
    ? path.basename(filename).replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    : "CodeCourse-data.zip";
  const payload = data instanceof ArrayBuffer
    ? Buffer.from(data)
    : ArrayBuffer.isView(data)
      ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
      : null;
  if (!payload || payload.length === 0 || payload.length > 300 * 1024 * 1024) {
    throw new Error("数据包为空或超过 300 MB。");
  }
  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const result = await dialog.showSaveDialog(owner, {
    title: "导出 CodeCourse 数据包",
    defaultPath: path.join(app.getPath("downloads"), safeName || "CodeCourse-data.zip"),
    filters: [{ name: "CodeCourse 数据包", extensions: ["zip"] }],
  });
  if (result.canceled || !result.filePath) return { saved: false };
  await fs.promises.writeFile(result.filePath, payload);
  return { saved: true, location: result.filePath };
});

ipcMain.handle("codecourse:renderer-diagnostic", (_event, payload) => {
  diagnosticLog("renderer", typeof payload === "string" ? payload : JSON.stringify(payload));
  return true;
});

ipcMain.handle("codecourse:notify", (_event, payload) => {
  if (!Notification.isSupported()) return false;
  const title = typeof payload?.title === "string" ? payload.title.slice(0, 100) : "CodeCourse";
  const body = typeof payload?.body === "string" ? payload.body.slice(0, 500) : "任务已完成";
  const notification = new Notification({ title, body, icon: appIconPath() });
  notification.on("click", showMainWindow);
  notification.show();
  return true;
});

ipcMain.handle("codecourse:detach-tab", (_event, payload) => createDetachedWindow(payload));

ipcMain.handle("codecourse:get-detached-payload", (event) => {
  const url = new URL(event.sender.getURL());
  const token = url.searchParams.get("detached") || "";
  return detachedPayloads.get(token) || null;
});

app.on("before-quit", () => {
  isQuitting = true;
  clearTimeout(windowStateSaveTimer);
  saveWindowState(mainWindow);
  stopBackend();
  tray?.destroy();
  tray = null;
});

app.on("activate", () => {
  showMainWindow();
});
