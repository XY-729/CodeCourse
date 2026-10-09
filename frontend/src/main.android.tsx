import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/android.css";
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
