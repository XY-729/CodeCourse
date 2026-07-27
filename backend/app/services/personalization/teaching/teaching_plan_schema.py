from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


TeachingStrategyId = Literal[
    "direct_answer",
    "overview_map",
    "execution_sequence",
    "state_transition",
    "role_comparison",
    "contrast_table",
    "minimal_code",
    "project_code",
    "worked_example",
    "analogy",
    "counterexample",
    "error_diagnosis",
    "boundary_case",
    "progressive_hint",
    "prerequisite_bridge",
    "brief_definition",
    "detailed_derivation",
    "summary_check",
]


class PlanAssumption(StrictModel):
    statement: str = Field(min_length=1, max_length=300)
    confidence: float = Field(ge=0.0, le=1.0)
    basis: Literal[
        "manual_fact",
        "manual_mastery",
        "capability_evidence",
        "current_message",
        "project_context",
        "uncertain",
    ]


class ExplainInstruction(StrictModel):
    concept_text: str = Field(min_length=1, max_length=120)
    concept_key: str | None = Field(default=None, max_length=240)
    depth: Literal["mention", "brief", "detailed"]
    reason: str = Field(min_length=1, max_length=300)


class AssessmentPlan(StrictModel):
    needed: bool
    format: Literal[
        "none",
        "multiple_choice",
        "true_false",
        "code_prediction",
        "error_choice",
        "step_selection",
    ]
    timing: Literal["none", "during", "after"]
    purpose: str = Field(max_length=300)
    required_information_gain: str = Field(max_length=300)


class TeachingStep(StrictModel):
    order: int = Field(ge=1, le=10)
    strategy: TeachingStrategyId
    instruction: str = Field(min_length=1, max_length=500)


class TeachingPlan(StrictModel):
    schema_version: Literal[1]
    planner_version: str

    user_goal: Literal[
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
    user_goal_summary: str = Field(min_length=1, max_length=500)

    blocker_type: Literal[
        "none",
        "terminology",
        "mechanism",
        "relationship",
        "procedure",
        "boundary",
        "misconception",
        "missing_context",
        "unknown",
    ]
    blocker_summary: str = Field(min_length=1, max_length=500)
    blocker_confidence: float = Field(ge=0.0, le=1.0)

    teaching_goal: str = Field(min_length=1, max_length=600)

    assumed_known: list[PlanAssumption] = Field(max_length=10)
    uncertain_assumptions: list[PlanAssumption] = Field(max_length=8)

    strategies: list[TeachingStrategyId] = Field(min_length=1, max_length=6)
    steps: list[TeachingStep] = Field(min_length=1, max_length=8)

    explain: list[ExplainInstruction] = Field(max_length=10)
    skip_topics: list[str] = Field(max_length=10)
    avoid: list[str] = Field(max_length=10)

    assessment: AssessmentPlan

    needs_diagnostic_question: bool
    diagnostic_goal: str = Field(max_length=300)

    plan_confidence: float = Field(ge=0.0, le=1.0)
    uncertainty_notes: list[str] = Field(default_factory=list, max_length=8)
