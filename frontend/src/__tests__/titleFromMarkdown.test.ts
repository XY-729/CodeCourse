import { describe, expect, it } from "vitest";
import { titleFromMarkdown } from "../utils/titleFromMarkdown";

describe("titleFromMarkdown", () => {
  it("extracts the first H1 heading", () => {
    expect(titleFromMarkdown("lessons/lesson_01.md", "# 第 1 课：React 整体架构与启动流程\n\n正文")).toBe(
      "第 1 课：React 整体架构与启动流程",
    );
  });

  it("trims surrounding whitespace from the H1", () => {
    expect(titleFromMarkdown("a.md", "#  变量与类型  \n正文")).toBe("变量与类型");
  });

  it("falls back to the filename without .md when there is no H1", () => {
    expect(titleFromMarkdown("lessons/lesson_02.md", "## 小节\n正文")).toBe("lessons/lesson_02");
  });

  it("keeps the group prefix when content lacks an H1", () => {
    expect(titleFromMarkdown("files/main_brief.md", "## 概览")).toBe("files/main_brief");
  });
});
