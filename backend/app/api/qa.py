from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import (
    LearningAnchorRequest,
    LearningAnchorResponse,
    QAAskRequest,
    QAFavoriteRequest,
    QARecordResponse,
    QAUpdateRequest,
)
from app.services.qa_service import (
    ask_question,
    edit_record,
    favorite_record,
    read_record,
    read_session_tree,
    read_understanding,
    remove_understanding,
    save_understanding,
    search_records,
)
from app.services.storage import LearningAnchor, QARecord, get_project

router = APIRouter(prefix="/api/projects", tags=["qa"])


def _require_project(project_id: int) -> None:
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if not Path(project.local_path).exists():
        raise HTTPException(status_code=404, detail="Project directory not found")


def _to_response(record: QARecord) -> QARecordResponse:
    return QARecordResponse(
        id=record.id,
        project_id=record.project_id,
        session_id=record.session_id,
        parent_qa_id=record.parent_qa_id,
        relation_type=record.relation_type,
        source_type=record.source_type,
        source_path=record.source_path,
        display_title=record.display_title,
        selected_text=record.selected_text,
        question=record.question,
        answer_md=record.answer_md,
        provider=record.provider,
        model=record.model,
        output_path=record.output_path,
        retrieval_trace=record.retrieval_trace,
        favorite=record.favorite,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _anchor_response(anchor: LearningAnchor) -> LearningAnchorResponse:
    return LearningAnchorResponse(**anchor.__dict__)


@router.post("/{project_id}/qa/ask", response_model=QARecordResponse)
def ask(project_id: int, payload: QAAskRequest) -> QARecordResponse:
    _require_project(project_id)
    try:
        record = ask_question(project_id, payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _to_response(record)


@router.get("/{project_id}/qa", response_model=list[QARecordResponse])
def list_history(
    project_id: int,
    query: str = "",
    favorite: Optional[bool] = Query(default=None),
) -> list[QARecordResponse]:
    _require_project(project_id)
    return [_to_response(record) for record in search_records(project_id, query=query, favorite=favorite)]


@router.get("/{project_id}/qa/sessions/{session_id}/tree", response_model=list[QARecordResponse])
def get_session_tree(project_id: int, session_id: int) -> list[QARecordResponse]:
    _require_project(project_id)
    return [_to_response(record) for record in read_session_tree(project_id, session_id)]


@router.get("/{project_id}/qa/{qa_id}", response_model=QARecordResponse)
def get_history_item(project_id: int, qa_id: int) -> QARecordResponse:
    _require_project(project_id)
    record = read_record(project_id, qa_id)
    if record is None:
        raise HTTPException(status_code=404, detail="QA record not found")
    return _to_response(record)


@router.put("/{project_id}/qa/{qa_id}", response_model=QARecordResponse)
def update_history_item(project_id: int, qa_id: int, payload: QAUpdateRequest) -> QARecordResponse:
    _require_project(project_id)
    record = edit_record(project_id, qa_id, payload.question, payload.answer_md, payload.display_title)
    if record is None:
        raise HTTPException(status_code=404, detail="QA record not found")
    return _to_response(record)


@router.post("/{project_id}/qa/{qa_id}/favorite", response_model=QARecordResponse)
def toggle_favorite(project_id: int, qa_id: int, payload: QAFavoriteRequest) -> QARecordResponse:
    _require_project(project_id)
    record = favorite_record(project_id, qa_id, payload.favorite)
    if record is None:
        raise HTTPException(status_code=404, detail="QA record not found")
    return _to_response(record)


@router.get("/{project_id}/qa/{qa_id}/understanding", response_model=LearningAnchorResponse)
def get_understanding(project_id: int, qa_id: int) -> LearningAnchorResponse:
    _require_project(project_id)
    anchor = read_understanding(project_id, qa_id)
    if anchor is None:
        raise HTTPException(status_code=404, detail="Learning anchor not found")
    return _anchor_response(anchor)


@router.post("/{project_id}/qa/{qa_id}/understanding", response_model=LearningAnchorResponse)
def put_understanding(project_id: int, qa_id: int, payload: LearningAnchorRequest) -> LearningAnchorResponse:
    _require_project(project_id)
    try:
        anchor = save_understanding(project_id, qa_id, payload.summary, payload.term_text)
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _anchor_response(anchor)


@router.delete("/{project_id}/qa/{qa_id}/understanding")
def delete_understanding(project_id: int, qa_id: int):
    _require_project(project_id)
    if not remove_understanding(project_id, qa_id):
        raise HTTPException(status_code=404, detail="Learning anchor not found")
    return {"deleted": True, "qa_id": qa_id}


@router.delete("/{project_id}/qa/{qa_id}")
def delete_history_item(project_id: int, qa_id: int):
    _require_project(project_id)
    from app.services.qa_service import delete_record
    deleted = delete_record(project_id, qa_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="QA record not found")
    return {"deleted": True, "id": qa_id}
