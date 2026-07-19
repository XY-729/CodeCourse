import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./styles/apple-tokens.css";
import "./styles/apple-workbench.css";
import "./styles/apple-content.css";
import "./styles/apple-overlays.css";
import "./styles/android-experience.css";
import { applyPlatformClass } from "./platform/runtime";

applyPlatformClass();

const storedTheme = window.localStorage.getItem("codecourse.theme");
const initialTheme = storedTheme === "light" || storedTheme === "dark"
  ? storedTheme
  : window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
document.documentElement.dataset.theme = initialTheme;
document.querySelector('meta[name="theme-color"]')?.setAttribute("content", initialTheme === "dark" ? "#090c12" : "#f7faf8");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
