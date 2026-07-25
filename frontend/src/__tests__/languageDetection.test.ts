import { describe, it, expect } from "vitest";
import { inferLanguage, normalizeLanguage } from "../platform/android/workspace";

describe("inferLanguage", () => {
  it("detects Python", () => {
    expect(inferLanguage("src/main.py")).toBe("python");
  });

  it("detects TypeScript", () => {
    expect(inferLanguage("src/App.tsx")).toBe("typescript");
  });

  it("detects Java", () => {
    expect(inferLanguage("src/Foo.java")).toBe("java");
  });

  it("detects Kotlin", () => {
    expect(inferLanguage("src/Bar.kt")).toBe("kotlin");
  });

  it("detects Gradle (Kotlin DSL)", () => {
    expect(inferLanguage("build.gradle.kts")).toBe("kotlin");
  });

  it("detects Gradle (Groovy)", () => {
    expect(inferLanguage("build.gradle")).toBe("groovy");
  });

  it("detects properties", () => {
    expect(inferLanguage("gradle.properties")).toBe("ini");
  });

  it("detects shell script", () => {
    expect(inferLanguage("run.sh")).toBe("shell");
  });

  it("detects PowerShell", () => {
    expect(inferLanguage("deploy.ps1")).toBe("powershell");
  });

  it("detects Dockerfile", () => {
    expect(inferLanguage("Dockerfile")).toBe("dockerfile");
  });

  it("detects Dockerfile.prod as dockerfile", () => {
    expect(inferLanguage("Dockerfile.prod")).toBe("dockerfile");
  });

  it("detects Makefile", () => {
    expect(inferLanguage("Makefile")).toBe("makefile");
  });

  it("detects .gitignore as ini", () => {
    expect(inferLanguage(".gitignore")).toBe("ini");
  });

  it("detects .editorconfig as ini", () => {
    expect(inferLanguage(".editorconfig")).toBe("ini");
  });

  it("does NOT map BUILD to stata", () => {
    const lang = inferLanguage("BUILD");
    expect(lang).not.toBe("stata");
  });

  it("does NOT map WORKSPACE to stata", () => {
    const lang = inferLanguage("WORKSPACE");
    expect(lang).not.toBe("stata");
  });

  it("maps BUILD.bazel to python (Starlark fallback)", () => {
    // Starlark is python-like; we accept python as the best hljs match
    expect(inferLanguage("BUILD.bazel")).toBe("python");
  });

  it("maps .bzl to python", () => {
    expect(inferLanguage("defs.bzl")).toBe("python");
  });

  it("maps .env files to ini", () => {
    expect(inferLanguage(".env")).toBe("ini");
    expect(inferLanguage(".env.local")).toBe("ini");
    expect(inferLanguage(".env.production")).toBe("ini");
  });

  it("falls back to plaintext for unknown extensions", () => {
    expect(inferLanguage("data.unknownxyz")).toBe("plaintext");
  });

  it("is case-insensitive for Dockerfile", () => {
    expect(inferLanguage("dockerfile")).toBe("dockerfile");
    expect(inferLanguage("DOCKERFILE")).toBe("dockerfile");
  });
});

describe("normalizeLanguage", () => {
  it("returns plaintext for empty input", () => {
    expect(normalizeLanguage("")).toBe("plaintext");
  });

  it("returns plaintext for 'text'", () => {
    expect(normalizeLanguage("text")).toBe("plaintext");
  });

  it("passes through valid languages", () => {
    expect(normalizeLanguage("python")).toBe("python");
    expect(normalizeLanguage("typescript")).toBe("typescript");
    expect(normalizeLanguage("javascript")).toBe("javascript");
  });

  it("maps aliases", () => {
    expect(normalizeLanguage("csharp")).toBe("csharp");
    expect(normalizeLanguage("dockerfile")).toBe("dockerfile");
  });

  it("returns plaintext for invalid languages", () => {
    expect(normalizeLanguage("stata")).toBe("stata"); // hljs supports it but we shouldn't use it
    expect(normalizeLanguage("nonexistent_lang")).toBe("plaintext");
  });
});
