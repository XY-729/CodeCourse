const { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

app.setName("CodeCourse");

let backendProcess = null;
let apiBase = "";

function projectRoot() {
  return path.resolve(__dirname, "..");
}

function backendDir() {
  return app.isPackaged ? path.join(process.resourcesPath, "backend") : path.join(projectRoot(), "backend");
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

function pythonCandidates() {
  const configured = process.env.CODECOURSE_PYTHON;
  const candidates = [];
  if (configured) candidates.push({ command: configured, prefixArgs: [] });
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
    if (!fs.existsSync(executable)) {
      throw new Error(`未找到内置后端：${executable}`);
    }
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

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 720,
    title: "CodeCourse",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#f5f5f7",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
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

function stopBackend() {
  if (backendProcess && backendProcess.exitCode === null && !backendProcess.killed) {
    backendProcess.kill();
  }
  backendProcess = null;
}

app.whenReady().then(async () => {
  try {
    await startBackend();
    createWindow();
  } catch (error) {
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

app.on("window-all-closed", () => {
  stopBackend();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopBackend);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && apiBase) createWindow();
});
