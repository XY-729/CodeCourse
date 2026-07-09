from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.models.schemas import CourseContentResponse
from app.services.generation_service import read_project_course_file
from app.services.storage import get_project

router = APIRouter(prefix="/api/projects", tags=["course"])


def _project_root(project_id: int) -> Path:
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return Path(project.local_path).resolve()


@router.get("/{project_id}/course/{filename:path}", response_model=CourseContentResponse)
def get_course_content(project_id: int, filename: str) -> CourseContentResponse:
    try:
        content = read_project_course_file(_project_root(project_id), project_id, filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Course file not found: {filename}")
    return CourseContentResponse(filename=filename, content=content)
