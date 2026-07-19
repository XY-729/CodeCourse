import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./styles/apple-tokens.css";
import "./styles/apple-workbench.css";
import "./styles/apple-content.css";
import "./styles/apple-code-highlight.css";
import "./styles/apple-overlays.css";
import "./styles/android-experience.css";
import { applyPlatformClass } from "./platform/runtime";

applyPlatformClass();

// Inline script in index.html already sets data-theme + background-color.
// Sync theme-color as a fallback in case the meta tag moved.
const observedTheme = document.documentElement.dataset.theme;
if (observedTheme === "dark" || observedTheme === "light") {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", observedTheme === "dark" ? "#090c12" : "#f7faf8");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
