const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const root = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const electronPath = require("electron");
const frontendUrl = process.env.CODECOURSE_FRONTEND_URL || "http://127.0.0.1:5173";

function waitForUrl(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
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
        reject(new Error(`前端开发服务启动超时：${url}`));
        return;
      }
      setTimeout(tick, 350);
    };
    tick();
  });
}

async function main() {
  const vite = spawn(npmCommand, ["--prefix", "frontend", "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

  const cleanup = () => {
    if (!vite.killed) vite.kill();
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  await waitForUrl(frontendUrl);
  const electron = spawn(electronPath, [root], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CODECOURSE_FRONTEND_URL: frontendUrl },
  });
  electron.on("exit", (code) => {
    cleanup();
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
