const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codecourseDesktop", {
  apiBase: process.env.CODECOURSE_API_BASE || "",
  openExternal: (url) => ipcRenderer.invoke("codecourse:open-external", url),
  windowMinimize: () => ipcRenderer.invoke("codecourse:window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("codecourse:window-maximize"),
  windowClose: () => ipcRenderer.invoke("codecourse:window-close"),
  windowToggleFullscreen: () => ipcRenderer.invoke("codecourse:window-toggle-fullscreen"),
  toggleDevTools: () => ipcRenderer.invoke("codecourse:toggle-devtools"),
  onWindowMaximizeChange: (callback) => {
    ipcRenderer.on("codecourse:window-maximize-change", (_event, isMaximized) => callback(isMaximized));
  },
});
