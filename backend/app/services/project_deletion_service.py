from __future__ import annotations

import logging
import os
import shutil
import sqlite3
import stat
import time
import uuid

from pathlib import Path

from app.core.config import (
    GENERATED_ROOT,
    REPOS_ROOT,
    WORKSPACE_ROOT,
)

from app.services.storage import (
    delete_project,
    get_project,
    list_generation_tasks,
)

logger = logging.getLogger(__name__)


TERMINAL_TASK_STATUSES = {
    "completed",
    "failed",
    "cancelled",
}


class ProjectDeletionError(RuntimeError):
    """Base error for safe project deletion."""


class ProjectDeletionNotFound(ProjectDeletionError):
    pass


class ProjectDeletionBusy(ProjectDeletionError):
    pass


class ProjectDeletionUnsafePath(ProjectDeletionError):
    pass


def _is_managed_child(path: Path, root: Path) -> bool:
    resolved_path = path.resolve()
    resolved_root = root.resolve()
    return (
        resolved_path != resolved_root
        and resolved_root in resolved_path.parents
    )


def _remove_readonly(func, path: str, exc_info) -> None:
    """shutil.rmtree callback that clears the read-only flag on Windows."""
    error = exc_info[1]
    if not isinstance(error, PermissionError):
        raise error
    os.chmod(path, stat.S_IWRITE | stat.S_IREAD)
    func(path)


def _restore_staged_paths(
    moved_paths: list[tuple[Path, Path]],
) -> list[str]:
    errors: list[str] = []
    for original_path, staged_path in reversed(moved_paths):
        if not staged_path.exists():
            continue
        try:
            if original_path.exists():
                errors.append(f"{original_path} and staged directory both exist")
                continue
            original_path.parent.mkdir(parents=True, exist_ok=True)
            os.replace(staged_path, original_path)
        except OSError as error:
            errors.append(f"{original_path}: {error}")
    return errors


def _rollback_and_raise(
    error: ProjectDeletionError,
    moved_paths: list[tuple[Path, Path]],
    trash_root: Path,
) -> None:
    rollback_errors = _restore_staged_paths(moved_paths)
    if rollback_errors:
        raise ProjectDeletionError(
            f"{error}; failed to restore project files. "
            f"Staged files remain at: {trash_root}; "
            f"Restore errors: {'; '.join(rollback_errors)}"
        ) from error
    try:
        trash_root.rmdir()
    except OSError:
        pass
    raise error


def _assert_project_idle(project_id: int) -> None:
    running_tasks = [
        task
        for task in list_generation_tasks(project_id)
        if task.status not in TERMINAL_TASK_STATUSES
    ]
    if running_tasks:
        raise ProjectDeletionBusy(
            "A generation task is still running for this project. "
            "Please wait for it to complete before deleting."
        )


def stage_and_delete_project(project_id: int) -> Path:
    """Move project files into quarantine, then remove database metadata.

    The move happens on the same workspace volume and is normally atomic.
    If the database operation fails, the original directories are restored.
    """
    project = get_project(project_id)
    if project is None:
        raise ProjectDeletionNotFound("Project not found or already deleted.")

    _assert_project_idle(project_id)

    repo_root = Path(project.local_path).resolve()
    generated_root = (GENERATED_ROOT / str(project_id)).resolve()

    if not _is_managed_child(repo_root, REPOS_ROOT):
        raise ProjectDeletionUnsafePath(
            "Project directory is outside the managed repos workspace. "
            "Refusing to delete files on disk."
        )

    if not _is_managed_child(generated_root, GENERATED_ROOT):
        raise ProjectDeletionUnsafePath(
            "Generated content directory is outside the workspace. Refusing to delete."
        )

    trash_root = (
        WORKSPACE_ROOT / ".trash" / f"project-{project_id}-{uuid.uuid4().hex}"
    ).resolve()

    moved_paths: list[tuple[Path, Path]] = []

    try:
        trash_root.mkdir(parents=True, exist_ok=False)

        sources = [
            (repo_root, trash_root / "repository"),
            (generated_root, trash_root / "generated"),
        ]

        for source_path, staged_path in sources:
            if not source_path.exists():
                continue
            staged_path.parent.mkdir(parents=True, exist_ok=True)
            # os.replace is atomic on the same filesystem volume
            os.replace(source_path, staged_path)
            moved_paths.append((source_path, staged_path))

    except PermissionError:
        _rollback_and_raise(
            ProjectDeletionBusy(
                "Project files are in use by another program. "
                "Please close any editor, terminal, or Git program "
                "using this project and try again."
            ),
            moved_paths,
            trash_root,
        )

    except OSError as error:
        _rollback_and_raise(
            ProjectDeletionError(f"Failed to move project files to staging: {error}"),
            moved_paths,
            trash_root,
        )

    try:
        deleted = delete_project(project_id)
    except sqlite3.OperationalError as error:
        message = str(error)
        if "locked" in message.lower():
            _rollback_and_raise(
                ProjectDeletionBusy(
                    "CodeCourse database is busy. Please try deleting again shortly."
                ),
                moved_paths,
                trash_root,
            )
        _rollback_and_raise(
            ProjectDeletionError(f"Failed to clean project database records: {message}"),
            moved_paths,
            trash_root,
        )
    except sqlite3.Error as error:
        _rollback_and_raise(
            ProjectDeletionError(f"Failed to clean project database records: {error}"),
            moved_paths,
            trash_root,
        )
    except Exception as error:
        _rollback_and_raise(
            ProjectDeletionError(f"Failed to delete project database records: {error}"),
            moved_paths,
            trash_root,
        )

    if not deleted:
        _rollback_and_raise(
            ProjectDeletionNotFound("Project not found or already deleted."),
            moved_paths,
            trash_root,
        )

    return trash_root


def cleanup_staged_project(trash_root: Path) -> None:
    """Delete quarantined files after the database deletion has succeeded.

    Cleanup failure is logged rather than making the project appear undeleted.
    """
    if not trash_root.exists():
        return

    delays = (0.0, 0.15, 0.4, 0.8, 1.5)

    for attempt, delay in enumerate(delays, start=1):
        if delay:
            time.sleep(delay)
        try:
            shutil.rmtree(trash_root, onerror=_remove_readonly)
            return
        except OSError:
            if attempt < len(delays):
                continue
            logger.exception(
                "Failed to clean staged project directory: %s",
                trash_root,
            )
