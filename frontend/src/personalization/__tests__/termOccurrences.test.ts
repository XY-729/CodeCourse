import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { DocumentTerm } from "../../api/client";
import {
  analyzeMarkdownTermOccurrences,
  buildTermCandidateId,
  matchTermsInTextNode,
  prepareTermsForMatching,
  remarkTermOccurrences,
} from "../termOccurrences";

function term(
  id: number,
  text: string,
  overrides: Partial<DocumentTerm> = {},
): DocumentTerm {
  return {
    id,
    project_id: 1,
    source_type: "course",
    source_path: "lesson.md",
    term_text: text,
    detection_source: "model",
    confidence: 0.8,
    status: "candidate",
    link_origin: "automatic",
    qa_record_id: null,
    concept_id: `global:${text.toLowerCase()}`,
    content_hash: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as DocumentTerm;
}

describe("markdown term occurrences", () => {
  it("uses stable document + AST node + local offset ids", () => {
    const first = buildTermCandidateId({
      termId: "42",
      sourceKey: "course:lesson.md",
      nodePath: "1.0",
      localStart: 3,
    });
    const second = buildTermCandidateId({
      termId: "42",
      sourceKey: "course:lesson.md",
      nodePath: "1.0",
      localStart: 3,
    });
    expect(first).toBe(second);
    expect(
      buildTermCandidateId({
        termId: "42",
        sourceKey: "course:lesson.md",
        nodePath: "1.0",
        localStart: 10,
      }),
    ).not.toBe(first);
  });

  it("uses longest non-overlapping term first", () => {
    const ordered = prepareTermsForMatching([
      term(1, "socket"),
      term(2, "socket address"),
    ]);
    const matches = matchTermsInTextNode("socket address and socket", ordered);
    expect(matches.map((item) => item.term.term_text)).toEqual([
      "socket address",
      "socket",
    ]);
  });

  it("gets real Markdown context and skips code and links", () => {
    const markdown = [
      "# socket heading",
      "",
      "socket bind socket",
      "",
      "`socket` and [socket](https://example.com)",
      "",
      "| name |",
      "| --- |",
      "| socket |",
      "",
      "```text",
      "socket",
      "```",
    ].join("\n");

    const analysis = analyzeMarkdownTermOccurrences(
      markdown,
      [term(1, "socket"), term(2, "bind")],
      "course:lesson.md",
    );

    const sockets = analysis.occurrences.filter(
      (occurrence) => occurrence.termText === "socket",
    );
    expect(sockets).toHaveLength(5);
    expect(sockets.filter((item) => item.isInHeading)).toHaveLength(1);
    expect(sockets.filter((item) => item.isInTable)).toHaveLength(1);
    expect(sockets.filter((item) => item.isInlineCode)).toHaveLength(1);
    expect(sockets.some((item) => item.isInCodeBlock)).toBe(false);
    expect(new Set(sockets.map((item) => item.candidateId)).size).toBe(5);
  });

  it("keeps mixed terms in source order instead of term-group order", () => {
    const analysis = analyzeMarkdownTermOccurrences(
      "socket bind socket",
      [term(1, "socket"), term(2, "bind")],
      "course:lesson.md",
    );
    expect(analysis.occurrences.map((item) => item.termText)).toEqual([
      "socket",
      "bind",
      "socket",
    ]);
  });

  it("hides historical rule candidates and automatic linked records but preserves manual links", () => {
    const analysis = analyzeMarkdownTermOccurrences(
      "禁止编译器偷偷做类型转换。左值引用、移动语义与自定义内容。",
      [
        term(1, "禁止编译器偷偷做类型转换", { detection_source: "rule" }),
        term(2, "左值引用", { detection_source: "index", status: "linked", link_origin: "legacy_unknown" }),
        term(3, "移动语义", { status: "linked", link_origin: "automatic" }),
        term(4, "自定义内容", { detection_source: "rule", status: "linked", link_origin: "manual" }),
      ],
      "course:lesson.md",
    );
    expect(analysis.occurrences.map((item) => [item.termText, item.manualLink])).toEqual([
      ["移动语义", false], ["自定义内容", true],
    ]);
  });

  it("matches a whole inline technical term, not a statement or existing link", () => {
    const analysis = analyzeMarkdownTermOccurrences(
      "`std::vector` 和 `std::vector<int> values;`。[`std::vector`](https://example.com)",
      [term(1, "std::vector")],
      "course:lesson.md",
    );
    expect(analysis.occurrences).toHaveLength(1);
    expect(analysis.occurrences[0]).toMatchObject({ source: "model", isInlineCode: true });
  });

  it("emits the term text as a text child of the occurrence node", () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkTermOccurrences, {
        sourceKey: "course:lesson.md",
        terms: [term(1, "socket")],
      });

    type AstNode = { type: string; value?: string; children?: AstNode[] };
    const mdast = processor.parse("**socket bind**") as AstNode;
    const tree = processor.runSync(mdast) as { children?: AstNode[] };
    const occurrences: Array<{ value?: string; children?: AstNode[] }> = [];
    const visit = (node: AstNode): void => {
      if (node.type === "termOccurrence") {
        occurrences.push(node);
      }
      node.children?.forEach(visit);
    };
    tree.children?.forEach(visit);

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].children).toHaveLength(1);
    expect(occurrences[0].children?.[0].type).toBe("text");
    expect(occurrences[0].children?.[0].value).toBe("socket");
  });
});
