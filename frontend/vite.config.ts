/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const packageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version as string;

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __CODECOURSE_VERSION__: JSON.stringify(packageVersion),
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]react(?:-dom)?[\\/]/.test(id) || id.includes("scheduler")) return "vendor-react";
          if (/remark|unified|mdast|micromark|react-markdown/.test(id)) return "vendor-markdown";
          if (id.includes("highlight.js")) return "vendor-highlight";
          if (id.includes("cytoscape")) return "vendor-graph";
          if (id.includes("@capacitor")) return "vendor-capacitor";
          if (id.includes("lucide-react")) return "vendor-icons";
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
  },
});
