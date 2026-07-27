from __future__ import annotations

PRIMARY_STRATEGY_COUNT = 2

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
}


def primary_strategies(strategies: list[str]) -> tuple[str, ...]:
    return tuple(strategies[:PRIMARY_STRATEGY_COUNT])


def strategy_change_required(previous_outcome: str | None) -> bool:
    return previous_outcome == "unsuccessful"


def has_changed_primary_strategy(
    previous_strategies: list[str],
    next_strategies: list[str],
) -> bool:
    return set(primary_strategies(previous_strategies)) != set(primary_strategies(next_strategies))


def deterministic_alternative_strategies(
    blocker_type: str,
    previous_strategies: list[str],
) -> list[str]:
    alternatives = list(
        DEFAULT_STRATEGY_ALTERNATIVES.get(
            blocker_type,
            DEFAULT_STRATEGY_ALTERNATIVES["unknown"],
        )
    )
    filtered = [s for s in alternatives if s not in previous_strategies[:2]]
    if not filtered:
        filtered = ["direct_answer", "worked_example"]
    return filtered[:2]


def enrich_partial_success_strategy(
    previous_strategies: list[str],
    blocker_type: str,
) -> list[str]:
    retained = previous_strategies[:1]
    alternatives = deterministic_alternative_strategies(
        blocker_type=blocker_type,
        previous_strategies=previous_strategies,
    )
    return (retained + alternatives)[:3]
