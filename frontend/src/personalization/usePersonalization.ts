/**
 * React hook for personalization state management.
 * Manages concept resolution, mastery batch loading, and feedback operations.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import type { PersonalizationMastery } from "../api/client";
import {
  markConceptKnown,
  markConceptUnknown,
  clearConceptOverride,
  resolvePersonalizationTerms,
} from "../api/client";
import {
  scoreTermLinks,
  selectTopTerms,
} from "./termLinkScorer";
import type { ScoredTerm, TermCandidate } from "./types";
import { getEffectiveMastery } from "./types";
import type { ResolvedConcept } from "./conceptResolver";
import { normalizeTerm } from "./conceptResolver";

// ---- Types ----

export interface PersonalizationState {
  /** Mastery map: conceptId → mastery */
  masteryMap: Map<string, PersonalizationMastery>;
  /** Resolved concepts: normalizedTerm → resolved concept */
  concepts: Map<string, ResolvedConcept>;
  loading: boolean;
  error: string | null;
}

export interface UsePersonalizationReturn extends PersonalizationState {
  /** Resolve a batch of terms to concepts and load their mastery */
  resolveAndLoad: (terms: string[], projectId: number, context?: { symbolHint?: { qualifiedName?: string; filePath?: string } }) => Promise<void>;
  /** Score term candidates using current mastery state */
  scoreTerms: (candidates: TermCandidate[], textLength: number, explorationSeed?: number) => ScoredTerm[];
  /** Mark a concept as known (atomic: event + projection) */
  markKnown: (conceptId: string, projectId: number) => Promise<void>;
  /** Mark a concept as unknown */
  markUnknown: (conceptId: string, projectId: number) => Promise<void>;
  /** Clear manual override */
  clearOverride: (conceptId: string, projectId: number) => Promise<void>;
  /** Get display-optimized mastery for a concept (respects manualStatus) */
  getDisplayMastery: (conceptId: string) => { mastery: number; manualStatus: "known" | "unknown" | null };
  /** Re-score after feedback change */
  rescoreTerms: () => void;
  /** Current scored terms */
  scoredTerms: Map<string, ScoredTerm>;
  /** Top terms for display (after density caps) */
  displayTerms: Map<string, ScoredTerm>;
}

// ---- Hook ----

export function usePersonalization(): UsePersonalizationReturn {
  const [masteryMap, setMasteryMap] = useState<Map<string, PersonalizationMastery>>(new Map());
  const [concepts, setConcepts] = useState<Map<string, ResolvedConcept>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scoredTerms, setScoredTerms] = useState<Map<string, ScoredTerm>>(new Map());
  const [displayTerms, setDisplayTerms] = useState<Map<string, ScoredTerm>>(new Map());

  // Refs for latest candidates/text so rescoreTerms can re-run
  const lastCandidatesRef = useRef<TermCandidate[]>([]);
  const lastTextLengthRef = useRef(0);

  const resolveAndLoad = useCallback(async (
    terms: string[],
    projectId: number,
    context?: { symbolHint?: { qualifiedName?: string; filePath?: string } },
  ) => {
    setLoading(true);
    setError(null);
    try {
      const originals = new Map<string, string>();
      for (const term of terms) {
        const normalized = normalizeTerm(term);
        if (normalized && !originals.has(normalized)) originals.set(normalized, term.trim());
      }
      const existingConcepts = new Map<string, ResolvedConcept>();
      const response = await resolvePersonalizationTerms(
        projectId,
        [...originals.values()].map((text) => ({
          text,
          source: context?.symbolHint ? "index" : "rule",
          confidence: context?.symbolHint ? 0.9 : 0.75,
        })),
      );
      const nextMastery = new Map<string, PersonalizationMastery>();
      for (const item of response.terms) {
        const normalized = normalizeTerm(item.text);
        existingConcepts.set(normalized, {
          conceptId: item.concept.id,
          conceptKey: item.concept.conceptKey,
          canonicalName: item.concept.canonicalName,
          displayName: item.concept.displayName,
          domain: item.concept.domain,
          aliases: item.concept.aliases,
          difficulty: item.concept.difficulty,
          isNew: false,
        });
        if (item.mastery) nextMastery.set(item.concept.id, item.mastery);
      }
      setConcepts((prev) => { const m = new Map(prev); existingConcepts.forEach((v, k) => m.set(k, v)); return m; });

      const conceptIds = [...new Set([...existingConcepts.values()].map((c) => c.conceptId))];
      if (conceptIds.length > 0) {
        setMasteryMap((prev) => {
          const m = new Map(prev);
          nextMastery.forEach((mastery, id) => m.set(id, mastery));
          for (const cid of conceptIds) {
            if (!nextMastery.has(cid)) {
              m.set(cid, {
                id: "", conceptId: cid,
                scope: { type: context?.symbolHint ? "project" : "global", id: context?.symbolHint ? String(projectId) : "local-user" },
                knownEvidence: 1, unknownEvidence: 1,
                mastery: 0.5, uncertainty: 0.7071,
                manualStatus: null, sequence: 0,
                lastSeenAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
              });
            }
          }
          return m;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load personalization");
    } finally {
      setLoading(false);
    }
  }, []);

  const scoreTerms = useCallback((
    candidates: TermCandidate[],
    textLength: number,
    explorationSeed: number = 0,
  ): ScoredTerm[] => {
    lastCandidatesRef.current = candidates;
    lastTextLengthRef.current = textLength;
    const masterySnapshot = new Map<string, import("./types").ConceptMastery>();
    masteryMap.forEach((m, id) => {
      masterySnapshot.set(id, {
        id: m.id,
        conceptId: m.conceptId,
        scope: { type: m.scope.type, id: m.scope.id },
        knownEvidence: m.knownEvidence,
        unknownEvidence: m.unknownEvidence,
        mastery: m.mastery,
        uncertainty: m.uncertainty,
        manualStatus: m.manualStatus,
        sequence: m.sequence,
        lastSeenAt: m.lastSeenAt,
        updatedAt: m.updatedAt,
      });
    });
    const scored = scoreTermLinks(candidates, masterySnapshot, new Date().toISOString(), explorationSeed);
    const top = selectTopTerms(scored, textLength);
    const sMap = new Map<string, ScoredTerm>();
    const dMap = new Map<string, ScoredTerm>();
    for (const s of scored) sMap.set(s.conceptId ?? s.text, s);
    for (const t of top) dMap.set(t.conceptId ?? t.text, t);
    setScoredTerms(sMap);
    setDisplayTerms(dMap);
    return top;
  }, [masteryMap]);

  const markKnown = useCallback(async (conceptId: string, projectId: number) => {
    const key = `mark-known:${projectId}:${conceptId}:${Date.now()}`;
    const result = await markConceptKnown(projectId, conceptId, key);
    setMasteryMap((prev) => { const m = new Map(prev); m.set(conceptId, result.mastery); return m; });
    // Re-score with latest mastery
    if (lastCandidatesRef.current.length > 0) {
      const masterySnapshot = new Map<string, import("./types").ConceptMastery>();
      masteryMap.forEach((v, k) => { masterySnapshot.set(k, { id: v.id, conceptId: v.conceptId, scope: { type: v.scope.type, id: v.scope.id }, knownEvidence: v.knownEvidence, unknownEvidence: v.unknownEvidence, mastery: v.mastery, uncertainty: v.uncertainty, manualStatus: v.manualStatus, sequence: v.sequence, lastSeenAt: v.lastSeenAt, updatedAt: v.updatedAt }); });
      masterySnapshot.set(conceptId, { id: result.mastery.id, conceptId, scope: { type: "project", id: String(projectId) }, knownEvidence: result.mastery.knownEvidence, unknownEvidence: result.mastery.unknownEvidence, mastery: result.mastery.mastery, uncertainty: result.mastery.uncertainty, manualStatus: result.mastery.manualStatus, sequence: result.mastery.sequence, lastSeenAt: result.mastery.lastSeenAt, updatedAt: result.mastery.updatedAt });
      const scored = scoreTermLinks(lastCandidatesRef.current, masterySnapshot, new Date().toISOString(), 0);
      const top = selectTopTerms(scored, lastTextLengthRef.current);
      const sMap = new Map<string, ScoredTerm>();
      const dMap = new Map<string, ScoredTerm>();
      for (const s of scored) sMap.set(s.conceptId ?? s.text, s);
      for (const t of top) dMap.set(t.conceptId ?? t.text, t);
      setScoredTerms(sMap);
      setDisplayTerms(dMap);
    }
  }, [masteryMap]);

  const markUnknown = useCallback(async (conceptId: string, projectId: number) => {
    const key = `mark-unknown:${projectId}:${conceptId}:${Date.now()}`;
    const result = await markConceptUnknown(projectId, conceptId, key);
    setMasteryMap((prev) => { const m = new Map(prev); m.set(conceptId, result.mastery); return m; });
    if (lastCandidatesRef.current.length > 0) {
      const m2 = new Map(masteryMap);
      m2.set(conceptId, result.mastery);
      const masterySnapshot = new Map<string, import("./types").ConceptMastery>();
      m2.forEach((v, k) => { masterySnapshot.set(k, { id: v.id, conceptId: v.conceptId, scope: { type: v.scope.type, id: v.scope.id }, knownEvidence: v.knownEvidence, unknownEvidence: v.unknownEvidence, mastery: v.mastery, uncertainty: v.uncertainty, manualStatus: v.manualStatus, sequence: v.sequence, lastSeenAt: v.lastSeenAt, updatedAt: v.updatedAt }); });
      const scored = scoreTermLinks(lastCandidatesRef.current, masterySnapshot, new Date().toISOString(), 0);
      const top = selectTopTerms(scored, lastTextLengthRef.current);
      const sMap = new Map<string, ScoredTerm>();
      const dMap = new Map<string, ScoredTerm>();
      for (const s of scored) sMap.set(s.conceptId ?? s.text, s);
      for (const t of top) dMap.set(t.conceptId ?? t.text, t);
      setScoredTerms(sMap);
      setDisplayTerms(dMap);
    }
  }, [masteryMap]);

  const clearOverride = useCallback(async (conceptId: string, projectId: number) => {
    const key = `clear-override:${projectId}:${conceptId}:${Date.now()}`;
    const result = await clearConceptOverride(projectId, conceptId, key);
    setMasteryMap((prev) => { const m = new Map(prev); m.set(conceptId, result.mastery); return m; });
    if (lastCandidatesRef.current.length > 0) {
      const m2 = new Map(masteryMap);
      m2.set(conceptId, result.mastery);
      const masterySnapshot = new Map<string, import("./types").ConceptMastery>();
      m2.forEach((v, k) => { masterySnapshot.set(k, { id: v.id, conceptId: v.conceptId, scope: { type: v.scope.type, id: v.scope.id }, knownEvidence: v.knownEvidence, unknownEvidence: v.unknownEvidence, mastery: v.mastery, uncertainty: v.uncertainty, manualStatus: v.manualStatus, sequence: v.sequence, lastSeenAt: v.lastSeenAt, updatedAt: v.updatedAt }); });
      const scored = scoreTermLinks(lastCandidatesRef.current, masterySnapshot, new Date().toISOString(), 0);
      const top = selectTopTerms(scored, lastTextLengthRef.current);
      const sMap = new Map<string, ScoredTerm>();
      const dMap = new Map<string, ScoredTerm>();
      for (const s of scored) sMap.set(s.conceptId ?? s.text, s);
      for (const t of top) dMap.set(t.conceptId ?? t.text, t);
      setScoredTerms(sMap);
      setDisplayTerms(dMap);
    }
  }, [masteryMap]);

  const rescoreTerms = useCallback(() => {
    if (lastCandidatesRef.current.length > 0) {
      scoreTerms(lastCandidatesRef.current, lastTextLengthRef.current, 0);
    }
  }, [scoreTerms]);

  const getDisplayMastery = useCallback((conceptId: string) => {
    const m = masteryMap.get(conceptId);
    if (!m) return { mastery: 0.5, manualStatus: null as "known" | "unknown" | null };
    return { mastery: getEffectiveMastery({ id: m.id, conceptId: m.conceptId, scope: { type: m.scope.type, id: m.scope.id }, knownEvidence: m.knownEvidence, unknownEvidence: m.unknownEvidence, mastery: m.mastery, uncertainty: m.uncertainty, manualStatus: m.manualStatus, sequence: m.sequence, lastSeenAt: m.lastSeenAt, updatedAt: m.updatedAt }).mastery, manualStatus: m.manualStatus };
  }, [masteryMap]);

  return {
    masteryMap, concepts, loading, error,
    resolveAndLoad, scoreTerms, markKnown, markUnknown, clearOverride,
    getDisplayMastery, rescoreTerms, scoredTerms, displayTerms,
  };
}
