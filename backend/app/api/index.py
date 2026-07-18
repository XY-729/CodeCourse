from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.models.schemas import ProjectIndexStatusResponse, ProjectSearchRequest, ProjectSearchResult
from app.services.index_service import build_project_index, index_status, search_project
from app.services.storage import get_project, set_project_index_status

router = APIRouter(prefix="/api/projects", tags=["index"])


def _require_project(project_id: int) -> None:
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if not Path(project.local_path).exists():
        raise HTTPException(status_code=404, detail="Project directory not found")


def _status_response(project_id: int) -> ProjectIndexStatusResponse:
    status = index_status(project_id)
    return ProjectIndexStatusResponse(
        project_id=int(status["project_id"]),
        status=str(status["status"]),
        chunk_count=int(status["chunk_count"]),
        updated_at=status["updated_at"] if status["updated_at"] else None,
        error_message=status["error_message"] if status["error_message"] else None,
        text_status=str(status.get("text_status") or "not_built"),
        structural_status=str(status.get("structural_status") or "not_built"),
        node_count=int(status.get("node_count") or 0),
        edge_count=int(status.get("edge_count") or 0),
        engine=str(status["engine"]) if status.get("engine") else None,
        degraded_reason=str(status["degraded_reason"]) if status.get("degraded_reason") else None,
        indexed_fingerprint=str(status["indexed_fingerprint"]) if status.get("indexed_fingerprint") else None,
    )


def _run_build(project_id: int) -> None:
    try:
        build_project_index(project_id)
    except Exception as exc:
        set_project_index_status(project_id, "failed", 0, str(exc), text_status="failed")


@router.post("/{project_id}/index/build", response_model=ProjectIndexStatusResponse)
def build_index(project_id: int, background_tasks: BackgroundTasks) -> ProjectIndexStatusResponse:
    _require_project(project_id)
    set_project_index_status(
        project_id,
        "building",
        0,
        None,
        text_status="building",
        structural_status="not_built",
        degraded_reason=None,
    )
    background_tasks.add_task(_run_build, project_id)
    return _status_response(project_id)


@router.get("/{project_id}/index/status", response_model=ProjectIndexStatusResponse)
def get_index_status(project_id: int) -> ProjectIndexStatusResponse:
    _require_project(project_id)
    return _status_response(project_id)


@router.post("/{project_id}/search", response_model=list[ProjectSearchResult])
def search(project_id: int, payload: ProjectSearchRequest) -> list[ProjectSearchResult]:
    _require_project(project_id)
    return search_project(project_id, payload.query, source_path=payload.source_path, limit=payload.limit)
