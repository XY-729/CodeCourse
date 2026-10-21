import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import MarkdownViewer from "./MarkdownViewer";

afterEach(cleanup);

beforeAll(() => {
  // jsdom lacks ResizeObserver, which the reader uses only for progress layout.
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
});

const lesson = `# 第 2 课：历史阅读与三层撤销

> 生成方式：AI 分章节生成并统一整合

## 提交历史的基本阅读

正文第一段。

<!-- codecourse-teaching: [{"concept":"git log","aspect":"用途与读法","kind":"explained","core":true,"dimension":"conceptual","quote":"四块内容各自回答一个问题。"}] -->

### 相关旧知识
- [git log --oneline · 用途、简化签名](https://codecourse.local/teaching/789e1e7f-ad1f-4cc5-971a-6a71a8cc0b48)

## 定向查询历史

正文第二段。

<!-- codecourse-teaching: [{"concept":"git blame","aspect":"逐行归属","kind":"explained","core":false,"dimension":"code_reading","quote":"每一行最后一次被谁改。"}] -->
`;

describe("MarkdownViewer teaching coverage metadata", () => {
  it("never renders the stored coverage comment as prose", () => {
    const { container } = render(<MarkdownViewer title="第 2 课" content={lesson} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("codecourse-teaching");
    expect(text).not.toContain('"concept"');
    expect(text).not.toContain("-->");
  });

  it("keeps the readable body and reuse references intact", () => {
    const { container } = render(<MarkdownViewer title="第 2 课" content={lesson} />);
    const text = container.textContent ?? "";
    expect(text).toContain("正文第一段。");
    expect(text).toContain("正文第二段。");
    expect(text).toContain("相关旧知识");
    const reference = Array.from(container.querySelectorAll("button"))
      .find((element) => element.textContent?.includes("git log --oneline"));
    expect(reference).toBeTruthy();
  });
});
