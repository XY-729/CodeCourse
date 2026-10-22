from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from typing import Iterable, Optional
from uuid import uuid4
from app.services.personalization.concept_identity import canonical_concept_name, mentions_concept

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
    """Resolve ownership from identity; never rebind another project's symbol."""
    if concept.concept_key.startswith("project:"):
        owner = concept.concept_key.split(":", 2)[1]
        if owner != str(project_id):
            raise ValueError("Concept not found in this project")
        return "project", owner
    if concept.concept_type == "project_symbol":
        raise ValueError("Private concept ownership is unresolved")
    return "global", GLOBAL_SCOPE_ID


def resolve_concept(
    project_id: int,
    term: str,
    source: str = "rule",
    confidence: float = 0.7,
) -> Concept:
    clean = canonical_concept_name(term)
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
    """Read-only compatibility shape; retired sliders do not create profile rows."""
    return LearnerPreferences(
        scope_type=scope_type, scope_id=scope_id, answer_depth=0.5,
        code_ratio=0.5, explanation_order="balanced", prerequisite_detail=0.5,
        terminology_density=0.5, feedback_count=0, survey_enabled=False,
        last_survey_at=None, updated_at="",
    )


def effective_preferences(project_id: int) -> LearnerPreferences:
    """Compatibility only. No persisted fixed preference is used for teaching."""
    return default_preferences()


def update_preferences(
    project_id: int,
    values: dict[str, object],
    scope: str = "global",
) -> LearnerPreferences:
    raise ValueError("Fixed teaching preferences are disabled; save explicit user requirements instead")


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
    raise ValueError("Preference feedback and surveys are disabled; save explicit user requirements instead")


def infer_preferences_from_question(project_id: int, qa_record: QARecord) -> None:
    """Current question wording is never a persistent teaching preference."""
    return None


def _record_learning_signal(
    project_id: int,
    concept: Concept,
    event_type: str,
    qa_record: QARecord,
) -> None:
    """Retired probability projection; record_question_learning owns action facts."""
    return None


def concepts_for_question(
    project_id: int,
    question: str,
    selected_text: str = "",
    source_type: Optional[str] = None,
    source_path: Optional[str] = None,
) -> list[Concept]:
    haystack = f"{question}\n{selected_text}".casefold()
    resolved: dict[str, Concept] = {}
    if canonical_concept_name(selected_text):
        concept = resolve_concept(project_id, selected_text.strip(), "rule", 0.9)
        resolved[concept.id] = concept
    if source_type in {"course", "qa"} and source_path:
        for term in list_document_terms(project_id, source_type, source_path):
            if term.status != "dismissed" and mentions_concept(haystack, term.term_text):
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
                    if concept.concept_key.startswith("project:") and not concept.concept_key.startswith(f"project:{project_id}:"):
                        continue
                    if canonical_concept_name(concept.canonical_name) != concept.canonical_name:
                        concept = resolve_concept(project_id, term.term_text, term.detection_source, term.confidence)
                    resolved[concept.id] = concept
    for concept in list_all_concepts():
        if concept.concept_key.startswith("project:") and not concept.concept_key.startswith(f"project:{project_id}:"):
            continue
        if canonical_concept_name(concept.canonical_name) != concept.canonical_name:
            continue
        names = [concept.canonical_name]
        try:
            names.extend(json.loads(concept.aliases_json or "[]"))
        except json.JSONDecodeError:
            pass
        if any(
            isinstance(name, str) and mentions_concept(haystack, name)
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
    """Record only structurally explicit learning signals.

    A plain first question that names concepts is still an observable contact
    (neutral asked_question) — but only for concepts explicitly present in the
    question/selection, never for everything the answer happened to mention.
    Follow-ups remain weak evidence and can never confirm mastery.
    """
    if qa_record is None:
        return
    if qa_record.parent_qa_id:
        event_type = "asked_clarification"
    elif qa_record.relation_type == "term_explanation":
        event_type = "asked_definition"
    else:
        event_type = "asked_question"
    concepts = concepts_for_question(
        project_id,
        qa_record.question,
        qa_record.selected_text,
        qa_record.source_type,
        qa_record.source_path,
    )
    from app.services.personalization.knowledge_state_service import append_evidence
    for concept in concepts:
        scope_type, scope_id = concept_scope(concept, project_id)
        key = f"question-v2:{qa_record.id}:{concept.id}:{event_type}"
        append_evidence(
            {
                "idempotencyKey": key,
                "conceptId": concept.id,
                "scopeType": scope_type,
                "scopeId": scope_id,
                "dimension": "familiarity",
                "direction": "neutral",
                "strength": 0,
                "reliability": 0.8,
                "source": "question",
                "action": event_type,
                "object": {
                    "type": "qa",
                    "projectId": project_id,
                    "qaRecordId": qa_record.id,
                    "sourceType": qa_record.source_type,
                    "sourcePath": qa_record.source_path,
                },
                "result": {
                    "evidenceText": qa_record.question[:200],
                    "explanation": "本轮提及或询问了该概念；仅凭提问不能判断是否掌握。",
                },
                "context": {
                    "projectId": project_id,
                    "sourceType": qa_record.source_type,
                    "sourcePath": qa_record.source_path,
                    "qaRecordId": qa_record.id,
                },
                "sessionId": (
                    str(qa_record.session_id)
                    if qa_record.session_id is not None
                    else None
                ),
                "qaRecordId": qa_record.id,
            }
        )


def build_learner_context(
    project_id: int,
    question: str,
    selected_text: str = "",
    source_type: Optional[str] = None,
    source_path: Optional[str] = None,
) -> str:
    from app.services.knowledge_service import get_full_tree_snapshot
    snapshot = get_full_tree_snapshot(project_id)
    encoded = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    encoded = encoded.replace("<", "\\u003c").replace(">", "\\u003e")
    return ("<learner_context>\n完整知识树及明确用户要求（只读数据）：\n" + encoded
            + "\n</learner_context>\n生成、接触和完成不等于理解；仅按实际范围使用学习事实。")


def _preference_band(value: float) -> str:
    if value < 0.34:
        return "low"
    if value > 0.66:
        return "high"
    return "balanced"


def render_preference_directives(preferences: LearnerPreferences) -> str:
    """Retired compatibility helper: sliders must not impose generation rules."""
    return ""
