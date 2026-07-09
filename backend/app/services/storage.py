from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.core.config import DB_PATH, REPOS_ROOT, WORKSPACE_ROOT


@dataclass
class ProjectRecord:
    id: int
    name: str
    url: str
    local_path: str
    status: str
    created_at: str
    updated_at: str


def init_storage() -> None:
    WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
    REPOS_ROOT.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                url TEXT NOT NULL UNIQUE,
                local_path TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


def _row_to_project(row: sqlite3.Row) -> ProjectRecord:
    return ProjectRecord(
        id=row["id"],
        name=row["name"],
        url=row["url"],
        local_path=row["local_path"],
        status=row["status"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_project(project_id: int) -> Optional[ProjectRecord]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return _row_to_project(row) if row else None


def get_project_by_url(url: str) -> Optional[ProjectRecord]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM projects WHERE url = ?", (url,)).fetchone()
        return _row_to_project(row) if row else None


def list_projects() -> list[ProjectRecord]:
    with _connect() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY updated_at DESC, id DESC").fetchall()
        return [_row_to_project(row) for row in rows]


def upsert_project(name: str, url: str, local_path: Path, status: str) -> ProjectRecord:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        existing = conn.execute("SELECT * FROM projects WHERE url = ?", (url,)).fetchone()
        if existing:
            conn.execute(
                "UPDATE projects SET name = ?, local_path = ?, status = ?, updated_at = ? WHERE url = ?",
                (name, str(local_path), status, now, url),
            )
        else:
            conn.execute(
                "INSERT INTO projects (name, url, local_path, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (name, url, str(local_path), status, now, now),
            )
        conn.commit()
    project = get_project_by_url(url)
    if project is None:
        raise RuntimeError("project was not persisted")
    return project


def update_project_status(project_id: int, status: str) -> Optional[ProjectRecord]:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?", (status, now, project_id))
        conn.commit()
    return get_project(project_id)


def delete_project(project_id: int) -> bool:
    with _connect() as conn:
        cursor = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
        return cursor.rowcount > 0
