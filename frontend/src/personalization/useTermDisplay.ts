import { useCallback, useMemo, useRef } from "react";
import type { DocumentTerm } from "../api/client";
import type {
  TermCandidateInput,
  TermPersonalizationProfile,
  TermDisplayDecision,
  TermDisplayResult,
  VisibleTermOccurrence,
} from "./termDisplayTypes";
import { buildPreliminaryTermDecision } from "./termDisplayDecision";
import { allocateTermDisplays } from "./termDisplayAllocator";

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function stableParagraphId(sourcePath: string, paraIndex: number): string {
  return `${sourcePath || "doc"}:p${paraIndex}`;
}

function isInsideCodeBlock(text: string, start: number): boolean {
  const before = text.substring(0, start);
  const ticks = before.split("```");
  return ticks.length % 2 === 0;
}

function isInsideLink(text: string, start: number): boolean {
  const before = text.substring(0, start);
  const openBrackets = (before.match(/\[/g) || []).length;
  const closeBrackets = (before.match(/\]/g) || []).length;
  return openBrackets > closeBrackets;
}

function isInsideHeading(text: string, start: number): boolean {
  const lineStart = text.lastIndexOf("\n", start) + 1;
  const line = text.substring(lineStart, start);
  return /^#{1,6}\s/.test(line);
}

function isInsideTable(text: string, start: number): boolean {
  const before = text.substring(0, start);
  const pipes = (before.match(/^\|/gm) || []).length;
  return pipes > 0 && before.includes("|");
}

function buildOccurrences(
  content: string,
  terms: DocumentTerm[],
  sourcePath: string,
): TermCandidateInput[] {
  const paragraphs = content.split(/\n\n+/);
  const result: TermCandidateInput[] = [];
  let globalIndex = 0;

  const filtered = terms.filter(
    (t) => t.status === "candidate" || t.status === "linked",
  );

  const sorted = [...filtered].sort(
    (a, b) => (b.term_text?.length || 0) - (a.term_text?.length || 0),
  );

  const usedRanges = new Set<string>();

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi];
    const paraId = stableParagraphId(sourcePath, pi);

    for (const term of sorted) {
      const searchText = term.term_text || "";
      if (!searchText || searchText.length < 1) continue;

      let searchFrom = 0;
      while (searchFrom < para.length) {
        const idx = para.indexOf(searchText, searchFrom);
        if (idx < 0) break;

        const rangeKey = `${pi}:${idx}:${searchText.length}`;
        const overlapping = [...usedRanges].some((r) => {
          const [rp, rs, rl] = r.split(":").map(Number);
          return rp === pi && idx < rs + rl && idx + searchText.length > rs;
        });

        if (!overlapping) {
          usedRanges.add(rangeKey);

          const termInCode = isInsideCodeBlock(content, content.indexOf(para) + idx);
          const isInlineCodeMatch = /`[^`]*`/.test(
            para.substring(Math.max(0, idx - 1), idx + searchText.length + 1),
          );
          const termInLink = isInsideLink(content, content.indexOf(para) + idx);
          const termInHeading = isInsideHeading(content, content.indexOf(para) + idx);
          const termInTable = isInsideTable(content, content.indexOf(para) + idx);

          result.push({
            candidateId: `term:${term.id}:${pi}:${idx}`,
            text: searchText,
            normalizedText: normalizeText(searchText),
            conceptKey: term.concept_id || `term:${normalizeText(searchText)}`,
            conceptName: searchText,
            paragraphId: paraId,
            occurrenceIndex: globalIndex,
            source: term.detection_source === "model"
              ? "model"
              : term.detection_source === "index"
                ? "code_symbol"
                : "unknown",
            sourceConfidence: term.confidence || 0.5,
            contextRelevance: Math.max(0.45, term.confidence || 0.5),
            difficulty: 0.5,
            isInHeading: termInHeading,
            isInCodeBlock: termInCode,
            isInlineCode: isInlineCodeMatch,
            isInTable: termInTable,
            manualLink: term.status === "linked",
          });
          globalIndex++;
        }

        searchFrom = idx + searchText.length;
        if (searchText.length === 0) break;
      }
    }
  }

  return result;
}

export interface UseTermDisplayProps {
  content: string;
  documentTerms: DocumentTerm[];
  sourcePath: string;
  termProfiles: Map<string, TermPersonalizationProfile>;
  terminologyDensity: number;
  profileAvailable: boolean;
}

export interface UseTermDisplayResult {
  decisions: Map<string, TermDisplayDecision>;
  visibleOccurrences: VisibleTermOccurrence[];
  occurrences: TermCandidateInput[];
  visibleCandidateIds: Set<string>;
}

export function computeTermDisplay(props: UseTermDisplayProps): UseTermDisplayResult {
  const {
    content,
    documentTerms,
    sourcePath,
    termProfiles,
    terminologyDensity,
    profileAvailable,
  } = props;

  const occurrences = buildOccurrences(content, documentTerms, sourcePath);

  const paragraphCount = Math.max(1, content.split(/\n\n+/).length);

  const preliminary = occurrences.map((occ) =>
    buildPreliminaryTermDecision(
      occ,
      termProfiles.get(occ.conceptKey),
      { terminologyDensity },
      { profileAvailable, paragraphCount },
    ),
  );

  const allocations = allocateTermDisplays({
    preliminary,
    paragraphCount,
    terminologyDensity,
    profileAvailable,
  });

  const decisions = new Map<string, TermDisplayDecision>();
  const visibleOccurrences: VisibleTermOccurrence[] = [];
  const visibleCandidateIds = new Set<string>();

  for (let i = 0; i < allocations.length; i++) {
    const d = allocations[i];
    const occ = occurrences[i];
    decisions.set(d.candidateId, d);

    if (d.visible) {
      visibleCandidateIds.add(occ.candidateId);
      visibleOccurrences.push({
        candidateId: d.candidateId,
        conceptKey: d.conceptKey,
        conceptName: occ.conceptName,
        paragraphId: d.paragraphId,
        text: occ.text,
        tier: d.tier,
      });
    }
  }

  return {
    decisions,
    visibleOccurrences,
    occurrences,
    visibleCandidateIds,
  };
}
