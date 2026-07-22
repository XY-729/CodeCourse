from __future__ import annotations

import hashlib
import re
import shutil
import zipfile
from pathlib import Path

from fastapi import HTTPException

from app.core.config import IGNORED_DIRS, REPOS_ROOT

MAX_ARCHIVE_FILES = 20_000
MAX_ARCHIVE_BYTES = 500 * 1024 * 1024


def _safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-.")
    return (cleaned or "local-project")[:90]


def _destination(source: Path) -> Path:
    fingerprint = hashlib.sha256(str(source).lower().encode("utf-8")).hexdigest()[:10]
    return (REPOS_ROOT / f"local-{_safe_name(source.stem or source.name)}-{fingerprint}").resolve()


def _copy_ignore(_directory: str, names: list[str]) -> set[str]:
    return {name for name in names if name in IGNORED_DIRS or name == ".generated_course"}


def import_local_directory(source_path: str) -> tuple[str, Path, str]:
    source = Path(source_path).expanduser().resolve()
    if not source.exists() or not source.is_dir():
        raise HTTPException(status_code=404, detail="Local project directory was not found")

    REPOS_ROOT.mkdir(parents=True, exist_ok=True)
    destination = _destination(source)
    if source == destination or destination in source.parents:
        raise HTTPException(status_code=400, detail="Cannot import the workspace into itself")
    if destination.exists():
        shutil.rmtree(destination)
    try:
        shutil.copytree(source, destination, ignore=_copy_ignore)
    except OSError as exc:
        if destination.exists():
            shutil.rmtree(destination, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"Failed to copy local project: {exc}") from exc
    return source.name, destination, f"local://{source.as_posix()}"


def import_local_archive(archive_path: str, display_name: str | None = None) -> tuple[str, Path, str]:
    source = Path(archive_path).expanduser().resolve()
    if not source.exists() or not source.is_file() or source.suffix.lower() != ".zip":
        raise HTTPException(status_code=400, detail="Only ZIP project archives are supported")

    REPOS_ROOT.mkdir(parents=True, exist_ok=True)
    destination = _destination(source)
    staging = destination.with_name(f"{destination.name}.extracting")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(source) as archive:
            members = [member for member in archive.infolist() if not member.is_dir()]
            if len(members) > MAX_ARCHIVE_FILES:
                raise HTTPException(status_code=413, detail="ZIP contains too many files")
            if sum(member.file_size for member in members) > MAX_ARCHIVE_BYTES:
                raise HTTPException(status_code=413, detail="ZIP expands beyond the 500 MB safety limit")

            staging_root = staging.resolve()
            for member in archive.infolist():
                member_path = (staging / member.filename).resolve()
                if staging_root != member_path and staging_root not in member_path.parents:
                    raise HTTPException(status_code=400, detail="ZIP contains an unsafe path")
                if any(part in IGNORED_DIRS for part in Path(member.filename).parts):
                    continue
                archive.extract(member, staging)
    except HTTPException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    except zipfile.BadZipFile as exc:
        shutil.rmtree(staging, ignore_errors=True)
        raise HTTPException(status_code=400, detail="The selected ZIP file is invalid") from exc
    except OSError as exc:
        shutil.rmtree(staging, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"Failed to extract ZIP project: {exc}") from exc
    finally:
        if staging.exists() and not any(staging.iterdir()):
            shutil.rmtree(staging, ignore_errors=True)

    entries = list(staging.iterdir())
    content_root = entries[0] if len(entries) == 1 and entries[0].is_dir() else staging
    if destination.exists():
        shutil.rmtree(destination)
    if content_root == staging:
        staging.rename(destination)
    else:
        shutil.move(str(content_root), str(destination))
        shutil.rmtree(staging, ignore_errors=True)

    name = Path(display_name or source.name).stem
    return name, destination, f"local-archive://{source.as_posix()}"
