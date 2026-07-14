const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const input = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);

app.commandLine.appendSwitch("disable-gpu");

app.whenReady().then(async () => {
  const svg = fs.readFileSync(input, "utf8");
  const window = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  await window.loadURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  fs.writeFileSync(output, image.toPNG());
  window.destroy();
  app.quit();
});
