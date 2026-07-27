import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentTerm } from "../api/client";
import type {
  TermCandidateInput,
  TermPersonalizationProfile,
  TermDisplayDecision,
  TermDisplayResult,
  TermDisplayTier,
  VisibleTermOccurrence,
} from "./termDisplayTypes";
import { buildPreliminaryTermDecision } from "./termDisplayDecision";
import { allocateTermDisplays } from "./termDisplayAllocator";
import { candidateIdForRendering } from "./termOccurrences";

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function stableParagraphId(sourcePath: string, paraIndex: number): string {
  return `${sourcePath || "doc"}:p${paraIndex}`;
}

function simpleHash(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildContentRevisionKey(sourceKey: string, content: string): string {
  return `${sourceKey}:${simpleHash(content)}`;
}

export function createNeutralTermProfile(conceptKey: string): TermPersonalizationProfile {
  return {
    conceptKey,
    manualStatus: null,
    mastery: null,
    uncertainty: null,
    shadowFamiliarity: null,
    shadowConfidence: null,
    shadowEvidenceCount: 0,
    domainPrior: null,
  };
}

function isLikelyNoise(
  candidate: TermCandidateInput,
  content: string,
): boolean {
  const text = candidate.normalizedText.trim();
  if (!text) return true;
  if (candidate.isInCodeBlock) return true;
  if (candidate.isInHeading) return true;
  if (candidate.isInTable) return true;
  if (/^[\d\s.,;:!?()[\]{}'"`~\-_/\\]+$/.test(text)) return true;
  if (text.length > 64) return true;
  if (text.length <= 2 && candidate.source !== "code_symbol" && candidate.source !== "inline_code") {
    return true;
  }
  return false;
}

function buildOccurrences(
  content: string,
  terms: DocumentTerm[],
  sourcePath: string,
): TermCandidateInput[] {
  const paragraphs = content.split(/\n\n+/);
  const result: TermCandidateInput[] = [];
  let globalIndex = 0;
  const usedRanges = new Set<string>();

  const filtered = terms.filter((t) => t.status === "candidate" || t.status === "linked");
  const sorted = [...filtered].sort((a, b) => (b.term_text?.length || 0) - (a.term_text?.length || 0));

  let globalOffset = 0;
  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi];
    const paraOffset = globalOffset;
    const paraId = stableParagraphId(sourcePath, pi);
    const matchCountInPara = new Map<string, number>();

    for (const term of sorted) {
      const searchText = term.term_text || "";
      if (!searchText) continue;
      let searchFrom = 0;
      while (searchFrom < para.length) {
        const idx = para.indexOf(searchText, searchFrom);
        if (idx < 0) break;

        const absStart = paraOffset + idx;
        const rangeKey = `${pi}:${absStart}:${searchText.length}`;
        const overlapping = [...usedRanges].some((r) => {
          const parts = r.split(":").map(Number);
          if (parts[0] !== pi) return false;
          return absStart < parts[1] + parts[2] && absStart + searchText.length > parts[1];
        });
        if (overlapping) {
          searchFrom = idx + 1;
          continue;
        }
        usedRanges.add(rangeKey);

        const prevCount = matchCountInPara.get(searchText) || 0;
        matchCountInPara.set(searchText, prevCount + 1);

        result.push({
          candidateId: candidateIdForRendering(String(term.id), para, prevCount),
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
          isInHeading: false,
          isInCodeBlock: false,
          isInlineCode: false,
          isInTable: false,
          manualLink: (term.link_origin ?? "legacy_unknown") === "manual",
        });
        globalIndex++;
        searchFrom = idx + searchText.length;
      }
    }
    globalOffset += para.length + 2;
  }

  return result;
}

function computeTermDisplay(props: {
  content: string;
  documentTerms: DocumentTerm[];
  sourcePath: string;
  termProfiles: Map<string, TermPersonalizationProfile>;
  terminologyDensity: number;
  profileAvailable: boolean;
}): {
  decisions: Map<string, TermDisplayDecision>;
  visibleOccurrences: VisibleTermOccurrence[];
  visibleCandidateIds: Set<string>;
  tiersById: Map<string, TermDisplayTier>;
} {
  const { content, documentTerms, sourcePath, termProfiles, terminologyDensity, profileAvailable } = props;
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
  const tiersById = new Map<string, TermDisplayTier>();

  for (let i = 0; i < allocations.length; i++) {
    const d = allocations[i];
    const occ = occurrences[i];
    decisions.set(d.candidateId, d);
    tiersById.set(d.candidateId, d.tier);

    if (d.visible) {
      visibleCandidateIds.add(d.candidateId);
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

  return { decisions, visibleOccurrences, visibleCandidateIds, tiersById };
}

export interface UseTermDisplayParams {
  projectId: number | null;
  sourceKey: string;
  content: string;
  rawTerms: DocumentTerm[];
  terminologyDensity: number;
  loadProfiles: (
    projectId: number,
    conceptKeys: string[],
    signal?: AbortSignal,
  ) => Promise<TermPersonalizationProfile[]>;
}

export interface UseTermDisplayResult {
  visibleCandidateIds: ReadonlySet<string>;
  tiersByCandidateId: ReadonlyMap<string, TermDisplayTier>;
  visibleOccurrences: VisibleTermOccurrence[];
  decisions: ReadonlyMap<string, TermDisplayDecision>;
  profilesByConceptKey: ReadonlyMap<string, TermPersonalizationProfile>;
  status: "idle" | "loading" | "ready" | "fallback";
  profileAvailable: boolean;
  patchProfile: (conceptKey: string, patch: Partial<TermPersonalizationProfile>) => void;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();
const EMPTY_TIERS: ReadonlyMap<string, TermDisplayTier> = new Map();

export function useTermDisplay(params: UseTermDisplayParams): UseTermDisplayResult {
  const { projectId, sourceKey, content, rawTerms, terminologyDensity, loadProfiles } = params;

  const [profiles, setProfiles] = useState<Map<string, TermPersonalizationProfile>>(new Map());
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "fallback">("idle");
  const [profileAvailable, setProfileAvailable] = useState(true);
  const revisionRef = useRef("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const revisionKey = buildContentRevisionKey(sourceKey, content);

  useEffect(() => {
    if (projectId == null || !content || rawTerms.length === 0) {
      setProfiles(new Map());
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    const requestRevision = revisionKey;
    revisionRef.current = requestRevision;

    const conceptKeys = [...new Set(rawTerms.map((t) => t.concept_id || `term:${normalizeText(t.term_text || "")}`).filter(Boolean))];

    if (conceptKeys.length === 0) {
      setStatus("ready");
      return;
    }

    setStatus("loading");
    void loadProfiles(projectId, conceptKeys, controller.signal)
      .then((loaded) => {
        if (!mountedRef.current) return;
        if (revisionRef.current !== requestRevision) return;

        const map = new Map<string, TermPersonalizationProfile>();
        for (const ck of conceptKeys) {
          map.set(ck, createNeutralTermProfile(ck));
        }
        for (const p of loaded) {
          map.set(p.conceptKey, p);
        }
        setProfiles(map);
        setProfileAvailable(true);
        setStatus("ready");
      })
      .catch(() => {
        if (!mountedRef.current) return;
        if (revisionRef.current !== requestRevision) return;

        const map = new Map<string, TermPersonalizationProfile>();
        for (const ck of conceptKeys) {
          map.set(ck, createNeutralTermProfile(ck));
        }
        setProfiles(map);
        setProfileAvailable(false);
        setStatus("fallback");
      });

    return () => {
      controller.abort();
    };
  }, [projectId, revisionKey, content, rawTerms, loadProfiles]);

  const patchProfile = useCallback(
    (conceptKey: string, patch: Partial<TermPersonalizationProfile>) => {
      setProfiles((prev) => {
        const next = new Map(prev);
        const existing = next.get(conceptKey) || createNeutralTermProfile(conceptKey);
        next.set(conceptKey, { ...existing, ...patch });
        return next;
      });
    },
    [],
  );

  const computed = useMemo(() => {
    if (status === "idle" || status === "loading") {
      return {
        decisions: new Map() as ReadonlyMap<string, TermDisplayDecision>,
        visibleOccurrences: [] as VisibleTermOccurrence[],
        visibleCandidateIds: EMPTY_IDS,
        tiersById: EMPTY_TIERS,
      };
    }
    return computeTermDisplay({
      content,
      documentTerms: rawTerms,
      sourcePath: sourceKey,
      termProfiles: profiles,
      terminologyDensity,
      profileAvailable: status !== "fallback" && profileAvailable,
    });
  }, [content, rawTerms, sourceKey, profiles, terminologyDensity, profileAvailable, status]);

  return {
    visibleCandidateIds: computed.visibleCandidateIds,
    tiersByCandidateId: computed.tiersById,
    visibleOccurrences: computed.visibleOccurrences,
    decisions: computed.decisions,
    profilesByConceptKey: profiles,
    status,
    profileAvailable: status !== "fallback" && profileAvailable,
    patchProfile,
  };
}
