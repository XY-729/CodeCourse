from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SnapshotSource(StrictModel):
    source_type: Literal[
        "manual_fact",
        "capability",
        "behavior_hypothesis",
        "misconception",
        "manual_mastery",
        "manual_preference",
    ]
    source_id: str
    evidence_qa_record_ids: list[int] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)


class RelevantCapability(StrictModel):
    concept_key: str
    concept_name: str
    dimension: Literal[
        "familiarity",
        "conceptual_understanding",
        "code_reading",
        "implementation",
        "debugging",
        "transfer",
    ]
    value: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    interpretation: Literal[
        "likely_known",
        "likely_unknown",
        "uncertain",
    ]
    sources: list[SnapshotSource] = Field(default_factory=list)


class RelevantFact(StrictModel):
    fact_type: str
    statement: str
    value: str
    scope_type: Literal["session", "project", "domain", "global"]
    scope_id: str
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_quote: str
    sources: list[SnapshotSource] = Field(default_factory=list)


class RelevantHypothesis(StrictModel):
    hypothesis_key: str
    statement: str
    category: str
    scope_type: Literal["session", "project", "domain", "global"]
    scope_id: str
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_count: int = Field(ge=1)
    sources: list[SnapshotSource] = Field(default_factory=list)


class RelevantMisconception(StrictModel):
    id: str
    concept_key: str | None
    concept_text: str
    statement: str
    confidence: float = Field(ge=0.0, le=1.0)
    sources: list[SnapshotSource] = Field(default_factory=list)


class ShadowLearnerSnapshot(StrictModel):
    schema_version: Literal[1]
    builder_version: str
    project_id: int
    session_id: int | None
    target_qa_record_id: int
    as_of_qa_record_id: int | None

    explicit_facts: list[RelevantFact] = Field(max_length=6)
    capabilities: list[RelevantCapability] = Field(max_length=10)
    behavior_hypotheses: list[RelevantHypothesis] = Field(max_length=5)
    misconceptions: list[RelevantMisconception] = Field(max_length=4)

    current_manual_preferences: dict[str, object] = Field(default_factory=dict)
    current_manual_mastery: list[dict[str, object]] = Field(default_factory=list)

    excluded_item_count: int = 0
    source_observation_ids: list[str] = Field(default_factory=list)
    snapshot_hash: str = ""
