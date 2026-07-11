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
    project_type: str = "repository"


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
    session_id: Optional[int]
    source_type: str
    source_path: Optional[str]
    display_title: Optional[str]
    selected_text: str
    question: str
    answer_md: str
    provider: str
    model: str
    output_path: Optional[str]
    retrieval_trace: Optional[str]
    favorite: bool
    created_at: str
    updated_at: str


@dataclass
class QASession:
    id: int
    project_id: int
    title: str
    memory_summary: str
    active_source_path: Optional[str]
    created_at: str
    updated_at: str


@dataclass
class CodeChunk:
    id: int
    project_id: int
    path: str
    language: str
    start_line: int
    end_line: int
    chunk_type: str
    symbol_name: Optional[str]
    content: str
    content_hash: str
    created_at: str


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


@dataclass
class KnowledgeNode:
    id: int
    project_id: int
    node_type: str
    title: str
    ref_type: Optional[str]
    ref_id: Optional[int]
    ref_path: Optional[str]
    summary: Optional[str]
    x: Optional[float]
    y: Optional[float]
    created_at: str
    updated_at: str


@dataclass
class KnowledgeEdge:
    id: int
    project_id: int
    source_node_id: int
    target_node_id: int
    relation_type: str
    label: Optional[str]
    created_at: str
    updated_at: str


@dataclass
class KnowledgeLink:
    id: int
    project_id: int
    source_type: str
    source_path: str
    term_text: str
    qa_record_id: int
    node_id: int
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
        if "project_type" not in cols:
            conn.execute("ALTER TABLE projects ADD COLUMN project_type TEXT NOT NULL DEFAULT 'repository'")
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
        if "session_id" not in qa_cols:
            conn.execute("ALTER TABLE qa_records ADD COLUMN session_id INTEGER")
        if "retrieval_trace" not in qa_cols:
            conn.execute("ALTER TABLE qa_records ADD COLUMN retrieval_trace TEXT")
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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS qa_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                memory_summary TEXT NOT NULL DEFAULT '',
                active_source_path TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS code_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                path TEXT NOT NULL,
                language TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                chunk_type TEXT NOT NULL,
                symbol_name TEXT,
                content TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            )
            """
        )
        conn.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS code_chunks_fts USING fts5(
                chunk_id UNINDEXED,
                project_id UNINDEXED,
                path,
                symbol_name,
                content
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS project_indexes (
                project_id INTEGER PRIMARY KEY,
                status TEXT NOT NULL,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS knowledge_nodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                node_type TEXT NOT NULL,
                title TEXT NOT NULL,
                ref_type TEXT,
                ref_id INTEGER,
                ref_path TEXT,
                summary TEXT,
                x REAL,
                y REAL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_project_ref
            ON knowledge_nodes(project_id, node_type, ref_type, ref_id, ref_path, title)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS knowledge_edges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                source_node_id INTEGER NOT NULL,
                target_node_id INTEGER NOT NULL,
                relation_type TEXT NOT NULL,
                label TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id),
                FOREIGN KEY(source_node_id) REFERENCES knowledge_nodes(id),
                FOREIGN KEY(target_node_id) REFERENCES knowledge_nodes(id)
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_knowledge_edges_project_nodes
            ON knowledge_edges(project_id, source_node_id, target_node_id, relation_type)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS knowledge_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                source_type TEXT NOT NULL,
                source_path TEXT NOT NULL,
                term_text TEXT NOT NULL,
                qa_record_id INTEGER NOT NULL,
                node_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id),
                FOREIGN KEY(qa_record_id) REFERENCES qa_records(id),
                FOREIGN KEY(node_id) REFERENCES knowledge_nodes(id)
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_knowledge_links_source
            ON knowledge_links(project_id, source_type, source_path, term_text)
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
        project_type=row["project_type"] or "repository",
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
        session_id=row["session_id"] if "session_id" in row.keys() else None,
        source_type=row["source_type"],
        source_path=row["source_path"],
        display_title=row["display_title"],
        selected_text=row["selected_text"],
        question=row["question"],
        answer_md=row["answer_md"],
        provider=row["provider"],
        model=row["model"],
        output_path=row["output_path"],
        retrieval_trace=row["retrieval_trace"] if "retrieval_trace" in row.keys() else None,
        favorite=bool(row["favorite"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_qa_session(row: sqlite3.Row) -> QASession:
    return QASession(
        id=row["id"],
        project_id=row["project_id"],
        title=row["title"],
        memory_summary=row["memory_summary"],
        active_source_path=row["active_source_path"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_code_chunk(row: sqlite3.Row) -> CodeChunk:
    return CodeChunk(
        id=row["id"],
        project_id=row["project_id"],
        path=row["path"],
        language=row["language"],
        start_line=row["start_line"],
        end_line=row["end_line"],
        chunk_type=row["chunk_type"],
        symbol_name=row["symbol_name"],
        content=row["content"],
        content_hash=row["content_hash"],
        created_at=row["created_at"],
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


def _row_to_knowledge_node(row: sqlite3.Row) -> KnowledgeNode:
    return KnowledgeNode(
        id=row["id"],
        project_id=row["project_id"],
        node_type=row["node_type"],
        title=row["title"],
        ref_type=row["ref_type"],
        ref_id=row["ref_id"],
        ref_path=row["ref_path"],
        summary=row["summary"],
        x=row["x"],
        y=row["y"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_knowledge_edge(row: sqlite3.Row) -> KnowledgeEdge:
    return KnowledgeEdge(
        id=row["id"],
        project_id=row["project_id"],
        source_node_id=row["source_node_id"],
        target_node_id=row["target_node_id"],
        relation_type=row["relation_type"],
        label=row["label"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_knowledge_link(row: sqlite3.Row) -> KnowledgeLink:
    return KnowledgeLink(
        id=row["id"],
        project_id=row["project_id"],
        source_type=row["source_type"],
        source_path=row["source_path"],
        term_text=row["term_text"],
        qa_record_id=row["qa_record_id"],
        node_id=row["node_id"],
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


def upsert_project(name: str, url: str, local_path: Path, status: str, project_type: str = "repository") -> ProjectRecord:
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
                "INSERT INTO projects (name, url, repo_key, local_path, status, project_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (name, url, repo_key, str(local_path), status, project_type, now, now),
            )
        conn.commit()
        row = conn.execute("SELECT * FROM projects WHERE repo_key = ?", (repo_key,)).fetchone()
        if row is None:
            raise RuntimeError("project was not persisted")
        return _row_to_project(row)


def create_learning_plan_project(name: str, local_path: Path) -> ProjectRecord:
    now = datetime.now(timezone.utc).isoformat()
    local_path.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO projects (name, url, repo_key, local_path, status, project_type, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (name, f"learning-plan://{name}", f"learning_plan:{now}", str(local_path), "learning_plan", "learning_plan", now, now),
        )
        conn.commit()
        project_id = int(cursor.lastrowid)
    project = get_project(project_id)
    if project is None:
        raise RuntimeError("learning plan project was not persisted")
    return project


def update_project_status(project_id: int, status: str) -> Optional[ProjectRecord]:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?", (status, now, project_id))
        conn.commit()
    return get_project(project_id)


def delete_project(project_id: int) -> bool:
    with _connect() as conn:
        conn.execute("DELETE FROM knowledge_links WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM knowledge_edges WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM knowledge_nodes WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM generation_tasks WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM qa_records WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM qa_sessions WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM highlights WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM code_chunks WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM code_chunks_fts WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM project_indexes WHERE project_id = ?", (project_id,))
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
    session_id: Optional[int] = None,
    retrieval_trace: Optional[str] = None,
) -> QARecord:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO qa_records (
                project_id, session_id, source_type, source_path, display_title, selected_text, question,
                answer_md, provider, model, output_path, retrieval_trace, favorite, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                project_id,
                session_id,
                source_type,
                source_path,
                display_title,
                selected_text,
                question,
                answer_md,
                provider,
                model,
                str(output_path) if output_path else None,
                retrieval_trace,
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


def get_or_create_qa_session(project_id: int, session_id: Optional[int] = None, title: str = "AI 助手") -> QASession:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        if session_id is not None:
            row = conn.execute(
                "SELECT * FROM qa_sessions WHERE project_id = ? AND id = ?",
                (project_id, session_id),
            ).fetchone()
            if row:
                return _row_to_qa_session(row)
        cursor = conn.execute(
            """
            INSERT INTO qa_sessions (project_id, title, memory_summary, active_source_path, created_at, updated_at)
            VALUES (?, ?, '', NULL, ?, ?)
            """,
            (project_id, title, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM qa_sessions WHERE id = ?", (int(cursor.lastrowid),)).fetchone()
        if row is None:
            raise RuntimeError("qa session was not persisted")
        return _row_to_qa_session(row)


def get_qa_session(project_id: int, session_id: int) -> Optional[QASession]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM qa_sessions WHERE project_id = ? AND id = ?",
            (project_id, session_id),
        ).fetchone()
        return _row_to_qa_session(row) if row else None


def update_qa_session_memory(project_id: int, session_id: int, memory_summary: str, active_source_path: Optional[str] = None) -> Optional[QASession]:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            UPDATE qa_sessions
            SET memory_summary = ?, active_source_path = COALESCE(?, active_source_path), updated_at = ?
            WHERE project_id = ? AND id = ?
            """,
            (memory_summary[:8000], active_source_path, now, project_id, session_id),
        )
        conn.commit()
    return get_qa_session(project_id, session_id)


def list_recent_qa_records(project_id: int, session_id: int, limit: int = 6) -> list[QARecord]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM qa_records
            WHERE project_id = ? AND session_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (project_id, session_id, limit),
        ).fetchall()
        return [_row_to_qa_record(row) for row in rows]


def set_project_index_status(project_id: int, status: str, chunk_count: int = 0, error_message: Optional[str] = None) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO project_indexes (project_id, status, chunk_count, error_message, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
                status = excluded.status,
                chunk_count = excluded.chunk_count,
                error_message = excluded.error_message,
                updated_at = excluded.updated_at
            """,
            (project_id, status, chunk_count, error_message, now),
        )
        conn.commit()


def get_project_index_status(project_id: int) -> dict[str, object]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM project_indexes WHERE project_id = ?", (project_id,)).fetchone()
        if not row:
            return {"project_id": project_id, "status": "not_built", "chunk_count": 0, "error_message": None, "updated_at": None}
        return {
            "project_id": project_id,
            "status": row["status"],
            "chunk_count": row["chunk_count"],
            "error_message": row["error_message"],
            "updated_at": row["updated_at"],
        }


def replace_code_chunks(project_id: int, chunks: list[dict[str, object]]) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute("DELETE FROM code_chunks WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM code_chunks_fts WHERE project_id = ?", (project_id,))
        for chunk in chunks:
            cursor = conn.execute(
                """
                INSERT INTO code_chunks (
                    project_id, path, language, start_line, end_line, chunk_type,
                    symbol_name, content, content_hash, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    project_id,
                    str(chunk["path"]),
                    str(chunk["language"]),
                    int(chunk["start_line"]),
                    int(chunk["end_line"]),
                    str(chunk["chunk_type"]),
                    chunk.get("symbol_name"),
                    str(chunk["content"]),
                    str(chunk["content_hash"]),
                    now,
                ),
            )
            chunk_id = int(cursor.lastrowid)
            conn.execute(
                """
                INSERT INTO code_chunks_fts (chunk_id, project_id, path, symbol_name, content)
                VALUES (?, ?, ?, ?, ?)
                """,
                (chunk_id, project_id, str(chunk["path"]), chunk.get("symbol_name"), str(chunk["content"])),
            )
        conn.commit()
    set_project_index_status(project_id, "completed", len(chunks), None)
    return len(chunks)


def list_code_chunks(project_id: int, path: Optional[str] = None, limit: int = 20) -> list[CodeChunk]:
    clauses = ["project_id = ?"]
    params: list[object] = [project_id]
    if path:
        clauses.append("path = ?")
        params.append(path)
    sql = f"SELECT * FROM code_chunks WHERE {' AND '.join(clauses)} ORDER BY path ASC, start_line ASC LIMIT ?"
    params.append(limit)
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_code_chunk(row) for row in rows]


def search_code_chunks(project_id: int, query: str, source_path: Optional[str] = None, limit: int = 8) -> list[CodeChunk]:
    terms = [item.strip() for item in re_split_search_terms(query) if item.strip()]
    if not terms:
        return list_code_chunks(project_id, source_path, limit)
    fts_query = " OR ".join(terms[:12])
    with _connect() as conn:
        try:
            rows = conn.execute(
                """
                SELECT c.*, bm25(code_chunks_fts) AS rank
                FROM code_chunks_fts
                JOIN code_chunks c ON c.id = code_chunks_fts.chunk_id
                WHERE code_chunks_fts MATCH ? AND c.project_id = ?
                ORDER BY
                    CASE WHEN c.path = ? THEN 0 ELSE 1 END,
                    rank,
                    c.path,
                    c.start_line
                LIMIT ?
                """,
                (fts_query, project_id, source_path or "", limit),
            ).fetchall()
        except sqlite3.OperationalError:
            like = f"%{terms[0]}%"
            rows = conn.execute(
                """
                SELECT * FROM code_chunks
                WHERE project_id = ? AND (content LIKE ? OR path LIKE ? OR COALESCE(symbol_name, '') LIKE ?)
                ORDER BY CASE WHEN path = ? THEN 0 ELSE 1 END, path, start_line
                LIMIT ?
                """,
                (project_id, like, like, like, source_path or "", limit),
            ).fetchall()
        return [_row_to_code_chunk(row) for row in rows]


def re_split_search_terms(query: str) -> list[str]:
    import re

    cleaned = re.sub(r"[^\w\u4e00-\u9fff./:-]+", " ", query)
    return [item for item in cleaned.split() if len(item) >= 2][:20]


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
        qa_nodes = [
            row["id"]
            for row in conn.execute(
                "SELECT id FROM knowledge_nodes WHERE project_id = ? AND ref_type = 'qa' AND ref_id = ?",
                (project_id, record_id),
            ).fetchall()
        ]
        conn.execute("DELETE FROM knowledge_links WHERE project_id = ? AND qa_record_id = ?", (project_id, record_id))
        for node_id in qa_nodes:
            conn.execute(
                "DELETE FROM knowledge_edges WHERE project_id = ? AND (source_node_id = ? OR target_node_id = ?)",
                (project_id, node_id, node_id),
            )
        conn.execute("DELETE FROM knowledge_nodes WHERE project_id = ? AND ref_type = 'qa' AND ref_id = ?", (project_id, record_id))
        cursor = conn.execute(
            "DELETE FROM qa_records WHERE project_id = ? AND id = ?",
            (project_id, record_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def create_knowledge_node(
    project_id: int,
    node_type: str,
    title: str,
    ref_type: Optional[str] = None,
    ref_id: Optional[int] = None,
    ref_path: Optional[str] = None,
    summary: Optional[str] = None,
    x: Optional[float] = None,
    y: Optional[float] = None,
) -> KnowledgeNode:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO knowledge_nodes (
                project_id, node_type, title, ref_type, ref_id, ref_path, summary, x, y, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (project_id, node_type, title, ref_type, ref_id, ref_path, summary, x, y, now, now),
        )
        conn.commit()
        node_id = int(cursor.lastrowid)
    node = get_knowledge_node(project_id, node_id)
    if node is None:
        raise RuntimeError("knowledge node was not persisted")
    return node


def get_knowledge_node(project_id: int, node_id: int) -> Optional[KnowledgeNode]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM knowledge_nodes WHERE project_id = ? AND id = ?",
            (project_id, node_id),
        ).fetchone()
        return _row_to_knowledge_node(row) if row else None


def find_knowledge_node(
    project_id: int,
    node_type: str,
    title: Optional[str] = None,
    ref_type: Optional[str] = None,
    ref_id: Optional[int] = None,
    ref_path: Optional[str] = None,
) -> Optional[KnowledgeNode]:
    clauses = ["project_id = ?", "node_type = ?"]
    params: list[object] = [project_id, node_type]
    if title is not None:
        clauses.append("title = ?")
        params.append(title)
    if ref_type is not None:
        clauses.append("ref_type = ?")
        params.append(ref_type)
    if ref_id is not None:
        clauses.append("ref_id = ?")
        params.append(ref_id)
    if ref_path is not None:
        clauses.append("ref_path = ?")
        params.append(ref_path)
    sql = f"SELECT * FROM knowledge_nodes WHERE {' AND '.join(clauses)} ORDER BY id ASC LIMIT 1"
    with _connect() as conn:
        row = conn.execute(sql, params).fetchone()
        return _row_to_knowledge_node(row) if row else None


def list_knowledge_nodes(project_id: int) -> list[KnowledgeNode]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM knowledge_nodes WHERE project_id = ? ORDER BY node_type, title, id",
            (project_id,),
        ).fetchall()
        return [_row_to_knowledge_node(row) for row in rows]


def update_knowledge_node(
    project_id: int,
    node_id: int,
    title: Optional[str] = None,
    summary: Optional[str] = None,
    x: Optional[float] = None,
    y: Optional[float] = None,
) -> Optional[KnowledgeNode]:
    existing = get_knowledge_node(project_id, node_id)
    if existing is None:
        return None
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            UPDATE knowledge_nodes
            SET title = ?, summary = ?, x = ?, y = ?, updated_at = ?
            WHERE project_id = ? AND id = ?
            """,
            (
                title if title is not None else existing.title,
                summary if summary is not None else existing.summary,
                x if x is not None else existing.x,
                y if y is not None else existing.y,
                now,
                project_id,
                node_id,
            ),
        )
        conn.commit()
    return get_knowledge_node(project_id, node_id)


def delete_knowledge_node(project_id: int, node_id: int) -> bool:
    with _connect() as conn:
        conn.execute("DELETE FROM knowledge_links WHERE project_id = ? AND node_id = ?", (project_id, node_id))
        conn.execute(
            "DELETE FROM knowledge_edges WHERE project_id = ? AND (source_node_id = ? OR target_node_id = ?)",
            (project_id, node_id, node_id),
        )
        cursor = conn.execute("DELETE FROM knowledge_nodes WHERE project_id = ? AND id = ?", (project_id, node_id))
        conn.commit()
        return cursor.rowcount > 0


def create_knowledge_edge(
    project_id: int,
    source_node_id: int,
    target_node_id: int,
    relation_type: str,
    label: Optional[str] = None,
) -> KnowledgeEdge:
    existing = find_knowledge_edge(project_id, source_node_id, target_node_id, relation_type)
    if existing:
        return existing
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO knowledge_edges (
                project_id, source_node_id, target_node_id, relation_type, label, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (project_id, source_node_id, target_node_id, relation_type, label, now, now),
        )
        conn.commit()
        edge_id = int(cursor.lastrowid)
    edge = get_knowledge_edge(project_id, edge_id)
    if edge is None:
        raise RuntimeError("knowledge edge was not persisted")
    return edge


def get_knowledge_edge(project_id: int, edge_id: int) -> Optional[KnowledgeEdge]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM knowledge_edges WHERE project_id = ? AND id = ?",
            (project_id, edge_id),
        ).fetchone()
        return _row_to_knowledge_edge(row) if row else None


def find_knowledge_edge(project_id: int, source_node_id: int, target_node_id: int, relation_type: str) -> Optional[KnowledgeEdge]:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM knowledge_edges
            WHERE project_id = ? AND source_node_id = ? AND target_node_id = ? AND relation_type = ?
            LIMIT 1
            """,
            (project_id, source_node_id, target_node_id, relation_type),
        ).fetchone()
        return _row_to_knowledge_edge(row) if row else None


def list_knowledge_edges(project_id: int) -> list[KnowledgeEdge]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM knowledge_edges WHERE project_id = ? ORDER BY id",
            (project_id,),
        ).fetchall()
        return [_row_to_knowledge_edge(row) for row in rows]


def update_knowledge_edge(
    project_id: int,
    edge_id: int,
    relation_type: Optional[str] = None,
    label: Optional[str] = None,
) -> Optional[KnowledgeEdge]:
    existing = get_knowledge_edge(project_id, edge_id)
    if existing is None:
        return None
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            UPDATE knowledge_edges
            SET relation_type = ?, label = ?, updated_at = ?
            WHERE project_id = ? AND id = ?
            """,
            (
                relation_type if relation_type is not None else existing.relation_type,
                label if label is not None else existing.label,
                now,
                project_id,
                edge_id,
            ),
        )
        conn.commit()
    return get_knowledge_edge(project_id, edge_id)


def delete_knowledge_edge(project_id: int, edge_id: int) -> bool:
    with _connect() as conn:
        cursor = conn.execute("DELETE FROM knowledge_edges WHERE project_id = ? AND id = ?", (project_id, edge_id))
        conn.commit()
        return cursor.rowcount > 0


def create_knowledge_link(
    project_id: int,
    source_type: str,
    source_path: str,
    term_text: str,
    qa_record_id: int,
    node_id: int,
) -> KnowledgeLink:
    existing = find_knowledge_link(project_id, source_type, source_path, term_text, qa_record_id)
    if existing:
        return existing
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO knowledge_links (
                project_id, source_type, source_path, term_text, qa_record_id, node_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (project_id, source_type, source_path, term_text, qa_record_id, node_id, now, now),
        )
        conn.commit()
        link_id = int(cursor.lastrowid)
    link = get_knowledge_link(project_id, link_id)
    if link is None:
        raise RuntimeError("knowledge link was not persisted")
    return link


def get_knowledge_link(project_id: int, link_id: int) -> Optional[KnowledgeLink]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM knowledge_links WHERE project_id = ? AND id = ?",
            (project_id, link_id),
        ).fetchone()
        return _row_to_knowledge_link(row) if row else None


def find_knowledge_link(
    project_id: int,
    source_type: str,
    source_path: str,
    term_text: str,
    qa_record_id: int,
) -> Optional[KnowledgeLink]:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM knowledge_links
            WHERE project_id = ? AND source_type = ? AND source_path = ? AND term_text = ? AND qa_record_id = ?
            LIMIT 1
            """,
            (project_id, source_type, source_path, term_text, qa_record_id),
        ).fetchone()
        return _row_to_knowledge_link(row) if row else None


def list_knowledge_links(
    project_id: int,
    source_type: Optional[str] = None,
    source_path: Optional[str] = None,
) -> list[KnowledgeLink]:
    clauses = ["project_id = ?"]
    params: list[object] = [project_id]
    if source_type:
        clauses.append("source_type = ?")
        params.append(source_type)
    if source_path:
        clauses.append("source_path = ?")
        params.append(source_path)
    sql = f"SELECT * FROM knowledge_links WHERE {' AND '.join(clauses)} ORDER BY LENGTH(term_text) DESC, id ASC"
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_knowledge_link(row) for row in rows]


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
