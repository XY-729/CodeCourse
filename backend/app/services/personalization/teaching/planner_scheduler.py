from __future__ import annotations

import hashlib
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from app.services.personalization.teaching.teacher_planner import (
    execute_teacher_planner,
    _is_planner_enabled,
    _always_run_for_followups,
    _get_planner_sample_rate,
)

logger = logging.getLogger(__name__)

_PLANNER_EXECUTOR: Optional[ThreadPoolExecutor] = None
_PLANNER_LOCK = threading.Lock()
_QUEUED_PLAN_KEYS: set[str] = set()
MAX_PLAN_QUEUE = 32


def _get_planner_executor() -> ThreadPoolExecutor:
    global _PLANNER_EXECUTOR
    if _PLANNER_EXECUTOR is None:
        with _PLANNER_LOCK:
            if _PLANNER_EXECUTOR is None:
                _PLANNER_EXECUTOR = ThreadPoolExecutor(
                    max_workers=1,
                    thread_name_prefix="codecourse-planner",
                )
    return _PLANNER_EXECUTOR


def shutdown_planner(wait: bool = True) -> None:
    global _PLANNER_EXECUTOR
    if _PLANNER_EXECUTOR is not None:
        _PLANNER_EXECUTOR.shutdown(wait=wait)
        _PLANNER_EXECUTOR = None


def deterministic_plan_sample(project_id: int, qa_record_id: int, sample_rate: float) -> bool:
    rate = max(0.0, min(1.0, sample_rate))
    digest = hashlib.sha256(
        f"{project_id}:{qa_record_id}:planner-v1".encode("utf-8")
    ).hexdigest()
    value = int(digest[:8], 16) / 0xFFFFFFFF
    return value < rate


def _should_plan(project_id: int, qa_record_id: int, parent_qa_id: int | None, relation_type: str | None) -> bool:
    if not _is_planner_enabled():
        return False
    if parent_qa_id is not None and _always_run_for_followups():
        return True
    if relation_type == "term_explanation":
        return True
    return deterministic_plan_sample(project_id, qa_record_id, _get_planner_sample_rate())


def schedule_teacher_plan(
    project_id: int,
    session_id: int | None,
    qa_record_id: int,
    parent_qa_id: int | None,
    relation_type: str | None,
    question: str,
    selected_text: str,
    source_type: str | None,
    source_path: str | None,
) -> None:
    if not _should_plan(project_id, qa_record_id, parent_qa_id, relation_type):
        return

    plan_key = f"plan:{project_id}:{qa_record_id}"

    global _QUEUED_PLAN_KEYS
    with _PLANNER_LOCK:
        if plan_key in _QUEUED_PLAN_KEYS:
            return
        if len(_QUEUED_PLAN_KEYS) >= MAX_PLAN_QUEUE:
            logger.warning("Planner queue full", extra={"plan_key": plan_key})
            return
        _QUEUED_PLAN_KEYS.add(plan_key)

    def _run_and_cleanup():
        try:
            execute_teacher_planner(
                project_id=project_id,
                session_id=session_id,
                qa_record_id=qa_record_id,
                parent_qa_id=parent_qa_id,
                question=question,
                selected_text=selected_text,
                source_type=source_type,
                source_path=source_path,
            )
        except Exception:
            logger.exception("Planner execution failed")
        finally:
            with _PLANNER_LOCK:
                _QUEUED_PLAN_KEYS.discard(plan_key)

    try:
        _get_planner_executor().submit(_run_and_cleanup)
    except Exception:
        with _PLANNER_LOCK:
            _QUEUED_PLAN_KEYS.discard(plan_key)
        logger.exception("Failed to submit planner task")
