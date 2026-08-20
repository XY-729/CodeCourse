import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./styles/apple-tokens.css";
import "./styles/apple-workbench.css";
import "./styles/apple-content.css";
import "./styles/apple-code-highlight.css";
import "./styles/apple-overlays.css";
import "./styles/apple-depth.css";
import "./styles/android-experience.css";
import "./styles/learner-profile.css";
import "./styles/apple-android-final.css";
import "./styles/android-shell.css";
import "./styles/android-reader.css";
import "./styles/android-assistant.css";
import "./styles/android-me.css";
import "./styles/android-generation.css";
import { applyPlatformClass } from "./platform/runtime";
import { initializeAndroidPerformanceMode, markAndroidPerformance } from "./platform/android/performance";

applyPlatformClass();
initializeAndroidPerformanceMode();

const observedTheme = document.documentElement.dataset.theme;
if (observedTheme === "dark" || observedTheme === "light") {
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    observedTheme === "dark" ? "#08111f" : "#edf4f1",
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode><App /></React.StrictMode>,
);
markAndroidPerformance("react-render-requested");
