from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class KnowledgeEvidence(StrictModel):
    concept_text: str = Field(min_length=1, max_length=120)
    concept_key: Optional[str] = Field(default=None, max_length=240)
    dimension: Literal[
        "familiarity",
        "conceptual_understanding",
        "code_reading",
        "implementation",
        "debugging",
        "transfer",
    ]
    direction: Literal["positive", "negative", "uncertain"]
    strength: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_quote: str = Field(min_length=1, max_length=300)
    explanation: str = Field(min_length=1, max_length=500)


class BehaviorEvidence(StrictModel):
    hypothesis_key: Optional[str] = Field(default=None, max_length=160)
    statement: str = Field(min_length=1, max_length=500)
    category: str = Field(min_length=1, max_length=100)
    direction: Literal["support", "contradict", "uncertain"]
    strength: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    recommended_scope: Literal["session", "project", "domain", "global"]
    evidence_quote: str = Field(min_length=1, max_length=300)


class MisconceptionObservation(StrictModel):
    concept_text: str = Field(min_length=1, max_length=120)
    concept_key: Optional[str] = Field(default=None, max_length=240)
    statement: str = Field(min_length=1, max_length=500)
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_quote: str = Field(min_length=1, max_length=300)
    explanation: str = Field(min_length=1, max_length=500)


class ExplicitUserFact(StrictModel):
    fact_type: Literal[
        "knowledge_self_report",
        "interaction_preference",
        "current_request",
        "learning_goal",
        "other",
    ]
    statement: str = Field(min_length=1, max_length=500)
    value: str = Field(min_length=1, max_length=300)
    recommended_scope: Literal["session", "project", "domain", "global"]
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_quote: str = Field(min_length=1, max_length=300)


class CurrentLearningState(StrictModel):
    intent_category: Literal[
        "quick_fix",
        "debug",
        "understand_term",
        "understand_mechanism",
        "build_mental_model",
        "implement",
        "compare_options",
        "explore_boundary",
        "review",
        "unknown",
    ]
    intent_summary: str = Field(min_length=1, max_length=500)
    confusion_category: Literal[
        "none",
        "terminology",
        "mechanism",
        "relationship",
        "procedure",
        "boundary",
        "misconception",
        "unknown",
    ]
    confusion_summary: str = Field(min_length=1, max_length=500)
    current_goal: str = Field(min_length=1, max_length=500)
    urgency: Literal["low", "medium", "high"]
    cognitive_load: Literal["low", "medium", "high", "unknown"]
    confidence: float = Field(ge=0.0, le=1.0)


class PreviousTeachingOutcome(StrictModel):
    result: Literal[
        "successful",
        "partially_successful",
        "unsuccessful",
        "advanced_followup",
        "topic_changed",
        "unknown",
    ]
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str = Field(min_length=1, max_length=500)
    evidence_quote: str = Field(min_length=1, max_length=300)


class ConceptRelationObservation(StrictModel):
    source_concept_text: str = Field(min_length=1, max_length=120)
    source_concept_key: Optional[str] = Field(default=None, max_length=240)
    target_concept_text: str = Field(min_length=1, max_length=120)
    target_concept_key: Optional[str] = Field(default=None, max_length=240)
    relation_type: Literal[
        "prerequisite",
        "component",
        "application",
        "sibling",
        "alias",
    ]
    domain: str = Field(min_length=1, max_length=100)
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str = Field(min_length=1, max_length=500)


class DomainAssessmentObservation(StrictModel):
    domain_key: str = Field(min_length=1, max_length=100)
    state: Literal["confirmed", "learning", "likely_prerequisite", "insufficient"]
    summary: str = Field(min_length=1, max_length=500)
    confidence: float = Field(ge=0.0, le=1.0)
    concept_keys: list[str] = Field(default_factory=list, max_length=12)
    evidence_quotes: list[str] = Field(default_factory=list, max_length=6)


class SurveyOption(StrictModel):
    value: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=80)


class DynamicSurveyCandidate(StrictModel):
    question: str = Field(min_length=1, max_length=180)
    dimension: Literal[
        "answer_depth",
        "code_ratio",
        "prerequisite_detail",
        "terminology_density",
        "explanation_order",
    ]
    options: list[SurveyOption] = Field(min_length=2, max_length=3)
    rationale: str = Field(min_length=1, max_length=300)
    confidence: float = Field(ge=0.0, le=1.0)


class DiagnosticOption(StrictModel):
    value: str | bool | list[str]
    label: str = Field(min_length=1, max_length=180)


class DiagnosticSourceRef(StrictModel):
    source_type: Literal["course", "file", "qa"]
    source_path: str = Field(min_length=1, max_length=500)
    excerpt: str = Field(min_length=1, max_length=600)
    start_line: Optional[int] = Field(default=None, ge=1)


class DynamicDiagnosticCandidate(StrictModel):
    concept_keys: list[str] = Field(min_length=1, max_length=4)
    dimension: Literal[
        "familiarity",
        "conceptual",
        "code_reading",
        "implementation",
        "debugging",
        "transfer",
    ]
    item_type: Literal[
        "single_choice",
        "true_false",
        "code_output",
        "error_location",
        "step_order",
    ]
    prompt: str = Field(min_length=1, max_length=1200)
    options: list[DiagnosticOption] = Field(default_factory=list, max_length=8)
    answer_key: str | bool | list[str]
    source_refs: list[DiagnosticSourceRef] = Field(min_length=1, max_length=4)
    rationale: str = Field(min_length=1, max_length=500)
    difficulty: float = Field(ge=0.0, le=1.0)


class InteractionObservation(StrictModel):
    schema_version: Literal[1, 2]
    current_state: CurrentLearningState
    previous_teaching_outcome: Optional[PreviousTeachingOutcome]
    knowledge_evidence: list[KnowledgeEvidence] = Field(max_length=12)
    behavior_evidence: list[BehaviorEvidence] = Field(max_length=8)
    possible_misconceptions: list[MisconceptionObservation] = Field(max_length=6)
    explicit_user_facts: list[ExplicitUserFact] = Field(max_length=6)
    concept_relations: list[ConceptRelationObservation] = Field(default_factory=list, max_length=12)
    domain_assessments: list[DomainAssessmentObservation] = Field(default_factory=list, max_length=6)
    survey_candidate: Optional[DynamicSurveyCandidate] = None
    diagnostic_candidate: Optional[DynamicDiagnosticCandidate] = None
    notes: list[str] = Field(default_factory=list, max_length=8)
