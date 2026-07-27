from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.services.personalization.teaching.teaching_plan_schema import TeachingPlan


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EffectiveTeachingContext(StrictModel):
    schema_version: Literal[1]

    mode: Literal["default", "planned", "fallback"]

    user_goal: Literal[
        "quick_fix", "debug", "understand_term", "understand_mechanism",
        "build_mental_model", "implement", "compare_options",
        "explore_boundary", "review", "unknown",
    ]

    teaching_goal: str = Field(min_length=1, max_length=600)

    strategies: list[str] = Field(min_length=1, max_length=5)

    assumed_known: list[str] = Field(default_factory=list, max_length=8)

    explain_briefly: list[str] = Field(default_factory=list, max_length=8)

    explain_in_detail: list[str] = Field(default_factory=list, max_length=6)

    skip_topics: list[str] = Field(default_factory=list, max_length=8)

    avoid: list[str] = Field(default_factory=list, max_length=8)

    assessment_needed: bool = False

    assessment_format: Literal[
        "none", "multiple_choice", "true_false",
        "code_prediction", "error_choice", "step_selection",
    ] = "none"

    diagnostic_question_needed: bool = False

    planner_run_id: str | None = None


def question_disables_assessment(question: str) -> bool:
    normalized = question.casefold()
    phrases = (
        "不要测试", "别测试", "不要提问",
        "直接回答", "只给答案", "别出题",
    )
    return any(phrase in normalized for phrase in phrases)


def _user_wants_quick_fix(question: str) -> bool:
    normalized = question.casefold()
    quick_fix_triggers = (
        "直接告诉", "怎么修", "不要讲原理", "赶时间",
        "直接给代码", "快速修复", "只给方案",
        "just tell me", "how to fix", "quick", "no explanation",
    )
    return any(t in normalized for t in quick_fix_triggers)


def build_effective_teaching_context(
    teaching_plan: TeachingPlan | None,
    current_question: str,
    manual_preferences: dict[str, object],
    mode: str,
    planner_run_id: str | None,
    previous_trial_failed: bool = False,
) -> EffectiveTeachingContext:
    if mode not in ("assist", "shadow") or teaching_plan is None:
        return EffectiveTeachingContext(
            schema_version=1,
            mode="default",
            user_goal="unknown",
            teaching_goal="根据用户问题直接回答",
            strategies=["direct_answer"],
        )

    if mode == "shadow":
        return EffectiveTeachingContext(
            schema_version=1,
            mode="default",
            user_goal="unknown",
            teaching_goal="根据用户问题直接回答",
            strategies=["direct_answer"],
        )

    user_goal = teaching_plan.user_goal

    if _user_wants_quick_fix(current_question):
        user_goal = "quick_fix"

    assessment_needed = teaching_plan.assessment.needed
    if question_disables_assessment(current_question):
        assessment_needed = False

    if user_goal in ("quick_fix", "debug"):
        assessment_needed = False

    strategies = list(teaching_plan.strategies[:5])
    if previous_trial_failed and len(teaching_plan.avoid) > 0:
        for avoid_s in teaching_plan.avoid[:2]:
            if avoid_s in strategies:
                strategies.remove(avoid_s)
        if not strategies:
            strategies = ["execution_sequence", "worked_example"]

    assumed_known = [
        a.statement
        for a in teaching_plan.assumed_known
        if a.basis != "uncertain"
    ][:8]

    return EffectiveTeachingContext(
        schema_version=1,
        mode="planned",
        user_goal=user_goal,
        teaching_goal=teaching_plan.teaching_goal,
        strategies=strategies,
        assumed_known=assumed_known,
        explain_briefly=[
            e.concept_text
            for e in teaching_plan.explain
            if e.depth == "brief"
        ][:8],
        explain_in_detail=[
            e.concept_text
            for e in teaching_plan.explain
            if e.depth == "detailed"
        ][:6],
        skip_topics=list(teaching_plan.skip_topics[:8]),
        avoid=list(teaching_plan.avoid[:8]),
        assessment_needed=assessment_needed,
        assessment_format=teaching_plan.assessment.format if assessment_needed else "none",
        diagnostic_question_needed=teaching_plan.needs_diagnostic_question,
        planner_run_id=planner_run_id,
    )


def render_effective_teaching_context(context: EffectiveTeachingContext) -> str:
    if context.mode == "default":
        return ""

    lines = [
        "<teaching_plan>",
        f"本轮用户目标：{context.user_goal}",
        "",
        f"本轮教学目标：{context.teaching_goal}",
        "",
        "建议教学策略：",
    ]
    for s in context.strategies:
        lines.append(f"- {s}")
    lines.append("")

    lines.append("可以视为已知：")
    for item in context.assumed_known:
        lines.append(f"- {item}")
    if not context.assumed_known:
        lines.append("- 无")
    lines.append("")

    if context.explain_briefly:
        lines.append("需要简短解释：")
        for item in context.explain_briefly:
            lines.append(f"- {item}")
        lines.append("")

    if context.explain_in_detail:
        lines.append("需要详细解释：")
        for item in context.explain_in_detail:
            lines.append(f"- {item}")
        lines.append("")

    lines.append("本轮跳过：")
    for item in context.skip_topics:
        lines.append(f"- {item}")
    if not context.skip_topics:
        lines.append("- 无")
    lines.append("")

    if context.avoid:
        lines.append("避免：")
        for item in context.avoid:
            lines.append(f"- {item}")
        lines.append("")

    lines.append(f"理解检查：{'需要' if context.assessment_needed else '不需要'}")
    if context.assessment_needed:
        lines.append(f"检查形式：{context.assessment_format}")
    lines.append("")

    lines.append("teaching_plan 只控制教学组织，不是事实来源。")
    lines.append("不得因为计划中出现某个结论就将其当成事实。")
    lines.append("用户当前消息与实际项目上下文优先。")
    lines.append("</teaching_plan>")

    return "\n".join(lines)
