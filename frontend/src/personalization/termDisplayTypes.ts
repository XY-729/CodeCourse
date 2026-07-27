export type ManualKnowledgeStatus = "known" | "unknown" | null;

export type TermDisplayTier = "none" | "subtle" | "prominent";

export type TermDisplayReason =
  | "manual_known"
  | "manual_unknown"
  | "likely_unfamiliar"
  | "important_prerequisite"
  | "trusted_shadow_signal"
  | "low_candidate_quality"
  | "below_threshold"
  | "duplicate_concept"
  | "paragraph_density_limit"
  | "document_density_limit"
  | "unsupported_location"
  | "profile_unavailable"
  | "explicit_manual_link";

export interface TermCandidateInput {
  candidateId: string;
  text: string;
  normalizedText: string;
  conceptKey: string;
  conceptName: string;
  paragraphId: string;
  occurrenceIndex: number;
  source: "model" | "code_symbol" | "inline_code" | "heading" | "existing_link" | "unknown";
  sourceConfidence: number;
  contextRelevance: number;
  difficulty: number;
  isInHeading: boolean;
  isInCodeBlock: boolean;
  isInlineCode: boolean;
  isInTable: boolean;
  manualLink: boolean;
}

export interface TermPersonalizationProfile {
  conceptKey: string;
  manualStatus: ManualKnowledgeStatus;
  mastery: number | null;
  uncertainty: number | null;
  shadowFamiliarity: number | null;
  shadowConfidence: number | null;
  shadowEvidenceCount: number;
  domainPrior: number | null;
}

export interface TermDisplayPreferences {
  terminologyDensity: number;
}

export interface PreliminaryTermDecision {
  candidateId: string;
  conceptKey: string;
  paragraphId: string;
  occurrenceIndex: number;
  eligible: boolean;
  score: number;
  tier: TermDisplayTier;
  reason: TermDisplayReason;
  manualUnknown: boolean;
}

export interface TermDisplayDecision {
  candidateId: string;
  conceptKey: string;
  paragraphId: string;
  occurrenceIndex: number;
  visible: boolean;
  score: number;
  tier: TermDisplayTier;
  reason: TermDisplayReason;
}

export interface TermDisplayContext {
  profileAvailable: boolean;
  paragraphCount: number;
}

export interface TermDisplayResult {
  decisionsByCandidateId: Map<string, TermDisplayDecision>;
  visibleOccurrences: VisibleTermOccurrence[];
}

export interface VisibleTermOccurrence {
  candidateId: string;
  conceptKey: string;
  conceptName: string;
  paragraphId: string;
  text: string;
  tier: TermDisplayTier;
}
