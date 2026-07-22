from __future__ import annotations

import hashlib
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.core.config import IGNORED_DIRS, MAX_TEXT_BYTES
from app.models.schemas import ProjectSearchResult
from app.services.generation_service import extract_file_signals
from app.services.scanner import infer_language
from app.services.ast_chunker import chunk_file as ast_chunk_file
from app.services.code_intelligence import (
    ENGINE_NAME,
    StructuralEngineError,
    build_structural_index,
    hybrid_retrieve,
    project_fingerprint,
    structural_available,
)
import sqlite3

from app.core.config import CHUNK_ALGORITHM_VERSION, DB_PATH, IGNORE_RULES_VERSION, INDEX_SCHEMA_VERSION, PARSER_GRAMMAR_VERSION, STRUCTURAL_ENGINE_VERSION, STRUCTURAL_INDEX_SCHEMA_VERSION
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
    mark_indexed_files_stale,
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

    # Try AST chunker first
    try:
        specs = ast_chunk_file(rel, content, language)
        if specs:
            chunks: list[dict[str, object]] = []
            for spec in specs:
                d = spec.to_dict()
                d["project_id"] = project_id
                d["content_hash"] = hashlib.sha256(d.get("content", "").encode("utf-8")).hexdigest()
                chunks.append(d)
            return chunks
    except Exception:
        pass  # fall through to legacy

    # Fallback: legacy line-based chunking with token limits
    return _chunk_file_legacy(rel, content, language, project_id)


def _chunk_file_legacy(rel: str, content: str, language: str, project_id: int) -> list[dict[str, object]]:
    """Legacy fallback when AST chunker is unavailable."""
    lines = content.splitlines()
    imports, symbols = extract_file_signals(content)
    chunks: list[dict[str, object]] = []

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
        chunks.append({
            "project_id": project_id, "path": rel, "language": language,
            "start_line": start_line, "end_line": end,
            "chunk_type": "line_fallback",
            "symbol_name": _symbol_for_line(lines, start_line),
            "qualified_name": None, "parent_symbol": None, "symbol_kind": None,
            "signature": None, "docstring": None,
            "content": chunk_text,
            "content_hash": hashlib.sha256(chunk_text.encode("utf-8")).hexdigest(),
            "token_count": len(body) // 3, "start_byte": 0, "end_byte": 0,
            "fragment_index": 0, "fragment_count": 0,
            "parse_status": "fallback", "parser": "line-based",
            "match_fields": None, "chunk_version": CHUNK_ALGORITHM_VERSION,
        })
        if end >= len(lines):
            break
    return chunks


_BUILDING_LOCKS: set[int] = set()
_BUILDING_LOCK_MUTEX = threading.Lock()


def build_project_index(project_id: int, *, force_verify: bool = False) -> int:
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

    # Concurrency guard — thread-safe
    with _BUILDING_LOCK_MUTEX:
        if project_id in _BUILDING_LOCKS:
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
        scan_errors: list[str] = []
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
            except OSError as exc:
                scan_errors.append(f"{str(path.relative_to(root).as_posix())}: {exc}")
                continue

        total_files = len(disk_files)
        scan_complete = len(scan_errors) == 0

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
                # If previous build failed for this file, always retry
                if bool(existing.get("is_stale")):
                    disk_info["content_hash"] = None  # force hash computation below
                    modified_files.append(disk_info)
                    skipped += 1
                    continue
                size_match = int(disk_info["file_size"]) == int(existing["file_size"])
                mtime_match = int(disk_info["mtime_ns"]) == int(existing["mtime_ns"])
                # force_verify: compute SHA-256 regardless of size/mtime match
                if force_verify:
                    fp = root / rel_path
                    try:
                        content = fp.read_text(encoding="utf-8")
                        disk_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
                    except (UnicodeDecodeError, OSError):
                        skipped += 1
                        continue
                    if existing.get("content_hash") == disk_hash:
                        unchanged_paths.add(rel_path)
                    else:
                        disk_info["content_hash"] = disk_hash
                        modified_files.append(disk_info)
                    continue
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

        # Only detect deletions when scan was complete — otherwise treat missing
        # files as scan errors, not deletions.
        stale_paths: set[str] = set()
        if scan_complete:
            stale_paths = set(existing_map.keys()) - set(disk_files.keys())
        else:
            # Treat all existing files not scanned as unchanged to prevent data loss
            missing_from_scan = set(existing_map.keys()) - set(disk_files.keys())
            unchanged_paths |= missing_from_scan
        unchanged_count = len(unchanged_paths)
        added_count = len(new_files)
        modified_count = len(modified_files)
        deleted_count = len(stale_paths)
        to_process = added_count + modified_count

        # --- Stage: building_text_index ---
        scan_note = None
        if not scan_complete:
            scan_note = f"扫描不完整（{len(scan_errors)} 个错误），未扫描到的文件保留旧索引。"
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
            degraded_reason=scan_note,
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
        failed_chunk_paths: list[str] = []  # paths whose chunking failed
        processed = 0

        # Process new files
        for info in new_files:
            try:
                fp = root / str(info["relative_path"])
                chunks = _chunk_file(project_id, root, fp)
                all_chunks.extend(chunks)
            except Exception as exc:
                failed_count += 1
                failed_chunk_paths.append(str(info["relative_path"]))
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
                failed_chunk_paths.append(str(info["relative_path"]))
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
            # Copy unchanged files from old generation
            if unchanged_paths and old_active_gen > 0:
                copy_unchanged_chunks(project_id, old_active_gen, new_gen, unchanged_paths)
            # Copy failed-file chunks from old generation to prevent data loss
            if failed_chunk_paths and old_active_gen > 0:
                copy_unchanged_chunks(project_id, old_active_gen, new_gen, set(failed_chunk_paths))

        # Delete stale file chunks (paths no longer on disk)
        if stale_paths:
            delete_stale_indexed_files(project_id, stale_paths)

        # Upsert indexed_files for successfully processed files only.
        # Failed files keep their old metadata and are marked stale for retry.
        failed_set = set(failed_chunk_paths)
        success_records = [r for r in new_files + modified_files if str(r["relative_path"]) not in failed_set]
        if success_records:
            for rec in success_records:
                if "content_hash" not in rec:
                    try:
                        fp = root / str(rec["relative_path"])
                        content = fp.read_text(encoding="utf-8")
                        rec["content_hash"] = hashlib.sha256(content.encode("utf-8")).hexdigest()
                    except (UnicodeDecodeError, OSError):
                        rec["content_hash"] = None
                rec["chunk_version"] = CHUNK_ALGORITHM_VERSION
            upsert_indexed_files_batch(project_id, success_records)
        # Mark failed files as stale so next build retries them
        if failed_chunk_paths:
            mark_indexed_files_stale(
                project_id, failed_chunk_paths,
                "; ".join(failed_details[:5]) if failed_details else "chunk generation failed",
            )

        # --- Stage: switching_generation ---
        # Atomically switch generation AND finalize text_index state.
        # Status stays "building" because structural index is not yet done.
        now_iso = datetime.now(timezone.utc).isoformat()
        # Count chunks in the new generation directly (active hasn't switched yet)
        text_count = _count_chunks_in_generation(project_id, new_gen)
        activate_generation(
            project_id, new_gen,
            status="building",
            text_status="completed",
            stage="building_structural_index",
            last_good_index_at=now_iso,
            chunk_count=text_count,
        )

        # --- Stage: cleaning_old_generation ---
        if old_active_gen > 0 and old_active_gen != new_gen:
            clean_generation(project_id, old_active_gen)

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

        # Reuse structural index only if ALL version dimensions match
        struct_versions_changed = (
            int(previous.get("structural_engine_version") or 0) != STRUCTURAL_ENGINE_VERSION
            or int(previous.get("index_schema_version") or 0) != INDEX_SCHEMA_VERSION
            or int(previous.get("structural_index_schema_version") or 0) != STRUCTURAL_INDEX_SCHEMA_VERSION
            or int(previous.get("parser_grammar_version") or 0) != PARSER_GRAMMAR_VERSION
            or int(previous.get("ignore_rules_version") or 0) != IGNORE_RULES_VERSION
        )
        old_struct_ok = bool(
            previous.get("structural_status") == "completed"
            and previous.get("indexed_fingerprint") == fingerprint
            and previous.get("structural_project_name")
            and not struct_versions_changed
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
                structural_engine_version=STRUCTURAL_ENGINE_VERSION,
                ignore_rules_version=IGNORE_RULES_VERSION,
                structural_index_schema_version=STRUCTURAL_INDEX_SCHEMA_VERSION,
                parser_grammar_version=PARSER_GRAMMAR_VERSION,
                index_schema_version=INDEX_SCHEMA_VERSION,
                stage="completed",
                active_generation=new_gen,
                building_generation=None,
                finished_at=finished_at,
                duration_ms=_duration_ms(started_at, finished_at),
                last_good_index_at=finished_at,
            )
            return text_count

        # Structural must rebuild; status was set to "building" by activate_generation
        # Update structural_status to "building" so frontend can show progress
        set_project_index_status(
            project_id, "building", text_count, None,
            text_status="completed",
            structural_status="building",
            engine=ENGINE_NAME,
            degraded_reason=None,
            stage="building_structural_index",
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
                structural_engine_version=STRUCTURAL_ENGINE_VERSION,
                ignore_rules_version=IGNORE_RULES_VERSION,
                structural_index_schema_version=STRUCTURAL_INDEX_SCHEMA_VERSION,
                parser_grammar_version=PARSER_GRAMMAR_VERSION,
                index_schema_version=INDEX_SCHEMA_VERSION,
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
        with _BUILDING_LOCK_MUTEX:
            _BUILDING_LOCKS.discard(project_id)


def _duration_ms(started_at: str, finished_at: str) -> int:
    try:
        start = datetime.fromisoformat(started_at)
        end = datetime.fromisoformat(finished_at)
        return max(0, int((end - start).total_seconds() * 1000))
    except (ValueError, TypeError):
        return 0


def _count_chunks_in_generation(project_id: int, generation: int) -> int:
    if generation <= 0:
        return 0
    conn = sqlite3.connect(str(DB_PATH), timeout=15)
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM code_chunks WHERE project_id = ? AND generation = ?",
            (project_id, generation),
        ).fetchone()
        return int(row[0]) if row else 0
    finally:
        conn.close()


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
