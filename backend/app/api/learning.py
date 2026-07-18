from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.models.schemas import LearningStateResponse, LearningStateUpdateRequest
from app.services.generation_service import list_project_course_files
from app.services.storage import (
    LearningState,
    delete_learning_state,
    get_project,
    get_qa_record_by_output_path,
    list_learning_states,
    reset_learning_states,
    upsert_learning_state,
)

router = APIRouter(prefix="/api/projects", tags=["learning"])


def _project(project_id: int):
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _response(state: LearningState) -> LearningStateResponse:
    return LearningStateResponse(**state.__dict__)


def _is_valid_source(project_id: int, source_type: str, source_path: str) -> bool:
    project = _project(project_id)
    if source_type == "course":
        return source_path in {item.filename for item in list_project_course_files(Path(project.local_path), project_id)}
    if source_type == "qa":
        return get_qa_record_by_output_path(project_id, source_path) is not None
    root = Path(project.local_path).resolve()
    candidate = (root / source_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return False
    return candidate.is_file()


@router.get("/{project_id}/learning-state", response_model=list[LearningStateResponse])
def get_learning_state(project_id: int) -> list[LearningStateResponse]:
    _project(project_id)
    valid: list[LearningStateResponse] = []
    for state in list_learning_states(project_id):
        if _is_valid_source(project_id, state.source_type, state.source_path):
            valid.append(_response(state))
        else:
            delete_learning_state(project_id, state.source_type, state.source_path)
    return valid


@router.put("/{project_id}/learning-state", response_model=LearningStateResponse)
def update_learning_state(project_id: int, payload: LearningStateUpdateRequest) -> LearningStateResponse:
    _project(project_id)
    if not _is_valid_source(project_id, payload.source_type, payload.source_path):
        raise HTTPException(status_code=404, detail="Learning source not found")
    if payload.position_kind == "scroll_ratio" and payload.position_value > 1:
        raise HTTPException(status_code=400, detail="Scroll ratio must be between 0 and 1")
    state = upsert_learning_state(
        project_id,
        payload.source_type,
        payload.source_path,
        payload.status,
        payload.position_kind,
        payload.position_value,
    )
    return _response(state)


@router.delete("/{project_id}/learning-state")
def reset_learning_state(project_id: int) -> dict[str, int | bool]:
    _project(project_id)
    deleted = reset_learning_states(project_id)
    return {"reset": True, "deleted": deleted}
