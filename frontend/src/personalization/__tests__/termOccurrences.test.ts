import { describe, expect, it } from "vitest";
import type { DocumentTerm } from "../../api/client";
import {
  analyzeMarkdownTermOccurrences,
  buildTermCandidateId,
  matchTermsInTextNode,
  prepareTermsForMatching,
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
});
