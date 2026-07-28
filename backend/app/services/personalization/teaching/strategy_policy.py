from __future__ import annotations

from dataclasses import replace
from typing import Any

from app.services.personalization.teaching.effective_context import (
    EffectiveTeachingContext,
)

PRIMARY_STRATEGY_COUNT = 2
MIN_OUTCOME_CONFIDENCE_FOR_POLICY = 0.55
MIN_CUMULATIVE_OUTCOMES_FOR_POLICY = 2

DEFAULT_STRATEGY_ALTERNATIVES: dict[str, list[str]] = {
    "terminology": ["brief_definition", "worked_example"],
    "mechanism": ["execution_sequence", "worked_example"],
    "relationship": ["role_comparison", "contrast_table"],
    "procedure": ["progressive_hint", "minimal_code"],
    "boundary": ["boundary_case", "counterexample"],
    "misconception": ["counterexample", "role_comparison"],
    "debug": ["error_diagnosis", "project_code"],
    "missing_context": ["direct_answer", "prerequisite_bridge"],
    "unknown": ["direct_answer", "worked_example"],
    "none": ["direct_answer", "worked_example"],
}

_FALLBACK_POOL = (
    "direct_answer",
    "worked_example",
    "role_comparison",
    "execution_sequence",
    "counterexample",
    "project_code",
)


def primary_strategies(strategies: list[str]) -> tuple[str, ...]:
    return tuple(strategies[:PRIMARY_STRATEGY_COUNT])


def strategy_change_required(
    previous_outcome: str | None,
    confidence: float | None = None,
) -> bool:
    return (
        previous_outcome == "unsuccessful"
        and float(confidence or 0.0) >= MIN_OUTCOME_CONFIDENCE_FOR_POLICY
    )


def has_changed_primary_strategy(
    previous_strategies: list[str],
    next_strategies: list[str],
) -> bool:
    return set(primary_strategies(previous_strategies)) != set(
        primary_strategies(next_strategies)
    )


def deterministic_alternative_strategies(
    blocker_type: str,
    previous_strategies: list[str],
) -> list[str]:
    previous_primary = set(previous_strategies[:PRIMARY_STRATEGY_COUNT])
    candidates = list(
        DEFAULT_STRATEGY_ALTERNATIVES.get(
            blocker_type,
            DEFAULT_STRATEGY_ALTERNATIVES["unknown"],
        )
    )
    for item in _FALLBACK_POOL:
        if item not in candidates:
            candidates.append(item)

    result = [item for item in candidates if item not in previous_primary]
    if len(result) < PRIMARY_STRATEGY_COUNT:
        raise ValueError("No deterministic alternative teaching strategy available")
    return result[:PRIMARY_STRATEGY_COUNT]


def enrich_partial_success_strategy(
    previous_strategies: list[str],
    blocker_type: str,
) -> list[str]:
    retained = previous_strategies[:1]
    alternatives = deterministic_alternative_strategies(
        blocker_type=blocker_type,
        previous_strategies=previous_strategies,
    )
    result: list[str] = []
    for item in [*retained, *alternatives]:
        if item not in result:
            result.append(item)
    return result[:3]


def apply_teaching_history_policy(
    *,
    context: EffectiveTeachingContext,
    blocker_type: str,
    recent_history: list[dict[str, Any]],
) -> EffectiveTeachingContext:
    """Apply a deterministic, fail-safe policy to the model plan.

    This function uses the strategies that were actually rendered in the
    previous EffectiveTeachingContext, not the raw Planner proposal.
    """
    if not recent_history:
        return context

    previous = recent_history[-1]
    previous_strategies = [str(item) for item in previous.get("strategies", [])]
    outcome = previous.get("outcome")
    confidence = float(previous.get("outcome_confidence") or 0.0)

    if not previous_strategies:
        return context

    next_strategies = list(context.strategies)
    previous_primary = set(primary_strategies(previous_strategies))
    comparable_history = [
        item for item in recent_history
        if set(primary_strategies([str(value) for value in item.get("strategies", [])]))
        == previous_primary
        and float(item.get("outcome_confidence") or 0.0)
        >= MIN_OUTCOME_CONFIDENCE_FOR_POLICY
    ]
    unsuccessful_count = sum(
        item.get("outcome") == "unsuccessful" for item in comparable_history
    )
    partial_count = sum(
        item.get("outcome") == "partially_successful" for item in comparable_history
    )
    advanced_count = sum(
        item.get("outcome") == "advanced_followup" for item in comparable_history
    )

    if (
        strategy_change_required(outcome, confidence)
        and unsuccessful_count >= MIN_CUMULATIVE_OUTCOMES_FOR_POLICY
    ):
        if has_changed_primary_strategy(previous_strategies, next_strategies):
            return context
        replacement = deterministic_alternative_strategies(
            blocker_type=blocker_type,
            previous_strategies=previous_strategies,
        )
        return context.model_copy(update={"strategies": replacement})

    if (
        outcome == "partially_successful"
        and confidence >= MIN_OUTCOME_CONFIDENCE_FOR_POLICY
        and partial_count + unsuccessful_count >= MIN_CUMULATIVE_OUTCOMES_FOR_POLICY
    ):
        enriched = enrich_partial_success_strategy(
            previous_strategies=previous_strategies,
            blocker_type=blocker_type,
        )
        return context.model_copy(update={"strategies": enriched})

    if (
        outcome == "advanced_followup"
        and confidence >= MIN_OUTCOME_CONFIDENCE_FOR_POLICY
        and advanced_count >= MIN_CUMULATIVE_OUTCOMES_FOR_POLICY
    ):
        avoid_basics = list(context.avoid)
        for item in ("重复基础术语定义", "从零重新介绍已建立的基础"):
            if item not in avoid_basics:
                avoid_basics.append(item)
        return context.model_copy(
            update={
                "user_goal": "explore_boundary",
                "avoid": avoid_basics[:8],
            }
        )

    # topic_changed / unknown / successful do not force a strategy mutation.
    return context
