import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
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
    expect(sockets).toHaveLength(4);
    expect(sockets.filter((item) => item.isInHeading)).toHaveLength(1);
    expect(sockets.filter((item) => item.isInTable)).toHaveLength(1);
    expect(sockets.some((item) => item.isInlineCode)).toBe(false);
    expect(sockets.some((item) => item.isInCodeBlock)).toBe(false);
    expect(new Set(sockets.map((item) => item.candidateId)).size).toBe(4);
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

  it("renders term text as a child of the occurrence node in hast", () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkTermOccurrences, {
        sourceKey: "course:lesson.md",
        terms: [term(1, "socket")],
      })
      .use(remarkRehype);

    const mdast = processor.parse("**socket bind**");
    const hast = processor.runSync(mdast);

    type HastNode = { tagName?: string; children?: unknown[] };
    const spans: Array<{ children?: Array<{ type: string; value?: string }> }> = [];
    const visit = (node: HastNode): void => {
      if (node.tagName === "span") {
        spans.push(node as (typeof spans)[number]);
      }
      node.children?.forEach((child) => visit(child as HastNode));
    };
    hast.children.forEach((child) => visit(child as HastNode));

    expect(spans).toHaveLength(1);
    expect(spans[0].children).toHaveLength(1);
    expect(spans[0].children?.[0].type).toBe("text");
    expect(spans[0].children?.[0].value).toBe("socket");
  });
});
