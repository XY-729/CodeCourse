/**
 * React hook for personalization state management.
 * Manages concept resolution, mastery batch loading, and feedback operations.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import type { PersonalizationMastery, PersonalizationConcept } from "../api/client";
import {
  listConcepts,
  createConcept,
  getMasteryBatch,
  markConceptKnown,
  markConceptUnknown,
  clearConceptOverride,
} from "../api/client";
import {
  scoreTermLinks,
  selectTopTerms,
} from "./termLinkScorer";
import type { ScoredTerm, TermCandidate } from "./types";
import { getEffectiveMastery } from "./types";
import type { ResolvedConcept } from "./conceptResolver";
import { normalizeTerm, globalConceptKey, projectConceptKey, buildConceptKey, guessDomain } from "./conceptResolver";

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
      const deduped = [...new Set(terms.map((t) => normalizeTerm(t)))].filter(Boolean);

      // 1. Search existing concepts by name
      const existingConcepts = new Map<string, ResolvedConcept>();
      for (const term of deduped) {
        try {
          const domain = guessDomain(term, { projectId, ...context });
          const globalKey = buildConceptKey("global", domain, term);
          // Try listing concepts matching this term
          const results: PersonalizationConcept[] = await listConcepts(projectId, term);
          const match = results.find(
            (c) => c.canonicalName.toLowerCase() === term.toLowerCase() ||
                   c.aliases.some((a) => a.toLowerCase() === term.toLowerCase()),
          );
          if (match) {
            existingConcepts.set(term, {
              conceptId: match.id,
              conceptKey: match.conceptKey,
              canonicalName: match.canonicalName,
              displayName: match.displayName,
              domain: match.domain,
              aliases: match.aliases,
              difficulty: match.difficulty,
              isNew: false,
            });
          } else {
            // 2. Create new concept (idempotent)
            const key = context?.symbolHint
              ? projectConceptKey(term, { projectId, symbolHint: context.symbolHint })
              : globalKey;
            const created = await createConcept(projectId, {
              conceptKey: key,
              canonicalName: term,
              displayName: term,
              domain,
              aliases: [],
              difficulty: 0.5,
            });
            existingConcepts.set(term, {
              conceptId: created.id,
              conceptKey: created.conceptKey,
              canonicalName: created.canonicalName,
              displayName: created.displayName,
              domain: created.domain,
              aliases: created.aliases,
              difficulty: created.difficulty,
              isNew: true,
            });
          }
        } catch {
          // Skip failed resolutions
        }
      }
      setConcepts((prev) => { const m = new Map(prev); existingConcepts.forEach((v, k) => m.set(k, v)); return m; });

      // 3. Batch load mastery
      const conceptIds = [...new Set([...existingConcepts.values()].map((c) => c.conceptId))];
      if (conceptIds.length > 0) {
        const batch = await getMasteryBatch(projectId, conceptIds);
        setMasteryMap((prev) => {
          const m = new Map(prev);
          for (const [id, mastery] of Object.entries(batch)) {
            m.set(id, mastery);
          }
          // Fill missing with neutral
          for (const cid of conceptIds) {
            if (!batch[cid]) {
              m.set(cid, {
                id: "", conceptId: cid,
                scope: { type: "project", id: String(projectId) },
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
