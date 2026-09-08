/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { monacoAssets } from './monacoAssets';
import { readFileSync } from "node:fs";

const packageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version as string;

export default defineConfig(({ mode }) => {
  const androidBuild = mode === "android";
  return {
  base: "./",
  plugins: [
    react(),
    ...(!androidBuild ? [monacoAssets()] : []),
    {
      name: "codecourse-platform-entry",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "build-platform.json",
          source: JSON.stringify({ platform: androidBuild ? "android" : "desktop", version: packageVersion }),
        });
      },
      transformIndexHtml: {
        order: "pre",
        handler(html) {
          return androidBuild
            ? html.replace('/src/main.tsx', '/src/main.android.tsx')
            : html;
        },
      },
    },
  ],
  define: {
    __CODECOURSE_VERSION__: JSON.stringify(packageVersion),
    __ANDROID_BUILD__: JSON.stringify(androidBuild),
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
    // The desktop payload has its own directory; Android keeps its original output.
    outDir: androidBuild ? "dist" : "dist-desktop",
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
  worker: {
    format: "es",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
  },
  };
});
