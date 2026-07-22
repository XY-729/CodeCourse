from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.core.config import IGNORED_DIRS, MAX_TEXT_BYTES
from app.models.schemas import ProjectSearchResult
from app.services.generation_service import extract_file_signals
from app.services.scanner import infer_language
from app.services.code_intelligence import (
    ENGINE_NAME,
    StructuralEngineError,
    build_structural_index,
    hybrid_retrieve,
    project_fingerprint,
    structural_available,
)
import sqlite3

from app.core.config import CHUNK_ALGORITHM_VERSION, DB_PATH, IGNORE_RULES_VERSION, INDEX_SCHEMA_VERSION, STRUCTURAL_ENGINE_VERSION
from app.services.storage import (
    activate_generation,
    clean_generation,
    copy_unchanged_chunks,
    delete_stale_indexed_files,
    get_active_generation,
    get_all_indexed_files,
    get_next_generation,
    get_project,
    get_project_index_status,
    replace_code_chunks,
    set_project_index_status,
    upsert_indexed_files_batch,
    write_chunks_to_generation,
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


_BUILDING_LOCKS: set[int] = set()


def build_project_index(project_id: int) -> int:
    project = get_project(project_id)
    if project is None:
        raise RuntimeError("Project not found")
    root = Path(project.local_path).resolve()
    if not root.exists():
        raise RuntimeError("Project directory not found")

    if project.project_type == "learning_plan":
        set_project_index_status(
            project_id,
            "completed",
            0,
            None,
            text_status="not_applicable",
            structural_status="not_applicable",
            engine="fts",
        )
        return 0

    # Concurrency guard
    if project_id in _BUILDING_LOCKS:
        # Already building for this project; caller should poll status
        return int(get_project_index_status(project_id).get("chunk_count") or 0)
    _BUILDING_LOCKS.add(project_id)

    previous = get_project_index_status(project_id)
    started_at = datetime.now(timezone.utc).isoformat()
    text_count = int(previous.get("chunk_count") or 0)
    old_active_gen = int(previous.get("active_generation") or 0)
    new_gen = 0

    try:
        # --- Stage: scanning ---
        set_project_index_status(
            project_id, "building", text_count, None,
            text_status="building",
            structural_status=str(previous.get("structural_status") or "not_built"),
            degraded_reason=None,
            stage="scanning",
            started_at=started_at,
            progress_current=0, progress_total=0,
        )

        disk_files: dict[str, dict[str, object]] = {}
        for path in root.rglob("*"):
            if _should_skip(path, root):
                continue
            try:
                stat = path.stat()
                disk_files[path.relative_to(root).as_posix()] = {
                    "relative_path": path.relative_to(root).as_posix(),
                    "file_size": stat.st_size,
                    "mtime_ns": stat.st_mtime_ns,
                    "language": infer_language(path),
                }
            except OSError:
                continue

        total_files = len(disk_files)

        # --- Stage: comparing ---
        set_project_index_status(
            project_id, "building", text_count, None,
            text_status="building",
            structural_status=str(previous.get("structural_status") or "not_built"),
            stage="comparing",
            started_at=started_at,
            progress_current=0, progress_total=total_files,
        )

        existing_records = get_all_indexed_files(project_id)
        existing_map: dict[str, dict[str, object]] = {}
        for rec in existing_records:
            existing_map[str(rec["relative_path"])] = rec

        new_files: list[dict[str, object]] = []
        modified_files: list[dict[str, object]] = []
        unchanged_paths: set[str] = set()
        skipped: int = 0

        for rel_path, disk_info in disk_files.items():
            existing = existing_map.get(rel_path)
            if existing is None:
                new_files.append(disk_info)
            else:
                size_match = int(disk_info["file_size"]) == int(existing["file_size"])
                mtime_match = int(disk_info["mtime_ns"]) == int(existing["mtime_ns"])
                if size_match and mtime_match:
                    unchanged_paths.add(rel_path)
                else:
                    # Suspected change — verify with content hash
                    fp = root / rel_path
                    try:
                        content = fp.read_text(encoding="utf-8")
                        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
                    except (UnicodeDecodeError, OSError):
                        skipped += 1
                        continue
                    if existing.get("content_hash") == content_hash:
                        # Content unchanged, just update metadata
                        upsert_indexed_files_batch(project_id, [{
                            "relative_path": rel_path,
                            "file_size": disk_info["file_size"],
                            "mtime_ns": disk_info["mtime_ns"],
                            "content_hash": content_hash,
                            "language": disk_info["language"],
                            "chunk_version": CHUNK_ALGORITHM_VERSION,
                        }])
                        unchanged_paths.add(rel_path)
                    else:
                        disk_info["content_hash"] = content_hash
                        modified_files.append(disk_info)

        stale_paths: set[str] = set(existing_map.keys()) - set(disk_files.keys())
        unchanged_count = len(unchanged_paths)
        added_count = len(new_files)
        modified_count = len(modified_files)
        deleted_count = len(stale_paths)
        to_process = added_count + modified_count

        # --- Stage: building_text_index ---
        set_project_index_status(
            project_id, "building", text_count, None,
            text_status="building",
            structural_status=str(previous.get("structural_status") or "not_built"),
            stage="building_text_index",
            started_at=started_at,
            progress_current=0, progress_total=to_process,
            processed_files=0,
            unchanged_files=unchanged_count,
            added_files=added_count,
            updated_files=modified_count,
            deleted_files=deleted_count,
            skipped_files=skipped,
        )

        new_gen = get_next_generation(project_id)
        set_project_index_status(
            project_id, "building", 0, None,
            text_status="building",
            structural_status=str(previous.get("structural_status") or "not_built"),
            stage="building_text_index",
            started_at=started_at,
            building_generation=new_gen,
            progress_current=0, progress_total=to_process,
        )

        all_chunks: list[dict[str, object]] = []
        failed_count = 0
        failed_details: list[str] = []
        processed = 0

        # Process new files
        for info in new_files:
            try:
                fp = root / str(info["relative_path"])
                chunks = _chunk_file(project_id, root, fp)
                all_chunks.extend(chunks)
            except Exception as exc:
                failed_count += 1
                failed_details.append(f"{info['relative_path']}: {str(exc)[:200]}")
            processed += 1
            if processed % 10 == 0 or processed == to_process:
                set_project_index_status(
                    project_id, "building", 0, None,
                    text_status="building",
                    structural_status=str(previous.get("structural_status") or "not_built"),
                    stage="building_text_index",
                    progress_current=processed, progress_total=to_process,
                    processed_files=processed, failed_files=failed_count,
                )

        # Process modified files
        for info in modified_files:
            try:
                fp = root / str(info["relative_path"])
                chunks = _chunk_file(project_id, root, fp)
                all_chunks.extend(chunks)
            except Exception as exc:
                failed_count += 1
                failed_details.append(f"{info['relative_path']}: {str(exc)[:200]}")
            processed += 1
            if processed % 10 == 0 or processed == to_process:
                set_project_index_status(
                    project_id, "building", 0, None,
                    text_status="building",
                    structural_status=str(previous.get("structural_status") or "not_built"),
                    stage="building_text_index",
                    progress_current=processed, progress_total=to_process,
                    processed_files=processed, failed_files=failed_count,
                )

        # Write new chunks into the new generation
        if all_chunks or unchanged_paths or not disk_files:
            write_chunks_to_generation(project_id, new_gen, all_chunks)
            if unchanged_paths and old_active_gen > 0:
                copy_unchanged_chunks(project_id, old_active_gen, new_gen, unchanged_paths)

        # Delete stale file chunks (paths no longer on disk)
        if stale_paths:
            delete_stale_indexed_files(project_id, stale_paths)

        # Upsert indexed_files for new and modified files
        all_records = new_files + modified_files
        if all_records:
            for rec in all_records:
                if "content_hash" not in rec:
                    try:
                        fp = root / str(rec["relative_path"])
                        content = fp.read_text(encoding="utf-8")
                        rec["content_hash"] = hashlib.sha256(content.encode("utf-8")).hexdigest()
                    except (UnicodeDecodeError, OSError):
                        rec["content_hash"] = None
                rec["chunk_version"] = CHUNK_ALGORITHM_VERSION
            upsert_indexed_files_batch(project_id, all_records)

        # --- Stage: switching_generation ---
        set_project_index_status(
            project_id, "building", 0, None,
            text_status="building",
            structural_status=str(previous.get("structural_status") or "not_built"),
            stage="switching_generation",
            building_generation=new_gen,
        )

        activate_generation(project_id, new_gen)

        # --- Stage: cleaning_old_generation ---
        if old_active_gen > 0 and old_active_gen != new_gen:
            set_project_index_status(
                project_id, "building", 0, None,
                text_status="completed",
                structural_status=str(previous.get("structural_status") or "not_built"),
                stage="cleaning_old_generation",
                active_generation=new_gen,
                building_generation=None,
            )
            clean_generation(project_id, old_active_gen)

        text_count = get_active_generation_chunk_count(project_id)

        # --- Stage: structural index ---
        if not structural_available():
            finished_at = datetime.now(timezone.utc).isoformat()
            set_project_index_status(
                project_id, "completed", text_count, None,
                text_status="completed",
                structural_status="unavailable",
                engine="fts",
                degraded_reason="结构索引组件不可用，当前使用基础全文检索。",
                stage="completed",
                active_generation=new_gen,
                building_generation=None,
                finished_at=finished_at,
                duration_ms=_duration_ms(started_at, finished_at),
                last_good_index_at=finished_at,
            )
            return text_count

        try:
            fingerprint = project_fingerprint(project_id)
        except Exception as exc:
            finished_at = datetime.now(timezone.utc).isoformat()
            set_project_index_status(
                project_id, "completed", text_count, None,
                text_status="completed",
                structural_status="failed",
                engine="fts",
                degraded_reason=f"结构索引准备失败，已使用基础全文检索：{str(exc)[:600]}",
                stage="completed",
                active_generation=new_gen,
                finished_at=finished_at,
                duration_ms=_duration_ms(started_at, finished_at),
                last_good_index_at=finished_at,
            )
            return text_count

        old_struct_ok = bool(
            previous.get("structural_status") == "completed"
            and previous.get("indexed_fingerprint") == fingerprint
            and previous.get("structural_project_name")
        )

        if old_struct_ok:
            finished_at = datetime.now(timezone.utc).isoformat()
            set_project_index_status(
                project_id, "completed", text_count, None,
                text_status="completed",
                structural_status="completed",
                node_count=int(previous.get("node_count") or 0),
                edge_count=int(previous.get("edge_count") or 0),
                engine=ENGINE_NAME,
                degraded_reason=None,
                indexed_fingerprint=fingerprint,
                structural_project_name=str(previous.get("structural_project_name")),
                stage="completed",
                active_generation=new_gen,
                building_generation=None,
                finished_at=finished_at,
                duration_ms=_duration_ms(started_at, finished_at),
                last_good_index_at=finished_at,
            )
            return text_count

        set_project_index_status(
            project_id, "building", text_count, None,
            text_status="completed",
            structural_status="building",
            engine=ENGINE_NAME,
            degraded_reason=None,
            stage="building_structural_index",
            active_generation=new_gen,
            building_generation=None,
        )

        try:
            structural = build_structural_index(project_id, fingerprint)
            finished_at = datetime.now(timezone.utc).isoformat()
            set_project_index_status(
                project_id, "completed", text_count, None,
                text_status="completed",
                structural_status="completed",
                node_count=int(structural.get("node_count") or 0),
                edge_count=int(structural.get("edge_count") or 0),
                engine=ENGINE_NAME,
                degraded_reason=None,
                indexed_fingerprint=fingerprint,
                structural_project_name=str(structural.get("structural_project_name") or ""),
                stage="completed",
                active_generation=new_gen,
                building_generation=None,
                finished_at=finished_at,
                duration_ms=_duration_ms(started_at, finished_at),
                last_good_index_at=finished_at,
            )
        except Exception as exc:
            finished_at = datetime.now(timezone.utc).isoformat()
            set_project_index_status(
                project_id, "completed", text_count, None,
                text_status="completed",
                structural_status="failed",
                engine="fts",
                degraded_reason=f"结构索引失败，已使用基础全文检索：{str(exc)[:600]}",
                stage="completed",
                active_generation=new_gen,
                finished_at=finished_at,
                duration_ms=_duration_ms(started_at, finished_at),
            )

        return text_count

    except Exception as exc:
        # Build failed; keep old active generation intact
        if new_gen > 0:
            try:
                clean_generation(project_id, new_gen)
            except Exception:
                pass
        finished_at = datetime.now(timezone.utc).isoformat()
        set_project_index_status(
            project_id, "failed", text_count, str(exc)[:2000],
            text_status="failed",
            structural_status=str(previous.get("structural_status") or "not_built"),
            stage="failed",
            building_generation=None,
            active_generation=old_active_gen,
            finished_at=finished_at,
            duration_ms=_duration_ms(started_at, finished_at),
            error_message=str(exc)[:2000],
        )
        raise
    finally:
        _BUILDING_LOCKS.discard(project_id)


def _duration_ms(started_at: str, finished_at: str) -> int:
    try:
        start = datetime.fromisoformat(started_at)
        end = datetime.fromisoformat(finished_at)
        return max(0, int((end - start).total_seconds() * 1000))
    except (ValueError, TypeError):
        return 0


def get_active_generation_chunk_count(project_id: int) -> int:
    gen = get_active_generation(project_id)
    if gen == 0:
        return 0
    conn = sqlite3.connect(str(DB_PATH), timeout=15)
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM code_chunks WHERE project_id = ? AND generation = ?",
            (project_id, gen),
        ).fetchone()
        return int(row[0]) if row else 0
    finally:
        conn.close()


def index_status(project_id: int) -> dict[str, object]:
    return get_project_index_status(project_id)


def search_project(project_id: int, query: str, source_path: Optional[str] = None, limit: int = 8) -> list[ProjectSearchResult]:
    sources = hybrid_retrieve(project_id, query, source_path=source_path, limit=limit)
    return [
        ProjectSearchResult(
            path=source.path,
            language=infer_language(Path(source.path)),
            start_line=source.start_line,
            end_line=source.end_line,
            chunk_type=source.evidence_type,
            symbol_name=source.symbol_name,
            qualified_name=source.qualified_name,
            relation=source.relation,
            provider=source.provider,
            content=source.content,
            score=source.score,
        )
        for source in sources
    ]
