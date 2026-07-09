from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.models.schemas import ExplainRequest, ExplainResponse, ImportProjectRequest, ProjectActionResponse, ProjectResponse, TreeNode
from app.services.course_generator import generate_course, list_course_files
from app.services.explainer import explain
from app.services.git_service import clone_or_reuse, repo_name_from_url, validate_git_url
from app.services.scanner import scan_tree
from app.core.config import REPOS_ROOT
from app.services.storage import delete_project, get_project, list_projects, update_project_status, upsert_project

router = APIRouter(prefix="/api", tags=["projects"])


def _project_root(project_id: int) -> Path:
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    root = Path(project.local_path).resolve()
    if not root.exists():
        raise HTTPException(status_code=404, detail="Project directory not found")
    return root


def _to_project_response(project) -> ProjectResponse:
    course_files = []
    root = Path(project.local_path)
    if root.exists():
        course_files = [item.filename for item in list_course_files(root)]
    return ProjectResponse(
        id=project.id,
        name=project.name,
        url=project.url,
        local_path=project.local_path,
        status=project.status,
        course_files=course_files,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.post("/projects/import", response_model=ProjectResponse)
def import_project(payload: ImportProjectRequest) -> ProjectResponse:
    url = validate_git_url(payload.url)
    repo_root = clone_or_reuse(url)
    course_files = generate_course(repo_root)
    project = upsert_project(repo_name_from_url(url), url, repo_root, "ready")
    response = _to_project_response(project)
    response.course_files = [item.filename for item in course_files]
    return response


@router.get("/projects", response_model=list[ProjectResponse])
def get_projects() -> list[ProjectResponse]:
    return [_to_project_response(project) for project in list_projects()]


@router.get("/projects/{project_id}", response_model=ProjectResponse)
def get_project_detail(project_id: int) -> ProjectResponse:
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _to_project_response(project)


@router.get("/projects/{project_id}/tree", response_model=TreeNode)
def get_tree(project_id: int) -> TreeNode:
    return scan_tree(_project_root(project_id))


@router.get("/projects/{project_id}/course")
def get_course_files(project_id: int):
    return list_course_files(_project_root(project_id))


@router.post("/projects/{project_id}/regenerate", response_model=ProjectActionResponse)
def regenerate_course(project_id: int) -> ProjectActionResponse:
    repo_root = _project_root(project_id)
    course_files = generate_course(repo_root)
    update_project_status(project_id, "ready")
    return ProjectActionResponse(
        id=project_id,
        status="ready",
        message="Course regenerated",
        course_files=[item.filename for item in course_files],
    )


@router.delete("/projects/{project_id}", response_model=ProjectActionResponse)
def remove_project(project_id: int) -> ProjectActionResponse:
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    repo_root = Path(project.local_path).resolve()
    if repo_root.exists():
        if REPOS_ROOT.resolve() not in repo_root.parents:
            raise HTTPException(status_code=400, detail="Stored project path is outside the repos workspace")
        import shutil

        shutil.rmtree(repo_root)
    deleted = delete_project(project_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectActionResponse(id=project_id, status="deleted", message="Project deleted", course_files=[])


@router.post("/explain", response_model=ExplainResponse)
def explain_selection(payload: ExplainRequest) -> ExplainResponse:
    repo_root = _project_root(payload.project_id)
    provider, explanation = explain(repo_root, payload.path, payload.selection, payload.mode)
    return ExplainResponse(provider=provider, explanation=explanation)
