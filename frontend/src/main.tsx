import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import GestureLayer from "./components/GestureLayer";
import "./styles.css";
import "./styles/apple-tokens.css";
import "./styles/apple-workbench.css";
import "./styles/apple-content.css";
import "./styles/apple-code-highlight.css";
import "./styles/apple-overlays.css";
import "./styles/apple-depth.css";
import "./styles/android-experience.css";
import "./styles/learner-profile.css";
import "./styles/gesture-drawer.css";
import "./styles/apple-android-final.css";
import "./styles/android-shell.css";
import "./styles/android-reader.css";
import "./styles/android-assistant.css";
import "./styles/android-me.css";
import "./styles/android-generation.css";
import "./styles/call-guide.css";
import "./desktop/direction.css";
import "./desktop/direction-surfaces.css";
import "./desktop/direction-reader.css";
import "./desktop/direction-ask.css";
import "./desktop/direction-interface.css";
import "./desktop/direction-generation.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow-condensed/800-italic.css";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/500.css";
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
const DetachedDocumentWindow = lazy(() => import("./components/DetachedDocumentWindow"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {detachedWindow
      ? <Suspense fallback={<div className="direction-window-loading"><strong>READ</strong><span>正在打开文档…</span></div>}><DetachedDocumentWindow /></Suspense>
      : <><App /><GestureLayer /></>}
  </React.StrictMode>,
);
markAndroidPerformance("react-render-requested");
