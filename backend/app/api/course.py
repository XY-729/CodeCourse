from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.schemas import CourseContentResponse, CourseFile
from app.services.generation_service import (
    create_empty_course_document,
    delete_project_course_file,
    read_project_course_file,
)
from app.services.storage import get_project

router = APIRouter(prefix="/api/projects", tags=["course"])


def _project_root(project_id: int) -> Path:
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return Path(project.local_path).resolve()


class CreateEmptyCourseRequest(BaseModel):
    title: str


@router.post("/{project_id}/course/empty", response_model=CourseFile)
def create_empty_course(project_id: int, payload: CreateEmptyCourseRequest):
    _project_root(project_id)
    try:
        return create_empty_course_document(project_id, payload.title)
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get("/{project_id}/course/{filename:path}", response_model=CourseContentResponse)
def get_course_content(project_id: int, filename: str) -> CourseContentResponse:
    try:
        content = read_project_course_file(_project_root(project_id), project_id, filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Course file not found: {filename}")
    return CourseContentResponse(filename=filename, content=content)


@router.delete("/{project_id}/course/{filename:path}")
def delete_course_file(project_id: int, filename: str):
    _project_root(project_id)
    try:
        delete_project_course_file(project_id, filename)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid file path")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Course file not found")
    return {"deleted": True, "filename": filename}
