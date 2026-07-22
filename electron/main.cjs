const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, screen, shell, Tray } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { autoUpdater } = require("electron-updater");

app.setName("CodeCourse");

let backendProcess = null;
let apiBase = "";
let mainWindow = null;
let splashWindow = null;
let tray = null;
let isQuitting = false;
let windowStateSaveTimer = null;
const detachedPayloads = new Map();

const DEFAULT_WINDOW_STATE = {
  width: 1280,
  height: 800,
  isMaximized: false,
};

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
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
  return path.join(projectRoot(), "frontend", "dist", "index.html");
}

function appIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(projectRoot(), "resources", "icon.ico");
}

function windowStatePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

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
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b1422" : "#f3f7f5",
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
  tray = new Tray(nativeImage.createFromPath(appIconPath()));
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
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", async (info) => {
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
    tray?.setToolTip("CodeCourse");
    console.warn("CodeCourse update check failed:", error?.message || error);
  });
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 8000);
}

function createWindow() {
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
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#f5f5f7",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = window;
  window.once("ready-to-show", () => {
    if (savedState.isMaximized) window.maximize();
    window.show();
    window.focus();
    closeSplashWindow();
  });
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
    window.loadURL(devUrl);
  } else {
    const indexPath = frontendIndex();
    if (!fs.existsSync(indexPath)) {
      dialog.showErrorBox("前端未构建", "未找到 frontend/dist/index.html，请先运行 npm --prefix frontend run build。");
      app.quit();
      return;
    }
    window.loadFile(indexPath);
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
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#08111f" : "#edf4f1",
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
  if (!hasSingleInstanceLock) return;
  createSplashWindow();
  createTray();
  try {
    await startBackend();
    createWindow();
    setupAutoUpdater();
  } catch (error) {
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
