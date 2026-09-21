"""Task-owned, atomic reading snapshots; never registered as course documents."""
from __future__ import annotations

import json
import logging
import time
from threading import RLock
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

LOGGER = logging.getLogger(__name__)
_SNAPSHOT_LOCK = RLock()


def preview_path(course_dir: Path, task_id: int) -> Path:
    return course_dir / ".previews" / f"task-{int(task_id)}.json"


def read_preview(course_dir: Path, task_id: int) -> dict:
    # Windows readers cannot keep a file open while another thread replaces it.
    with _SNAPSHOT_LOCK:
        try:
            return json.loads(preview_path(course_dir, task_id).read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, json.JSONDecodeError):
            LOGGER.warning("Could not read lesson preview for task %s", task_id, exc_info=True)
            return {}


def write_preview(course_dir: Path, task_id: int, value: dict) -> None:
    path = preview_path(course_dir, task_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".{uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        with _SNAPSHOT_LOCK:
            temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


class LessonPreview:
    def __init__(self, course_dir: Path, task_id: int, request: dict):
        self.course_dir = course_dir
        self.task_id = task_id
        self.started = time.monotonic()
        self.phase_started = self.started
        self.data = {
            "version": uuid4().hex, "phase": "preparing", "total_sections": 0,
            "completed_sections": 0, "readable_sections": 0, "markdown": "",
            "started_at": datetime.now(timezone.utc).isoformat(), "finished_at": None,
            "timings": {}, "request": request,
        }
        self.save()

    def save(self):
        write_preview(self.course_dir, self.task_id, self.data)

    def phase(self, phase: str):
        now = time.monotonic()
        self.data["timings"][self.data["phase"]] = round(now - self.phase_started, 3)
        self.phase_started = now
        self.data["phase"] = phase
        self.save()

    def sections(self, title: str, sections: list[str]):
        readable = 0
        for section in sections:
            if not section:
                break
            readable += 1
        markdown = f"# {title}\n\n" + "\n\n".join(sections[:readable]) if readable else ""
        if markdown != self.data["markdown"]:
            self.data["version"] = uuid4().hex
        self.data.update(total_sections=len(sections), completed_sections=sum(bool(s) for s in sections),
                         readable_sections=readable, markdown=markdown)
        if readable and "first_readable" not in self.data["timings"]:
            self.data["timings"]["first_readable"] = round(time.monotonic() - self.started, 3)
        self.save()

    def finish(self, status: str):
        self.phase(status)
        self.data["finished_at"] = datetime.now(timezone.utc).isoformat()
        self.data["timings"]["total"] = round(time.monotonic() - self.started, 3)
        self.save()
        LOGGER.info("lesson_generation task=%s status=%s timings=%s", self.task_id, status, self.data["timings"])
