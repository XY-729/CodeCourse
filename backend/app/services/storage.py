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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
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


def get_setting(key: str) -> Optional[str]:
    with _connect() as conn:
        row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None


def set_setting(key: str, value: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO app_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (key, value, now),
        )
        conn.commit()


def get_llm_settings() -> dict[str, str]:
    return {
        "provider": get_setting("llm.provider") or "deepseek",
        "base_url": get_setting("llm.base_url") or "https://api.deepseek.com",
        "model": get_setting("llm.model") or "deepseek-v4-flash",
        "api_key": get_setting("llm.api_key") or "",
        "enabled": get_setting("llm.enabled") or "false",
    }


def save_llm_settings(provider: str, base_url: str, model: str, enabled: bool, api_key: Optional[str], clear_api_key: bool) -> dict[str, str]:
    set_setting("llm.provider", provider.strip() or "deepseek")
    set_setting("llm.base_url", base_url.strip().rstrip("/") or "https://api.deepseek.com")
    set_setting("llm.model", model.strip() or "deepseek-v4-flash")
    set_setting("llm.enabled", "true" if enabled else "false")
    if clear_api_key:
        set_setting("llm.api_key", "")
    elif api_key is not None and api_key.strip():
        set_setting("llm.api_key", api_key.strip())
    return get_llm_settings()
