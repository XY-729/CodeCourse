import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocumentTerm } from "../../api/client";
import MarkdownViewer from "../../components/MarkdownViewer";
import { analyzeMarkdownTermOccurrences } from "../termOccurrences";
import { buildPreliminaryTermDecision } from "../termDisplayDecision";
import { allocateTermDisplays } from "../termDisplayAllocator";
import { createNeutralTermProfile } from "../useTermDisplay";

const content = "**禁止编译器偷偷做类型转换**。它只是把值复制给另一个对象。\n\n学习 `std::vector`。\n\n`std::vector<int> values;`\n\n[std::vector](https://example.com)\n\n```cpp\nstd::vector<int> values;\n```";
const terms: DocumentTerm[] = [
  { id: 1, term_text: "禁止编译器偷偷做类型转换", detection_source: "rule" },
  { id: 2, term_text: "它只是把", detection_source: "rule" },
  { id: 3, term_text: "std::vector", detection_source: "model" },
].map((item) => ({
  project_id: 12, source_type: "course", source_path: "lesson_02.md", confidence: 0.8,
  status: "candidate", link_origin: "automatic", created_at: "2026-09-01", updated_at: "2026-09-01",
  ...item,
})) as DocumentTerm[];

describe("regression from generated C++ lessons", () => {
  it("renders only the selected technical term, preserving code and ordinary emphasis", () => {
    const analysis = analyzeMarkdownTermOccurrences(content, terms, "lesson_02.md");
    expect(analysis.occurrences.map((item) => item.text)).toEqual(["std::vector"]);
    const candidateId = analysis.occurrences[0].candidateId;
    const html = renderToStaticMarkup(createElement(MarkdownViewer, {
      title: "术语回归课件", content, documentTerms: terms, termSourceKey: "lesson_02.md", onGenerateTerm: () => {},
      visibleTermCandidateIds: new Set([candidateId]),
    }));
    expect(html).toMatch(/<code><button[^>]*data-term-id="3"[^>]*>std::vector<\/button><\/code>/);
    expect(html).toContain("<strong>禁止编译器偷偷做类型转换</strong>");
    expect(html).not.toContain('data-term-id="1"');
    expect(html).not.toContain('data-term-id="2"');
    expect(html).toContain('<a href="https://example.com">std::vector</a>');
    expect(html).toContain("<code>std::vector&lt;int&gt; values;</code>");
  });
  it("suppresses a confirmed term and keeps its inline code readable", () => {
    const analysis = analyzeMarkdownTermOccurrences(content, terms, "lesson_02.md");
    const preliminary = analysis.occurrences.map((item) => buildPreliminaryTermDecision(item, {
      ...createNeutralTermProfile(item.conceptKey), knowledgeStatus: "confirmed",
    }, { terminologyDensity: 0.5 }, { profileAvailable: true, paragraphCount: analysis.paragraphCount }));
    const result = allocateTermDisplays({ preliminary, terminologyDensity: 0.5, profileAvailable: true, paragraphCount: analysis.paragraphCount });
    expect(result.every((item) => !item.visible)).toBe(true);
    const html = renderToStaticMarkup(createElement(MarkdownViewer, {
      title: "术语回归课件", content, documentTerms: terms, termSourceKey: "lesson_02.md", onGenerateTerm: () => {},
      visibleTermCandidateIds: new Set<string>(),
    }));
    expect(html).toContain("<code>std::vector</code>");
    expect(html).not.toContain('data-term-id="3"');
  });
});
