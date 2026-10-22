import type { Plugin } from "unified";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { decodeString } from "micromark-util-decode-string";
import type { DocumentTerm } from "../api/client";
import type { TermCandidateInput } from "./termDisplayTypes";
import { readingBody } from "./teachingMetadata";
import { splitRecordInformation } from "../utils/recordInformation";

type AstNode = {
  type: string;
  value?: string;
  children?: AstNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
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
  absoluteOffset?: number;
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
  node: AstNode & { type: "text" | "inlineCode"; value: string };
  parent: ParentNode;
  childIndex: number;
  nodePath: string;
  context: VisitContext;
}

const BLOCK_TYPES = new Set(["paragraph", "heading", "tableCell"]);
const SKIP_SUBTREE_TYPES = new Set([
  "code",
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

function isManifestTerm(term: DocumentTerm): boolean {
  return term.detection_source === "manifest" || term.detection_source === "teaching_manifest_v2";
}

/** Identifies the exact candidate, including row-less homonyms and aliases. */
export function documentTermKey(term: DocumentTerm): string {
  return JSON.stringify([term.id, term.concept_id, term.term_text, term.source_span, term.quote]);
}

export function prepareTermsForMatching(
  terms: readonly DocumentTerm[],
): DocumentTerm[] {
  return [...terms]
    .filter(
      (term) =>
        (term.status === "candidate" || term.status === "linked") &&
        (term.detection_source === "model" ||
          isManifestTerm(term) ||
          term.link_origin === "manual") &&
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

    if ((node.type === "text" || node.type === "inlineCode") && typeof node.value === "string" && parent) {
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
  if (context.isInsideLink) return "existing_link";
  if (isManifestTerm(term)) return "manifest";
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

type PositionedTerm = { term: DocumentTerm; start: number; end: number };

function positionTerms(markdown: string, terms: readonly DocumentTerm[]) {
  const positioned: PositionedTerm[] = [];
  const legacy: DocumentTerm[] = [];
  for (const term of terms) {
    const span = term.source_span;
    const pinned = isManifestTerm(term) && (term.quote || span?.start != null || span?.end != null);
    if (!pinned) { legacy.push(term); continue; }
    let start = span?.start;
    let end = span?.end;
    if (term.quote) {
      // Quotes are unique in the published body. Re-anchor to that exact context
      // after hidden metadata is removed, also reconciling Python code-point
      // offsets with JavaScript UTF-16 offsets (e.g. emoji before a term).
      const quoteStart = markdown.indexOf(term.quote);
      const inQuote = term.quote.indexOf(term.term_text);
      if (quoteStart < 0 || markdown.indexOf(term.quote, quoteStart + 1) >= 0
        || inQuote < 0 || term.quote.indexOf(term.term_text, inQuote + 1) >= 0) continue;
      start = quoteStart + inQuote;
      end = start + term.term_text.length;
    }
    if (Number.isInteger(start) && Number.isInteger(end) && start! >= 0
      && end! > start! && markdown.slice(start, end) === term.term_text) {
      positioned.push({ term, start: start!, end: end! });
    }
    // A stale or malformed authoritative position must never become a global
    // text match for another same-spelling concept.
  }
  return { positioned, legacy };
}

function matchesForEntry(
  entry: TextNodeEntry, markdown: string, terms: ReturnType<typeof positionTerms>,
): TextTermMatch[] {
  // An inline code span can be a term (e.g. `std::vector`) or a complete
  // statement. Only decorate whole-term spans; do not turn variables or
  // fragments of an example statement into links.
  const candidates = entry.context.isInlineCode
    ? terms.legacy.filter((term) => term.term_text === entry.node.value)
    : terms.legacy;
  const exact: TextTermMatch[] = [];
  const nodeStart = entry.node.position?.start?.offset;
  const nodeEnd = entry.node.position?.end?.offset;
  if (nodeStart != null && nodeEnd != null) {
    const raw = markdown.slice(nodeStart, nodeEnd);
    const delimiter = entry.context.isInlineCode ? /^`+/.exec(raw)?.[0].length ?? 0 : 0;
    const codeBody = delimiter ? raw.slice(delimiter, -delimiter).replace(/\r\n?|\n/g, " ") : "";
    const trimCodeSpace = codeBody.startsWith(" ") && codeBody.endsWith(" ") && /[^ ]/.test(codeBody);
    for (const { term, start, end } of terms.positioned) {
      if (start < nodeStart + delimiter || end > nodeEnd - delimiter) continue;
      const prefix = markdown.slice(nodeStart + delimiter, start);
      const localStart = entry.context.isInlineCode
        ? prefix.replace(/\r\n?|\n/g, " ").length - (trimCodeSpace ? 1 : 0)
        : decodeString(prefix).replace(/\r\n?/g, "\n").length;
      const localEnd = localStart + term.term_text.length;
      if (localStart < 0 || entry.node.value.slice(localStart, localEnd) !== term.term_text
        || !hasValidBoundary(entry.node.value, localStart, term.term_text)
        || (entry.context.isInlineCode && term.term_text !== entry.node.value)) continue;
      if (!exact.some(match => match.localStart < localEnd && match.localEnd > localStart)) {
        exact.push({ term, localStart, localEnd, absoluteOffset: start });
      }
    }
  }
  const fallback = matchTermsInTextNode(entry.node.value, candidates).filter(match =>
    !exact.some(pin => pin.localStart < match.localEnd && pin.localEnd > match.localStart));
  return [...exact, ...fallback].sort((left, right) => left.localStart - right.localStart);
}

export function analyzeMarkdownTermOccurrences(
  markdown: string,
  terms: readonly DocumentTerm[],
  sourceKey: string,
): MarkdownTermAnalysis {
  markdown = readingBody(markdown);
  if (/^(qa|selection_answers):/.test(sourceKey)) markdown = splitRecordInformation(markdown).body;
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as AstNode;
  const orderedTerms = positionTerms(markdown, prepareTermsForMatching(terms));
  const { entries, paragraphCount } = collectTextNodeEntries(tree);
  const occurrences: TermOccurrence[] = [];

  for (const entry of entries) {
    const matches = matchesForEntry(entry, markdown, orderedTerms);
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
        match.absoluteOffset ?? (entry.node.position?.start?.offset ?? 0) + match.localStart;
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
        manualLink: linkOrigin === "manual",
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
        "data-term-key": documentTermKey(match.term),
        // The authoritative identity is the concept, not the text-keyed row id:
        // two concepts may share a spelling and one may have no legacy row (id 0).
        "data-term-concept-id": match.term.concept_id ?? "",
        "data-term-text": match.term.term_text,
        "data-term-link-origin": linkOriginOf(match.term),
        "data-term-status": match.term.status,
      },
    },
  };
}

export const remarkTermOccurrences: Plugin<[RemarkTermOccurrencesOptions]> =
  function remarkTermOccurrencesPlugin(options) {
    return (tree: unknown, file) => {
      try {
        const root = tree as AstNode;
        const terms = prepareTermsForMatching(options?.terms ?? []);
        if (terms.length === 0) return;
        const markdown = String(file.value);
        const orderedTerms = positionTerms(markdown, terms);
        const { entries } = collectTextNodeEntries(root);

        const replacements = entries
          .map((entry) => ({
            entry,
            matches: matchesForEntry(entry, markdown, orderedTerms),
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
          if (entry.context.isInlineCode) {
            entry.parent.children.splice(entry.childIndex, 1, {
              type: "termInlineCode",
              children: nextChildren,
              data: { hName: "code" },
            });
          } else {
            entry.parent.children.splice(entry.childIndex, 1, ...nextChildren);
          }
        }
      } catch (error) {
        // Term links are an enhancement. A malformed term or AST must never
        // prevent the underlying Markdown document from rendering.
        console.warn("Term occurrence rendering failed; using plain Markdown", error);
      }
    };
  };
