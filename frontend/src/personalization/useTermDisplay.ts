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
import type { MarkdownTermAnalysis } from "./termOccurrences";

/** Bumped when annotation rules change so cached decisions can be invalidated. */
export const TERM_ANNOTATION_RULES_VERSION = "manifest-v2";

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

/**
 * Annotation cache identity: document version + tree state version + rules
 * version. A confirmed or withdrawn understanding changes the tree state, so
 * the same body is re-annotated without regenerating the content.
 */
function buildContentRevisionKey(
  sourceKey: string,
  content: string,
  treeStateVersion: number,
): string {
  return [
    sourceKey,
    simpleHash(content),
    `tree:${treeStateVersion}`,
    TERM_ANNOTATION_RULES_VERSION,
  ].join(":");
}

export function createNeutralTermProfile(conceptKey: string): TermPersonalizationProfile {
  return {
    conceptKey,
    manualStatus: null,
    familiarity: "unrecorded",
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
  profileAvailable: boolean;
}): {
  decisions: Map<string, TermDisplayDecision>;
  visibleOccurrences: VisibleTermOccurrence[];
  visibleCandidateIds: Set<string>;
  tiersById: Map<string, TermDisplayTier>;
} {
  const { occurrences, paragraphCount, termProfiles, profileAvailable } = props;

  const preliminary = occurrences.map((occ) =>
    buildPreliminaryTermDecision(
      occ,
      termProfiles.get(occ.conceptKey),
      {},
      { profileAvailable, paragraphCount },
    ),
  );

  const allocations = allocateTermDisplays({
    preliminary,
    paragraphCount,
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
  /** Tree state version; every confirmed or withdrawn understanding bumps it. */
  stateVersion?: number;
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
const EMPTY_PROFILES = new Map<string, TermPersonalizationProfile>();
const EMPTY_MARKDOWN_ANALYSIS: MarkdownTermAnalysis = {
  occurrences: [],
  occurrenceByCandidateId: new Map(),
  paragraphCount: 1,
};

export function useTermDisplay(params: UseTermDisplayParams): UseTermDisplayResult {
  const {
    projectId,
    sourceKey,
    content,
    rawTerms,
    stateVersion = 0,
    profileRevision = 0,
    loadProfiles,
  } = params;

  const [profiles, setProfiles] = useState<Map<string, TermPersonalizationProfile>>(new Map());
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "fallback">("idle");
  const [profileAvailable, setProfileAvailable] = useState(true);
  const revisionRef = useRef("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const revisionKey = buildContentRevisionKey(sourceKey, content, stateVersion);
  const profileRequestRevision = `${revisionKey}:profile:${profileRevision}`;

  // A saved manifest already selected these terms for this body, so a missing
  // or failed profile request never hides them: unknown state is not evidence
  // of either knowing or not knowing a concept.
  useEffect(() => {
    if (projectId == null || !content || rawTerms.length === 0) {
      setProfiles((current) => current.size === 0 ? current : EMPTY_PROFILES);
      setStatus((current) => current === "idle" ? current : "idle");
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
        if (!mountedRef.current || controller.signal.aborted) return;
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
        if (!mountedRef.current || controller.signal.aborted) return;
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
  }, [projectId, profileRequestRevision, content, rawTerms, loadProfiles]);

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

  const [markdownAnalysis, setMarkdownAnalysis] = useState<{
    analysis: MarkdownTermAnalysis;
    failed: boolean;
  }>({
    analysis: EMPTY_MARKDOWN_ANALYSIS,
    failed: false,
  });

  useEffect(() => {
    let cancelled = false;
    if (!content || rawTerms.length === 0) {
      setMarkdownAnalysis((current) => (
        current.analysis === EMPTY_MARKDOWN_ANALYSIS && !current.failed
          ? current
          : { analysis: EMPTY_MARKDOWN_ANALYSIS, failed: false }
      ));
      return;
    }
    void import("./termOccurrences")
      .then(({ analyzeMarkdownTermOccurrences }) => analyzeMarkdownTermOccurrences(content, rawTerms, sourceKey))
      .then((analysis) => { if (!cancelled) setMarkdownAnalysis({ analysis, failed: false }); })
      .catch((error) => {
        console.warn("Term occurrence analysis failed; rendering plain Markdown terms", error);
        if (!cancelled) setMarkdownAnalysis({
          analysis: { occurrences: [], occurrenceByCandidateId: new Map(), paragraphCount: 1 },
          failed: true,
        });
      });
    return () => { cancelled = true; };
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
    if (markdownAnalysis.failed) {
      return {
        decisions: new Map() as ReadonlyMap<string, TermDisplayDecision>,
        visibleOccurrences: [] as VisibleTermOccurrence[],
        visibleCandidateIds: EMPTY_IDS,
        tiersById: EMPTY_TIERS,
      };
    }
    const effectiveProfiles = status === "ready" ? profiles : neutralProfiles;
    return computeTermDisplay({
      occurrences: markdownAnalysis.analysis.occurrences,
      paragraphCount: markdownAnalysis.analysis.paragraphCount,
      termProfiles: effectiveProfiles,
      profileAvailable: status === "ready" && profileAvailable,
    });
  }, [markdownAnalysis, neutralProfiles, profiles, profileAvailable, status]);

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

export type { TermDisplayResult };
