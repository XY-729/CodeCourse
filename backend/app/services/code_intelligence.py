from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable, Optional, Protocol

from app.core.config import (
    CODE_INTELLIGENCE_BINARY,
    CODE_INTELLIGENCE_CACHE_ROOT,
    CODE_INTELLIGENCE_SNAPSHOTS_ROOT,
    IGNORED_DIRS,
    REPOS_ROOT,
)
from app.services.storage import get_project, get_project_index_status, search_code_chunks


MAX_CLI_OUTPUT = 8 * 1024 * 1024
MAX_SNAPSHOT_FILE_BYTES = 16 * 1024 * 1024
QUERY_TIMEOUT_SECONDS = 20
INDEX_TIMEOUT_SECONDS = 60 * 30
ENGINE_NAME = "codebase-memory-mcp"


@dataclass
class RetrievalSource:
    path: str
    start_line: int = 1
    end_line: int = 1
    symbol_name: Optional[str] = None
    qualified_name: Optional[str] = None
    relation: Optional[str] = None
    evidence_type: str = "text"
    provider: str = "fts"
    content: str = ""
    score: float = 0.0

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


class StructuralEngineError(RuntimeError):
    pass


def _binary_candidates() -> list[Path]:
    candidates: list[Path] = []
    if CODE_INTELLIGENCE_BINARY:
        candidates.append(Path(CODE_INTELLIGENCE_BINARY))
    discovered = shutil.which("codebase-memory-mcp")
    if discovered:
        candidates.append(Path(discovered))
    project_root = Path(__file__).resolve().parents[3]
    candidates.extend(
        [
            project_root / "resources" / "code-intelligence" / "codebase-memory-mcp.exe",
            project_root / "resources" / "code-intelligence" / "codebase-memory-mcp",
        ]
    )
    return candidates


def structural_binary() -> Optional[Path]:
    for candidate in _binary_candidates():
        try:
            resolved = candidate.expanduser().resolve()
        except OSError:
            continue
        if resolved.is_file():
            return resolved
    return None


def structural_available() -> bool:
    return structural_binary() is not None


def _snapshot_dir(project_id: int) -> Path:
    return CODE_INTELLIGENCE_SNAPSHOTS_ROOT / str(project_id)


def remove_structural_project_data(project_id: int) -> None:
    status = get_project_index_status(project_id)
    project_name = str(status.get("structural_project_name") or "").strip()
    if project_name and structural_available():
        try:
            _run_tool("delete_project", {"project": project_name})
        except StructuralEngineError:
            pass
    snapshot = _snapshot_dir(project_id)
    if snapshot.exists():
        shutil.rmtree(snapshot, ignore_errors=True)
    project_cache = CODE_INTELLIGENCE_CACHE_ROOT / "projects" / str(project_id)
    if project_cache.exists():
        shutil.rmtree(project_cache, ignore_errors=True)


def _is_ignored(relative: Path) -> bool:
    ignored = set(IGNORED_DIRS) | {".generated_course", ".codebase-memory"}
    return any(part in ignored for part in relative.parts)


def _source_files(root: Path) -> Iterable[tuple[Path, Path]]:
    for source in root.rglob("*"):
        try:
            relative = source.relative_to(root)
            if _is_ignored(relative) or source.is_symlink() or not source.is_file():
                continue
            if source.stat().st_size > MAX_SNAPSHOT_FILE_BYTES:
                continue
        except (OSError, ValueError):
            continue
        yield source, relative


def project_fingerprint(project_id: int) -> str:
    project = get_project(project_id)
    if project is None:
        raise StructuralEngineError("Project not found")
    root = Path(project.local_path).resolve()
    digest = hashlib.sha256()
    for source, relative in sorted(_source_files(root), key=lambda item: item[1].as_posix()):
        stat = source.stat()
        digest.update(relative.as_posix().encode("utf-8", errors="replace"))
        digest.update(str(stat.st_size).encode("ascii"))
        digest.update(str(stat.st_mtime_ns).encode("ascii"))
    return digest.hexdigest()


def sync_analysis_snapshot(project_id: int) -> Path:
    project = get_project(project_id)
    if project is None:
        raise StructuralEngineError("Project not found")
    source_root = Path(project.local_path).resolve()
    if not source_root.exists() or REPOS_ROOT.resolve() not in source_root.parents:
        raise StructuralEngineError("Project path is outside the CodeCourse repository workspace")

    snapshot = _snapshot_dir(project_id)
    snapshot.mkdir(parents=True, exist_ok=True)
    expected: set[str] = set()
    for source, relative in _source_files(source_root):
        relative_key = relative.as_posix()
        expected.add(relative_key)
        target = snapshot / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            source_stat = source.stat()
            target_stat = target.stat() if target.exists() else None
            unchanged = bool(
                target_stat
                and source_stat.st_size == target_stat.st_size
                and source_stat.st_mtime_ns == target_stat.st_mtime_ns
            )
        except OSError:
            unchanged = False
        if not unchanged:
            shutil.copy2(source, target)

    for target in sorted(snapshot.rglob("*"), reverse=True):
        try:
            relative = target.relative_to(snapshot)
        except ValueError:
            continue
        if target.is_file() and relative.as_posix() not in expected:
            target.unlink(missing_ok=True)
        elif target.is_dir() and target != snapshot:
            try:
                target.rmdir()
            except OSError:
                pass
    return snapshot


def _engine_env(snapshot_root: Optional[Path] = None) -> dict[str, str]:
    CODE_INTELLIGENCE_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    CODE_INTELLIGENCE_SNAPSHOTS_ROOT.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.update(
        {
            "CBM_CACHE_DIR": str(CODE_INTELLIGENCE_CACHE_ROOT),
            "CBM_ALLOWED_ROOT": str((snapshot_root or CODE_INTELLIGENCE_SNAPSHOTS_ROOT).resolve()),
            "CBM_LOG_LEVEL": "error",
            "CBM_DIAGNOSTICS": "false",
        }
    )
    return env


def _extract_json(stdout: str) -> Any:
    text = stdout.strip()
    if not text:
        raise StructuralEngineError("Structural engine returned no output")
    for start_char, end_char in (("{", "}"), ("[", "]")):
        start = text.find(start_char)
        end = text.rfind(end_char)
        if start >= 0 and end >= start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise StructuralEngineError("Structural engine returned invalid JSON")


def _run_tool(tool: str, payload: Optional[dict[str, object]] = None, *, timeout: int = QUERY_TIMEOUT_SECONDS) -> Any:
    binary = structural_binary()
    if binary is None:
        raise StructuralEngineError("Structural engine binary is not available")
    arguments = [str(binary), "cli", tool]
    for key, value in (payload or {}).items():
        if value is None:
            continue
        flag = "--" + key.replace("_", "-")
        if isinstance(value, bool):
            encoded = "true" if value else "false"
        elif isinstance(value, (list, dict)):
            encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        else:
            encoded = str(value)
        arguments.extend([flag, encoded])
    try:
        completed = subprocess.run(
            arguments,
            cwd=str(CODE_INTELLIGENCE_SNAPSHOTS_ROOT),
            env=_engine_env(),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            shell=False,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except subprocess.TimeoutExpired as exc:
        raise StructuralEngineError(f"Structural engine timed out while running {tool}") from exc
    except OSError as exc:
        raise StructuralEngineError(f"Unable to start structural engine: {exc}") from exc
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()[:1200]
        raise StructuralEngineError(f"Structural engine {tool} failed: {detail or completed.returncode}")
    if len(completed.stdout.encode("utf-8", errors="replace")) > MAX_CLI_OUTPUT:
        raise StructuralEngineError("Structural engine output exceeded the safety limit")
    return _extract_json(completed.stdout)


def _walk_dicts(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_dicts(child)


def _first_value(value: Any, names: tuple[str, ...]) -> Any:
    for item in _walk_dicts(value):
        for name in names:
            candidate = item.get(name)
            if candidate not in (None, "", []):
                return candidate
    return None


def _int_value(value: Any, names: tuple[str, ...]) -> int:
    candidate = _first_value(value, names)
    try:
        return int(candidate)
    except (TypeError, ValueError):
        return 0


def _resolve_engine_project_name(index_result: Any, snapshot: Path) -> str:
    candidate = _first_value(index_result, ("project", "project_name", "name"))
    if isinstance(candidate, str) and candidate.strip():
        return candidate.strip()
    try:
        projects = _run_tool("list_projects")
    except StructuralEngineError:
        return snapshot.name
    snapshot_resolved = str(snapshot.resolve()).lower()
    for item in _walk_dicts(projects):
        root = item.get("repo_path") or item.get("root") or item.get("path")
        name = item.get("name") or item.get("project")
        if isinstance(root, str) and isinstance(name, str):
            try:
                if str(Path(root).resolve()).lower() == snapshot_resolved:
                    return name
            except OSError:
                continue
    return snapshot.name


def build_structural_index(project_id: int, fingerprint: str) -> dict[str, object]:
    snapshot = sync_analysis_snapshot(project_id)
    project_name = f"codecourse-{project_id}"
    result = _run_tool(
        "index_repository",
        {
            "repo_path": str(snapshot),
            "name": project_name,
            "mode": "full",
            "persistence": False,
        },
        timeout=INDEX_TIMEOUT_SECONDS,
    )
    return {
        "structural_project_name": _resolve_engine_project_name(result, snapshot) or project_name,
        "node_count": _int_value(result, ("node_count", "nodes", "total_nodes")),
        "edge_count": _int_value(result, ("edge_count", "edges", "total_edges")),
        "indexed_fingerprint": fingerprint,
        "engine": ENGINE_NAME,
    }


def _safe_relative_path(project_id: int, value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        return ""
    text = value.replace("\\", "/").strip()
    path = Path(value)
    if path.is_absolute():
        for root in (_snapshot_dir(project_id), Path(get_project(project_id).local_path) if get_project(project_id) else None):
            if root is None:
                continue
            try:
                return path.resolve().relative_to(root.resolve()).as_posix()
            except (OSError, ValueError):
                continue
        return ""
    while text.startswith("./"):
        text = text[2:]
    if text.startswith("../") or "/../" in text:
        return ""
    return text


def _source_from_item(project_id: int, item: dict[str, Any], provider: str, evidence_type: str) -> Optional[RetrievalSource]:
    path = _safe_relative_path(
        project_id,
        item.get("file_path") or item.get("path") or item.get("file") or item.get("relative_path"),
    )
    if not path:
        return None
    start = item.get("start_line") or item.get("line") or item.get("line_number") or 1
    end = item.get("end_line") or item.get("line_end") or start
    try:
        start_line = max(1, int(start))
        end_line = max(start_line, int(end))
    except (TypeError, ValueError):
        start_line = end_line = 1
    symbol = item.get("symbol_name") or item.get("name") or item.get("symbol")
    qualified = item.get("qualified_name") or item.get("fqn") or item.get("qualifiedName")
    relation = item.get("relation") or item.get("relationship") or item.get("edge_type") or item.get("type")
    content = (
        item.get("snippet")
        or item.get("code")
        or item.get("content")
        or item.get("text")
        or item.get("signature")
        or item.get("docstring")
        or ""
    )
    score = item.get("score") or item.get("similarity") or item.get("rank") or 0
    try:
        score_value = float(score)
    except (TypeError, ValueError):
        score_value = 0.0
    return RetrievalSource(
        path=path,
        start_line=start_line,
        end_line=end_line,
        symbol_name=str(symbol) if symbol else None,
        qualified_name=str(qualified) if qualified else None,
        relation=str(relation) if relation else None,
        evidence_type=evidence_type,
        provider=provider,
        content=str(content)[:4000],
        score=80.0 + max(0.0, score_value),
    )


def _sources_from_result(project_id: int, result: Any, evidence_type: str) -> list[RetrievalSource]:
    sources: list[RetrievalSource] = []
    seen: set[tuple[str, int, str, str]] = set()
    for item in _walk_dicts(result):
        source = _source_from_item(project_id, item, ENGINE_NAME, evidence_type)
        if source is None:
            continue
        key = (source.path, source.start_line, source.symbol_name or "", source.relation or "")
        if key in seen:
            continue
        seen.add(key)
        sources.append(source)
    return sources


def _resolved_trace_sources(
    project_id: int,
    project_name: str,
    trace: Any,
    limit: int,
) -> list[RetrievalSource]:
    if not isinstance(trace, dict):
        return []
    relations: dict[str, str] = {}
    qualified_names: list[str] = []
    for direction in ("callers", "callees"):
        items = trace.get(direction)
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            qualified = item.get("qualified_name")
            if not isinstance(qualified, str) or not qualified:
                continue
            try:
                hop = max(1, int(item.get("hop") or 1))
            except (TypeError, ValueError):
                hop = 1
            relations[qualified] = f"{direction[:-1]} hop {hop}"
            qualified_names.append(qualified)
            if len(qualified_names) >= limit:
                break
    if not qualified_names:
        return []
    qn_pattern = "^(?:" + "|".join(re.escape(name) for name in qualified_names) + ")$"
    try:
        resolved = _run_tool(
            "search_graph",
            {
                "project": project_name,
                "qn_pattern": qn_pattern,
                "limit": len(qualified_names),
                "format": "json",
                "fields": ["signature", "docstring", "return_type"],
            },
        )
    except StructuralEngineError:
        return []
    sources = _sources_from_result(project_id, resolved, "call_chain")
    for source in sources:
        if source.qualified_name in relations:
            source.relation = relations[source.qualified_name]
        source.score = max(source.score, 95.0)
    return sources


def _candidate_symbols(question: str, selected_text: str) -> list[str]:
    combined = selected_text if 0 < len(selected_text) <= 500 else question
    tokens = re.findall(r"[A-Za-z_~][A-Za-z0-9_:.$<>~-]{1,100}", combined)
    ignored = {"this", "that", "what", "where", "function", "class", "file", "return", "const", "void"}
    unique: list[str] = []
    for token in sorted(tokens, key=len, reverse=True):
        clean = token.strip(".:<>")
        if clean.lower() in ignored or clean in unique:
            continue
        unique.append(clean)
        if len(unique) >= 3:
            break
    return unique


def structural_retrieve(
    project_id: int,
    query: str,
    *,
    source_path: Optional[str] = None,
    selected_text: str = "",
    limit: int = 8,
) -> list[RetrievalSource]:
    status = get_project_index_status(project_id)
    project_name = str(status.get("structural_project_name") or "").strip()
    if status.get("structural_status") != "completed" or not project_name or not structural_available():
        return []

    results: list[RetrievalSource] = []
    symbols = _candidate_symbols(query, selected_text)
    search_payload: dict[str, object] = {
        "project": project_name,
        "query": query,
        "semantic_query": symbols or _candidate_symbols(query, query),
        "limit": min(limit, 8),
        "format": "json",
        "fields": ["signature", "docstring", "return_type"],
    }
    if source_path:
        normalized_source_path = source_path.replace("\\", "/")
        search_payload["file_pattern"] = f".*{re.escape(normalized_source_path)}.*"
    try:
        semantic = _run_tool("search_graph", search_payload)
        results.extend(_sources_from_result(project_id, semantic, "semantic"))
    except StructuralEngineError:
        pass

    for symbol in symbols[:2]:
        payload: dict[str, object] = {
            "project": project_name,
            "name_pattern": f".*{re.escape(symbol)}.*",
            "limit": 8,
        }
        if source_path:
            normalized_source_path = source_path.replace("\\", "/")
            payload["file_pattern"] = f".*{re.escape(normalized_source_path)}.*"
        payload["format"] = "json"
        try:
            graph_result = _run_tool("search_graph", payload)
            results.extend(_sources_from_result(project_id, graph_result, "symbol"))
        except StructuralEngineError:
            continue
        if any(
            term in query.lower()
            for term in ("调用", "谁调用", "call", "caller", "callee", "影响", "依赖", "引用", "谁用")
        ) or selected_text:
            try:
                trace = _run_tool(
                    "trace_path",
                    {"project": project_name, "function_name": symbol, "direction": "both", "depth": 2},
                )
                results.extend(_resolved_trace_sources(project_id, project_name, trace, limit))
            except StructuralEngineError:
                pass

    if not source_path or any(term in query.lower() for term in ("项目", "架构", "入口", "模块", "architecture")):
        try:
            architecture = _run_tool("get_architecture", {"project": project_name})
            results.extend(_sources_from_result(project_id, architecture, "architecture"))
        except StructuralEngineError:
            pass

    results.sort(
        key=lambda item: (
            0 if source_path and item.path == source_path else 1,
            0 if item.evidence_type == "call_chain" else 1,
            -item.score,
        )
    )
    return results[:limit]


class CodeIntelligenceProvider(Protocol):
    def retrieve(
        self,
        project_id: int,
        query: str,
        *,
        source_path: Optional[str] = None,
        selected_text: str = "",
        limit: int = 8,
    ) -> list[RetrievalSource]: ...


class StructuralGraphProvider:
    def retrieve(
        self,
        project_id: int,
        query: str,
        *,
        source_path: Optional[str] = None,
        selected_text: str = "",
        limit: int = 8,
    ) -> list[RetrievalSource]:
        return structural_retrieve(
            project_id,
            query,
            source_path=source_path,
            selected_text=selected_text,
            limit=limit,
        )


class FtsProvider:
    def retrieve(
        self,
        project_id: int,
        query: str,
        *,
        source_path: Optional[str] = None,
        selected_text: str = "",
        limit: int = 8,
    ) -> list[RetrievalSource]:
        del selected_text
        chunks = search_code_chunks(project_id, query, source_path=source_path, limit=limit)
        return [
            RetrievalSource(
                path=chunk.path,
                start_line=chunk.start_line,
                end_line=chunk.end_line,
                symbol_name=chunk.symbol_name,
                evidence_type=chunk.chunk_type,
                provider="fts",
                content=chunk.content[:4000],
                score=(60.0 if source_path and chunk.path == source_path else 40.0)
                + (2.0 if chunk.symbol_name else 0.0),
            )
            for chunk in chunks
        ]


class HybridProvider:
    def __init__(self, structural: CodeIntelligenceProvider, fallback: CodeIntelligenceProvider):
        self.structural = structural
        self.fallback = fallback

    def retrieve(
        self,
        project_id: int,
        query: str,
        *,
        source_path: Optional[str] = None,
        selected_text: str = "",
        limit: int = 8,
    ) -> list[RetrievalSource]:
        structural = self.structural.retrieve(
            project_id,
            query,
            source_path=source_path,
            selected_text=selected_text,
            limit=limit,
        )
        text_sources = self.fallback.retrieve(
            project_id,
            query,
            source_path=source_path,
            selected_text=selected_text,
            limit=limit,
        )
        combined = structural + text_sources
        combined.sort(key=lambda item: (-item.score, 0 if source_path and item.path == source_path else 1))
        deduped: list[RetrievalSource] = []
        seen: set[tuple[str, int, int, str]] = set()
        for source in combined:
            key = (source.path, source.start_line, source.end_line, source.symbol_name or "")
            if key in seen:
                continue
            seen.add(key)
            deduped.append(source)
            if len(deduped) >= limit:
                break
        return deduped


_HYBRID_PROVIDER = HybridProvider(StructuralGraphProvider(), FtsProvider())


def hybrid_retrieve(
    project_id: int,
    query: str,
    *,
    source_path: Optional[str] = None,
    selected_text: str = "",
    limit: int = 8,
) -> list[RetrievalSource]:
    return _HYBRID_PROVIDER.retrieve(
        project_id,
        query,
        source_path=source_path,
        selected_text=selected_text,
        limit=limit,
    )
