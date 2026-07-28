import type {
  PreliminaryTermDecision,
  TermCandidateInput,
  TermDisplayContext,
  TermDisplayPreferences,
  TermPersonalizationProfile,
} from "./termDisplayTypes";

const MIN_SOURCE_CONFIDENCE = 0.48;
const MIN_CONTEXT_RELEVANCE = 0.34;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizedDensity(value: number): number {
  return clamp01(Number.isFinite(value) ? value : 0.5);
}

function stableUnitInterval(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

function isLikelyNoise(candidate: TermCandidateInput): boolean {
  const text = candidate.normalizedText.trim();
  if (!text) return true;
  if (candidate.isInCodeBlock) return true;
  if (candidate.isInHeading) return true;
  if (candidate.isInTable) return true;
  if (/^[\d\s.,;:!?()[\]{}'"`~\-_/\\]+$/.test(text)) return true;
  if (text.length > 64) return true;
  if (
    text.length <= 2 &&
    candidate.source !== "code_symbol" &&
    candidate.source !== "inline_code"
  ) {
    return true;
  }
  return false;
}

function getAutomaticUnfamiliarity(
  profile: TermPersonalizationProfile | undefined,
): { value: number; usedShadow: boolean } {
  if (!profile) {
    return { value: 0.5, usedShadow: false };
  }
  let unfamiliarity = profile.mastery == null ? 0.5 : clamp01(1 - profile.mastery);
  let usedShadow = false;

  if (
    profile.shadowFamiliarity != null &&
    profile.shadowConfidence != null &&
    profile.shadowConfidence >= 0.12 &&
    profile.shadowEvidenceCount >= 2
  ) {
    const shadowUnfamiliarity = clamp01(1 - profile.shadowFamiliarity);
    const shadowWeight = Math.min(0.35, profile.shadowConfidence * 0.35);
    unfamiliarity = unfamiliarity * (1 - shadowWeight) + shadowUnfamiliarity * shadowWeight;
    usedShadow = true;
  }

  if (profile.domainPrior != null) {
    const priorAdjustment = (clamp01(profile.domainPrior) - 0.5) * 0.12;
    unfamiliarity = clamp01(unfamiliarity - priorAdjustment);
  }

  return { value: clamp01(unfamiliarity), usedShadow };
}

function getScoreThreshold(
  preferences: TermDisplayPreferences,
  context: TermDisplayContext,
): number {
  const density = normalizedDensity(preferences.terminologyDensity);
  let threshold = 0.76 - density * 0.18;
  if (!context.profileAvailable) {
    threshold += 0.08;
  }
  return clamp01(threshold);
}

export function buildPreliminaryTermDecision(
  candidate: TermCandidateInput,
  profile: TermPersonalizationProfile | undefined,
  preferences: TermDisplayPreferences,
  context: TermDisplayContext,
): PreliminaryTermDecision {
  if (candidate.manualLink) {
    return {
      candidateId: candidate.candidateId,
      conceptKey: candidate.conceptKey,
      paragraphId: candidate.paragraphId,
      occurrenceIndex: candidate.occurrenceIndex,
      eligible: true,
      score: 1,
      tier: "prominent",
      reason: "explicit_manual_link",
      manualUnknown: false,
    };
  }

  if (profile?.manualStatus === "known") {
    return {
      candidateId: candidate.candidateId,
      conceptKey: candidate.conceptKey,
      paragraphId: candidate.paragraphId,
      occurrenceIndex: candidate.occurrenceIndex,
      eligible: false,
      score: 0,
      tier: "none",
      reason: "manual_known",
      manualUnknown: false,
    };
  }

  if (profile?.manualStatus === "unknown") {
    return {
      candidateId: candidate.candidateId,
      conceptKey: candidate.conceptKey,
      paragraphId: candidate.paragraphId,
      occurrenceIndex: candidate.occurrenceIndex,
      eligible: true,
      score: 1,
      tier: "prominent",
      reason: "manual_unknown",
      manualUnknown: true,
    };
  }

  if (isLikelyNoise(candidate)) {
    return {
      candidateId: candidate.candidateId,
      conceptKey: candidate.conceptKey,
      paragraphId: candidate.paragraphId,
      occurrenceIndex: candidate.occurrenceIndex,
      eligible: false,
      score: 0,
      tier: "none",
      reason: "unsupported_location",
      manualUnknown: false,
    };
  }

  if (
    candidate.sourceConfidence < MIN_SOURCE_CONFIDENCE ||
    candidate.contextRelevance < MIN_CONTEXT_RELEVANCE
  ) {
    return {
      candidateId: candidate.candidateId,
      conceptKey: candidate.conceptKey,
      paragraphId: candidate.paragraphId,
      occurrenceIndex: candidate.occurrenceIndex,
      eligible: false,
      score: 0,
      tier: "none",
      reason: "low_candidate_quality",
      manualUnknown: false,
    };
  }

  const unfamiliarity = getAutomaticUnfamiliarity(profile);
  const difficulty = clamp01(candidate.difficulty);
  const relevance = clamp01(candidate.contextRelevance * 0.65 + candidate.sourceConfidence * 0.35);
  const exploration = stableUnitInterval(`${candidate.conceptKey}:${candidate.paragraphId}`);

  const score = clamp01(
    0.5 * unfamiliarity.value +
      0.2 * difficulty +
      0.2 * relevance +
      0.1 * exploration,
  );

  const threshold = getScoreThreshold(preferences, context);
  const hasKnowledgeEvidence = Boolean(
    profile?.manualStatus
    || profile?.mastery != null
    || (
      profile?.shadowFamiliarity != null
      && profile.shadowConfidence != null
      && profile.shadowEvidenceCount >= 2
    ),
  );
  const coldStartFloor =
    !hasKnowledgeEvidence && candidate.sourceConfidence >= 0.76
      ? threshold + Math.min(0.08, (candidate.sourceConfidence - 0.76) * 0.45)
      : score;
  const effectiveScore = Math.max(score, coldStartFloor);

  if (effectiveScore < threshold) {
    return {
      candidateId: candidate.candidateId,
      conceptKey: candidate.conceptKey,
      paragraphId: candidate.paragraphId,
      occurrenceIndex: candidate.occurrenceIndex,
      eligible: false,
      score: effectiveScore,
      tier: "none",
      reason: context.profileAvailable ? "below_threshold" : "profile_unavailable",
      manualUnknown: false,
    };
  }

  const tier = effectiveScore >= Math.max(0.82, threshold + 0.12) ? "prominent" : "subtle";

  return {
    candidateId: candidate.candidateId,
    conceptKey: candidate.conceptKey,
    paragraphId: candidate.paragraphId,
    occurrenceIndex: candidate.occurrenceIndex,
    eligible: true,
    score: effectiveScore,
    tier,
    reason: unfamiliarity.usedShadow
      ? "trusted_shadow_signal"
      : difficulty >= 0.72
        ? "important_prerequisite"
        : "likely_unfamiliar",
    manualUnknown: false,
  };
}
