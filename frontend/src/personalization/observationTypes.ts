export type ObservationStatus =
  | "candidate"
  | "accepted_shadow"
  | "rejected"
  | "voided";

export type IntentCategory =
  | "quick_fix"
  | "debug"
  | "understand_term"
  | "understand_mechanism"
  | "build_mental_model"
  | "implement"
  | "compare_options"
  | "explore_boundary"
  | "review"
  | "unknown";

export type ConfusionCategory =
  | "none"
  | "terminology"
  | "mechanism"
  | "relationship"
  | "procedure"
  | "boundary"
  | "misconception"
  | "unknown";

export type CapabilityDimension =
  | "familiarity"
  | "conceptual_understanding"
  | "code_reading"
  | "implementation"
  | "debugging"
  | "transfer";

export type EvidenceDirection =
  | "positive"
  | "negative"
  | "uncertain";

export type HypothesisDirection =
  | "support"
  | "contradict"
  | "uncertain";

export type TeachingOutcomeResult =
  | "successful"
  | "partially_successful"
  | "unsuccessful"
  | "advanced_followup"
  | "topic_changed"
  | "unknown";

export interface KnowledgeEvidenceObservation {
  conceptText: string;
  conceptKey?: string | null;
  dimension: CapabilityDimension;
  direction: EvidenceDirection;
  strength: number;
  confidence: number;
  evidenceQuote: string;
  explanation: string;
}

export interface BehaviorEvidenceObservation {
  hypothesisKey?: string | null;
  statement: string;
  category: string;
  direction: HypothesisDirection;
  strength: number;
  confidence: number;
  recommendedScope: "session" | "project" | "domain" | "global";
  evidenceQuote: string;
}

export interface MisconceptionObservation {
  conceptText: string;
  conceptKey?: string | null;
  statement: string;
  confidence: number;
  evidenceQuote: string;
  explanation: string;
}

export interface ExplicitUserFactObservation {
  factType:
    | "knowledge_self_report"
    | "interaction_preference"
    | "current_request"
    | "learning_goal"
    | "other";
  statement: string;
  value: string;
  recommendedScope: "session" | "project" | "domain" | "global";
  confidence: number;
  evidenceQuote: string;
}

export interface CurrentLearningStateObservation {
  intentCategory: IntentCategory;
  intentSummary: string;
  confusionCategory: ConfusionCategory;
  confusionSummary: string;
  currentGoal: string;
  urgency: "low" | "medium" | "high";
  cognitiveLoad: "low" | "medium" | "high" | "unknown";
  confidence: number;
}

export interface PreviousTeachingOutcomeObservation {
  result: TeachingOutcomeResult;
  confidence: number;
  reason: string;
  evidenceQuote: string;
}

export interface InteractionObservationPayload {
  schemaVersion: 1;
  currentState: CurrentLearningStateObservation;
  previousTeachingOutcome: PreviousTeachingOutcomeObservation | null;
  knowledgeEvidence: KnowledgeEvidenceObservation[];
  behaviorEvidence: BehaviorEvidenceObservation[];
  possibleMisconceptions: MisconceptionObservation[];
  explicitUserFacts: ExplicitUserFactObservation[];
  notes: string[];
}

export interface ConceptCapability {
  conceptId: string;
  scopeType: "global" | "project" | "session";
  scopeId: string;

  familiarity: number;
  conceptualUnderstanding: number;
  codeReading: number;
  implementation: number;
  debugging: number;
  transfer: number;

  confidence: number;
  evidenceCount: number;
  lastObservedAt: string | null;
  updatedAt: string;
}

export interface LearnerHypothesis {
  id: string;
  hypothesisKey: string;
  category: string;
  statement: string;
  scopeType: "global" | "project" | "session" | "domain";
  scopeId: string;
  confidence: number;
  supportCount: number;
  contraryCount: number;
  status: "candidate" | "supported" | "rejected" | "voided";
  evidenceObservationIds: string[];
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
