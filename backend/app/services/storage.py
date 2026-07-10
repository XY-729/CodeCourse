from __future__ import annotations

import sqlite3
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.core.config import DB_PATH, GENERATED_ROOT, REPOS_ROOT, WORKSPACE_ROOT


@dataclass
class ProjectRecord:
    id: int
    name: str
    url: str
    local_path: str
    status: str
    created_at: str
    updated_at: str
    repo_key: str = ""


@dataclass
class GenerationTask:
    id: int
    project_id: int
    task_type: str
    status: str
    source_path: Optional[str]
    mode: Optional[str]
    model: Optional[str]
    prompt_version: str
    input_hash: str
    output_path: Optional[str]
    error_message: Optional[str]
    created_at: str
    updated_at: str


@dataclass
class QARecord:
    id: int
    project_id: int
    source_type: str
    source_path: Optional[str]
    display_title: Optional[str]
    selected_text: str
    question: str
    answer_md: str
    provider: str
    model: str
    output_path: Optional[str]
    favorite: bool
    created_at: str
    updated_at: str


@dataclass
class HighlightRecord:
    id: int
    project_id: int
    source_type: str
    source_path: str
    selected_text: str
    color: str
    note: Optional[str]
    created_at: str
    updated_at: str


def init_storage() -> None:
    WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
    REPOS_ROOT.mkdir(parents=True, exist_ok=True)
    GENERATED_ROOT.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                local_path TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        # Migration: add repo_key column if it doesn't exist
        cols = [row[1] for row in conn.execute("PRAGMA table_info(projects)").fetchall()]
        if "repo_key" not in cols:
            conn.execute("ALTER TABLE projects ADD COLUMN repo_key TEXT")
            conn.commit()
        # Backfill null repo_keys
        null_rows = conn.execute("SELECT id, url FROM projects WHERE repo_key IS NULL").fetchall()
        if null_rows:
            from app.services.git_service import normalize_github_repo_key
            for row in null_rows:
                rk = normalize_github_repo_key(row[1])
                conn.execute("UPDATE projects SET repo_key = ? WHERE id = ?", (rk, row[0]))
            conn.commit()
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS generation_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                task_type TEXT NOT NULL,
                status TEXT NOT NULL,
                source_path TEXT,
                mode TEXT,
                model TEXT,
                prompt_version TEXT NOT NULL,
                input_hash TEXT NOT NULL,
                output_path TEXT,
                error_message TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS qa_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                source_type TEXT NOT NULL,
                source_path TEXT,
                display_title TEXT,
                selected_text TEXT NOT NULL,
                question TEXT NOT NULL,
                answer_md TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                output_path TEXT,
                favorite INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            )
            """
        )
        qa_cols = [row[1] for row in conn.execute("PRAGMA table_info(qa_records)").fetchall()]
        if "display_title" not in qa_cols:
            conn.execute("ALTER TABLE qa_records ADD COLUMN display_title TEXT")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS highlights (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                source_type TEXT NOT NULL,
                source_path TEXT NOT NULL,
                selected_text TEXT NOT NULL,
                color TEXT NOT NULL,
                note TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id)
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
        repo_key=row["repo_key"] or "",
    )


def _row_to_task(row: sqlite3.Row) -> GenerationTask:
    return GenerationTask(
        id=row["id"],
        project_id=row["project_id"],
        task_type=row["task_type"],
        status=row["status"],
        source_path=row["source_path"],
        mode=row["mode"],
        model=row["model"],
        prompt_version=row["prompt_version"],
        input_hash=row["input_hash"],
        output_path=row["output_path"],
        error_message=row["error_message"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_qa_record(row: sqlite3.Row) -> QARecord:
    return QARecord(
        id=row["id"],
        project_id=row["project_id"],
        source_type=row["source_type"],
        source_path=row["source_path"],
        display_title=row["display_title"],
        selected_text=row["selected_text"],
        question=row["question"],
        answer_md=row["answer_md"],
        provider=row["provider"],
        model=row["model"],
        output_path=row["output_path"],
        favorite=bool(row["favorite"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_highlight(row: sqlite3.Row) -> HighlightRecord:
    return HighlightRecord(
        id=row["id"],
        project_id=row["project_id"],
        source_type=row["source_type"],
        source_path=row["source_path"],
        selected_text=row["selected_text"],
        color=row["color"],
        note=row["note"],
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


def _get_project_by_repo_key(conn: sqlite3.Connection, repo_key: str) -> Optional[ProjectRecord]:
    row = conn.execute("SELECT * FROM projects WHERE repo_key = ?", (repo_key,)).fetchone()
    return _row_to_project(row) if row else None


def list_projects() -> list[ProjectRecord]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT p.* FROM projects p
            WHERE p.id NOT IN (
                SELECT p2.id FROM projects p2
                INNER JOIN projects p3 ON p2.repo_key = p3.repo_key
                    AND p2.repo_key IS NOT NULL
                    AND (p2.updated_at < p3.updated_at
                         OR (p2.updated_at = p3.updated_at AND p2.id < p3.id))
            )
            ORDER BY p.updated_at DESC, p.id DESC
            """
        ).fetchall()
        return [_row_to_project(row) for row in rows]


def upsert_project(name: str, url: str, local_path: Path, status: str) -> ProjectRecord:
    from app.services.git_service import normalize_github_repo_key

    repo_key = normalize_github_repo_key(url)
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        existing = conn.execute("SELECT * FROM projects WHERE repo_key = ?", (repo_key,)).fetchone()
        if existing:
            conn.execute(
                "UPDATE projects SET name = ?, url = ?, local_path = ?, status = ?, updated_at = ? WHERE repo_key = ?",
                (name, url, str(local_path), status, now, repo_key),
            )
        else:
            conn.execute(
                "INSERT INTO projects (name, url, repo_key, local_path, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (name, url, repo_key, str(local_path), status, now, now),
            )
        conn.commit()
        row = conn.execute("SELECT * FROM projects WHERE repo_key = ?", (repo_key,)).fetchone()
        if row is None:
            raise RuntimeError("project was not persisted")
        return _row_to_project(row)


def update_project_status(project_id: int, status: str) -> Optional[ProjectRecord]:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?", (status, now, project_id))
        conn.commit()
    return get_project(project_id)


def delete_project(project_id: int) -> bool:
    with _connect() as conn:
        conn.execute("DELETE FROM generation_tasks WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM qa_records WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM highlights WHERE project_id = ?", (project_id,))
        cursor = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
        return cursor.rowcount > 0


def create_generation_task(
    project_id: int,
    task_type: str,
    input_hash: str,
    prompt_version: str,
    source_path: Optional[str] = None,
    mode: Optional[str] = None,
    model: Optional[str] = None,
    output_path: Optional[Path] = None,
    status: str = "queued",
) -> GenerationTask:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO generation_tasks (
                project_id, task_type, status, source_path, mode, model,
                prompt_version, input_hash, output_path, error_message, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                task_type,
                status,
                source_path,
                mode,
                model,
                prompt_version,
                input_hash,
                str(output_path) if output_path else None,
                None,
                now,
                now,
            ),
        )
        conn.commit()
        task_id = int(cursor.lastrowid)
    task = get_generation_task(task_id)
    if task is None:
        raise RuntimeError("generation task was not persisted")
    return task


def update_generation_task(
    task_id: int,
    status: str,
    output_path: Optional[Path] = None,
    error_message: Optional[str] = None,
) -> Optional[GenerationTask]:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            UPDATE generation_tasks
            SET status = ?,
                output_path = COALESCE(?, output_path),
                error_message = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (status, str(output_path) if output_path else None, error_message, now, task_id),
        )
        conn.commit()
    return get_generation_task(task_id)


def get_generation_task(task_id: int) -> Optional[GenerationTask]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM generation_tasks WHERE id = ?", (task_id,)).fetchone()
        return _row_to_task(row) if row else None


def list_generation_tasks(project_id: int) -> list[GenerationTask]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM generation_tasks WHERE project_id = ? ORDER BY updated_at DESC, id DESC",
            (project_id,),
        ).fetchall()
        return [_row_to_task(row) for row in rows]


def find_completed_task(
    project_id: int,
    task_type: str,
    input_hash: str,
    prompt_version: str,
    source_path: Optional[str] = None,
    mode: Optional[str] = None,
) -> Optional[GenerationTask]:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM generation_tasks
            WHERE project_id = ?
              AND task_type = ?
              AND input_hash = ?
              AND prompt_version = ?
              AND COALESCE(source_path, '') = COALESCE(?, '')
              AND COALESCE(mode, '') = COALESCE(?, '')
              AND status = 'completed'
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """,
            (project_id, task_type, input_hash, prompt_version, source_path, mode),
        ).fetchone()
        return _row_to_task(row) if row else None


def create_qa_record(
    project_id: int,
    source_type: str,
    source_path: Optional[str],
    selected_text: str,
    question: str,
    answer_md: str,
    provider: str,
    model: str,
    output_path: Optional[Path] = None,
    display_title: Optional[str] = None,
) -> QARecord:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO qa_records (
                project_id, source_type, source_path, display_title, selected_text, question,
                answer_md, provider, model, output_path, favorite, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                project_id,
                source_type,
                source_path,
                display_title,
                selected_text,
                question,
                answer_md,
                provider,
                model,
                str(output_path) if output_path else None,
                now,
                now,
            ),
        )
        conn.commit()
        record_id = int(cursor.lastrowid)
    record = get_qa_record(project_id, record_id)
    if record is None:
        raise RuntimeError("qa record was not persisted")
    return record


def get_qa_record(project_id: int, record_id: int) -> Optional[QARecord]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM qa_records WHERE project_id = ? AND id = ?",
            (project_id, record_id),
        ).fetchone()
        return _row_to_qa_record(row) if row else None


def list_qa_records(project_id: int, query: str = "", favorite: Optional[bool] = None) -> list[QARecord]:
    clauses = ["project_id = ?"]
    params: list[object] = [project_id]
    if query.strip():
        clauses.append("(display_title LIKE ? OR question LIKE ? OR selected_text LIKE ? OR answer_md LIKE ? OR source_path LIKE ?)")
        like = f"%{query.strip()}%"
        params.extend([like, like, like, like, like])
    if favorite is not None:
        clauses.append("favorite = ?")
        params.append(1 if favorite else 0)
    sql = f"SELECT * FROM qa_records WHERE {' AND '.join(clauses)} ORDER BY updated_at DESC, id DESC"
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_qa_record(row) for row in rows]


def update_qa_record(
    project_id: int,
    record_id: int,
    question: Optional[str] = None,
    answer_md: Optional[str] = None,
    output_path: Optional[Path] = None,
    display_title: Optional[str] = None,
) -> Optional[QARecord]:
    existing = get_qa_record(project_id, record_id)
    if existing is None:
        return None
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            UPDATE qa_records
            SET display_title = ?,
                question = ?,
                answer_md = ?,
                output_path = COALESCE(?, output_path),
                updated_at = ?
            WHERE project_id = ? AND id = ?
            """,
            (
                display_title if display_title is not None else existing.display_title,
                question if question is not None else existing.question,
                answer_md if answer_md is not None else existing.answer_md,
                str(output_path) if output_path else None,
                now,
                project_id,
                record_id,
            ),
        )
        conn.commit()
    return get_qa_record(project_id, record_id)


def create_highlight(
    project_id: int,
    source_type: str,
    source_path: str,
    selected_text: str,
    color: str = "#fff59d",
    note: Optional[str] = None,
) -> HighlightRecord:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO highlights (
                project_id, source_type, source_path, selected_text, color, note, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (project_id, source_type, source_path, selected_text, color, note, now, now),
        )
        conn.commit()
        highlight_id = int(cursor.lastrowid)
    record = get_highlight(project_id, highlight_id)
    if record is None:
        raise RuntimeError("highlight was not persisted")
    return record


def get_highlight(project_id: int, highlight_id: int) -> Optional[HighlightRecord]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM highlights WHERE project_id = ? AND id = ?",
            (project_id, highlight_id),
        ).fetchone()
        return _row_to_highlight(row) if row else None


def list_highlights(
    project_id: int,
    source_type: Optional[str] = None,
    source_path: Optional[str] = None,
) -> list[HighlightRecord]:
    clauses = ["project_id = ?"]
    params: list[object] = [project_id]
    if source_type:
        clauses.append("source_type = ?")
        params.append(source_type)
    if source_path:
        clauses.append("source_path = ?")
        params.append(source_path)
    sql = f"SELECT * FROM highlights WHERE {' AND '.join(clauses)} ORDER BY created_at ASC, id ASC"
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_highlight(row) for row in rows]


def delete_highlight(project_id: int, highlight_id: int) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM highlights WHERE project_id = ? AND id = ?",
            (project_id, highlight_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def set_qa_favorite(project_id: int, record_id: int, favorite: bool) -> Optional[QARecord]:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            "UPDATE qa_records SET favorite = ?, updated_at = ? WHERE project_id = ? AND id = ?",
            (1 if favorite else 0, now, project_id, record_id),
        )
        conn.commit()
        if cursor.rowcount == 0:
            return None
    return get_qa_record(project_id, record_id)


def delete_qa_record(project_id: int, record_id: int) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM qa_records WHERE project_id = ? AND id = ?",
            (project_id, record_id),
        )
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
    env_file_values = _read_env_file()
    env_api_key = os.getenv("DEEPSEEK_API_KEY") or os.getenv("GPL_LLM_API_KEY") or env_file_values.get("DEEPSEEK_API_KEY") or env_file_values.get("GPL_LLM_API_KEY")
    if env_api_key:
        return {
            "provider": os.getenv("GPL_LLM_PROVIDER") or env_file_values.get("GPL_LLM_PROVIDER") or "deepseek",
            "base_url": os.getenv("DEEPSEEK_BASE_URL") or os.getenv("GPL_LLM_BASE_URL") or env_file_values.get("DEEPSEEK_BASE_URL") or env_file_values.get("GPL_LLM_BASE_URL") or "https://api.deepseek.com",
            "model": os.getenv("DEEPSEEK_MODEL") or os.getenv("GPL_LLM_MODEL") or env_file_values.get("DEEPSEEK_MODEL") or env_file_values.get("GPL_LLM_MODEL") or "deepseek-v4-flash",
            "api_key": env_api_key,
            "enabled": "true",
        }
    return {
        "provider": get_setting("llm.provider") or "deepseek",
        "base_url": get_setting("llm.base_url") or "https://api.deepseek.com",
        "model": get_setting("llm.model") or "deepseek-v4-flash",
        "api_key": get_setting("llm.api_key") or "",
        "enabled": get_setting("llm.enabled") or "false",
    }


def _read_env_file() -> dict[str, str]:
    path = WORKSPACE_ROOT.parent / ".env"
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    try:
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    except UnicodeDecodeError:
        return {}
    return values


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
