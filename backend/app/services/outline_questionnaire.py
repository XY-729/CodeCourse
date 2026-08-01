"""Outline preflight questionnaire: model-generated learning-intent survey."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from app.services.generation_service import (
    _clean_instructions,
    _scope_to_text,
    build_outline_input,
)
from app.services.llm_client import call_openai_compatible_chat
from app.services.personalization_service import (
    apply_preference_feedback,
    effective_preferences,
)
from app.services.prompt_contracts import compose_system_prompt
from app.services.prompt_store import load_prompt
from app.services.storage import (
    get_outline_preflight,
    get_project,
    insert_outline_preflight,
    update_outline_preflight,
)

PREREQUISITE_DIMENSION = "prerequisite_level"
MAX_QUESTIONS = 8


def _llm_settings_or_error() -> dict[str, str]:
    from app.services.storage import get_llm_settings

    settings = get_llm_settings()
    if settings.get("enabled") != "true" or not settings.get("api_key"):
        raise RuntimeError("模型 API 未配置或未启用。无法生成问卷，可跳过问卷直接生成总纲。")
    return settings


def _preferences_summary(project_id: int) -> str:
    try:
        prefs = effective_preferences(project_id)
    except Exception:
        return "暂无"
    parts = [
        f"回答深度: {prefs.answer_depth:.2f}",
        f"代码比例: {prefs.code_ratio:.2f}",
        f"讲解顺序: {prefs.explanation_order}",
        f"前置知识: {prefs.prerequisite_detail:.2f}",
        f"术语密度: {prefs.terminology_density:.2f}",
    ]
    return "；".join(parts)


def _build_questionnaire_messages(
    project_id: int,
    scope: Any,
    instructions: str,
    settings: dict[str, str],
) -> list[dict[str, str]]:
    project = get_project(project_id)
    repo_root = Path(project.local_path).resolve() if project else None
    scope_text = _scope_to_text(scope)
    user_instructions = _clean_instructions(instructions)
    if repo_root is not None:
        prompt_input, _ = build_outline_input(repo_root, scope, instructions)
    else:
        prompt_input = f"学习范围：\n{scope_text}\n\n用户补充要求：\n{user_instructions or '无'}\n"
    prompt = load_prompt("prompt.outline.questionnaire").format(
        scope_text=scope_text,
        user_instructions=user_instructions or "无",
        preferences_summary=_preferences_summary(project_id),
        prompt_input=prompt_input,
    )
    return [
        {
            "role": "system",
            "content": compose_system_prompt(load_prompt("prompt.system"), "json"),
        },
        {"role": "user", "content": prompt},
    ]


def _parse_questions(content: str) -> list[dict]:
    text = content.strip()
    # Strip optional code fences the model may wrap JSON in.
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        parsed = json.loads(text)
    except ValueError as exc:
        raise RuntimeError("问卷生成返回了非法 JSON，可跳过问卷直接生成总纲。") from exc
    if not isinstance(parsed, list):
        raise RuntimeError("问卷生成返回结构错误，可跳过问卷直接生成总纲。")
    questions: list[dict] = []
    for item in parsed:
        if not isinstance(item, dict) or not isinstance(item.get("question"), str):
            continue
        if not item.get("question", "").strip():
            continue
        options = item.get("options")
        if options is None:
            options = []
        elif not isinstance(options, list):
            options = []
        questions.append(
            {
                "question": item["question"].strip(),
                "question_type": item.get("question_type", "single_choice"),
                "dimension": item.get("dimension", "other"),
                "options": options[:8],
                "rationale": item.get("rationale", ""),
            }
        )
    if not questions:
        raise RuntimeError("问卷未生成任何有效问题，可跳过问卷直接生成总纲。")
    return questions[:MAX_QUESTIONS]


def generate_questionnaire(
    project_id: int,
    scope: Any,
    instructions: str = "",
) -> dict:
    """Generate a questionnaire, persist it, return {preflight_id, questions}."""
    settings = _llm_settings_or_error()
    messages = _build_questionnaire_messages(project_id, scope, instructions, settings)
    content = call_openai_compatible_chat(
        settings["base_url"],
        settings["api_key"],
        settings["model"],
        messages,
        timeout=90,
    )
    questions = _parse_questions(content)
    preflight_id = f"pf:{project_id}:{uuid4().hex[:12]}"

    insert_outline_preflight(
        project_id=project_id,
        preflight_id=preflight_id,
        scope_json=json.dumps(scope.model_dump() if hasattr(scope, "model_dump") else {}, ensure_ascii=False),
        questions_json=json.dumps(questions, ensure_ascii=False),
    )
    return {"preflight_id": preflight_id, "questions": questions}


def serialize_learning_intent(answers: list[dict]) -> str:
    """Serialize survey answers into a <learning_intent> block for the outline prompt."""
    if not answers:
        return ""
    lines: list[str] = ["<learning_intent>"]
    for answer in answers:
        if not isinstance(answer, dict):
            continue
        question = str(answer.get("question", "")).strip()
        dimension = str(answer.get("dimension", "other")).strip()
        selected = answer.get("selected", answer.get("answer"))
        if isinstance(selected, list):
            labels = [str(item) for item in selected]
            selected_text = "、".join(labels) if labels else "（未选择）"
        else:
            selected_text = str(selected or "（未选择）")
        line = f"- {question}"
        if dimension and dimension != "other":
            line += f" [{dimension}]"
        line += f"：{selected_text}"
        lines.append(line)
    lines.append("</learning_intent>")
    return "\n".join(lines)


def persist_prerequisite_answers(project_id: int, answers: list[dict]) -> None:
    """Only prerequisite-level answers persist to learner_preferences via survey feedback."""
    for answer in answers:
        if not isinstance(answer, dict):
            continue
        if answer.get("dimension") != PREREQUISITE_DIMENSION:
            continue
        selected = answer.get("selected", answer.get("answer"))
        if isinstance(selected, list):
            selected = selected[0] if selected else None
        if selected is None or str(selected).strip() == "":
            continue
        choice = str(selected).strip()
        # Map survey choices to apply_preference_feedback signal semantics.
        low_map = {
            "none": "less",
            "novice": "prerequisites",
            "beginner": "prerequisites",
            "some": "prerequisites",
            "basic": "prerequisites",
            "little": "prerequisites",
            "unfamiliar": "prerequisites",
        }
        signal = low_map.get(choice.lower())
        if signal is None:
            # Fall back to "more prerequisite help" unless the user is clearly familiar.
            familiar = {"familiar", "good", "experienced", "advanced", "proficient", "comfortable"}
            signal = "less" if choice.lower() in familiar else "prerequisites"
        try:
            apply_preference_feedback(
                project_id,
                dimension="prerequisite_detail",
                choice=signal,
                source="survey",
                idempotency_key=f"outline-preflight:{project_id}:{answer.get('_key', uuid4().hex[:8])}",
            )
        except Exception:
            continue


def resolve_preflight(preflight_id: str) -> Optional[dict]:
    return get_outline_preflight(preflight_id)


def mark_preflight_answered(preflight_id: str, answers: list[dict]) -> None:
    update_outline_preflight(
        preflight_id,
        status="answered",
        answers_json=json.dumps(answers, ensure_ascii=False),
    )
