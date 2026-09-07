import type {
  PreliminaryTermDecision,
  TermCandidateInput,
  TermDisplayContext,
  TermDisplayPreferences,
  TermPersonalizationProfile,
} from "./termDisplayTypes";

export function buildPreliminaryTermDecision(
  candidate: TermCandidateInput,
  profile: TermPersonalizationProfile | undefined,
  _preferences: TermDisplayPreferences,
  _context: TermDisplayContext,
): PreliminaryTermDecision {
  const decision: PreliminaryTermDecision = {
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

  // Neither user feedback nor a generated candidate may create nested links
  // or decorate an executable code block.
  if (candidate.isInCodeBlock || candidate.source === "existing_link") return decision;

  if (candidate.manualLink) {
    return { ...decision, eligible: true, score: 1, tier: "prominent", reason: "explicit_manual_link" };
  }

  if (candidate.source !== "model") {
    return { ...decision, reason: "untrusted_candidate" };
  }
  if (candidate.isInHeading || !candidate.normalizedText.trim()) return decision;

  if (profile?.manualStatus === "known") {
    return { ...decision, reason: "manual_known" };
  }
  if (profile?.manualStatus === "unknown") {
    return { ...decision, eligible: true, score: 1, tier: "prominent", reason: "manual_unknown", manualUnknown: true };
  }
  if (profile?.knowledgeStatus === "confirmed") {
    return { ...decision, reason: "confirmed_knowledge" };
  }

  // The model selected this term with the document and learning context in
  // view. A missing profile is not evidence of unfamiliarity; keep its choice
  // subtle, then apply only reading-density and repetition limits.
  return { ...decision, eligible: true, score: 0.5, tier: "subtle", reason: "model_selected" };
}
