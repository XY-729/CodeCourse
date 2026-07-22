from __future__ import annotations

import sqlite3
import os
from contextlib import closing, contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional

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
    progress_current: int
    progress_total: int
    stage_label: Optional[str]
    created_at: str
    updated_at: str


@dataclass
class QARecord:
    id: int
    project_id: int
    session_id: Optional[int]
    parent_qa_id: Optional[int]
    relation_type: str
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
    retrieval_sources_json: Optional[str]
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


@dataclass
class DocumentTerm:
    id: int
    project_id: int
    source_type: str
    source_path: str
    term_text: str
    detection_source: str
    confidence: float
    status: str
    qa_record_id: Optional[int]
    created_at: str
    updated_at: str


@dataclass
class LearningAnchor:
    id: int
    project_id: int
    qa_record_id: int
    term_text: Optional[str]
    summary: str
    created_at: str
    updated_at: str


@dataclass
class IndexedFile:
    id: int
    project_id: int
    relative_path: str
    file_size: int
    mtime_ns: int
    content_hash: Optional[str]
    language: str
    chunk_version: int
    indexed_at: str


@dataclass
class LearningState:
    id: int
    project_id: int
    source_type: str
    source_path: str
    status: str
    position_kind: str
    position_value: float
    last_opened_at: str
    completed_at: Optional[str]
    updated_at: str


def init_storage() -> None:
    WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
    REPOS_ROOT.mkdir(parents=True, exist_ok=True)
    GENERATED_ROOT.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(DB_PATH, timeout=15)) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=15000")
        conn.execute("PRAGMA synchronous=NORMAL")
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
                progress_current INTEGER NOT NULL DEFAULT 0,
                progress_total INTEGER NOT NULL DEFAULT 0,
                stage_label TEXT,
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
        if "retrieval_sources_json" not in qa_cols:
            conn.execute("ALTER TABLE qa_records ADD COLUMN retrieval_sources_json TEXT")
        if "parent_qa_id" not in qa_cols:
            conn.execute("ALTER TABLE qa_records ADD COLUMN parent_qa_id INTEGER")
        if "relation_type" not in qa_cols:
            conn.execute("ALTER TABLE qa_records ADD COLUMN relation_type TEXT NOT NULL DEFAULT 'follow_up'")
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
        # Migration: add generation column to code_chunks
        chunk_cols = [row[1] for row in conn.execute("PRAGMA table_info(code_chunks)").fetchall()]
        if "generation" not in chunk_cols:
            conn.execute("ALTER TABLE code_chunks ADD COLUMN generation INTEGER NOT NULL DEFAULT 1")
            conn.commit()
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS indexed_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                relative_path TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                mtime_ns INTEGER NOT NULL,
                content_hash TEXT,
                language TEXT NOT NULL,
                chunk_version INTEGER NOT NULL DEFAULT 1,
                indexed_at TEXT NOT NULL,
                UNIQUE(project_id, relative_path),
                FOREIGN KEY(project_id) REFERENCES projects(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS project_indexes (
                project_id INTEGER PRIMARY KEY,
                status TEXT NOT NULL,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                text_status TEXT NOT NULL DEFAULT 'not_built',
                structural_status TEXT NOT NULL DEFAULT 'not_built',
                node_count INTEGER NOT NULL DEFAULT 0,
                edge_count INTEGER NOT NULL DEFAULT 0,
                engine TEXT,
                degraded_reason TEXT,
                indexed_fingerprint TEXT,
                structural_project_name TEXT,
                error_message TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            )
            """
        )
        index_cols = [row[1] for row in conn.execute("PRAGMA table_info(project_indexes)").fetchall()]
        index_migrations = {
            "text_status": "TEXT NOT NULL DEFAULT 'not_built'",
            "structural_status": "TEXT NOT NULL DEFAULT 'not_built'",
            "node_count": "INTEGER NOT NULL DEFAULT 0",
            "edge_count": "INTEGER NOT NULL DEFAULT 0",
            "engine": "TEXT",
            "degraded_reason": "TEXT",
            "indexed_fingerprint": "TEXT",
            "structural_project_name": "TEXT",
            "active_generation": "INTEGER NOT NULL DEFAULT 0",
            "building_generation": "INTEGER",
            "last_good_generation": "INTEGER",
            "stage": "TEXT",
            "progress_current": "INTEGER NOT NULL DEFAULT 0",
            "progress_total": "INTEGER NOT NULL DEFAULT 0",
            "processed_files": "INTEGER NOT NULL DEFAULT 0",
            "unchanged_files": "INTEGER NOT NULL DEFAULT 0",
            "added_files": "INTEGER NOT NULL DEFAULT 0",
            "updated_files": "INTEGER NOT NULL DEFAULT 0",
            "deleted_files": "INTEGER NOT NULL DEFAULT 0",
            "skipped_files": "INTEGER NOT NULL DEFAULT 0",
            "failed_files": "INTEGER NOT NULL DEFAULT 0",
            "started_at": "TEXT",
            "finished_at": "TEXT",
            "duration_ms": "INTEGER",
            "last_good_index_at": "TEXT",
            "index_schema_version": "INTEGER",
            "chunk_algorithm_version": "INTEGER",
            "ignore_rules_version": "INTEGER",
            "structural_engine_version": "INTEGER",
        }
        for column, definition in index_migrations.items():
            if column not in index_cols:
                conn.execute(f"ALTER TABLE project_indexes ADD COLUMN {column} {definition}")
        conn.execute(
            """
            UPDATE project_indexes
            SET text_status = CASE
                WHEN text_status = 'not_built' AND status = 'completed' THEN 'completed'
                WHEN text_status = 'not_built' AND status = 'building' THEN 'building'
                WHEN text_status = 'not_built' AND status = 'failed' THEN 'failed'
                ELSE text_status
            END
            """
        )
        # Clean up interrupted builds: if building_generation is set but status is not building,
        # the previous session crashed; mark as failed and clean the incomplete generation
        interrupted = conn.execute(
            "SELECT project_id, building_generation, active_generation FROM project_indexes "
            "WHERE status = 'building' OR building_generation IS NOT NULL"
        ).fetchall()
        for row in interrupted:
            pid = row["project_id"]
            bg = row["building_generation"]
            ag = row["active_generation"] or 0
            if row["status"] == "building" or (bg and bg > ag):
                # Previous build was interrupted
                if bg and bg > 0:
                    conn.execute("DELETE FROM code_chunks WHERE project_id = ? AND generation = ?", (pid, bg))
                conn.execute(
                    "UPDATE project_indexes SET status = 'failed', building_generation = NULL, "
                    "stage = 'cancelled', error_message = '上次构建过程异常退出，已清理未完成索引。' "
                    "WHERE project_id = ?",
                    (pid,),
                )
        conn.commit()
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
        task_cols = [row[1] for row in conn.execute("PRAGMA table_info(generation_tasks)").fetchall()]
        if "progress_current" not in task_cols:
            conn.execute("ALTER TABLE generation_tasks ADD COLUMN progress_current INTEGER NOT NULL DEFAULT 0")
        if "progress_total" not in task_cols:
            conn.execute("ALTER TABLE generation_tasks ADD COLUMN progress_total INTEGER NOT NULL DEFAULT 0")
        if "stage_label" not in task_cols:
            conn.execute("ALTER TABLE generation_tasks ADD COLUMN stage_label TEXT")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS document_terms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                source_type TEXT NOT NULL,
                source_path TEXT NOT NULL,
                term_text TEXT NOT NULL,
                detection_source TEXT NOT NULL,
                confidence REAL NOT NULL DEFAULT 0.7,
                status TEXT NOT NULL DEFAULT 'candidate',
                qa_record_id INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id),
                FOREIGN KEY(qa_record_id) REFERENCES qa_records(id),
                UNIQUE(project_id, source_type, source_path, term_text)
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_document_terms_source
            ON document_terms(project_id, source_type, source_path, status)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS learning_anchors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                qa_record_id INTEGER NOT NULL UNIQUE,
                term_text TEXT,
                summary TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id),
                FOREIGN KEY(qa_record_id) REFERENCES qa_records(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS learning_states (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                source_type TEXT NOT NULL,
                source_path TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'in_progress',
                position_kind TEXT NOT NULL DEFAULT 'scroll_ratio',
                position_value REAL NOT NULL DEFAULT 0,
                last_opened_at TEXT NOT NULL,
                completed_at TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id),
                UNIQUE(project_id, source_type, source_path)
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_learning_states_project_recent
            ON learning_states(project_id, last_opened_at DESC)
            """
        )
        conn.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS learning_anchors_fts USING fts5(
                anchor_id UNINDEXED,
                project_id UNINDEXED,
                term_text,
                summary
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
        progress_current=row["progress_current"] if "progress_current" in row.keys() else 0,
        progress_total=row["progress_total"] if "progress_total" in row.keys() else 0,
        stage_label=row["stage_label"] if "stage_label" in row.keys() else None,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_qa_record(row: sqlite3.Row) -> QARecord:
    return QARecord(
        id=row["id"],
        project_id=row["project_id"],
        session_id=row["session_id"] if "session_id" in row.keys() else None,
        parent_qa_id=row["parent_qa_id"] if "parent_qa_id" in row.keys() else None,
        relation_type=(row["relation_type"] if "relation_type" in row.keys() else None) or "follow_up",
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
        retrieval_sources_json=row["retrieval_sources_json"] if "retrieval_sources_json" in row.keys() else None,
        favorite=bool(row["favorite"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_document_term(row: sqlite3.Row) -> DocumentTerm:
    return DocumentTerm(
        id=row["id"],
        project_id=row["project_id"],
        source_type=row["source_type"],
        source_path=row["source_path"],
        term_text=row["term_text"],
        detection_source=row["detection_source"],
        confidence=float(row["confidence"]),
        status=row["status"],
        qa_record_id=row["qa_record_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_learning_anchor(row: sqlite3.Row) -> LearningAnchor:
    return LearningAnchor(
        id=row["id"],
        project_id=row["project_id"],
        qa_record_id=row["qa_record_id"],
        term_text=row["term_text"],
        summary=row["summary"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_learning_state(row: sqlite3.Row) -> LearningState:
    return LearningState(
        id=row["id"],
        project_id=row["project_id"],
        source_type=row["source_type"],
        source_path=row["source_path"],
        status=row["status"],
        position_kind=row["position_kind"],
        position_value=float(row["position_value"]),
        last_opened_at=row["last_opened_at"],
        completed_at=row["completed_at"],
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


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=15000")
    conn.execute("PRAGMA synchronous=NORMAL")
    try:
        yield conn
    finally:
        conn.close()


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
        conn.execute("DELETE FROM learning_states WHERE project_id = ?", (project_id,))
        anchor_ids = [row["id"] for row in conn.execute("SELECT id FROM learning_anchors WHERE project_id = ?", (project_id,)).fetchall()]
        for anchor_id in anchor_ids:
            conn.execute("DELETE FROM learning_anchors_fts WHERE anchor_id = ?", (anchor_id,))
        conn.execute("DELETE FROM learning_anchors WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM document_terms WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM knowledge_links WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM knowledge_edges WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM knowledge_nodes WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM generation_tasks WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM qa_records WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM qa_sessions WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM highlights WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM code_chunks_fts WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM code_chunks WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM indexed_files WHERE project_id = ?", (project_id,))
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
    progress_current: Optional[int] = None,
    progress_total: Optional[int] = None,
    stage_label: Optional[str] = None,
) -> Optional[GenerationTask]:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            UPDATE generation_tasks
            SET status = ?,
                output_path = COALESCE(?, output_path),
                error_message = ?,
                progress_current = COALESCE(?, progress_current),
                progress_total = COALESCE(?, progress_total),
                stage_label = COALESCE(?, stage_label),
                updated_at = ?
            WHERE id = ?
            """,
            (
                status,
                str(output_path) if output_path else None,
                error_message,
                progress_current,
                progress_total,
                stage_label,
                now,
                task_id,
            ),
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
    retrieval_sources_json: Optional[str] = None,
    parent_qa_id: Optional[int] = None,
    relation_type: str = "follow_up",
) -> QARecord:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO qa_records (
                project_id, session_id, parent_qa_id, relation_type, source_type, source_path, display_title, selected_text, question,
                answer_md, provider, model, output_path, retrieval_trace, retrieval_sources_json, favorite, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                project_id,
                session_id,
                parent_qa_id,
                relation_type,
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
                retrieval_sources_json,
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


def get_qa_record_by_output_path(project_id: int, output_path: str) -> Optional[QARecord]:
    normalized = str(Path(output_path))
    alternatives = {normalized, normalized.replace("\\", "/")}
    with _connect() as conn:
        for candidate in alternatives:
            row = conn.execute(
                "SELECT * FROM qa_records WHERE project_id = ? AND output_path = ? LIMIT 1",
                (project_id, candidate),
            ).fetchone()
            if row:
                return _row_to_qa_record(row)
    return None


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


def list_qa_session_records(project_id: int, session_id: int) -> list[QARecord]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM qa_records
            WHERE project_id = ? AND session_id = ?
            ORDER BY created_at ASC, id ASC
            """,
            (project_id, session_id),
        ).fetchall()
        return [_row_to_qa_record(row) for row in rows]


def set_project_index_status(
    project_id: int,
    status: str,
    chunk_count: int = 0,
    error_message: Optional[str] = None,
    *,
    text_status: Optional[str] = None,
    structural_status: Optional[str] = None,
    node_count: Optional[int] = None,
    edge_count: Optional[int] = None,
    engine: Optional[str] = None,
    degraded_reason: Optional[str] = None,
    indexed_fingerprint: Optional[str] = None,
    structural_project_name: Optional[str] = None,
    stage: Optional[str] = None,
    progress_current: Optional[int] = None,
    progress_total: Optional[int] = None,
    processed_files: Optional[int] = None,
    unchanged_files: Optional[int] = None,
    added_files: Optional[int] = None,
    updated_files: Optional[int] = None,
    deleted_files: Optional[int] = None,
    skipped_files: Optional[int] = None,
    failed_files: Optional[int] = None,
    started_at: Optional[str] = None,
    finished_at: Optional[str] = None,
    duration_ms: Optional[int] = None,
    last_good_index_at: Optional[str] = None,
    active_generation: Optional[int] = None,
    building_generation: Optional[int] = None,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        existing = conn.execute("SELECT * FROM project_indexes WHERE project_id = ?", (project_id,)).fetchone()
        previous = dict(existing) if existing else {}
        values: dict[str, object] = {
            "text_status": text_status if text_status is not None else previous.get("text_status", "not_built"),
            "structural_status": structural_status if structural_status is not None else previous.get("structural_status", "not_built"),
            "node_count": node_count if node_count is not None else previous.get("node_count", 0),
            "edge_count": edge_count if edge_count is not None else previous.get("edge_count", 0),
            "engine": engine if engine is not None else previous.get("engine"),
            "degraded_reason": degraded_reason if degraded_reason is not None else previous.get("degraded_reason"),
            "indexed_fingerprint": indexed_fingerprint if indexed_fingerprint is not None else previous.get("indexed_fingerprint"),
            "structural_project_name": structural_project_name if structural_project_name is not None else previous.get("structural_project_name"),
            "stage": stage if stage is not None else previous.get("stage"),
            "progress_current": progress_current if progress_current is not None else previous.get("progress_current", 0),
            "progress_total": progress_total if progress_total is not None else previous.get("progress_total", 0),
            "processed_files": processed_files if processed_files is not None else previous.get("processed_files", 0),
            "unchanged_files": unchanged_files if unchanged_files is not None else previous.get("unchanged_files", 0),
            "added_files": added_files if added_files is not None else previous.get("added_files", 0),
            "updated_files": updated_files if updated_files is not None else previous.get("updated_files", 0),
            "deleted_files": deleted_files if deleted_files is not None else previous.get("deleted_files", 0),
            "skipped_files": skipped_files if skipped_files is not None else previous.get("skipped_files", 0),
            "failed_files": failed_files if failed_files is not None else previous.get("failed_files", 0),
            "active_generation": active_generation if active_generation is not None else previous.get("active_generation", 0),
            "building_generation": building_generation if building_generation is not None else previous.get("building_generation"),
        }
        conn.execute(
            """
            INSERT INTO project_indexes (
                project_id, status, chunk_count, text_status, structural_status,
                node_count, edge_count, engine, degraded_reason, indexed_fingerprint,
                structural_project_name, error_message,
                stage, progress_current, progress_total,
                processed_files, unchanged_files, added_files, updated_files,
                deleted_files, skipped_files, failed_files,
                active_generation, building_generation, started_at, finished_at, duration_ms,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
                status = excluded.status,
                chunk_count = excluded.chunk_count,
                text_status = excluded.text_status,
                structural_status = excluded.structural_status,
                node_count = excluded.node_count,
                edge_count = excluded.edge_count,
                engine = excluded.engine,
                degraded_reason = excluded.degraded_reason,
                indexed_fingerprint = excluded.indexed_fingerprint,
                structural_project_name = excluded.structural_project_name,
                error_message = excluded.error_message,
                stage = COALESCE(excluded.stage, project_indexes.stage),
                progress_current = COALESCE(excluded.progress_current, project_indexes.progress_current),
                progress_total = COALESCE(excluded.progress_total, project_indexes.progress_total),
                processed_files = COALESCE(excluded.processed_files, project_indexes.processed_files),
                unchanged_files = COALESCE(excluded.unchanged_files, project_indexes.unchanged_files),
                added_files = COALESCE(excluded.added_files, project_indexes.added_files),
                updated_files = COALESCE(excluded.updated_files, project_indexes.updated_files),
                deleted_files = COALESCE(excluded.deleted_files, project_indexes.deleted_files),
                skipped_files = COALESCE(excluded.skipped_files, project_indexes.skipped_files),
                failed_files = COALESCE(excluded.failed_files, project_indexes.failed_files),
                active_generation = COALESCE(excluded.active_generation, project_indexes.active_generation),
                building_generation = COALESCE(excluded.building_generation, project_indexes.building_generation),
                started_at = excluded.started_at,
                finished_at = excluded.finished_at,
                duration_ms = excluded.duration_ms,
                updated_at = excluded.updated_at
            """,
            (
                project_id, status, chunk_count,
                values["text_status"], values["structural_status"],
                values["node_count"], values["edge_count"],
                values["engine"], values["degraded_reason"],
                values["indexed_fingerprint"], values["structural_project_name"],
                error_message,
                values["stage"], values["progress_current"], values["progress_total"],
                values["processed_files"], values["unchanged_files"], values["added_files"],
                values["updated_files"], values["deleted_files"], values["skipped_files"],
                values["failed_files"],
                values["active_generation"], values["building_generation"],
                started_at, finished_at, duration_ms,
                now,
            ),
        )
        conn.commit()


DEFAULT_INDEX_STATUS_FIELDS: dict[str, object] = {
    "status": "not_built",
    "chunk_count": 0,
    "text_status": "not_built",
    "structural_status": "not_built",
    "node_count": 0,
    "edge_count": 0,
    "engine": None,
    "degraded_reason": None,
    "indexed_fingerprint": None,
    "structural_project_name": None,
    "error_message": None,
    "stage": None,
    "progress_current": 0,
    "progress_total": 0,
    "processed_files": 0,
    "unchanged_files": 0,
    "added_files": 0,
    "updated_files": 0,
    "deleted_files": 0,
    "skipped_files": 0,
    "failed_files": 0,
    "active_generation": 0,
    "building_generation": None,
    "started_at": None,
    "finished_at": None,
    "duration_ms": None,
    "last_good_index_at": None,
    "updated_at": None,
}


def get_project_index_status(project_id: int) -> dict[str, object]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM project_indexes WHERE project_id = ?", (project_id,)).fetchone()
        if not row:
            return {"project_id": project_id, **DEFAULT_INDEX_STATUS_FIELDS}
        result = dict(row)
        result["project_id"] = project_id
        return result


def replace_code_chunks(project_id: int, chunks: list[dict[str, object]]) -> int:
    """Legacy full-rebuild entry point. Uses generation-based write for safety."""
    gen = get_next_generation(project_id)
    write_chunks_to_generation(project_id, gen, chunks)
    activate_generation(project_id, gen)
    return len(chunks)


def get_active_generation(project_id: int) -> int:
    with _connect() as conn:
        row = conn.execute(
            "SELECT active_generation FROM project_indexes WHERE project_id = ?",
            (project_id,),
        ).fetchone()
        return int(row["active_generation"]) if row and row["active_generation"] else 0


def get_next_generation(project_id: int) -> int:
    """Reserve the next generation number for this project."""
    with _connect() as conn:
        existing = conn.execute(
            "SELECT COALESCE(MAX(generation), 0) AS max_gen FROM code_chunks WHERE project_id = ?",
            (project_id,),
        ).fetchone()
        return int(existing["max_gen"]) + 1 if existing else 1


def write_chunks_to_generation(project_id: int, generation: int, chunks: list[dict[str, object]]) -> None:
    """Write chunks for a specific generation. Does NOT switch active generation."""
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        for chunk in chunks:
            cursor = conn.execute(
                """
                INSERT INTO code_chunks (
                    project_id, path, language, start_line, end_line, chunk_type,
                    symbol_name, content, content_hash, generation, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    generation,
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


def copy_unchanged_chunks(project_id: int, old_generation: int, new_generation: int, unchanged_paths: set[str]) -> int:
    """Copy chunks for unchanged files from the old generation to the new one."""
    if not unchanged_paths or old_generation == 0 or old_generation == new_generation:
        return 0
    now = datetime.now(timezone.utc).isoformat()
    count = 0
    with _connect() as conn:
        for path in unchanged_paths:
            old_chunks = conn.execute(
                """
                SELECT path, language, start_line, end_line, chunk_type,
                       symbol_name, content, content_hash
                FROM code_chunks
                WHERE project_id = ? AND path = ? AND generation = ?
                ORDER BY start_line
                """,
                (project_id, path, old_generation),
            ).fetchall()
            for chunk in old_chunks:
                cursor = conn.execute(
                    """
                    INSERT INTO code_chunks (
                        project_id, path, language, start_line, end_line, chunk_type,
                        symbol_name, content, content_hash, generation, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        project_id,
                        chunk["path"],
                        chunk["language"],
                        int(chunk["start_line"]),
                        int(chunk["end_line"]),
                        chunk["chunk_type"],
                        chunk["symbol_name"],
                        chunk["content"],
                        chunk["content_hash"],
                        new_generation,
                        now,
                    ),
                )
                chunk_id = int(cursor.lastrowid)
                sym = chunk["symbol_name"] if isinstance(chunk, dict) else (chunk["symbol_name"] if "symbol_name" in chunk.keys() else None)
                conn.execute(
                    """
                    INSERT INTO code_chunks_fts (chunk_id, project_id, path, symbol_name, content)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (chunk_id, project_id, chunk["path"], sym, chunk["content"]),
                )
                count += 1
        conn.commit()
    return count


def activate_generation(project_id: int, generation: int) -> None:
    """Switch active_generation to the given generation in a transaction."""
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        existing = conn.execute(
            "SELECT project_id FROM project_indexes WHERE project_id = ?", (project_id,)
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE project_indexes
                SET active_generation = ?,
                    building_generation = NULL,
                    last_good_generation = active_generation,
                    updated_at = ?
                WHERE project_id = ?
                """,
                (generation, now, project_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO project_indexes (project_id, status, chunk_count, text_status,
                    structural_status, active_generation, updated_at)
                VALUES (?, 'not_built', 0, 'not_built', 'not_built', ?, ?)
                """,
                (project_id, generation, now),
            )
        conn.commit()


def clean_generation(project_id: int, generation: int) -> int:
    """Delete all chunks belonging to a given (old) generation."""
    with _connect() as conn:
        chunk_rows = conn.execute(
            "SELECT id FROM code_chunks WHERE project_id = ? AND generation = ?",
            (project_id, generation),
        ).fetchall()
        deleted = len(chunk_rows)
        conn.execute(
            "DELETE FROM code_chunks_fts WHERE chunk_id IN (SELECT id FROM code_chunks WHERE project_id = ? AND generation = ?)",
            (project_id, generation),
        )
        conn.execute(
            "DELETE FROM code_chunks WHERE project_id = ? AND generation = ?",
            (project_id, generation),
        )
        conn.commit()
    return deleted


def get_all_indexed_files(project_id: int) -> list[dict[str, object]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT relative_path, file_size, mtime_ns, content_hash, language, chunk_version "
            "FROM indexed_files WHERE project_id = ?",
            (project_id,),
        ).fetchall()
        return [dict(row) for row in rows]


def upsert_indexed_file(project_id: int, relative_path: str, file_size: int, mtime_ns: int, content_hash: Optional[str], language: str, chunk_version: int = 1) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO indexed_files (project_id, relative_path, file_size, mtime_ns, content_hash, language, chunk_version, indexed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, relative_path) DO UPDATE SET
                file_size = excluded.file_size,
                mtime_ns = excluded.mtime_ns,
                content_hash = excluded.content_hash,
                language = excluded.language,
                chunk_version = excluded.chunk_version,
                indexed_at = excluded.indexed_at
            """,
            (project_id, relative_path, file_size, mtime_ns, content_hash, language, chunk_version, now),
        )
        conn.commit()


def upsert_indexed_files_batch(project_id: int, records: list[dict[str, object]]) -> None:
    """Batch upsert indexed_files records for performance."""
    if not records:
        return
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        for rec in records:
            conn.execute(
                """
                INSERT INTO indexed_files (project_id, relative_path, file_size, mtime_ns, content_hash, language, chunk_version, indexed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id, relative_path) DO UPDATE SET
                    file_size = excluded.file_size,
                    mtime_ns = excluded.mtime_ns,
                    content_hash = excluded.content_hash,
                    language = excluded.language,
                    chunk_version = excluded.chunk_version,
                    indexed_at = excluded.indexed_at
                """,
                (
                    project_id,
                    str(rec["relative_path"]),
                    int(rec["file_size"]),
                    int(rec["mtime_ns"]),
                    rec.get("content_hash"),
                    str(rec["language"]),
                    int(rec.get("chunk_version", 1)),
                    now,
                ),
            )
        conn.commit()


def delete_stale_indexed_files(project_id: int, stale_paths: set[str]) -> int:
    """Delete indexed_files records and associated chunks for paths no longer on disk."""
    if not stale_paths:
        return 0
    with _connect() as conn:
        # Delete FTS entries for the stale paths' chunks
        placeholders = ",".join("?" for _ in stale_paths)
        params = [project_id] + list(stale_paths)
        conn.execute(
            f"DELETE FROM code_chunks_fts WHERE chunk_id IN "
            f"(SELECT id FROM code_chunks WHERE project_id = ? AND path IN ({placeholders}))",
            params,
        )
        conn.execute(
            f"DELETE FROM code_chunks WHERE project_id = ? AND path IN ({placeholders})",
            params,
        )
        cursor = conn.execute(
            f"DELETE FROM indexed_files WHERE project_id = ? AND relative_path IN ({placeholders})",
            params,
        )
        conn.commit()
        return cursor.rowcount


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
    active_gen = get_active_generation(project_id)
    if active_gen == 0:
        return []
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
                  AND c.generation = ?
                ORDER BY
                    CASE WHEN c.path = ? THEN 0 ELSE 1 END,
                    rank,
                    c.path,
                    c.start_line
                LIMIT ?
                """,
                (fts_query, project_id, active_gen, source_path or "", limit),
            ).fetchall()
        except sqlite3.OperationalError:
            like = f"%{terms[0]}%"
            rows = conn.execute(
                """
                SELECT * FROM code_chunks
                WHERE project_id = ? AND (content LIKE ? OR path LIKE ? OR COALESCE(symbol_name, '') LIKE ?)
                  AND generation = ?
                ORDER BY CASE WHEN path = ? THEN 0 ELSE 1 END, path, start_line
                LIMIT ?
                """,
                (project_id, like, like, like, active_gen, source_path or "", limit),
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
        qa_record = conn.execute(
            "SELECT output_path FROM qa_records WHERE project_id = ? AND id = ?",
            (project_id, record_id),
        ).fetchone()
        if qa_record and qa_record["output_path"]:
            conn.execute(
                "DELETE FROM learning_states WHERE project_id = ? AND source_type = 'qa' AND source_path = ?",
                (project_id, qa_record["output_path"]),
            )
        qa_nodes = [
            row["id"]
            for row in conn.execute(
                "SELECT id FROM knowledge_nodes WHERE project_id = ? AND ref_type = 'qa' AND ref_id = ?",
                (project_id, record_id),
            ).fetchall()
        ]
        conn.execute("DELETE FROM knowledge_links WHERE project_id = ? AND qa_record_id = ?", (project_id, record_id))
        anchor_rows = conn.execute(
            "SELECT id FROM learning_anchors WHERE project_id = ? AND qa_record_id = ?",
            (project_id, record_id),
        ).fetchall()
        for row in anchor_rows:
            conn.execute("DELETE FROM learning_anchors_fts WHERE anchor_id = ?", (row["id"],))
        conn.execute("DELETE FROM learning_anchors WHERE project_id = ? AND qa_record_id = ?", (project_id, record_id))
        conn.execute(
            "UPDATE document_terms SET status = 'candidate', qa_record_id = NULL WHERE project_id = ? AND qa_record_id = ?",
            (project_id, record_id),
        )
        conn.execute(
            "UPDATE qa_records SET parent_qa_id = NULL WHERE project_id = ? AND parent_qa_id = ?",
            (project_id, record_id),
        )
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


def normalize_default_course_node_titles(project_id: int) -> int:
    """Upgrade legacy outline labels without overwriting user aliases."""
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            """
            UPDATE knowledge_nodes
            SET title = '总纲', updated_at = ?
            WHERE project_id = ?
              AND ref_type = 'course'
              AND ref_path = 'outline.md'
              AND title IN ('outline.md', 'outline', '项目学习总纲')
            """,
            (now, project_id),
        )
        conn.commit()
        return cursor.rowcount


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


def cleanup_course_artifacts(project_id: int, source_path: str) -> None:
    with _connect() as conn:
        conn.execute(
            "DELETE FROM learning_states WHERE project_id = ? AND source_type = 'course' AND source_path = ?",
            (project_id, source_path),
        )
        node_ids = [
            row["id"]
            for row in conn.execute(
                """
                SELECT id FROM knowledge_nodes
                WHERE project_id = ? AND ref_type = 'course' AND ref_path = ?
                """,
                (project_id, source_path),
            ).fetchall()
        ]
        conn.execute(
            "DELETE FROM highlights WHERE project_id = ? AND source_type = 'course' AND source_path = ?",
            (project_id, source_path),
        )
        conn.execute(
            "DELETE FROM knowledge_links WHERE project_id = ? AND source_type = 'course' AND source_path = ?",
            (project_id, source_path),
        )
        conn.execute(
            "DELETE FROM document_terms WHERE project_id = ? AND source_type = 'course' AND source_path = ?",
            (project_id, source_path),
        )
        if node_ids:
            placeholders = ",".join("?" for _ in node_ids)
            conn.execute(
                f"DELETE FROM knowledge_links WHERE project_id = ? AND node_id IN ({placeholders})",
                [project_id, *node_ids],
            )
            conn.execute(
                f"""
                DELETE FROM knowledge_edges
                WHERE project_id = ?
                  AND (source_node_id IN ({placeholders}) OR target_node_id IN ({placeholders}))
                """,
                [project_id, *node_ids, *node_ids],
            )
            conn.execute(
                f"DELETE FROM knowledge_nodes WHERE project_id = ? AND id IN ({placeholders})",
                [project_id, *node_ids],
            )
        conn.commit()


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


def upsert_document_term(
    project_id: int,
    source_type: str,
    source_path: str,
    term_text: str,
    detection_source: str,
    confidence: float = 0.7,
) -> DocumentTerm:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO document_terms (
                project_id, source_type, source_path, term_text, detection_source,
                confidence, status, qa_record_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 'candidate', NULL, ?, ?)
            ON CONFLICT(project_id, source_type, source_path, term_text) DO UPDATE SET
                detection_source = CASE
                    WHEN document_terms.detection_source = 'model' THEN document_terms.detection_source
                    ELSE excluded.detection_source
                END,
                confidence = MAX(document_terms.confidence, excluded.confidence),
                updated_at = excluded.updated_at
            """,
            (project_id, source_type, source_path, term_text, detection_source, confidence, now, now),
        )
        conn.commit()
        row = conn.execute(
            """
            SELECT * FROM document_terms
            WHERE project_id = ? AND source_type = ? AND source_path = ? AND term_text = ?
            """,
            (project_id, source_type, source_path, term_text),
        ).fetchone()
        if row is None:
            raise RuntimeError("document term was not persisted")
        return _row_to_document_term(row)


def upsert_learning_state(
    project_id: int,
    source_type: str,
    source_path: str,
    status: str,
    position_kind: str,
    position_value: float,
) -> LearningState:
    now = datetime.now(timezone.utc).isoformat()
    completed_at = now if status == "completed" else None
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO learning_states (
                project_id, source_type, source_path, status, position_kind,
                position_value, last_opened_at, completed_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, source_type, source_path) DO UPDATE SET
                status = excluded.status,
                position_kind = excluded.position_kind,
                position_value = excluded.position_value,
                last_opened_at = excluded.last_opened_at,
                completed_at = CASE
                    WHEN excluded.status = 'completed' THEN COALESCE(learning_states.completed_at, excluded.completed_at)
                    ELSE NULL
                END,
                updated_at = excluded.updated_at
            """,
            (
                project_id,
                source_type,
                source_path,
                status,
                position_kind,
                position_value,
                now,
                completed_at,
                now,
            ),
        )
        conn.commit()
        row = conn.execute(
            """
            SELECT * FROM learning_states
            WHERE project_id = ? AND source_type = ? AND source_path = ?
            """,
            (project_id, source_type, source_path),
        ).fetchone()
        if row is None:
            raise RuntimeError("learning state was not persisted")
        return _row_to_learning_state(row)


def list_learning_states(project_id: int) -> list[LearningState]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM learning_states
            WHERE project_id = ?
            ORDER BY last_opened_at DESC, id DESC
            """,
            (project_id,),
        ).fetchall()
        return [_row_to_learning_state(row) for row in rows]


def delete_learning_state(project_id: int, source_type: str, source_path: str) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM learning_states WHERE project_id = ? AND source_type = ? AND source_path = ?",
            (project_id, source_type, source_path),
        )
        conn.commit()
        return cursor.rowcount > 0


def reset_learning_states(project_id: int) -> int:
    with _connect() as conn:
        cursor = conn.execute("DELETE FROM learning_states WHERE project_id = ?", (project_id,))
        conn.commit()
        return cursor.rowcount


def get_document_term(project_id: int, term_id: int) -> Optional[DocumentTerm]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM document_terms WHERE project_id = ? AND id = ?",
            (project_id, term_id),
        ).fetchone()
        return _row_to_document_term(row) if row else None


def list_document_terms(
    project_id: int,
    source_type: Optional[str] = None,
    source_path: Optional[str] = None,
) -> list[DocumentTerm]:
    clauses = ["project_id = ?"]
    params: list[object] = [project_id]
    if source_type:
        clauses.append("source_type = ?")
        params.append(source_type)
    if source_path:
        clauses.append("source_path = ?")
        params.append(source_path)
    sql = f"SELECT * FROM document_terms WHERE {' AND '.join(clauses)} ORDER BY LENGTH(term_text) DESC, confidence DESC, id ASC"
    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_document_term(row) for row in rows]


def update_document_term_status(
    project_id: int,
    term_id: int,
    status: str,
    qa_record_id: Optional[int] = None,
) -> Optional[DocumentTerm]:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            """
            UPDATE document_terms
            SET status = ?, qa_record_id = COALESCE(?, qa_record_id), updated_at = ?
            WHERE project_id = ? AND id = ?
            """,
            (status, qa_record_id, now, project_id, term_id),
        )
        conn.commit()
        if cursor.rowcount == 0:
            return None
    return get_document_term(project_id, term_id)


def upsert_learning_anchor(
    project_id: int,
    qa_record_id: int,
    summary: str,
    term_text: Optional[str] = None,
) -> LearningAnchor:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO learning_anchors (
                project_id, qa_record_id, term_text, summary, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(qa_record_id) DO UPDATE SET
                term_text = excluded.term_text,
                summary = excluded.summary,
                updated_at = excluded.updated_at
            """,
            (project_id, qa_record_id, term_text, summary, now, now),
        )
        row = conn.execute(
            "SELECT * FROM learning_anchors WHERE project_id = ? AND qa_record_id = ?",
            (project_id, qa_record_id),
        ).fetchone()
        if row is None:
            raise RuntimeError("learning anchor was not persisted")
        anchor = _row_to_learning_anchor(row)
        conn.execute("DELETE FROM learning_anchors_fts WHERE anchor_id = ?", (anchor.id,))
        conn.execute(
            "INSERT INTO learning_anchors_fts (anchor_id, project_id, term_text, summary) VALUES (?, ?, ?, ?)",
            (anchor.id, project_id, term_text or "", summary),
        )
        if term_text:
            conn.execute(
                """
                UPDATE document_terms
                SET status = 'known', updated_at = ?
                WHERE project_id = ? AND lower(term_text) = lower(?) AND status = 'candidate'
                """,
                (now, project_id, term_text),
            )
        conn.commit()
        return anchor


def get_learning_anchor(project_id: int, qa_record_id: int) -> Optional[LearningAnchor]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM learning_anchors WHERE project_id = ? AND qa_record_id = ?",
            (project_id, qa_record_id),
        ).fetchone()
        return _row_to_learning_anchor(row) if row else None


def list_learning_anchors(project_id: int) -> list[LearningAnchor]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM learning_anchors WHERE project_id = ? ORDER BY updated_at DESC, id DESC",
            (project_id,),
        ).fetchall()
        return [_row_to_learning_anchor(row) for row in rows]


def search_learning_anchors(project_id: int, query: str, limit: int = 3) -> list[LearningAnchor]:
    terms = [item for item in re_split_search_terms(query) if item]
    if not terms:
        return list_learning_anchors(project_id)[:limit]
    with _connect() as conn:
        try:
            rows = conn.execute(
                """
                SELECT a.* FROM learning_anchors_fts f
                JOIN learning_anchors a ON a.id = f.anchor_id
                WHERE learning_anchors_fts MATCH ? AND a.project_id = ?
                ORDER BY bm25(learning_anchors_fts), a.updated_at DESC
                LIMIT ?
                """,
                (" OR ".join(terms[:10]), project_id, limit),
            ).fetchall()
        except sqlite3.OperationalError:
            like = f"%{terms[0]}%"
            rows = conn.execute(
                """
                SELECT * FROM learning_anchors
                WHERE project_id = ? AND (summary LIKE ? OR COALESCE(term_text, '') LIKE ?)
                ORDER BY updated_at DESC LIMIT ?
                """,
                (project_id, like, like, limit),
            ).fetchall()
        return [_row_to_learning_anchor(row) for row in rows]


def delete_learning_anchor(project_id: int, qa_record_id: int) -> bool:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id FROM learning_anchors WHERE project_id = ? AND qa_record_id = ?",
            (project_id, qa_record_id),
        ).fetchone()
        if row is None:
            return False
        conn.execute("DELETE FROM learning_anchors_fts WHERE anchor_id = ?", (row["id"],))
        conn.execute(
            "DELETE FROM learning_anchors WHERE project_id = ? AND qa_record_id = ?",
            (project_id, qa_record_id),
        )
        conn.commit()
        return True


def update_knowledge_link_node(project_id: int, link_id: int, node_id: int) -> Optional[KnowledgeLink]:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            UPDATE knowledge_links
            SET node_id = ?, updated_at = ?
            WHERE project_id = ? AND id = ?
            """,
            (node_id, now, project_id, link_id),
        )
        conn.commit()
    return get_knowledge_link(project_id, link_id)


def collapse_knowledge_term_bridges(project_id: int) -> int:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT
                ref.id AS ref_edge_id,
                exp.id AS exp_edge_id,
                ref.source_node_id AS source_id,
                ref.target_node_id AS term_id,
                exp.target_node_id AS qa_id
            FROM knowledge_edges ref
            JOIN knowledge_nodes term ON term.project_id = ref.project_id AND term.id = ref.target_node_id
            JOIN knowledge_edges exp ON exp.project_id = ref.project_id AND exp.source_node_id = term.id
            JOIN knowledge_nodes qa ON qa.project_id = exp.project_id AND qa.id = exp.target_node_id
            WHERE ref.project_id = ?
              AND ref.relation_type = 'references'
              AND exp.relation_type = 'explains'
              AND term.node_type = 'term'
              AND term.ref_type = 'term'
              AND qa.node_type = 'qa'
            """,
            (project_id,),
        ).fetchall()
        if not rows:
            return 0

        changed = 0
        now = datetime.now(timezone.utc).isoformat()
        bridge_edge_ids: set[int] = set()
        term_ids: set[int] = set()
        for row in rows:
            exists = conn.execute(
                """
                SELECT 1 FROM knowledge_edges
                WHERE project_id = ? AND source_node_id = ? AND target_node_id = ? AND relation_type = 'explains'
                LIMIT 1
                """,
                (project_id, row["source_id"], row["qa_id"]),
            ).fetchone()
            if not exists:
                conn.execute(
                    """
                    INSERT INTO knowledge_edges (project_id, source_node_id, target_node_id, relation_type, label, created_at, updated_at)
                    VALUES (?, ?, ?, 'explains', '解释', ?, ?)
                    """,
                    (project_id, row["source_id"], row["qa_id"], now, now),
                )
                changed += 1
            conn.execute(
                "UPDATE knowledge_links SET node_id = ?, updated_at = ? WHERE project_id = ? AND node_id = ?",
                (row["qa_id"], now, project_id, row["term_id"]),
            )
            bridge_edge_ids.add(int(row["ref_edge_id"]))
            bridge_edge_ids.add(int(row["exp_edge_id"]))
            term_ids.add(int(row["term_id"]))

        if bridge_edge_ids:
            placeholders = ",".join("?" for _ in bridge_edge_ids)
            conn.execute(
                f"DELETE FROM knowledge_edges WHERE project_id = ? AND id IN ({placeholders})",
                [project_id, *bridge_edge_ids],
            )

        for term_id in term_ids:
            conn.execute(
                """
                DELETE FROM knowledge_nodes
                WHERE project_id = ?
                  AND id = ?
                  AND node_type = 'term'
                  AND ref_type = 'term'
                  AND id NOT IN (SELECT source_node_id FROM knowledge_edges WHERE project_id = ?)
                  AND id NOT IN (SELECT target_node_id FROM knowledge_edges WHERE project_id = ?)
                  AND id NOT IN (SELECT node_id FROM knowledge_links WHERE project_id = ?)
                """,
                (project_id, term_id, project_id, project_id, project_id),
            )
        conn.commit()
        return changed


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
