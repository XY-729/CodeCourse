from __future__ import annotations

import io
import json
import shutil
import sqlite3
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

from app.core.config import DB_PATH, GENERATED_ROOT, IGNORED_DIRS, WORKSPACE_ROOT
from app.services.course_generator import list_course_files_from_dir
from app.services.scanner import infer_language, is_key_file


ARCHIVE_FORMAT = "codecourse-data-archive"
ARCHIVE_VERSION = 1
MAX_ARCHIVE_BYTES = 160 * 1024 * 1024
MAX_EXTRACTED_BYTES = 300 * 1024 * 1024
MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024
MAX_FILE_COUNT = 10_000

# Parent tables precede their dependants. Import uses this order and deletion
# uses the reverse order. Rebuildable indexes and FTS tables are deliberately
# absent: they are platform-specific caches, not user data.
PORTABLE_TABLES = (
    "projects",
    "qa_sessions",
    "prompt_revisions",
    "concepts",
    "qa_records",
    "teaching_handoffs",
    "generation_tasks",
    "highlights",
    "knowledge_nodes",
    "knowledge_edges",
    "knowledge_links",
    "document_terms",
    "learning_anchors",
    "learning_states",
    "concept_mastery",
    "learning_events",
    "learner_preferences",
    "preference_events",
    "term_impressions",
    "concept_relations",
    "learner_inferences",
    "domain_profiles",
    "concept_explanations",
    "survey_candidates",
    "model_call_audit",
    "term_model_scans",
    "learning_evidence_v2",
    "knowledge_states_v2",
    "diagnostic_items",
    "diagnostic_attempts",
    "observer_jobs",
    "teaching_trials",
    "teaching_outcomes",
)

PROJECT_COLUMNS = (
    "id",
    "name",
    "url",
    "status",
    "project_type",
    "created_at",
    "updated_at",
)
SECRET_SETTING_MARKERS = ("api_key", "access_token", "password", "secret")
_transfer_lock = threading.Lock()


class DataTransferError(ValueError):
    pass


class DataTransferBusy(DataTransferError):
    pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
        (table,),
    ).fetchone() is not None


def _table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [str(row[1]) for row in conn.execute(f"PRAGMA table_info({_quote_identifier(table)})")]


def _export_table(conn: sqlite3.Connection, table: str) -> dict[str, Any] | None:
    if not _table_exists(conn, table):
        return None
    available = _table_columns(conn, table)
    columns = [column for column in (PROJECT_COLUMNS if table == "projects" else available) if column in available]
    if not columns:
        return None
    selected = ",".join(_quote_identifier(column) for column in columns)
    rows = conn.execute(f"SELECT {selected} FROM {_quote_identifier(table)}").fetchall()
    return {
        "columns": columns,
        "rows": [[row[column] for column in columns] for row in rows],
    }


def _has_active_generation(conn: sqlite3.Connection) -> bool:
    if not _table_exists(conn, "generation_tasks"):
        return False
    return conn.execute(
        "SELECT 1 FROM generation_tasks WHERE status IN ('queued','running') LIMIT 1"
    ).fetchone() is not None


def _portable_settings(conn: sqlite3.Connection) -> dict[str, str]:
    settings: dict[str, str] = {}
    llm: dict[str, Any] = {
        "provider": "deepseek",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-v4-flash",
        # Credentials never leave the source device. Imported model settings
        # therefore start disabled until the user confirms a local key.
        "enabled": False,
    }
    if not _table_exists(conn, "app_settings"):
        settings["llm.config"] = json.dumps(llm, ensure_ascii=False, separators=(",", ":"))
        return settings
    for row in conn.execute("SELECT key,value FROM app_settings"):
        key, value = str(row[0]), str(row[1])
        lower = key.lower()
        if any(marker in lower for marker in SECRET_SETTING_MARKERS):
            continue
        if key == "llm.provider":
            llm["provider"] = value
        elif key == "llm.base_url":
            llm["base_url"] = value
        elif key == "llm.model":
            llm["model"] = value
        elif key == "llm.enabled":
            continue
        else:
            settings[key] = value
    settings["llm.config"] = json.dumps(llm, ensure_ascii=False, separators=(",", ":"))
    return settings


def _iter_portable_text_files(root: Path) -> Iterable[tuple[str, bytes, str, bool]]:
    if not root.exists() or not root.is_dir():
        return
    resolved_root = root.resolve()
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix().lower()):
        try:
            relative = path.relative_to(root)
        except ValueError:
            continue
        if any(part in IGNORED_DIRS or part == ".generated_course" for part in relative.parts):
            continue
        if path.is_symlink() or not path.is_file():
            continue
        resolved = path.resolve()
        if resolved_root not in resolved.parents:
            continue
        if path.stat().st_size > MAX_TEXT_FILE_BYTES:
            continue
        payload = path.read_bytes()
        if b"\0" in payload:
            continue
        try:
            payload.decode("utf-8")
        except UnicodeDecodeError:
            continue
        yield relative.as_posix(), payload, infer_language(path), is_key_file(path)


def _title_from_markdown(filename: str, payload: bytes) -> str:
    content = payload.decode("utf-8")
    for line in content.splitlines():
        if line.startswith("# ") and line[2:].strip():
            return line[2:].strip()
    return Path(filename).stem


def _safe_archive_path(value: str) -> str:
    if not isinstance(value, str) or not value or "\0" in value or "\\" in value:
        raise DataTransferError("数据包包含无效路径。")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        raise DataTransferError("数据包包含不安全路径。")
    return path.as_posix()


def _validate_table_snapshot(value: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(value, dict):
        raise DataTransferError("数据包数据库结构无效。")
    result: dict[str, dict[str, Any]] = {}
    for table, snapshot in value.items():
        if table not in PORTABLE_TABLES or not isinstance(snapshot, dict):
            continue
        columns, rows = snapshot.get("columns"), snapshot.get("rows")
        if not isinstance(columns, list) or not columns or not all(isinstance(item, str) for item in columns):
            raise DataTransferError(f"数据表 {table} 的列定义无效。")
        if len(set(columns)) != len(columns) or not isinstance(rows, list):
            raise DataTransferError(f"数据表 {table} 的内容无效。")
        for row in rows:
            if not isinstance(row, list) or len(row) != len(columns):
                raise DataTransferError(f"数据表 {table} 存在损坏记录。")
            if any(item is not None and not isinstance(item, (str, int, float)) for item in row):
                raise DataTransferError(f"数据表 {table} 包含不支持的字段。")
        result[table] = {"columns": columns, "rows": rows}
    if "projects" not in result:
        raise DataTransferError("数据包缺少项目数据。")
    return result


def _validate_archive(payload: bytes) -> tuple[zipfile.ZipFile, dict[str, Any], dict[str, Any]]:
    if not payload:
        raise DataTransferError("数据包为空。")
    if len(payload) > MAX_ARCHIVE_BYTES:
        raise DataTransferError("CodeCourse 数据包超过 160 MB。")
    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile as error:
        raise DataTransferError("文件不是有效的 CodeCourse ZIP 数据包。") from error
    infos = archive.infolist()
    if len(infos) > MAX_FILE_COUNT * 2 + 100:
        archive.close()
        raise DataTransferError("数据包条目数量超过安全上限。")
    names = [info.filename for info in infos]
    if len(names) != len(set(names)):
        archive.close()
        raise DataTransferError("数据包包含重复 ZIP 条目。")
    total = 0
    for info in infos:
        _safe_archive_path(info.filename.rstrip("/"))
        if info.flag_bits & 0x1:
            archive.close()
            raise DataTransferError("不支持加密 ZIP 数据包。")
        total += int(info.file_size)
        if total > MAX_EXTRACTED_BYTES:
            archive.close()
            raise DataTransferError("数据包解压后超过 300 MB。")
    try:
        manifest = json.loads(archive.read("manifest.json"))
        database = json.loads(archive.read("database.json"))
    except (KeyError, UnicodeDecodeError, json.JSONDecodeError, zipfile.BadZipFile) as error:
        archive.close()
        raise DataTransferError("数据包缺少有效的清单或数据库快照。") from error
    if not isinstance(manifest, dict) or manifest.get("format") != ARCHIVE_FORMAT:
        archive.close()
        raise DataTransferError("这不是 CodeCourse 数据包。")
    if manifest.get("version") != ARCHIVE_VERSION:
        archive.close()
        raise DataTransferError("数据包版本暂不受支持，请升级 CodeCourse。")
    if manifest.get("secrets_included") is not False:
        archive.close()
        raise DataTransferError("数据包声明包含敏感凭据，已拒绝导入。")
    if manifest.get("source_platform") not in ("desktop", "android"):
        archive.close()
        raise DataTransferError("数据包来源平台无效。")
    if not isinstance(database, dict) or not isinstance(database.get("settings", {}), dict):
        archive.close()
        raise DataTransferError("数据包设置快照无效。")
    database["tables"] = _validate_table_snapshot(database.get("tables"))
    projects = manifest.get("projects")
    if not isinstance(projects, list):
        archive.close()
        raise DataTransferError("数据包项目清单无效。")
    if manifest.get("project_count") != len(projects):
        archive.close()
        raise DataTransferError("数据包项目数量与清单不一致。")
    ids: set[int] = set()
    listed_files: set[str] = {"manifest.json", "database.json"}
    declared_sizes: dict[str, int] = {}
    listed_file_count = 0
    for project in projects:
        if not isinstance(project, dict) or type(project.get("id")) is not int or project["id"] <= 0:
            archive.close()
            raise DataTransferError("数据包包含无效项目。")
        if project.get("project_type") not in ("repository", "learning_plan"):
            archive.close()
            raise DataTransferError("数据包包含无效项目类型。")
        project_id = int(project["id"])
        if project_id in ids:
            archive.close()
            raise DataTransferError("数据包包含重复项目编号。")
        ids.add(project_id)
        for key, folder, path_key in (("source_files", "repo", "path"), ("course_files", "generated", "filename")):
            entries = project.get(key, [])
            if not isinstance(entries, list):
                archive.close()
                raise DataTransferError("数据包文件清单无效。")
            for entry in entries:
                if not isinstance(entry, dict):
                    archive.close()
                    raise DataTransferError("数据包文件记录无效。")
                relative = _safe_archive_path(str(entry.get(path_key, "")))
                archive_path = f"projects/{project_id}/{folder}/{relative}"
                if archive_path in listed_files:
                    archive.close()
                    raise DataTransferError("数据包包含重复文件记录。")
                if type(entry.get("size")) is not int or int(entry["size"]) < 0:
                    archive.close()
                    raise DataTransferError("数据包文件大小无效。")
                listed_files.add(archive_path)
                declared_sizes[archive_path] = int(entry["size"])
                listed_file_count += 1
    if manifest.get("file_count") != listed_file_count:
        archive.close()
        raise DataTransferError("数据包文件数量与清单不一致。")
    project_snapshot = database["tables"]["projects"]
    try:
        id_index = project_snapshot["columns"].index("id")
        raw_snapshot_ids = [row[id_index] for row in project_snapshot["rows"]]
    except (ValueError, TypeError, IndexError) as error:
        archive.close()
        raise DataTransferError("数据包项目表缺少有效编号。") from error
    if (
        any(type(project_id) is not int or project_id <= 0 for project_id in raw_snapshot_ids)
        or len(raw_snapshot_ids) != len(set(raw_snapshot_ids))
    ):
        archive.close()
        raise DataTransferError("数据包项目表包含无效编号。")
    snapshot_ids = set(raw_snapshot_ids)
    if snapshot_ids != ids:
        archive.close()
        raise DataTransferError("数据包清单与项目数据库不一致。")
    actual_files = {info.filename for info in archive.infolist() if not info.is_dir()}
    if len(actual_files) > MAX_FILE_COUNT + 2:
        archive.close()
        raise DataTransferError("数据包文件数量超过 10000 个。")
    if not listed_files.issubset(actual_files):
        archive.close()
        raise DataTransferError("数据包缺少清单中声明的文件。")
    unexpected = [name for name in actual_files if name not in listed_files]
    if unexpected:
        archive.close()
        raise DataTransferError("数据包包含未声明文件，已停止导入。")
    for archive_path, declared_size in declared_sizes.items():
        if archive.getinfo(archive_path).file_size != declared_size:
            archive.close()
            raise DataTransferError("数据包文件大小与清单不一致。")
    return archive, manifest, database


def export_data_archive(
    *,
    db_path: Path | None = None,
    generated_root: Path | None = None,
) -> tuple[bytes, str]:
    db_path = (db_path or DB_PATH).resolve()
    generated_root = (generated_root or GENERATED_ROOT).resolve()
    if not _transfer_lock.acquire(blocking=False):
        raise DataTransferBusy("另一个数据导入或导出操作正在进行。")
    try:
        conn = sqlite3.connect(db_path, timeout=15)
        conn.row_factory = sqlite3.Row
        try:
            if _has_active_generation(conn):
                raise DataTransferBusy("仍有内容正在生成，请完成后再导出数据。")
            tables = {
                table: snapshot
                for table in PORTABLE_TABLES
                if (snapshot := _export_table(conn, table)) is not None
            }
            projects = conn.execute(
                "SELECT id,name,url,local_path,status,project_type,created_at,updated_at FROM projects ORDER BY id"
            ).fetchall()
            settings = _portable_settings(conn)
        finally:
            conn.close()

        manifest_projects: list[dict[str, Any]] = []
        file_count = 0
        uncompressed_bytes = 0
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for project in projects:
                project_id = int(project["id"])
                source_files: list[dict[str, Any]] = []
                for relative, payload, language, key_file in _iter_portable_text_files(Path(project["local_path"])):
                    file_count += 1
                    uncompressed_bytes += len(payload)
                    if file_count > MAX_FILE_COUNT or uncompressed_bytes > MAX_EXTRACTED_BYTES:
                        raise DataTransferError("项目数据超过可迁移上限（10000 个文件或 300 MB）。")
                    archive.writestr(f"projects/{project_id}/repo/{relative}", payload)
                    source_files.append({
                        "path": relative,
                        "size": len(payload),
                        "language": language,
                        "is_key_file": key_file,
                    })

                course_files: list[dict[str, Any]] = []
                course_root = generated_root / str(project_id)
                listed_courses = {item.filename: item for item in list_course_files_from_dir(course_root)}
                for relative, payload, _language, _key_file in _iter_portable_text_files(course_root):
                    file_count += 1
                    uncompressed_bytes += len(payload)
                    if file_count > MAX_FILE_COUNT or uncompressed_bytes > MAX_EXTRACTED_BYTES:
                        raise DataTransferError("项目数据超过可迁移上限（10000 个文件或 300 MB）。")
                    archive.writestr(f"projects/{project_id}/generated/{relative}", payload)
                    course = listed_courses.get(relative)
                    course_files.append({
                        "filename": relative,
                        "size": len(payload),
                        "title": course.title if course else _title_from_markdown(relative, payload),
                        "group": course.group if course else "课程",
                    })

                manifest_projects.append({
                    "id": project_id,
                    "name": str(project["name"]),
                    "project_type": str(project["project_type"]),
                    "source_files": source_files,
                    "course_files": course_files,
                })

            database = {"settings": settings, "tables": tables}
            manifest = {
                "format": ARCHIVE_FORMAT,
                "version": ARCHIVE_VERSION,
                "exported_at": _utc_now(),
                "source_platform": "desktop",
                "secrets_included": False,
                "project_count": len(manifest_projects),
                "file_count": file_count,
                "projects": manifest_projects,
            }
            archive.writestr("database.json", json.dumps(database, ensure_ascii=False, separators=(",", ":")))
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, separators=(",", ":")))

        payload = output.getvalue()
        if len(payload) > MAX_ARCHIVE_BYTES:
            raise DataTransferError("生成的 CodeCourse 数据包超过 160 MB。")
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        return payload, f"CodeCourse-data-{stamp}.zip"
    finally:
        _transfer_lock.release()


def _normal_data_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
    result: list[str] = []
    for name, sql in rows:
        name = str(name)
        create_sql = str(sql or "").upper()
        if "VIRTUAL TABLE" in create_sql or name.startswith("code_chunks_fts") or name.startswith("learning_anchors_fts"):
            continue
        if name == "app_settings":
            continue
        result.append(name)
    return result


def _restore_settings(conn: sqlite3.Connection, settings: dict[str, Any]) -> None:
    if not _table_exists(conn, "app_settings"):
        return
    preserved_secrets = [
        (str(row[0]), str(row[1]))
        for row in conn.execute("SELECT key,value FROM app_settings")
        if any(marker in str(row[0]).lower() for marker in SECRET_SETTING_MARKERS)
    ]
    conn.execute("DELETE FROM app_settings")
    normalized = {
        str(key): str(value)
        for key, value in settings.items()
        if isinstance(value, (str, int, float))
        and not any(marker in str(key).lower() for marker in SECRET_SETTING_MARKERS)
    }
    llm_config = normalized.pop("llm.config", "")
    try:
        parsed = json.loads(llm_config) if llm_config else {}
    except json.JSONDecodeError:
        parsed = {}
    if isinstance(parsed, dict):
        normalized["llm.provider"] = str(parsed.get("provider") or "deepseek")
        normalized["llm.base_url"] = str(parsed.get("base_url") or "https://api.deepseek.com")
        normalized["llm.model"] = str(parsed.get("model") or "deepseek-v4-flash")
    normalized["llm.enabled"] = "false"
    normalized.pop("llm.api_key", None)
    stamp = _utc_now()
    conn.executemany(
        "INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?)",
        [
            (key, value, stamp)
            for key, value in [*normalized.items(), *preserved_secrets]
            if key
        ],
    )


def _insert_snapshot_table(
    conn: sqlite3.Connection,
    table: str,
    snapshot: dict[str, Any],
    portable_projects_root: Path,
) -> None:
    if not _table_exists(conn, table):
        return
    source_columns = [str(item) for item in snapshot["columns"]]
    target_columns = _table_columns(conn, table)
    selected = [column for column in source_columns if column in target_columns]
    if table == "projects":
        for extra in ("local_path", "repo_key"):
            if extra in target_columns and extra not in selected:
                selected.append(extra)
    if not selected:
        return
    source_indexes = {column: index for index, column in enumerate(source_columns)}
    records: list[list[Any]] = []
    for row in snapshot["rows"]:
        row_map = {column: row[index] for column, index in source_indexes.items()}
        if table == "projects":
            project_id = int(row_map["id"])
            row_map["local_path"] = str((portable_projects_root / str(project_id) / "repo").resolve())
            row_map["repo_key"] = f"portable:{project_id}"
        records.append([row_map.get(column) for column in selected])
    if not records:
        return
    columns_sql = ",".join(_quote_identifier(column) for column in selected)
    placeholders = ",".join("?" for _ in selected)
    conn.executemany(
        f"INSERT INTO {_quote_identifier(table)} ({columns_sql}) VALUES ({placeholders})",
        records,
    )


def _replace_directory(staged: Path, target: Path, backup: Path) -> bool:
    target.parent.mkdir(parents=True, exist_ok=True)
    had_target = target.exists()
    if had_target:
        target.replace(backup)
    try:
        staged.replace(target)
    except Exception:
        if had_target and backup.exists():
            backup.replace(target)
        raise
    return had_target


def _restore_directory(target: Path, backup: Path, had_target: bool) -> None:
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)
    if had_target and backup.exists():
        backup.replace(target)


def import_data_archive(
    payload: bytes,
    *,
    db_path: Path | None = None,
    workspace_root: Path | None = None,
    generated_root: Path | None = None,
) -> dict[str, Any]:
    db_path = (db_path or DB_PATH).resolve()
    workspace_root = (workspace_root or WORKSPACE_ROOT).resolve()
    generated_root = (generated_root or GENERATED_ROOT).resolve()
    if not _transfer_lock.acquire(blocking=False):
        raise DataTransferBusy("另一个数据导入或导出操作正在进行。")
    archive: zipfile.ZipFile | None = None
    stage_root: Path | None = None
    try:
        archive, manifest, database = _validate_archive(payload)
        conn = sqlite3.connect(db_path, timeout=15)
        try:
            if _has_active_generation(conn):
                raise DataTransferBusy("仍有内容正在生成，请完成后再导入数据。")
        finally:
            conn.close()

        token = uuid.uuid4().hex
        stage_root = workspace_root / f".data-transfer-stage-{token}"
        staged_projects = stage_root / "portable-projects"
        staged_generated = stage_root / "generated"
        staged_projects.mkdir(parents=True, exist_ok=False)
        staged_generated.mkdir(parents=True, exist_ok=False)

        for project in manifest["projects"]:
            project_id = int(project["id"])
            for entry in project.get("source_files", []):
                relative = _safe_archive_path(str(entry["path"]))
                target = staged_projects / str(project_id) / "repo" / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                try:
                    content = archive.read(f"projects/{project_id}/repo/{relative}")
                except (KeyError, RuntimeError, zipfile.BadZipFile) as error:
                    raise DataTransferError(f"数据包文件已损坏：{relative}") from error
                target.write_bytes(content)
            for entry in project.get("course_files", []):
                relative = _safe_archive_path(str(entry["filename"]))
                target = staged_generated / str(project_id) / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                try:
                    content = archive.read(f"projects/{project_id}/generated/{relative}")
                except (KeyError, RuntimeError, zipfile.BadZipFile) as error:
                    raise DataTransferError(f"数据包文件已损坏：{relative}") from error
                target.write_bytes(content)

        portable_projects_root = workspace_root / "portable-projects"
        projects_backup = workspace_root / f".data-transfer-projects-backup-{token}"
        generated_backup = workspace_root / f".data-transfer-generated-backup-{token}"
        projects_installed = False
        try:
            had_projects = _replace_directory(staged_projects, portable_projects_root, projects_backup)
            projects_installed = True
            had_generated = _replace_directory(staged_generated, generated_root, generated_backup)
        except Exception:
            if projects_installed:
                _restore_directory(portable_projects_root, projects_backup, had_projects)
            raise

        try:
            conn = sqlite3.connect(db_path, timeout=15)
            conn.execute("PRAGMA foreign_keys=OFF")
            try:
                conn.execute("BEGIN IMMEDIATE")
                for table in _normal_data_tables(conn):
                    conn.execute(f"DELETE FROM {_quote_identifier(table)}")
                for virtual in ("code_chunks_fts", "learning_anchors_fts"):
                    if _table_exists(conn, virtual):
                        conn.execute(f"DELETE FROM {_quote_identifier(virtual)}")
                _restore_settings(conn, database.get("settings", {}))
                snapshots = database["tables"]
                for table in PORTABLE_TABLES:
                    snapshot = snapshots.get(table)
                    if snapshot:
                        _insert_snapshot_table(conn, table, snapshot, portable_projects_root)
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.execute("PRAGMA foreign_keys=ON")
                conn.close()
        except Exception:
            _restore_directory(portable_projects_root, projects_backup, had_projects)
            _restore_directory(generated_root, generated_backup, had_generated)
            raise
        else:
            shutil.rmtree(projects_backup, ignore_errors=True)
            shutil.rmtree(generated_backup, ignore_errors=True)

        project_count = len(manifest["projects"])
        return {
            "imported": True,
            "project_count": project_count,
            "file_count": int(manifest.get("file_count") or 0),
            "message": f"已恢复 {project_count} 个项目，CodeCourse 将重新加载。",
        }
    finally:
        if archive is not None:
            archive.close()
        if stage_root is not None:
            shutil.rmtree(stage_root, ignore_errors=True)
        _transfer_lock.release()
