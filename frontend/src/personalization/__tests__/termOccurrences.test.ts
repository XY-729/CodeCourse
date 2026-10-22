import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
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
  it.each(["teaching_manifest_v2", "manifest"])("keeps exact homonym identities for %s in both analysis and rendering", (source) => {
    const markdown = "# stack\n\n😀 C++ 的 **stack** 是适配器。\n\nPython 的 `stack` 用列表实现。\n\n| stack |\n| --- |\n| 栈 |";
    const cppQuote = "😀 C++ 的 **stack** 是适配器。";
    const pyQuote = "Python 的 `stack` 用列表实现。";
    const terms = [cppQuote, pyQuote].map((quote, index) => {
      const start = markdown.indexOf("stack", markdown.indexOf(quote));
      // Desktop offsets count Unicode code points; Android offsets count UTF-16.
      const offset = source === "teaching_manifest_v2" ? [...markdown.slice(0, start)].length : start;
      return term(0, "stack", { detection_source: source, concept_id: ["cpp-stack", "python-stack"][index],
        quote, source_span: { text: "stack", start: offset, end: offset + 5 } });
    });
    const analysis = analyzeMarkdownTermOccurrences(markdown, terms, "course:homonyms.md");
    expect(analysis.occurrences.map(item => [item.conceptKey, item.source, item.absoluteOffset])).toEqual([
      ["cpp-stack", "manifest", markdown.indexOf("stack", markdown.indexOf(cppQuote))],
      ["python-stack", "manifest", markdown.indexOf("stack", markdown.indexOf(pyQuote))],
    ]);
    const processor = unified().use(remarkParse).use(remarkGfm)
      .use(remarkTermOccurrences, { sourceKey: "course:homonyms.md", terms });
    const tree = processor.runSync(processor.parse(markdown), { value: markdown });
    const rendered: Array<{ id: unknown; candidate: unknown }> = [];
    const visit = (node: any) => {
      if (node.type === "termOccurrence") rendered.push({
        id: node.data.hProperties["data-term-concept-id"], candidate: node.data.hProperties["data-term-candidate-id"],
      });
      node.children?.forEach(visit);
    };
    visit(tree);
    expect(rendered).toEqual(analysis.occurrences.map(item => ({ id: item.conceptKey, candidate: item.candidateId })));
  });

  it("accounts for escaped text, entities, inline delimiters and hidden metadata before a pinned term", () => {
    const body = "<!-- codecourse-teaching: [] -->\n\n&amp; \\* 范围：栈。\n\n`` 栈 `` 和 ``\n队列\n``。";
    const terms = ["&amp; \\* 范围：栈。", "`` 栈 ``", "``\n队列\n``"].map((quote, index) => {
      const text = index === 2 ? "队列" : "栈";
      return term(0, text, { detection_source: "teaching_manifest_v2", concept_id: String(index), quote,
        source_span: { text, start: 999, end: 1000 } });
    });
    const analysis = analyzeMarkdownTermOccurrences(body, terms, "course:unicode.md");
    expect(analysis.occurrences.map(item => [item.conceptKey, item.localStart])).toEqual([
      ["0", 7], ["1", 0], ["2", 0],
    ]);
  });

  it("does not redirect stale authoritative spans or ambiguous quotes to another occurrence", () => {
    const markdown = "C++ stack。\n\nPython stack。";
    const terms = [
      term(0, "stack", { detection_source: "manifest", quote: "Deleted stack。", source_span: { text: "stack", start: 4, end: 9 } }),
      term(0, "stack", { detection_source: "teaching_manifest_v2", source_span: { text: "stack", start: 99, end: 104 } }),
      term(0, "stack", { detection_source: "manifest", quote: "stack" }),
    ];
    expect(analyzeMarkdownTermOccurrences(markdown, terms, "course:stale.md").occurrences).toEqual([]);
  });

  it("pins a manifest without a quote to its numeric span while preserving old text-only candidates", () => {
    const markdown = "stack 和 stack。socket。";
    const terms = [term(0, "stack", { detection_source: "manifest", source_span: { text: "stack", start: 8, end: 13 } }), term(2, "socket")];
    expect(analyzeMarkdownTermOccurrences(markdown, terms, "course:legacy.md").occurrences.map(item => item.absoluteOffset)).toEqual([8, 14]);
  });

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
