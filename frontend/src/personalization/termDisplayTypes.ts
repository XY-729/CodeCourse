export type ManualKnowledgeStatus = "known" | "unknown" | null;

export type TermFamiliarity = "unrecorded" | "encountered" | "studied"
  | "self_reported_understood" | "partially_understood" | "declared_known" | "needs_help" | "mixed";

export type TermDisplayTier = "none" | "subtle" | "prominent";

export type TermDisplayReason =
  | "model_selected"
  | "untrusted_candidate"
  | "confirmed_knowledge"
  | "declared_known"
  | "self_reported_understood"
  | "needs_help"
  | "manual_known"
  | "manual_unknown"
  | "likely_unfamiliar"
  | "important_prerequisite"
  | "trusted_shadow_signal"
  | "low_candidate_quality"
  | "below_threshold"
  | "duplicate_concept"
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
  source: "manifest" | "model" | "code_symbol" | "inline_code" | "heading" | "existing_link" | "unknown";
  sourceConfidence: number;
  contextRelevance: number;
  difficulty: number;
  isInHeading: boolean;
  isInCodeBlock: boolean;
  isInlineCode: boolean;
  isInTable: boolean;
  manualLink: boolean;
}

export interface TermFamiliarityRange {
  aspect: string;
  dimension: string;
  familiarity: TermFamiliarity;
  evidence_ids?: string[];
  last_evidence_at?: string | null;
}

export interface TermPersonalizationProfile {
  conceptKey: string;
  /** Authoritative UUID when the request was made by concept key. */
  conceptId?: string;
  /** The identifier the caller actually asked for (may be a UUID or key). */
  requestKey?: string;
  manualStatus: ManualKnowledgeStatus;
  /** Authoritative fact state; takes precedence over legacy knowledgeStatus. */
  familiarity?: TermFamiliarity;
  ranges?: TermFamiliarityRange[];
  treeSnapshot?: { topology_version: number; state_version: number };
  knowledgeStatus?: string | null;
  mastery: number | null;
  uncertainty: number | null;
  shadowFamiliarity: number | null;
  shadowConfidence: number | null;
  shadowEvidenceCount: number;
  domainPrior: number | null;
}

export interface TermDisplayPreferences {
  /** Compatibility only. Ignored by the display decision. */
  terminologyDensity?: number;
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
