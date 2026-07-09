from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import FileContentResponse
from app.services.scanner import read_text_file
from app.services.storage import get_project

router = APIRouter(prefix="/api/projects", tags=["files"])


def _project_root(project_id: int) -> Path:
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return Path(project.local_path).resolve()


@router.get("/{project_id}/file", response_model=FileContentResponse)
def get_file(project_id: int, path: str = Query(min_length=1)) -> FileContentResponse:
    content, language = read_text_file(_project_root(project_id), path)
    return FileContentResponse(path=path, language=language, content=content)
