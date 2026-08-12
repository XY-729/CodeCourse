import hljs from "highlight.js/lib/core";
import { normalizeHighlightLanguage } from "./highlightLanguages";

type LanguageLoader = () => Promise<{ default: unknown }>;

const loaders: Record<string, LanguageLoader> = {
  bash: () => import("highlight.js/lib/languages/bash"), c: () => import("highlight.js/lib/languages/c"),
  cmake: () => import("highlight.js/lib/languages/cmake"), cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"), css: () => import("highlight.js/lib/languages/css"),
  dart: () => import("highlight.js/lib/languages/dart"), diff: () => import("highlight.js/lib/languages/diff"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"), dos: () => import("highlight.js/lib/languages/dos"),
  go: () => import("highlight.js/lib/languages/go"), gradle: () => import("highlight.js/lib/languages/gradle"),
  graphql: () => import("highlight.js/lib/languages/graphql"), groovy: () => import("highlight.js/lib/languages/groovy"),
  html: () => import("highlight.js/lib/languages/xml"), ini: () => import("highlight.js/lib/languages/ini"),
  java: () => import("highlight.js/lib/languages/java"), javascript: () => import("highlight.js/lib/languages/javascript"),
  json: () => import("highlight.js/lib/languages/json"), kotlin: () => import("highlight.js/lib/languages/kotlin"),
  latex: () => import("highlight.js/lib/languages/latex"), lua: () => import("highlight.js/lib/languages/lua"),
  makefile: () => import("highlight.js/lib/languages/makefile"), markdown: () => import("highlight.js/lib/languages/markdown"),
  php: () => import("highlight.js/lib/languages/php"), plaintext: () => import("highlight.js/lib/languages/plaintext"),
  powershell: () => import("highlight.js/lib/languages/powershell"), protobuf: () => import("highlight.js/lib/languages/protobuf"),
  python: () => import("highlight.js/lib/languages/python"), r: () => import("highlight.js/lib/languages/r"),
  ruby: () => import("highlight.js/lib/languages/ruby"), rust: () => import("highlight.js/lib/languages/rust"),
  scala: () => import("highlight.js/lib/languages/scala"), scss: () => import("highlight.js/lib/languages/scss"),
  shell: () => import("highlight.js/lib/languages/shell"), sql: () => import("highlight.js/lib/languages/sql"),
  swift: () => import("highlight.js/lib/languages/swift"), toml: () => import("highlight.js/lib/languages/ini"),
  stata: () => import("highlight.js/lib/languages/stata"),
  typescript: () => import("highlight.js/lib/languages/typescript"), xml: () => import("highlight.js/lib/languages/xml"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
};

const registrations = new Map<string, Promise<string>>();

export async function ensureHighlightLanguage(raw: string): Promise<string> {
  const language = normalizeHighlightLanguage(raw);
  if (hljs.getLanguage(language)) return language;
  let registration = registrations.get(language);
  if (!registration) {
    registration = (loaders[language] ?? loaders.plaintext)().then((module) => {
      hljs.registerLanguage(language, module.default as Parameters<typeof hljs.registerLanguage>[1]);
      return language;
    });
    registrations.set(language, registration);
  }
  return registration;
}

export async function highlightCode(code: string, rawLanguage: string): Promise<string> {
  const language = await ensureHighlightLanguage(rawLanguage);
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}
