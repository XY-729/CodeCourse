import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import GestureLayer from "./features/gestures/GestureLayer";
import "./styles/desktop.css";
import { applyPlatformClass } from "./platform/runtime";
import { initializeAndroidPerformanceMode, markAndroidPerformance } from "./platform/android/performance";

applyPlatformClass();
if (document.documentElement.classList.contains("platform-android")) {
  initializeAndroidPerformanceMode();
}

// Inline script in index.html already sets data-theme + background-color.
// Sync theme-color as a fallback in case the meta tag moved.
const observedTheme = document.documentElement.dataset.theme;
if (observedTheme === "dark" || observedTheme === "light") {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", observedTheme === "dark" ? "#08111f" : "#edf4f1");
}

const detachedWindow = new URLSearchParams(window.location.search).has("detached");
const DetachedDocumentWindow = lazy(() => import("./features/reader/DetachedDocumentWindow"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {detachedWindow
      ? <Suspense fallback={<div className="viewer-loading">正在打开文档…</div>}><DetachedDocumentWindow /></Suspense>
      : <><App /><GestureLayer /></>}
  </React.StrictMode>,
);
markAndroidPerformance("react-render-requested");
