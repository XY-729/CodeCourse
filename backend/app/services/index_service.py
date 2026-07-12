from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Optional

from app.core.config import IGNORED_DIRS, MAX_TEXT_BYTES
from app.models.schemas import ProjectSearchResult
from app.services.generation_service import extract_file_signals
from app.services.scanner import infer_language
from app.services.storage import (
    CodeChunk,
    get_project,
    get_project_index_status,
    replace_code_chunks,
    search_code_chunks,
    set_project_index_status,
)

CHUNK_LINES = 80
CHUNK_OVERLAP = 12
MAX_INDEX_BYTES = min(MAX_TEXT_BYTES, 400_000)


def _should_skip(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    if any(part in IGNORED_DIRS or part == ".generated_course" for part in rel.parts):
        return True
    if not path.is_file():
        return True
    if path.stat().st_size > MAX_INDEX_BYTES:
        return True
    return False


def _symbol_for_line(lines: list[str], line_number: int) -> Optional[str]:
    patterns = [
        re.compile(r"^\s*(?:def|class)\s+([A-Za-z_][\w]*)"),
        re.compile(r"^\s*(?:function|class|interface|type)\s+([A-Za-z_][\w]*)"),
        re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][\w]*)\s*="),
        re.compile(r"^\s*(?:struct|enum|class)\s+([A-Za-z_][\w:]*)"),
        re.compile(r"^\s*([A-Za-z_][\w:]*)\s*\([^;]*\)\s*(?:const\s*)?[{:]"),
    ]
    for idx in range(max(0, line_number - 1), -1, -1):
        text = lines[idx]
        for pattern in patterns:
            match = pattern.match(text)
            if match:
                return match.group(1)
    return None


def _chunk_file(project_id: int, root: Path, path: Path) -> list[dict[str, object]]:
    rel = path.relative_to(root).as_posix()
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return []
    language = infer_language(path)
    lines = content.splitlines()
    imports, symbols = extract_file_signals(content)
    chunks: list[dict[str, object]] = []

    if imports or symbols:
        signal_content = "\n".join(
            [
                f"文件：{rel}",
                f"语言：{language}",
                "import/include:",
                *imports[:40],
                "symbols:",
                ", ".join(symbols[:100]),
            ]
        )
        chunks.append(
            {
                "project_id": project_id,
                "path": rel,
                "language": language,
                "start_line": 1,
                "end_line": min(len(lines), 1),
                "chunk_type": "signals",
                "symbol_name": None,
                "content": signal_content,
                "content_hash": hashlib.sha256(signal_content.encode("utf-8")).hexdigest(),
            }
        )

    step = max(1, CHUNK_LINES - CHUNK_OVERLAP)
    for start in range(0, max(1, len(lines)), step):
        end = min(len(lines), start + CHUNK_LINES)
        part_lines = lines[start:end]
        if not part_lines:
            continue
        body = "\n".join(part_lines).strip()
        if not body:
            continue
        start_line = start + 1
        chunk_text = f"文件：{rel}\n行号：{start_line}-{end}\n语言：{language}\n\n{body}"
        chunks.append(
            {
                "project_id": project_id,
                "path": rel,
                "language": language,
                "start_line": start_line,
                "end_line": end,
                "chunk_type": "lines",
                "symbol_name": _symbol_for_line(lines, start_line),
                "content": chunk_text,
                "content_hash": hashlib.sha256(chunk_text.encode("utf-8")).hexdigest(),
            }
        )
        if end >= len(lines):
            break
    return chunks


def build_project_index(project_id: int) -> int:
    project = get_project(project_id)
    if project is None:
        raise RuntimeError("Project not found")
    root = Path(project.local_path).resolve()
    if not root.exists():
        raise RuntimeError("Project directory not found")
    set_project_index_status(project_id, "building", 0, None)
    try:
        chunks: list[dict[str, object]] = []
        for path in root.rglob("*"):
            if _should_skip(path, root):
                continue
            chunks.extend(_chunk_file(project_id, root, path))
        count = replace_code_chunks(project_id, chunks)
        return count
    except Exception as exc:
        set_project_index_status(project_id, "failed", 0, str(exc))
        raise


def index_status(project_id: int) -> dict[str, object]:
    return get_project_index_status(project_id)


def search_project(project_id: int, query: str, source_path: Optional[str] = None, limit: int = 8) -> list[ProjectSearchResult]:
    chunks = search_code_chunks(project_id, query, source_path=source_path, limit=limit)
    return [_to_result(chunk, source_path) for chunk in chunks]


def _to_result(chunk: CodeChunk, source_path: Optional[str]) -> ProjectSearchResult:
    score = 20.0 if source_path and chunk.path == source_path else 10.0
    if chunk.chunk_type == "signals":
        score += 2.0
    if chunk.symbol_name:
        score += 1.0
    return ProjectSearchResult(
        path=chunk.path,
        language=chunk.language,
        start_line=chunk.start_line,
        end_line=chunk.end_line,
        chunk_type=chunk.chunk_type,
        symbol_name=chunk.symbol_name,
        content=chunk.content[:4000],
        score=score,
    )
