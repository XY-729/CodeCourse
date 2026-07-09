from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.models.schemas import (
    ExplainRequest,
    ExplainResponse,
    GenerateFileLessonRequest,
    GenerateOutlineRequest,
    GenerationTaskResponse,
    ImportProjectRequest,
    ProjectActionResponse,
    ProjectResponse,
    TreeNode,
)
from app.services.explainer import explain
from app.services.generation_service import (
    create_or_reuse_file_lesson_task,
    create_or_reuse_outline_task,
    generate_rule_course,
    list_project_course_files,
    project_course_dir,
    run_file_lesson_task,
    run_outline_generation_task,
)
from app.services.git_service import clone_or_reuse, repo_name_from_url, validate_git_url
from app.services.scanner import scan_tree
from app.core.config import REPOS_ROOT
from app.services.storage import (
    GenerationTask,
    delete_project,
    get_generation_task,
    get_llm_settings,
    get_project,
    list_generation_tasks,
    list_projects,
    update_project_status,
    upsert_project,
)

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
        course_files = [item.filename for item in list_project_course_files(root, project.id)]
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


def _to_task_response(task: GenerationTask) -> GenerationTaskResponse:
    return GenerationTaskResponse(
        id=task.id,
        project_id=task.project_id,
        task_type=task.task_type,
        status=task.status,
        source_path=task.source_path,
        mode=task.mode,
        model=task.model,
        prompt_version=task.prompt_version,
        input_hash=task.input_hash,
        output_path=task.output_path,
        error_message=task.error_message,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


@router.post("/projects/import", response_model=ProjectResponse)
def import_project(payload: ImportProjectRequest) -> ProjectResponse:
    url = validate_git_url(payload.url)
    repo_root = clone_or_reuse(url)
    project = upsert_project(repo_name_from_url(url), url, repo_root, "scanned")
    course_files = generate_rule_course(project.id, repo_root)
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
    return list_project_course_files(_project_root(project_id), project_id)


@router.post("/projects/{project_id}/regenerate", response_model=ProjectActionResponse)
def regenerate_course(project_id: int) -> ProjectActionResponse:
    repo_root = _project_root(project_id)
    course_files = generate_rule_course(project_id, repo_root)
    update_project_status(project_id, "scanned")
    return ProjectActionResponse(
        id=project_id,
        status="scanned",
        message="Rule fallback course regenerated",
        course_files=[item.filename for item in course_files],
    )


@router.post("/projects/{project_id}/outline/generate", response_model=GenerationTaskResponse)
def generate_outline(project_id: int, payload: GenerateOutlineRequest, background_tasks: BackgroundTasks) -> GenerationTaskResponse:
    repo_root = _project_root(project_id)
    settings = get_llm_settings()
    task, reused = create_or_reuse_outline_task(project_id, repo_root, payload.scope, settings.get("model"))
    if not reused:
        background_tasks.add_task(run_outline_generation_task, project_id, task.id, payload.scope)
    return _to_task_response(task)


@router.post("/projects/{project_id}/lessons/file", response_model=GenerationTaskResponse)
def generate_file_lesson(project_id: int, payload: GenerateFileLessonRequest, background_tasks: BackgroundTasks) -> GenerationTaskResponse:
    repo_root = _project_root(project_id)
    settings = get_llm_settings()
    task, reused = create_or_reuse_file_lesson_task(project_id, repo_root, payload.path, payload.mode, settings.get("model"))
    if not reused:
        background_tasks.add_task(run_file_lesson_task, project_id, task.id, payload.path, payload.mode)
    return _to_task_response(task)


@router.get("/projects/{project_id}/tasks", response_model=list[GenerationTaskResponse])
def get_tasks(project_id: int) -> list[GenerationTaskResponse]:
    _project_root(project_id)
    return [_to_task_response(task) for task in list_generation_tasks(project_id)]


@router.get("/projects/{project_id}/tasks/{task_id}", response_model=GenerationTaskResponse)
def get_task(project_id: int, task_id: int) -> GenerationTaskResponse:
    _project_root(project_id)
    task = get_generation_task(task_id)
    if task is None or task.project_id != project_id:
        raise HTTPException(status_code=404, detail="Task not found")
    return _to_task_response(task)


@router.delete("/projects/{project_id}", response_model=ProjectActionResponse)
def remove_project(project_id: int) -> ProjectActionResponse:
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    repo_root = Path(project.local_path).resolve()
    import shutil

    if repo_root.exists():
        if REPOS_ROOT.resolve() not in repo_root.parents:
            raise HTTPException(status_code=400, detail="Stored project path is outside the repos workspace")
        shutil.rmtree(repo_root)
    generated_dir = project_course_dir(project_id)
    if generated_dir.exists():
        shutil.rmtree(generated_dir)
    deleted = delete_project(project_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectActionResponse(id=project_id, status="deleted", message="Project deleted", course_files=[])


@router.post("/explain", response_model=ExplainResponse)
def explain_selection(payload: ExplainRequest) -> ExplainResponse:
    repo_root = _project_root(payload.project_id)
    provider, explanation = explain(repo_root, payload.path, payload.selection, payload.mode)
    return ExplainResponse(provider=provider, explanation=explanation)
