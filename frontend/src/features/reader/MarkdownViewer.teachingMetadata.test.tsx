import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DocumentTerm } from "../../api/client";
import { analyzeMarkdownTermOccurrences } from "../../personalization/termOccurrences";
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

<!-- CODECOURSE_LESSON_LINKS_START -->
<!-- CODECOURSE_LESSON_LINKS_END -->
`;

describe("MarkdownViewer teaching coverage metadata", () => {
  it("opens the precise row-less homonym or alias selected by the rendered span", () => {
    const content = "<!-- codecourse-teaching: [] -->\n\n😀 C++ 的 stack。\n\nPython 的 `stack`。\n\nC++ 的栈适配器。";
    const terms = [
      { text: "stack", quote: "😀 C++ 的 stack。", id: "cpp" },
      { text: "stack", quote: "Python 的 `stack`。", id: "python" },
      { text: "栈适配器", quote: "C++ 的栈适配器。", id: "cpp" },
    ].map(({ text, quote, id }) => ({
      id: 0, project_id: 1, source_type: "course", source_path: "homonyms.md", term_text: text,
      detection_source: "teaching_manifest_v2", status: "candidate", concept_id: id, quote,
      confidence: 0.95, link_origin: "automatic", created_at: "", updated_at: "",
      source_span: { text, start: [...content.slice(0, content.indexOf(text, content.indexOf(quote)))].length },
    })) as DocumentTerm[];
    const sourceKey = "course:homonyms.md";
    const analysis = analyzeMarkdownTermOccurrences(content, terms, sourceKey);
    const onGenerateTerm = vi.fn();
    const { container } = render(<MarkdownViewer title="同名概念" content={content} sourcePath="homonyms.md"
      termSourceKey={sourceKey} documentTerms={terms} onGenerateTerm={onGenerateTerm}
      visibleTermCandidateIds={new Set(analysis.occurrences.map(item => item.candidateId))} />);
    const buttons = container.querySelectorAll("button.personalized-term");
    expect(buttons).toHaveLength(3);
    buttons.forEach((button, index) => {
      fireEvent.click(button);
      expect(onGenerateTerm.mock.calls[index][0]).toEqual(terms[index]);
    });
  });

  it("never renders the stored coverage comment as prose", () => {
    const { container } = render(<MarkdownViewer title="第 2 课" content={lesson} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("codecourse-teaching");
    expect(text).not.toContain('"concept"');
    expect(text).not.toContain("-->");
    expect(text).not.toContain("CODECOURSE_");
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
