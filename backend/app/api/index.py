from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

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
        chunk_count=int(status.get("chunk_count") or 0),
        updated_at=status.get("updated_at") if status.get("updated_at") else None,
        error_message=status.get("error_message") if status.get("error_message") else None,
        text_status=str(status.get("text_status") or "not_built"),
        structural_status=str(status.get("structural_status") or "not_built"),
        node_count=int(status.get("node_count") or 0),
        edge_count=int(status.get("edge_count") or 0),
        engine=str(status["engine"]) if status.get("engine") else None,
        degraded_reason=str(status["degraded_reason"]) if status.get("degraded_reason") else None,
        indexed_fingerprint=str(status["indexed_fingerprint"]) if status.get("indexed_fingerprint") else None,
        stage=str(status.get("stage")) if status.get("stage") else None,
        progress_current=int(status.get("progress_current") or 0),
        progress_total=int(status.get("progress_total") or 0),
        processed_files=int(status.get("processed_files") or 0),
        unchanged_files=int(status.get("unchanged_files") or 0),
        added_files=int(status.get("added_files") or 0),
        updated_files=int(status.get("updated_files") or 0),
        deleted_files=int(status.get("deleted_files") or 0),
        skipped_files=int(status.get("skipped_files") or 0),
        failed_files=int(status.get("failed_files") or 0),
        active_generation=int(status.get("active_generation") or 0),
        building_generation=int(status["building_generation"]) if status.get("building_generation") else None,
        started_at=str(status.get("started_at")) if status.get("started_at") else None,
        finished_at=str(status.get("finished_at")) if status.get("finished_at") else None,
        duration_ms=int(status["duration_ms"]) if status.get("duration_ms") else None,
        last_good_index_at=str(status.get("last_good_index_at")) if status.get("last_good_index_at") else None,
    )


def _run_build(project_id: int, force_verify: bool = False) -> None:
    try:
        build_project_index(project_id, force_verify=force_verify)
    except Exception as exc:
        set_project_index_status(project_id, "failed", 0, str(exc), text_status="failed")


@router.post("/{project_id}/index/build", response_model=ProjectIndexStatusResponse)
def build_index(
    project_id: int,
    background_tasks: BackgroundTasks,
    force_verify: bool = Query(False, description="Force full SHA-256 content verification for all files"),
) -> ProjectIndexStatusResponse:
    _require_project(project_id)
    current = index_status(project_id)
    if current.get("status") == "building":
        return _status_response(project_id)
    set_project_index_status(
        project_id,
        "building",
        0,
        None,
        text_status="building",
        structural_status="not_built",
        degraded_reason=None,
        stage="queued",
    )
    background_tasks.add_task(_run_build, project_id, force_verify)
    return _status_response(project_id)


@router.get("/{project_id}/index/status", response_model=ProjectIndexStatusResponse)
def get_index_status(project_id: int) -> ProjectIndexStatusResponse:
    _require_project(project_id)
    return _status_response(project_id)


@router.post("/{project_id}/search", response_model=list[ProjectSearchResult])
def search(project_id: int, payload: ProjectSearchRequest) -> list[ProjectSearchResult]:
    _require_project(project_id)
    return search_project(project_id, payload.query, source_path=payload.source_path, limit=payload.limit)
