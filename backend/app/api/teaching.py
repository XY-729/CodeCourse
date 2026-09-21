from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import teaching_index as service
from app.services.storage import _connect, get_project

router = APIRouter(prefix="/api/projects", tags=["teaching"])


class Feedback(BaseModel):
    sourceType: Literal["course", "qa"]
    sourcePath: str = Field(min_length=1, max_length=1000)
    result: Literal["understood", "partial", "needs_help", "clear"]
    passageIds: list[str] = Field(default_factory=list, max_length=1000)
    contentHash: str
    requestKey: str = Field(min_length=1, max_length=150)


class ReindexRequest(BaseModel):
    sourceType: Literal["course", "qa"]
    sourcePath: str = Field(min_length=1, max_length=1000)


def project_exists(project_id):
    if get_project(project_id) is None:
        raise HTTPException(404, "项目不存在")


@router.get("/{project_id}/teaching/document")
def document(project_id: int, sourceType: Literal["course", "qa"], sourcePath: str):
    project_exists(project_id)
    try:
        return service.document_state(project_id, sourceType, sourcePath)
    except FileNotFoundError as error:
        raise HTTPException(404, str(error)) from error


@router.get("/{project_id}/teaching/courses")
def courses(project_id: int):
    project_exists(project_id)
    from app.services.generation_service import list_project_course_files
    from pathlib import Path
    files = list_project_course_files(Path(get_project(project_id).local_path), project_id)
    result = []
    for course in files:
        try:
            from app.services.storage import get_qa_record_by_output_path
            source_type = "qa" if get_qa_record_by_output_path(project_id, course.filename) else "course"
            state = service.document_state(project_id, source_type, course.filename)
            result.append({key: value for key, value in state.items() if key not in {"passages", "feedback"}})
        except FileNotFoundError:
            continue
    return result


@router.get("/{project_id}/teaching/reference/{passage_id}")
def reference(project_id: int, passage_id: str):
    project_exists(project_id)
    try:
        return service.resolve_reference(project_id, passage_id)
    except (ValueError, FileNotFoundError) as error:
        raise HTTPException(404, str(error)) from error


@router.post("/{project_id}/teaching/understanding")
def feedback(project_id: int, payload: Feedback):
    project_exists(project_id)
    try:
        return service.save_feedback(project_id, payload.sourceType, payload.sourcePath,
                                     payload.result, payload.passageIds, payload.contentHash, payload.requestKey)
    except FileNotFoundError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@router.post("/{project_id}/teaching/reindex")
def reindex(project_id: int, payload: ReindexRequest):
    project_exists(project_id)
    try:
        return service.reindex_document(project_id, payload.sourceType, payload.sourcePath)
    except FileNotFoundError as error:
        raise HTTPException(404, str(error)) from error
    except (ValueError, RuntimeError) as error:
        raise HTTPException(409, str(error)) from error
