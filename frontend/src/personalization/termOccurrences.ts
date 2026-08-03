import type { Plugin } from "unified";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { DocumentTerm } from "../api/client";
import type { TermCandidateInput } from "./termDisplayTypes";

type AstNode = {
  type: string;
  value?: string;
  children?: AstNode[];
  position?: {
    start?: { offset?: number };
  };
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
};

type ParentNode = AstNode & { children: AstNode[] };

export interface TermOccurrence extends TermCandidateInput {
  termId: string;
  termText: string;
  nodePath: string;
  localStart: number;
  localEnd: number;
  absoluteOffset: number;
  linkOrigin: "manual" | "automatic" | "legacy_unknown";
  status: DocumentTerm["status"];
}

export interface MarkdownTermAnalysis {
  occurrences: TermOccurrence[];
  occurrenceByCandidateId: ReadonlyMap<string, TermOccurrence>;
  paragraphCount: number;
}

export interface TextTermMatch {
  term: DocumentTerm;
  localStart: number;
  localEnd: number;
}

export interface RemarkTermOccurrencesOptions {
  sourceKey: string;
  terms: readonly DocumentTerm[];
}

interface VisitContext {
  isInHeading: boolean;
  isInCodeBlock: boolean;
  isInlineCode: boolean;
  isInTable: boolean;
  isInsideLink: boolean;
  paragraphIndex: number | null;
}

interface TextNodeEntry {
  node: AstNode & { type: "text"; value: string };
  parent: ParentNode;
  childIndex: number;
  nodePath: string;
  context: VisitContext;
}

const BLOCK_TYPES = new Set(["paragraph", "heading", "tableCell"]);
const SKIP_SUBTREE_TYPES = new Set([
  "code",
  "inlineCode",
  "html",
  "link",
  "linkReference",
  "definition",
]);

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function simpleHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildTermCandidateId(input: {
  termId: string;
  sourceKey: string;
  nodePath: string;
  localStart: number;
}): string {
  return [
    "term",
    encodeURIComponent(input.termId),
    "doc",
    simpleHash(input.sourceKey || "document"),
    "node",
    input.nodePath,
    "offset",
    String(input.localStart),
  ].join(":");
}

function isAsciiIdentifierChar(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_]/.test(value));
}

function needsAsciiBoundary(term: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.:#<>+\-]*$/.test(term);
}

function hasValidBoundary(text: string, start: number, term: string): boolean {
  if (!needsAsciiBoundary(term)) {
    return true;
  }
  const before = start > 0 ? text[start - 1] : undefined;
  const afterIndex = start + term.length;
  const after = afterIndex < text.length ? text[afterIndex] : undefined;
  return !isAsciiIdentifierChar(before) && !isAsciiIdentifierChar(after);
}

export function prepareTermsForMatching(
  terms: readonly DocumentTerm[],
): DocumentTerm[] {
  return [...terms]
    .filter(
      (term) =>
        (term.status === "candidate" || term.status === "linked") &&
        Boolean(term.term_text?.trim()),
    )
    .sort(
      (left, right) =>
        right.term_text.length - left.term_text.length ||
        String(left.id).localeCompare(String(right.id)),
    );
}

export function matchTermsInTextNode(
  text: string,
  orderedTerms: readonly DocumentTerm[],
): TextTermMatch[] {
  const matches: TextTermMatch[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const term = orderedTerms.find((candidate) => {
      const value = candidate.term_text;
      return (
        value.length > 0 &&
        text.startsWith(value, cursor) &&
        hasValidBoundary(text, cursor, value)
      );
    });

    if (!term) {
      cursor += 1;
      continue;
    }

    matches.push({
      term,
      localStart: cursor,
      localEnd: cursor + term.term_text.length,
    });
    cursor += term.term_text.length;
  }

  return matches;
}

function collectTextNodeEntries(root: AstNode): {
  entries: TextNodeEntry[];
  paragraphCount: number;
} {
  const entries: TextNodeEntry[] = [];
  let nextParagraphIndex = 0;

  const visit = (
    node: AstNode,
    parent: ParentNode | null,
    childIndex: number,
    path: number[],
    incoming: VisitContext,
  ): void => {
    const context: VisitContext = {
      ...incoming,
      isInHeading: incoming.isInHeading || node.type === "heading",
      isInCodeBlock: incoming.isInCodeBlock || node.type === "code",
      isInlineCode: incoming.isInlineCode || node.type === "inlineCode",
      isInTable:
        incoming.isInTable ||
        node.type === "table" ||
        node.type === "tableRow" ||
        node.type === "tableCell",
      isInsideLink:
        incoming.isInsideLink ||
        node.type === "link" ||
        node.type === "linkReference",
      paragraphIndex: incoming.paragraphIndex,
    };

    if (BLOCK_TYPES.has(node.type)) {
      context.paragraphIndex = nextParagraphIndex;
      nextParagraphIndex += 1;
    }

    if (node.type === "text" && typeof node.value === "string" && parent) {
      if (context.paragraphIndex == null) {
        context.paragraphIndex = nextParagraphIndex;
        nextParagraphIndex += 1;
      }
      entries.push({
        node: node as TextNodeEntry["node"],
        parent,
        childIndex,
        nodePath: path.join("."),
        context,
      });
      return;
    }

    if (SKIP_SUBTREE_TYPES.has(node.type)) {
      return;
    }

    if (!Array.isArray(node.children)) {
      return;
    }

    node.children.forEach((child, index) => {
      visit(
        child,
        node as ParentNode,
        index,
        [...path, index],
        context,
      );
    });
  };

  visit(
    root,
    null,
    0,
    [],
    {
      isInHeading: false,
      isInCodeBlock: false,
      isInlineCode: false,
      isInTable: false,
      isInsideLink: false,
      paragraphIndex: null,
    },
  );

  return {
    entries,
    paragraphCount: Math.max(1, nextParagraphIndex),
  };
}

function sourceForOccurrence(
  term: DocumentTerm,
  context: VisitContext,
): TermCandidateInput["source"] {
  if (context.isInHeading) return "heading";
  if (context.isInsideLink) return "existing_link";
  if (context.isInlineCode) return "inline_code";
  if (term.detection_source === "model") return "model";
  if (term.detection_source === "index") return "code_symbol";
  return "unknown";
}

function linkOriginOf(
  term: DocumentTerm,
): TermOccurrence["linkOrigin"] {
  const value = term.link_origin ?? "legacy_unknown";
  return value === "manual" || value === "automatic"
    ? value
    : "legacy_unknown";
}

export function analyzeMarkdownTermOccurrences(
  markdown: string,
  terms: readonly DocumentTerm[],
  sourceKey: string,
): MarkdownTermAnalysis {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as AstNode;
  const orderedTerms = prepareTermsForMatching(terms);
  const { entries, paragraphCount } = collectTextNodeEntries(tree);
  const occurrences: TermOccurrence[] = [];

  for (const entry of entries) {
    const matches = matchTermsInTextNode(entry.node.value, orderedTerms);
    for (const match of matches) {
      const paragraphIndex = entry.context.paragraphIndex ?? 0;
      const termId = String(match.term.id);
      const linkOrigin = linkOriginOf(match.term);
      const candidateId = buildTermCandidateId({
        termId,
        sourceKey,
        nodePath: entry.nodePath,
        localStart: match.localStart,
      });
      const absoluteOffset =
        (entry.node.position?.start?.offset ?? 0) + match.localStart;
      const normalized = normalizeText(match.term.term_text);

      occurrences.push({
        candidateId,
        termId,
        termText: match.term.term_text,
        nodePath: entry.nodePath,
        localStart: match.localStart,
        localEnd: match.localEnd,
        absoluteOffset,
        linkOrigin,
        status: match.term.status,
        text: match.term.term_text,
        normalizedText: normalized,
        conceptKey:
          match.term.concept_id || `term:${normalized}`,
        conceptName: match.term.term_text,
        paragraphId: `${sourceKey || "doc"}:p${paragraphIndex}`,
        occurrenceIndex: occurrences.length,
        source: sourceForOccurrence(match.term, entry.context),
        sourceConfidence: match.term.confidence || 0.5,
        contextRelevance: Math.max(0.45, match.term.confidence || 0.5),
        difficulty: 0.5,
        isInHeading: entry.context.isInHeading,
        isInCodeBlock: entry.context.isInCodeBlock,
        isInlineCode: entry.context.isInlineCode,
        isInTable: entry.context.isInTable,
        manualLink: linkOrigin === "manual" || match.term.status === "linked",
      });
    }
  }

  return {
    occurrences,
    occurrenceByCandidateId: new Map(
      occurrences.map((occurrence) => [occurrence.candidateId, occurrence]),
    ),
    paragraphCount,
  };
}

function occurrenceNode(
  sourceKey: string,
  entry: TextNodeEntry,
  match: TextTermMatch,
): AstNode {
  const termId = String(match.term.id);
  const candidateId = buildTermCandidateId({
    termId,
    sourceKey,
    nodePath: entry.nodePath,
    localStart: match.localStart,
  });

  return {
    type: "termOccurrence",
    value: match.term.term_text,
    // remark-rehype maps data.hName to an element whose children come from
    // node.children; without a text child the term span renders empty.
    children: [{ type: "text", value: match.term.term_text }],
    data: {
      hName: "span",
      hProperties: {
        "data-term-candidate-id": candidateId,
        "data-term-id": termId,
        "data-term-text": match.term.term_text,
        "data-term-link-origin": linkOriginOf(match.term),
        "data-term-status": match.term.status,
      },
    },
  };
}

export const remarkTermOccurrences: Plugin<[RemarkTermOccurrencesOptions]> =
  function remarkTermOccurrencesPlugin(options) {
    return (tree: unknown) => {
      try {
        const root = tree as AstNode;
        const orderedTerms = prepareTermsForMatching(options?.terms ?? []);
        if (orderedTerms.length === 0) return;
        const { entries } = collectTextNodeEntries(root);

        const replacements = entries
          .map((entry) => ({
            entry,
            matches: matchTermsInTextNode(entry.node.value, orderedTerms),
          }))
          .filter((item) => item.matches.length > 0)
          .sort((left, right) => {
            if (left.entry.parent === right.entry.parent) {
              return right.entry.childIndex - left.entry.childIndex;
            }
            return right.entry.nodePath.localeCompare(left.entry.nodePath, undefined, {
              numeric: true,
            });
          });

        for (const { entry, matches } of replacements) {
          const nextChildren: AstNode[] = [];
          let cursor = 0;
          for (const match of matches) {
            if (match.localStart > cursor) {
              nextChildren.push({
                type: "text",
                value: entry.node.value.slice(cursor, match.localStart),
              });
            }
            nextChildren.push(occurrenceNode(options?.sourceKey ?? "document", entry, match));
            cursor = match.localEnd;
          }
          if (cursor < entry.node.value.length) {
            nextChildren.push({
              type: "text",
              value: entry.node.value.slice(cursor),
            });
          }
          entry.parent.children.splice(entry.childIndex, 1, ...nextChildren);
        }
      } catch (error) {
        // Term links are an enhancement. A malformed term or AST must never
        // prevent the underlying Markdown document from rendering.
        console.warn("Term occurrence rendering failed; using plain Markdown", error);
      }
    };
  };
