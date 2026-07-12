const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codecourseDesktop", {
  apiBase: process.env.CODECOURSE_API_BASE || "",
  openExternal: (url) => ipcRenderer.invoke("codecourse:open-external", url),
});
