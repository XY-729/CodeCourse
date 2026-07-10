from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import HighlightCreateRequest, HighlightResponse
from app.services.storage import (
    HighlightRecord,
    create_highlight,
    delete_highlight,
    get_project,
    list_highlights,
)

router = APIRouter(prefix="/api/projects", tags=["highlights"])


def _require_project(project_id: int) -> None:
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if not Path(project.local_path).exists():
        raise HTTPException(status_code=404, detail="Project directory not found")


def _to_response(record: HighlightRecord) -> HighlightResponse:
    return HighlightResponse(
        id=record.id,
        project_id=record.project_id,
        source_type=record.source_type,
        source_path=record.source_path,
        selected_text=record.selected_text,
        color=record.color,
        note=record.note,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


@router.post("/{project_id}/highlights", response_model=HighlightResponse)
def create(project_id: int, payload: HighlightCreateRequest) -> HighlightResponse:
    _require_project(project_id)
    record = create_highlight(
        project_id=project_id,
        source_type=payload.source_type,
        source_path=payload.source_path,
        selected_text=payload.selected_text,
        color=payload.color,
        note=payload.note,
    )
    return _to_response(record)


@router.get("/{project_id}/highlights", response_model=list[HighlightResponse])
def list_project_highlights(
    project_id: int,
    source_type: Optional[str] = Query(default=None),
    source_path: Optional[str] = Query(default=None),
) -> list[HighlightResponse]:
    _require_project(project_id)
    records = list_highlights(project_id, source_type=source_type, source_path=source_path)
    return [_to_response(record) for record in records]


@router.delete("/{project_id}/highlights/{highlight_id}", response_model=dict[str, bool])
def remove(project_id: int, highlight_id: int) -> dict[str, bool]:
    _require_project(project_id)
    deleted = delete_highlight(project_id, highlight_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Highlight not found")
    return {"deleted": True}
