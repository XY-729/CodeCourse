const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("codecourseDesktop", {
  apiBase: process.env.CODECOURSE_API_BASE || "",
});
