import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import DetachedDocumentWindow from "./components/DetachedDocumentWindow";
import GestureLayer from "./components/GestureLayer";
import "./styles.css";
import "./styles/apple-tokens.css";
import "./styles/apple-workbench.css";
import "./styles/apple-content.css";
import "./styles/apple-code-highlight.css";
import "./styles/apple-overlays.css";
import "./styles/apple-depth.css";
import "./styles/android-experience.css";
import "./styles/gesture-drawer.css";
import { applyPlatformClass } from "./platform/runtime";

applyPlatformClass();

// Inline script in index.html already sets data-theme + background-color.
// Sync theme-color as a fallback in case the meta tag moved.
const observedTheme = document.documentElement.dataset.theme;
if (observedTheme === "dark" || observedTheme === "light") {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", observedTheme === "dark" ? "#08111f" : "#edf4f1");
}

const detachedWindow = new URLSearchParams(window.location.search).has("detached");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {detachedWindow ? <DetachedDocumentWindow /> : <><App /><GestureLayer /></>}
  </React.StrictMode>,
);
