from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

TeachingMode = Literal["off", "shadow", "assist", "fallback", "default"]


@dataclass(frozen=True, slots=True)
class AppliedTeachingTrialDraft:
    project_id: int
    session_id: int | None
    planner_run_id: str | None
    teaching_plan_id: str | None
    snapshot_id: str | None
    effective_context_json: str
    mode: TeachingMode
    fallback_reason: str | None = None
    answer_model: str | None = None
    pre_state_json: str = "{}"
    target_concepts_json: str = "[]"
    target_dimensions_json: str = "[]"
    strategy_rationale: str = ""
    policy_version: str = "teaching-trial-v2.1"

    @property
    def should_persist(self) -> bool:
        return self.mode in ("assist", "default") and self.fallback_reason is None


@dataclass(frozen=True, slots=True)
class TeachingPreparation:
    rendered_context: str
    trial_draft: AppliedTeachingTrialDraft | None = None
