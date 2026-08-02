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
import { analyzeMarkdownTermOccurrences } from "./termOccurrences";

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function simpleHash(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
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

function computeTermDisplay(props: {
  occurrences: TermCandidateInput[];
  paragraphCount: number;
  termProfiles: Map<string, TermPersonalizationProfile>;
  terminologyDensity: number;
  profileAvailable: boolean;
}): {
  decisions: Map<string, TermDisplayDecision>;
  visibleOccurrences: VisibleTermOccurrence[];
  visibleCandidateIds: Set<string>;
  tiersById: Map<string, TermDisplayTier>;
} {
  const { occurrences, paragraphCount, termProfiles, terminologyDensity, profileAvailable } = props;

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
  profileRevision?: number;
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
  diagnostics: TermDisplayDiagnostics;
  patchProfile: (conceptKey: string, patch: Partial<TermPersonalizationProfile>) => void;
}

export type TermDisplayDiagnostics = {
  candidateCount: number;
  occurrenceCount: number;
  visibleCount: number;
  reasonCounts: Record<string, number>;
  contentRevision: string;
};

const EMPTY_IDS: ReadonlySet<string> = new Set();
const EMPTY_TIERS: ReadonlyMap<string, TermDisplayTier> = new Map();

export function useTermDisplay(params: UseTermDisplayParams): UseTermDisplayResult {
  const { projectId, sourceKey, content, rawTerms, terminologyDensity, profileRevision = 0, loadProfiles } = params;

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
  const profileRequestRevision = `${revisionKey}:profile:${profileRevision}`;

  useEffect(() => {
    if (projectId == null || !content || rawTerms.length === 0 || terminologyDensity <= 0) {
      setProfiles(new Map());
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    const requestRevision = profileRequestRevision;
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
  }, [projectId, profileRequestRevision, content, rawTerms, terminologyDensity, loadProfiles]);

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

  const markdownAnalysis = useMemo(() => {
    try {
      return {
        analysis: analyzeMarkdownTermOccurrences(content, rawTerms, sourceKey),
        failed: false,
      };
    } catch (error) {
      console.warn("Term occurrence analysis failed; rendering plain Markdown terms", error);
      return {
        analysis: {
          occurrences: [],
          occurrenceByCandidateId: new Map(),
          paragraphCount: 1,
        },
        failed: true,
      };
    }
  }, [content, rawTerms, sourceKey]);

  const neutralProfiles = useMemo(() => {
    const map = new Map<string, TermPersonalizationProfile>();
    for (const occurrence of markdownAnalysis.analysis.occurrences) {
      if (!map.has(occurrence.conceptKey)) {
        map.set(occurrence.conceptKey, createNeutralTermProfile(occurrence.conceptKey));
      }
    }
    return map;
  }, [markdownAnalysis]);

  const computed = useMemo(() => {
    if (
      terminologyDensity <= 0
      || markdownAnalysis.failed
      || status === "idle"
    ) {
      return {
        decisions: new Map() as ReadonlyMap<string, TermDisplayDecision>,
        visibleOccurrences: [] as VisibleTermOccurrence[],
        visibleCandidateIds: EMPTY_IDS,
        tiersById: EMPTY_TIERS,
      };
    }
    const effectiveProfiles =
      status === "ready" ? profiles : neutralProfiles;
    return computeTermDisplay({
      occurrences: markdownAnalysis.analysis.occurrences,
      paragraphCount: markdownAnalysis.analysis.paragraphCount,
      termProfiles: effectiveProfiles,
      terminologyDensity,
      profileAvailable: status === "ready" && profileAvailable,
    });
  }, [markdownAnalysis, neutralProfiles, profiles, terminologyDensity, profileAvailable, status]);

  const diagnostics = useMemo<TermDisplayDiagnostics>(() => {
    const reasonCounts: Record<string, number> = {};
    for (const decision of computed.decisions.values()) {
      reasonCounts[decision.reason] = (reasonCounts[decision.reason] ?? 0) + 1;
    }
    return {
      candidateCount: rawTerms.length,
      occurrenceCount: markdownAnalysis.analysis.occurrences.length,
      visibleCount: computed.visibleOccurrences.length,
      reasonCounts,
      contentRevision: revisionKey,
    };
  }, [computed, markdownAnalysis, rawTerms.length, revisionKey]);

  return {
    visibleCandidateIds: computed.visibleCandidateIds,
    tiersByCandidateId: computed.tiersById,
    visibleOccurrences: computed.visibleOccurrences,
    decisions: computed.decisions,
    profilesByConceptKey: profiles,
    status: markdownAnalysis.failed ? "fallback" : status,
    profileAvailable: !markdownAnalysis.failed && status !== "fallback" && profileAvailable,
    diagnostics,
    patchProfile,
  };
}
