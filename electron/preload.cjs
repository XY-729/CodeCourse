const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("codecourseDesktop", {
  apiBase: process.env.CODECOURSE_API_BASE || "",
  openExternal: (url) => ipcRenderer.invoke("codecourse:open-external", url),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  notify: (payload) => ipcRenderer.invoke("codecourse:notify", payload),
  detachTab: (payload) => ipcRenderer.invoke("codecourse:detach-tab", payload),
  getDetachedPayload: () => ipcRenderer.invoke("codecourse:get-detached-payload"),
  windowMinimize: () => ipcRenderer.invoke("codecourse:window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("codecourse:window-maximize"),
  windowClose: () => ipcRenderer.invoke("codecourse:window-close"),
  windowToggleFullscreen: () => ipcRenderer.invoke("codecourse:window-toggle-fullscreen"),
  toggleDevTools: () => ipcRenderer.invoke("codecourse:toggle-devtools"),
  onWindowMaximizeChange: (callback) => {
    const listener = (_event, isMaximized) => callback(isMaximized);
    ipcRenderer.on("codecourse:window-maximize-change", listener);
    return () => ipcRenderer.removeListener("codecourse:window-maximize-change", listener);
  },
  onShortcut: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("codecourse:shortcut", listener);
    return () => ipcRenderer.removeListener("codecourse:shortcut", listener);
  },
});
