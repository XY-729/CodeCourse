from __future__ import annotations

import asyncio
import json as json_module
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse

from app.models.schemas import (
    CreateLearningPlanRequest,
    GenerateFileLessonRequest,
    GenerateOutlineLessonRequest,
    GenerateOutlineRequest,
    GenerationTaskResponse,
    ImportProjectRequest,
    ProjectActionResponse,
    ProjectResponse,
    TreeNode,
)
from app.services.generation_service import (
    create_or_reuse_file_lesson_task,
    create_or_reuse_outline_lesson_task,
    create_or_reuse_outline_task,
    generate_rule_course,
    list_project_course_files,
    project_course_dir,
    run_file_lesson_task,
    run_outline_lesson_task,
    run_outline_generation_task,
    stream_outline_generation,
    stream_file_lesson_generation,
    stream_outline_lesson_generation,
)
from app.services.git_service import clone_or_reuse, repo_name_from_url, validate_git_url
from app.services.index_service import build_project_index
from app.services.code_intelligence import remove_structural_project_data
from app.services.scanner import scan_tree
from app.core.config import REPOS_ROOT
from app.services.storage import (
    GenerationTask,
    create_learning_plan_project,
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
        project_type=project.project_type,
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
        progress_current=task.progress_current,
        progress_total=task.progress_total,
        stage_label=task.stage_label,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _run_index_build(project_id: int) -> None:
    try:
        build_project_index(project_id)
    except Exception:
        # build_project_index persists failure status; import should stay successful
        pass


@router.post("/projects/import", response_model=ProjectResponse)
def import_project(payload: ImportProjectRequest, background_tasks: BackgroundTasks) -> ProjectResponse:
    url = validate_git_url(payload.url)
    repo_root = clone_or_reuse(url)
    project = upsert_project(repo_name_from_url(url), url, repo_root, "scanned")
    course_files = generate_rule_course(project.id, repo_root)
    background_tasks.add_task(_run_index_build, project.id)
    response = _to_project_response(project)
    response.course_files = [item.filename for item in course_files]
    return response


def _safe_plan_dir_name(name: str) -> str:
    import re
    from datetime import datetime, timezone

    safe = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", name.strip()).strip("_")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    return f"{safe or 'learning_plan'}_{stamp}"


@router.post("/projects/learning-plan", response_model=ProjectResponse)
def create_learning_plan(payload: CreateLearningPlanRequest) -> ProjectResponse:
    name = payload.name.strip()
    root = REPOS_ROOT / "_learning_plans" / _safe_plan_dir_name(name)
    project = create_learning_plan_project(name, root)
    return _to_project_response(project)


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
    project = get_project(project_id)
    if project is not None and project.project_type == "learning_plan":
        return TreeNode(name=project.name, path="", type="directory", children=[], is_key_file=False)
    return scan_tree(_project_root(project_id))


@router.get("/projects/{project_id}/course")
def get_course_files(project_id: int):
    return list_project_course_files(_project_root(project_id), project_id)


@router.post("/projects/{project_id}/regenerate", response_model=ProjectActionResponse)
def regenerate_course(project_id: int) -> ProjectActionResponse:
    project = get_project(project_id)
    if project is not None and project.project_type == "learning_plan":
        return ProjectActionResponse(
            id=project_id,
            status=project.status,
            message="Learning plan has no default course files",
            course_files=[],
        )
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
    task, reused = create_or_reuse_outline_task(project_id, repo_root, payload.scope, settings.get("model"), payload.instructions)
    if not reused:
        background_tasks.add_task(run_outline_generation_task, project_id, task.id, payload.scope, payload.instructions)
    return _to_task_response(task)


@router.post("/projects/{project_id}/lessons/file", response_model=GenerationTaskResponse)
def generate_file_lesson(project_id: int, payload: GenerateFileLessonRequest, background_tasks: BackgroundTasks) -> GenerationTaskResponse:
    repo_root = _project_root(project_id)
    settings = get_llm_settings()
    task, reused = create_or_reuse_file_lesson_task(project_id, repo_root, payload.path, payload.mode, settings.get("model"), payload.instructions)
    if not reused:
        background_tasks.add_task(run_file_lesson_task, project_id, task.id, payload.path, payload.mode, payload.instructions)
    return _to_task_response(task)


@router.post("/projects/{project_id}/lessons/outline", response_model=GenerationTaskResponse)
def generate_outline_lesson(project_id: int, payload: GenerateOutlineLessonRequest, background_tasks: BackgroundTasks) -> GenerationTaskResponse:
    repo_root = _project_root(project_id)
    settings = get_llm_settings()
    task, reused = create_or_reuse_outline_lesson_task(
        project_id,
        repo_root,
        payload.lesson_number,
        payload.title,
        settings.get("model"),
        payload.instructions,
    )
    if not reused:
        background_tasks.add_task(
            run_outline_lesson_task,
            project_id,
            task.id,
            payload.lesson_number,
            payload.title,
            payload.instructions,
        )
    return _to_task_response(task)


# ---------------------------------------------------------------------------
# Streaming generation endpoints
# ---------------------------------------------------------------------------

def _sse_response(generator):
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _format_sse(event: dict) -> str:
    event_type = event.get("event", "message")
    data = json_module.dumps(event.get("data", {}), ensure_ascii=False)
    return f"event: {event_type}\ndata: {data}\n\n"


@router.post("/projects/{project_id}/outline/generate/stream")
async def generate_outline_stream(project_id: int, payload: GenerateOutlineRequest):
    async def generate():
        try:
            async for event in stream_outline_generation(project_id, payload.scope, payload.instructions):
                yield _format_sse(event)
        except asyncio.CancelledError:
            yield _format_sse({"event": "error", "data": {"message": "生成已取消"}})
        except Exception as exc:
            yield _format_sse({"event": "error", "data": {"message": str(exc)}})
    return _sse_response(generate())


@router.post("/projects/{project_id}/lessons/file/stream")
async def generate_file_lesson_stream(project_id: int, payload: GenerateFileLessonRequest):
    async def generate():
        try:
            async for event in stream_file_lesson_generation(project_id, payload.path, payload.mode, payload.instructions):
                yield _format_sse(event)
        except asyncio.CancelledError:
            yield _format_sse({"event": "error", "data": {"message": "生成已取消"}})
        except Exception as exc:
            yield _format_sse({"event": "error", "data": {"message": str(exc)}})
    return _sse_response(generate())


@router.post("/projects/{project_id}/lessons/outline/stream")
async def generate_outline_lesson_stream(project_id: int, payload: GenerateOutlineLessonRequest):
    async def generate():
        try:
            async for event in stream_outline_lesson_generation(
                project_id, payload.lesson_number, payload.title, payload.instructions,
            ):
                yield _format_sse(event)
        except asyncio.CancelledError:
            yield _format_sse({"event": "error", "data": {"message": "生成已取消"}})
        except Exception as exc:
            yield _format_sse({"event": "error", "data": {"message": str(exc)}})
    return _sse_response(generate())


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

    remove_structural_project_data(project_id)
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

