from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from typing import Iterable, Optional
from uuid import uuid4

from app.services.storage import (
    Concept,
    LearnerPreferences,
    QARecord,
    get_concept,
    get_concept_mastery,
    get_event_by_idempotency_key,
    get_learner_preferences,
    get_learning_events,
    get_qa_record,
    insert_learning_event,
    insert_preference_event,
    list_all_concepts,
    list_document_terms,
    list_preference_events,
    search_concepts,
    upsert_concept,
    upsert_concept_mastery,
    upsert_learner_preferences,
)


GLOBAL_SCOPE_ID = "local-user"
DEFINITION_RE = re.compile(
    r"(是什么|什么意思|解释一下|不懂|what\s+is|define\b)",
    re.IGNORECASE,
)
PRIVATE_SYMBOL_SOURCES = {"index", "project", "code", "symbol"}


def concept_scope(concept: Concept, project_id: int) -> tuple[str, str]:
    """Keep reusable knowledge global while isolating repository-private symbols."""
    if concept.concept_key.startswith("project:") or concept.concept_type == "project_symbol":
        return "project", str(project_id)
    return "global", GLOBAL_SCOPE_ID


def resolve_concept(
    project_id: int,
    term: str,
    source: str = "rule",
    confidence: float = 0.7,
) -> Concept:
    clean = re.sub(r"\s+", " ", term.strip())[:80]
    if not clean:
        raise ValueError("term is empty")
    folded = clean.casefold()
    project_symbol = source in PRIVATE_SYMBOL_SOURCES
    desired_key = (
        f"project:{project_id}:symbol:{folded}"
        if project_symbol
        else f"global:general:{folded}"
    )
    for concept in search_concepts(clean, limit=30):
        if project_symbol and concept.concept_key != desired_key:
            continue
        if not project_symbol and concept.concept_key.startswith("project:"):
            continue
        try:
            aliases = json.loads(concept.aliases_json or "[]")
        except json.JSONDecodeError:
            aliases = []
        if concept.canonical_name.casefold() == folded or any(
            isinstance(alias, str) and alias.casefold() == folded for alias in aliases
        ):
            return concept

    return upsert_concept(
        concept_id=str(uuid4()),
        concept_key=desired_key,
        canonical_name=clean,
        display_name=clean,
        domain="project-symbol" if project_symbol else "general",
        concept_type="project_symbol" if project_symbol else "theory",
        aliases_json="[]",
        difficulty=max(0.2, min(0.9, 0.45 + confidence - 0.7)),
    )


def default_preferences(
    scope_type: str = "global",
    scope_id: str = GLOBAL_SCOPE_ID,
) -> LearnerPreferences:
    existing = get_learner_preferences(scope_type, scope_id)
    return existing or upsert_learner_preferences(scope_type, scope_id)


def effective_preferences(project_id: int) -> LearnerPreferences:
    return get_learner_preferences("project", str(project_id)) or default_preferences()


def update_preferences(
    project_id: int,
    values: dict[str, object],
    scope: str = "global",
) -> LearnerPreferences:
    scope_type = "project" if scope == "project" else "global"
    scope_id = str(project_id) if scope_type == "project" else GLOBAL_SCOPE_ID
    current = get_learner_preferences(scope_type, scope_id)
    if current is None:
        base = effective_preferences(project_id)
        current = upsert_learner_preferences(
            scope_type,
            scope_id,
            answer_depth=base.answer_depth,
            code_ratio=base.code_ratio,
            explanation_order=base.explanation_order,
            prerequisite_detail=base.prerequisite_detail,
            terminology_density=base.terminology_density,
            survey_enabled=base.survey_enabled,
        )

    allowed_orders = {"balanced", "example_first", "principle_first", "code_first"}

    def numeric(name: str, fallback: float) -> float:
        value = values.get(name)
        return fallback if value is None else max(0.0, min(1.0, float(value)))

    order = str(values.get("explanation_order") or current.explanation_order)
    if order not in allowed_orders:
        order = current.explanation_order
    return upsert_learner_preferences(
        scope_type,
        scope_id,
        answer_depth=numeric("answer_depth", current.answer_depth),
        code_ratio=numeric("code_ratio", current.code_ratio),
        explanation_order=order,
        prerequisite_detail=numeric("prerequisite_detail", current.prerequisite_detail),
        terminology_density=numeric("terminology_density", current.terminology_density),
        feedback_count=current.feedback_count,
        survey_enabled=bool(values.get("survey_enabled", current.survey_enabled)),
        last_survey_at=current.last_survey_at,
    )


def apply_preference_feedback(
    project_id: int,
    *,
    dimension: str,
    choice: str,
    source: str,
    idempotency_key: str,
    qa_record_id: Optional[int] = None,
    scope: str = "global",
) -> LearnerPreferences:
    scope_type = "project" if scope == "project" else "global"
    scope_id = str(project_id) if scope_type == "project" else GLOBAL_SCOPE_ID
    current = get_learner_preferences(scope_type, scope_id) or default_preferences(
        scope_type,
        scope_id,
    )
    if any(
        event.idempotency_key == idempotency_key
        for event in list_preference_events(scope_type, scope_id, 200)
    ):
        return current

    explicit = source in {"explicit_user", "survey"}
    max_delta = 0.05 if explicit else 0.02
    decay = max(0.35, 1.0 / math.sqrt(1.0 + current.feedback_count / 8.0))
    magnitude = max_delta * decay
    positive = {
        "more",
        "deeper",
        "code",
        "examples",
        "prerequisites",
        "terms",
        "too_shallow",
    }
    negative = {"less", "shorter", "principles", "fewer", "too_deep"}
    signed = magnitude if choice in positive else (-magnitude if choice in negative else 0.0)

    values: dict[str, object] = {}
    if dimension == "explanation_order":
        values["explanation_order"] = {
            "examples": "example_first",
            "principles": "principle_first",
            "code": "code_first",
            "balanced": "balanced",
        }.get(choice, current.explanation_order)
    elif dimension in {
        "answer_depth",
        "code_ratio",
        "prerequisite_detail",
        "terminology_density",
    }:
        values[dimension] = max(
            0.0,
            min(1.0, float(getattr(current, dimension)) + signed),
        )

    insert_preference_event(
        event_id=str(uuid4()),
        idempotency_key=idempotency_key,
        scope_type=scope_type,
        scope_id=scope_id,
        dimension=dimension,
        delta=signed,
        source=source,
        qa_record_id=qa_record_id,
        evidence_text=choice,
    )
    updated = update_preferences(project_id, values, scope=scope)
    return upsert_learner_preferences(
        updated.scope_type,
        updated.scope_id,
        answer_depth=updated.answer_depth,
        code_ratio=updated.code_ratio,
        explanation_order=updated.explanation_order,
        prerequisite_detail=updated.prerequisite_detail,
        terminology_density=updated.terminology_density,
        feedback_count=current.feedback_count + 1,
        survey_enabled=updated.survey_enabled,
        last_survey_at=(
            datetime.now(timezone.utc).isoformat()
            if source == "survey"
            else current.last_survey_at
        ),
    )


def infer_preferences_from_question(project_id: int, qa_record: QARecord) -> None:
    text = qa_record.question.casefold()
    signals: list[tuple[str, str]] = []
    if re.search(r"(详细|一步一步|深入|展开|detail|step by step)", text):
        signals.append(("answer_depth", "more"))
    if re.search(r"(简单|简短|一句话|直接说|concise|brief)", text):
        signals.append(("answer_depth", "less"))
    if re.search(r"(代码|示例代码|code|实现)", text):
        signals.append(("code_ratio", "code"))
    if re.search(r"(举例|例子|example|类比)", text):
        signals.append(("explanation_order", "examples"))
    if re.search(r"(原理|为什么|底层|principle|why)", text):
        signals.append(("explanation_order", "principles"))
    if re.search(r"(小白|前置|基础|从头|prerequisite)", text):
        signals.append(("prerequisite_detail", "more"))
    for dimension, choice in signals:
        apply_preference_feedback(
            project_id,
            dimension=dimension,
            choice=choice,
            source="implicit_question",
            idempotency_key=f"qa-pref:{qa_record.id}:{dimension}:{choice}",
            qa_record_id=qa_record.id,
        )


def _record_learning_signal(
    project_id: int,
    concept: Concept,
    event_type: str,
    qa_record: QARecord,
) -> None:
    key = f"qa-learning:{qa_record.id}:{concept.id}:{event_type}"
    if get_event_by_idempotency_key(key):
        return
    scope_type, scope_id = concept_scope(concept, project_id)
    current = get_concept_mastery(concept.id, scope_type, scope_id)
    known = current.known_evidence if current else 1.0
    unknown = current.unknown_evidence if current else 1.0
    manual_status = current.manual_status if current else None
    if manual_status is None:
        unknown += 1.0

    insert_learning_event(
        event_id=str(uuid4()),
        idempotency_key=key,
        schema_version=1,
        concept_id=concept.id,
        scope_type=scope_type,
        scope_id=scope_id,
        event_type=event_type,
        direction="unknown",
        strength=1.0,
        source="system_inference",
        evidence_text=qa_record.question[:200],
        session_id=str(qa_record.session_id) if qa_record.session_id else None,
        qa_record_id=qa_record.id,
    )
    total = max(known + unknown, 1.0)
    upsert_concept_mastery(
        mastery_id=current.id if current else str(uuid4()),
        concept_id=concept.id,
        scope_type=scope_type,
        scope_id=scope_id,
        known_evidence=known,
        unknown_evidence=unknown,
        mastery=known / total,
        uncertainty=1.0 / math.sqrt(total),
        manual_status=manual_status,
        sequence=(current.sequence + 1) if current else 1,
    )


def concepts_for_question(
    project_id: int,
    question: str,
    selected_text: str = "",
    source_type: Optional[str] = None,
    source_path: Optional[str] = None,
) -> list[Concept]:
    haystack = f"{question}\n{selected_text}".casefold()
    resolved: dict[str, Concept] = {}
    if selected_text.strip() and len(selected_text.strip()) <= 80:
        concept = resolve_concept(project_id, selected_text.strip(), "rule", 0.9)
        resolved[concept.id] = concept
    if source_type in {"course", "qa"} and source_path:
        for term in list_document_terms(project_id, source_type, source_path):
            if term.term_text.casefold() in haystack:
                concept = (
                    get_concept(term.concept_id)
                    if term.concept_id
                    else resolve_concept(
                        project_id,
                        term.term_text,
                        term.detection_source,
                        term.confidence,
                    )
                )
                if concept:
                    resolved[concept.id] = concept
    for concept in list_all_concepts():
        names = [concept.canonical_name]
        try:
            names.extend(json.loads(concept.aliases_json or "[]"))
        except json.JSONDecodeError:
            pass
        if any(
            isinstance(name, str) and len(name) >= 2 and name.casefold() in haystack
            for name in names
        ):
            resolved[concept.id] = concept
    return list(resolved.values())[:8]


def _parent_concepts(project_id: int, qa_record: QARecord) -> list[Concept]:
    if not qa_record.parent_qa_id:
        return []
    parent = get_qa_record(project_id, qa_record.parent_qa_id)
    if parent is None:
        return []
    return concepts_for_question(
        project_id,
        parent.question,
        parent.selected_text,
        parent.source_type,
        parent.source_path,
    )


def record_question_learning(project_id: int, qa_record: QARecord) -> None:
    concepts = concepts_for_question(
        project_id,
        qa_record.question,
        qa_record.selected_text,
        qa_record.source_type,
        qa_record.source_path,
    )
    if qa_record.parent_qa_id and not concepts:
        concepts = _parent_concepts(project_id, qa_record)
    event_type = (
        "asked_clarification"
        if qa_record.parent_qa_id
        else "asked_definition"
        if DEFINITION_RE.search(qa_record.question)
        or qa_record.relation_type == "term_explanation"
        else ""
    )
    if event_type:
        for concept in concepts:
            _record_learning_signal(project_id, concept, event_type, qa_record)
    infer_preferences_from_question(project_id, qa_record)


def build_learner_context(
    project_id: int,
    question: str,
    selected_text: str = "",
    source_type: Optional[str] = None,
    source_path: Optional[str] = None,
) -> str:
    preferences = effective_preferences(project_id)
    concepts = concepts_for_question(
        project_id,
        question,
        selected_text,
        source_type,
        source_path,
    )
    known: list[str] = []
    unfamiliar: list[str] = []
    uncertain: list[str] = []
    for concept in sorted(concepts, key=lambda item: item.canonical_name.casefold()):
        scope_type, scope_id = concept_scope(concept, project_id)
        mastery = get_concept_mastery(concept.id, scope_type, scope_id)
        if mastery and mastery.manual_status == "known":
            known.append(concept.display_name)
        elif mastery and mastery.manual_status == "unknown":
            unfamiliar.append(concept.display_name)
        elif mastery and mastery.mastery >= 0.75:
            known.append(concept.display_name)
        elif mastery and mastery.mastery <= 0.35:
            unfamiliar.append(concept.display_name)
        else:
            uncertain.append(concept.display_name)

    order_labels = {
        "balanced": "结论、直觉、示例和原理保持平衡",
        "example_first": "先给直观例子，再解释原理",
        "principle_first": "先说明原因和原理，再给例子",
        "code_first": "先给可读代码，再拆解概念",
    }
    depth = (
        "简洁"
        if preferences.answer_depth < 0.35
        else "深入"
        if preferences.answer_depth > 0.65
        else "适中"
    )
    code = (
        "代码示例较多"
        if preferences.code_ratio > 0.65
        else "文字解释较多"
        if preferences.code_ratio < 0.35
        else "代码与解释平衡"
    )
    prerequisites = (
        "主动补充必要前置知识"
        if preferences.prerequisite_detail > 0.6
        else "只补充直接相关的前置知识"
    )

    def lines(values: Iterable[str]) -> str:
        items = list(values)
        return "\n".join(f"- {value}" for value in items) if items else "- 无"

    return f"""<learner_context>
回答偏好：
- 回答深度：{depth}
- 组织顺序：{order_labels.get(preferences.explanation_order, order_labels["balanced"])}
- 示例比例：{code}
- 前置知识：{prerequisites}

本轮相关已掌握概念：
{lines(known)}

本轮相关可能陌生概念：
{lines(unfamiliar)}

本轮相关不确定概念：
{lines(uncertain)}

使用要求：
- 优先回答当前问题，当前问题中的明确要求高于历史偏好。
- 已掌握概念不要重复做入门定义。
- 可能陌生概念第一次使用前先用一句大白话解释。
- 不要向用户展示掌握度数值，也不要给用户贴水平标签。
</learner_context>"""
