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


class InteractionObservation(StrictModel):
    schema_version: Literal[1]
    current_state: CurrentLearningState
    previous_teaching_outcome: Optional[PreviousTeachingOutcome]
    knowledge_evidence: list[KnowledgeEvidence] = Field(max_length=12)
    behavior_evidence: list[BehaviorEvidence] = Field(max_length=8)
    possible_misconceptions: list[MisconceptionObservation] = Field(max_length=6)
    explicit_user_facts: list[ExplicitUserFact] = Field(max_length=6)
    notes: list[str] = Field(default_factory=list, max_length=8)
