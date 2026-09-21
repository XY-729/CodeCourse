import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ProgressiveMarkdown from "./ProgressiveMarkdown";
import { splitRecordInformation } from "../utils/recordInformation";
afterEach(cleanup);
it("keeps completed blocks stable and preserves fenced code, tables and reference links", () => {
  const first = "## 标题\n\n[参考][ref]\n\n";
  const markdown = first + "```cpp\nint x = 1;\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n[ref]: https://example.com";
  const view = render(<ProgressiveMarkdown markdown={markdown} visibleLength={first.length} />);
  const heading = screen.getByRole("heading");
  expect(screen.getByRole("link").getAttribute("href")).toBe("https://example.com");
  view.rerender(<ProgressiveMarkdown markdown={markdown} visibleLength={markdown.length} />);
  expect(screen.getByRole("heading")).toBe(heading);
  expect(view.container.querySelector("pre code")?.textContent).toContain("int x = 1;");
  expect(screen.getByRole("table")).toBeTruthy();
});
it("folds only generated trailing metadata and leaves user sections and code intact", () => {
  const info = "## 记录信息\n\n- 来源类型：course\n- 来源路径：lesson.md\n- 模型：test\n- 收藏：false\n- 创建时间：now\n- 更新时间：now\n";
  expect(splitRecordInformation(`正文\n\n---\n\n${info}`).body).toBe("正文");
  expect(splitRecordInformation(`正文\n\n${info}`).information).toContain("来源路径");
  const custom = "正文\n\n## 记录信息\n\n这是用户写的笔记";
  expect(splitRecordInformation(custom)).toEqual({ body: custom, information: "" });
  const code = `\`\`\`markdown\n${info}`;
  expect(splitRecordInformation(code)).toEqual({ body: code, information: "" });
});
