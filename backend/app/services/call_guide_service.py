from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Iterable, Optional

from app.models.schemas import CallGuideCandidate
from app.services.code_intelligence import (
    ENGINE_NAME,
    StructuralEngineError,
    _run_tool,
    _safe_relative_path,
    structural_available,
)
from app.services.scanner import read_text_file
from app.services.storage import (
    create_call_guide,
    delete_call_guide,
    get_call_guide,
    get_project,
    get_project_index_status,
    list_call_guides,
    list_code_chunks,
    update_call_guide,
)

MAX_DIRECT = 5
MAX_SECONDARY_PER_NODE = 2
MAX_NODES = 31


class CallGuideError(RuntimeError):
    pass


def _walk_dicts(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_dicts(child)


def _index_context(project_id: int) -> tuple[dict[str, object], str]:
    project = get_project(project_id)
    if project is None:
        raise CallGuideError("项目不存在")
    if project.project_type != "repository":
        raise CallGuideError("学习计划不支持调用链导览")
    status = get_project_index_status(project_id)
    structural_status = str(status.get("structural_status") or "not_built")
    project_name = str(status.get("structural_project_name") or "").strip()
    if structural_status != "completed":
        if structural_status == "building":
            raise CallGuideError("结构索引正在分析调用关系，请稍后再试")
        raise CallGuideError("结构索引不可用，请先构建索引")
    if not project_name or not structural_available():
        raise CallGuideError("当前桌面包未提供结构分析引擎")
    return status, project_name


def _candidate_from_item(project_id: int, item: dict[str, Any]) -> Optional[dict[str, object]]:
    path = _safe_relative_path(
        project_id,
        item.get("file_path") or item.get("path") or item.get("file") or item.get("relative_path"),
    )
    name = item.get("symbol_name") or item.get("name") or item.get("symbol")
    qualified = item.get("qualified_name") or item.get("fqn") or item.get("qualifiedName")
    if not path or not isinstance(name, str) or not name.strip():
        return None
    try:
        start = max(1, int(item.get("start_line") or item.get("line") or item.get("line_number") or 1))
        end = max(start, int(item.get("end_line") or item.get("line_end") or start))
    except (TypeError, ValueError):
        start = end = 1
    signature = item.get("signature")
    return {
        "symbol_name": name.strip(),
        "qualified_name": str(qualified).strip() if qualified else None,
        "path": path,
        "start_line": start,
        "end_line": end,
        "signature": str(signature).strip()[:1000] if signature else None,
    }


def _dedupe_candidates(candidates: Iterable[dict[str, object]], limit: int = 8) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    seen: set[tuple[str, str, int]] = set()
    for candidate in candidates:
        key = (
            str(candidate.get("qualified_name") or candidate.get("symbol_name") or ""),
            str(candidate.get("path") or ""),
            int(candidate.get("start_line") or 1),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(candidate)
        if len(result) >= limit:
            break
    return result


def _selected_symbol_tokens(selected_text: str) -> list[str]:
    tokens = re.findall(r"[A-Za-z_~][A-Za-z0-9_:.$<>~-]{1,100}", selected_text)
    ignored = {"const", "class", "def", "function", "return", "void", "public", "private", "async"}
    result: list[str] = []
    for token in tokens:
        clean = token.strip(".:<>")
        if clean.lower() in ignored or clean in result:
            continue
        result.append(clean)
    return result[:8]


def resolve_call_guide_candidates(
    project_id: int,
    *,
    source_path: Optional[str] = None,
    line: Optional[int] = None,
    selected_text: str = "",
    symbol_name: Optional[str] = None,
    qualified_name: Optional[str] = None,
) -> dict[str, object]:
    status, project_name = _index_context(project_id)
    queries = [item for item in [symbol_name, *_selected_symbol_tokens(selected_text)] if item]
    local_candidates: list[dict[str, object]] = []
    if source_path and line:
        chunks = list_code_chunks(project_id, source_path, limit=500)
        containing = [
            chunk for chunk in chunks
            if chunk.symbol_name and chunk.start_line <= line <= chunk.end_line
        ]
        containing.sort(key=lambda chunk: (chunk.end_line - chunk.start_line, -chunk.start_line))
        for chunk in containing[:3]:
            local_candidates.append({
                "symbol_name": chunk.symbol_name,
                "qualified_name": chunk.qualified_name,
                "path": chunk.path,
                "start_line": chunk.start_line,
                "end_line": chunk.end_line,
                "signature": chunk.signature,
            })
            if chunk.qualified_name:
                qualified_name = qualified_name or chunk.qualified_name
            queries.insert(0, chunk.symbol_name)

    payload: dict[str, object] = {
        "project": project_name,
        "limit": 8,
        "format": "json",
        "fields": ["signature", "docstring", "return_type"],
    }
    if qualified_name:
        payload["qn_pattern"] = f"^{re.escape(qualified_name)}$"
    elif queries:
        payload["name_pattern"] = f".*{re.escape(queries[0])}.*"
    else:
        return {
            "candidates": _dedupe_candidates(local_candidates),
            "structural_status": str(status.get("structural_status") or "completed"),
            "reason": "请选择函数名或将光标放在函数内部",
        }
    if source_path:
        payload["file_pattern"] = f".*{re.escape(source_path.replace(chr(92), '/'))}.*"
    try:
        raw = _run_tool("search_graph", payload)
    except StructuralEngineError as exc:
        raise CallGuideError(f"无法解析调用链起点：{exc}") from exc
    engine_candidates = [
        candidate
        for item in _walk_dicts(raw)
        if (candidate := _candidate_from_item(project_id, item)) is not None
    ]
    candidates = _dedupe_candidates([*engine_candidates, *local_candidates])
    return {
        "candidates": candidates,
        "structural_status": str(status.get("structural_status") or "completed"),
        "reason": None if candidates else "结构索引中没有找到匹配的函数或方法",
    }


def _trace_entries(trace: Any, direction: str, limit: int) -> list[dict[str, object]]:
    if not isinstance(trace, dict):
        return []
    items = trace.get(direction)
    if not isinstance(items, list):
        return []
    result: list[dict[str, object]] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        qualified = item.get("qualified_name") or item.get("fqn")
        name = item.get("name") or item.get("symbol_name") or item.get("symbol")
        key = str(qualified or name or "").strip()
        if not key or key in seen:
            continue
        try:
            hop = max(1, int(item.get("hop") or 1))
        except (TypeError, ValueError):
            hop = 1
        if hop != 1:
            continue
        seen.add(key)
        result.append({"qualified_name": str(qualified).strip() if qualified else None, "symbol_name": str(name or key), "hop": 1})
        if len(result) >= limit:
            break
    return result


def _resolve_details(
    project_id: int,
    project_name: str,
    refs: Iterable[dict[str, object]],
) -> dict[str, dict[str, object]]:
    refs_list = list(refs)
    qualified = [str(item["qualified_name"]) for item in refs_list if item.get("qualified_name")]
    names = [
        str(item["symbol_name"])
        for item in refs_list
        if not item.get("qualified_name") and item.get("symbol_name")
    ]
    raw_results: list[Any] = []
    if qualified:
        pattern = "^(?:" + "|".join(re.escape(item) for item in qualified) + ")$"
        raw_results.append(_run_tool("search_graph", {
            "project": project_name,
            "qn_pattern": pattern,
            "limit": min(len(qualified), MAX_NODES),
            "format": "json",
            "fields": ["signature", "docstring", "return_type"],
        }))
    if names:
        # Some structural engines omit qualified names from trace results. Resolve only
        # the exact names returned by that trace; ambiguous matches remain unresolved.
        pattern = "^(?:" + "|".join(re.escape(item) for item in dict.fromkeys(names)) + ")$"
        raw_results.append(_run_tool("search_graph", {
            "project": project_name,
            "name_pattern": pattern,
            "limit": min(max(len(names) * 3, len(names)), MAX_NODES),
            "format": "json",
            "fields": ["signature", "docstring", "return_type"],
        }))
    candidates_by_name: dict[str, list[dict[str, object]]] = {}
    details: dict[str, dict[str, object]] = {}
    for raw in raw_results:
        for item in _walk_dicts(raw):
            candidate = _candidate_from_item(project_id, item)
            if candidate is None:
                continue
            qualified_key = candidate.get("qualified_name")
            if qualified_key and str(qualified_key) in qualified:
                details[str(qualified_key)] = candidate
            name_key = str(candidate["symbol_name"])
            if name_key in names:
                candidates_by_name.setdefault(name_key, []).append(candidate)
    for name in names:
        matches = _dedupe_candidates(candidates_by_name.get(name, []), limit=2)
        if len(matches) == 1:
            details[name] = matches[0]
    return details


def _node_id(candidate: dict[str, object]) -> str:
    identity = "|".join((
        str(candidate.get("qualified_name") or candidate.get("symbol_name") or ""),
        str(candidate.get("path") or ""),
        str(candidate.get("start_line") or 1),
    ))
    return "cg-" + hashlib.sha1(identity.encode("utf-8")).hexdigest()[:16]


def _node_content(project_id: int, candidate: dict[str, object]) -> str:
    project = get_project(project_id)
    if project is None:
        return ""
    try:
        content, _language = read_text_file(Path(project.local_path).resolve(), str(candidate["path"]))
    except Exception:
        return ""
    lines = content.splitlines()
    start = max(1, int(candidate.get("start_line") or 1))
    end = max(start, int(candidate.get("end_line") or start))
    window_start = max(1, start - 2)
    window_end = min(len(lines), max(end, start + 12) + 2)
    return "\n".join(f"{number}: {lines[number - 1]}" for number in range(window_start, window_end + 1))[:4000]


def _as_node(project_id: int, candidate: dict[str, object], direction: str, hop: int) -> dict[str, object]:
    return {
        "id": _node_id(candidate),
        **candidate,
        "content": _node_content(project_id, candidate),
        "direction": direction,
        "hop": hop,
    }


def _resolve_root(project_id: int, project_name: str, requested: CallGuideCandidate) -> dict[str, object]:
    result = resolve_call_guide_candidates(
        project_id,
        source_path=requested.path,
        line=requested.start_line,
        symbol_name=requested.symbol_name,
        qualified_name=requested.qualified_name,
    )
    candidates = result["candidates"]
    if not isinstance(candidates, list) or not candidates:
        raise CallGuideError("调用链起点已不在当前结构索引中")
    if requested.qualified_name:
        exact = next((item for item in candidates if item.get("qualified_name") == requested.qualified_name), None)
        if exact:
            return exact
    exact_path = next((item for item in candidates if item.get("path") == requested.path and item.get("symbol_name") == requested.symbol_name), None)
    return exact_path or candidates[0]


def build_call_guide_graph(project_id: int, requested: CallGuideCandidate) -> dict[str, object]:
    status, project_name = _index_context(project_id)
    root = _resolve_root(project_id, project_name, requested)
    root_name = str(root.get("qualified_name") or root["symbol_name"])
    nodes: dict[str, dict[str, object]] = {}
    edges: dict[str, dict[str, object]] = {}
    root_node = _as_node(project_id, root, "root", 0)
    nodes[str(root_node["id"])] = root_node
    coverage = {
        "status": "complete",
        "callers_complete": True,
        "callees_complete": True,
        "reason": None,
        "engine": ENGINE_NAME,
    }

    try:
        root_trace = _run_tool("trace_path", {
            "project": project_name,
            "function_name": root_name,
            "direction": "both",
            "depth": 1,
        })
    except StructuralEngineError as exc:
        raise CallGuideError(f"结构引擎无法追踪该符号：{exc}") from exc

    direct_by_direction = {
        "caller": _trace_entries(root_trace, "callers", MAX_DIRECT),
        "callee": _trace_entries(root_trace, "callees", MAX_DIRECT),
    }
    all_direct = [item for values in direct_by_direction.values() for item in values]
    try:
        direct_details = _resolve_details(project_id, project_name, all_direct)
    except StructuralEngineError:
        direct_details = {}
        coverage.update(status="partial", reason="部分调用节点无法定位到源码")

    direct_nodes: dict[tuple[str, str], dict[str, object]] = {}
    for direction, refs in direct_by_direction.items():
        for ref in refs:
            ref_key = str(ref.get("qualified_name") or ref["symbol_name"])
            detail = direct_details.get(ref_key)
            if not detail:
                coverage.update(status="partial", reason="部分调用节点无法定位到源码")
                continue
            node = _as_node(project_id, detail, direction, 1)
            node_id = str(node["id"])
            nodes[node_id] = node
            direct_nodes[(direction, ref_key)] = node
            source_id, target_id = (
                (node_id, str(root_node["id"])) if direction == "caller"
                else (str(root_node["id"]), node_id)
            )
            edge_id = f"{source_id}->{target_id}"
            edges[edge_id] = {"id": edge_id, "source": source_id, "target": target_id, "relation": "calls", "verified": True}

    for (direction, ref_key), parent_node in list(direct_nodes.items()):
        if len(nodes) >= MAX_NODES:
            break
        try:
            trace = _run_tool("trace_path", {
                "project": project_name,
                "function_name": ref_key,
                "direction": "both",
                "depth": 1,
            })
            trace_key = "callers" if direction == "caller" else "callees"
            secondary_refs = _trace_entries(trace, trace_key, MAX_SECONDARY_PER_NODE)
            secondary_details = _resolve_details(project_id, project_name, secondary_refs)
        except StructuralEngineError:
            coverage["status"] = "partial"
            coverage[f"{direction}s_complete"] = False
            coverage["reason"] = "部分二跳调用关系未能完成分析"
            continue
        for ref in secondary_refs:
            ref_identity = str(ref.get("qualified_name") or ref["symbol_name"])
            detail = secondary_details.get(ref_identity)
            if not detail:
                coverage["status"] = "partial"
                coverage[f"{direction}s_complete"] = False
                coverage["reason"] = "部分二跳调用节点无法定位到源码"
                continue
            node = _as_node(project_id, detail, direction, 2)
            node_id = str(node["id"])
            if node_id == str(root_node["id"]):
                continue
            nodes.setdefault(node_id, node)
            parent_id = str(parent_node["id"])
            source_id, target_id = (
                (node_id, parent_id) if direction == "caller" else (parent_id, node_id)
            )
            edge_id = f"{source_id}->{target_id}"
            edges[edge_id] = {"id": edge_id, "source": source_id, "target": target_id, "relation": "calls", "verified": True}
            if len(nodes) >= MAX_NODES:
                break

    return {
        "root": root,
        "nodes": list(nodes.values()),
        "edges": list(edges.values()),
        "coverage": coverage,
        "indexed_fingerprint": str(status.get("indexed_fingerprint") or "") or None,
        "current_node_id": str(root_node["id"]),
    }


def _parse_json(value: object, fallback: object) -> object:
    try:
        parsed = json.loads(str(value or ""))
    except (json.JSONDecodeError, TypeError):
        return fallback
    return parsed


def serialize_call_guide(row: dict[str, object]) -> dict[str, object]:
    graph = _parse_json(row.get("graph_json"), {})
    if not isinstance(graph, dict):
        graph = {}
    root = _parse_json(row.get("root_json"), {})
    coverage = _parse_json(row.get("coverage_json"), {})
    visited = _parse_json(row.get("visited_node_ids_json"), [])
    status = get_project_index_status(int(row["project_id"]))
    current_fingerprint = str(status.get("indexed_fingerprint") or "")
    saved_fingerprint = str(row.get("indexed_fingerprint") or "")
    return {
        "id": int(row["id"]),
        "project_id": int(row["project_id"]),
        "title": str(row["title"]),
        "root": root,
        "nodes": graph.get("nodes", []),
        "edges": graph.get("edges", []),
        "coverage": coverage,
        "indexed_fingerprint": row.get("indexed_fingerprint"),
        "current_node_id": row.get("current_node_id"),
        "visited_node_ids": visited if isinstance(visited, list) else [],
        "stale": bool(saved_fingerprint and current_fingerprint and saved_fingerprint != current_fingerprint),
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }


def create_persisted_call_guide(project_id: int, requested: CallGuideCandidate, title: Optional[str]) -> dict[str, object]:
    built = build_call_guide_graph(project_id, requested)
    root = built["root"]
    row = create_call_guide(
        project_id,
        (title or f"{root['symbol_name']} 调用链").strip()[:200],
        json.dumps(root, ensure_ascii=False),
        json.dumps({"nodes": built["nodes"], "edges": built["edges"]}, ensure_ascii=False),
        json.dumps(built["coverage"], ensure_ascii=False),
        built["indexed_fingerprint"],
        str(built["current_node_id"]),
    )
    return serialize_call_guide(row)


def list_persisted_call_guides(project_id: int) -> list[dict[str, object]]:
    return [serialize_call_guide(row) for row in list_call_guides(project_id)]


def get_persisted_call_guide(project_id: int, guide_id: int) -> Optional[dict[str, object]]:
    row = get_call_guide(project_id, guide_id)
    return serialize_call_guide(row) if row else None


def update_persisted_call_guide(
    project_id: int,
    guide_id: int,
    *,
    title: Optional[str],
    current_node_id: Optional[str],
    visited_node_ids: Optional[list[str]],
) -> Optional[dict[str, object]]:
    row = get_call_guide(project_id, guide_id)
    if row is None:
        return None
    graph = _parse_json(row.get("graph_json"), {})
    valid_ids = {
        str(item.get("id")) for item in graph.get("nodes", [])
        if isinstance(item, dict) and item.get("id")
    } if isinstance(graph, dict) else set()
    if current_node_id is not None and current_node_id not in valid_ids:
        raise CallGuideError("导览节点不存在")
    sanitized_visited = None
    if visited_node_ids is not None:
        sanitized_visited = list(dict.fromkeys(item for item in visited_node_ids if item in valid_ids))[:64]
    updated = update_call_guide(
        project_id,
        guide_id,
        title=title.strip()[:200] if title and title.strip() else None,
        current_node_id=current_node_id,
        visited_node_ids_json=json.dumps(sanitized_visited, ensure_ascii=False) if sanitized_visited is not None else None,
    )
    return serialize_call_guide(updated) if updated else None


def refresh_persisted_call_guide(project_id: int, guide_id: int) -> Optional[dict[str, object]]:
    row = get_call_guide(project_id, guide_id)
    if row is None:
        return None
    root_data = _parse_json(row.get("root_json"), {})
    requested = CallGuideCandidate.model_validate(root_data)
    built = build_call_guide_graph(project_id, requested)
    valid_ids = {str(item["id"]) for item in built["nodes"]}
    old_visited = _parse_json(row.get("visited_node_ids_json"), [])
    visited = [str(item) for item in old_visited if str(item) in valid_ids] if isinstance(old_visited, list) else []
    current = str(row.get("current_node_id") or "")
    if current not in valid_ids:
        current = str(built["current_node_id"])
    updated = update_call_guide(
        project_id,
        guide_id,
        graph_json=json.dumps({"nodes": built["nodes"], "edges": built["edges"]}, ensure_ascii=False),
        coverage_json=json.dumps(built["coverage"], ensure_ascii=False),
        indexed_fingerprint=built["indexed_fingerprint"],
        current_node_id=current,
        visited_node_ids_json=json.dumps(visited, ensure_ascii=False),
        update_fingerprint=True,
    )
    return serialize_call_guide(updated) if updated else None


def delete_persisted_call_guide(project_id: int, guide_id: int) -> bool:
    return delete_call_guide(project_id, guide_id)


def build_call_guide_qa_context(
    project_id: int,
    guide_id: Optional[int],
    focused_node_id: Optional[str],
    route_node_ids: list[str],
) -> tuple[str, list[dict[str, object]]]:
    if guide_id is None:
        raise CallGuideError("缺少调用链导览")
    guide = get_persisted_call_guide(project_id, guide_id)
    if guide is None:
        raise CallGuideError("调用链导览不存在")
    if guide["stale"]:
        raise CallGuideError("调用链导览已过期，请刷新后再讲解")
    by_id = {str(node["id"]): node for node in guide["nodes"]}
    verified_pairs = {
        frozenset((str(edge.get("source")), str(edge.get("target"))))
        for edge in guide["edges"]
        if edge.get("verified") is True and edge.get("source") and edge.get("target")
    }
    focus_id = focused_node_id or str(guide.get("current_node_id") or "")
    if focus_id not in by_id:
        raise CallGuideError("当前调用链节点不存在")
    route = [item for item in route_node_ids if item in by_id]
    if focus_id not in route:
        route.append(focus_id)
    route = route[-8:]
    root_ids = {node_id for node_id, node in by_id.items() if node.get("direction") == "root"}
    if route[0] != focus_id or not root_ids.intersection(route[-1:]):
        raise CallGuideError("讲解路径必须包含当前节点")
    for source_id, target_id in zip(route, route[1:]):
        if frozenset((source_id, target_id)) not in verified_pairs:
            raise CallGuideError("讲解路径包含未经结构索引验证的调用边")
    lines = ["当前材料来自本地结构索引验证过的调用链，不得补写不存在的调用边："]
    sources: list[dict[str, object]] = []
    for index, node_id in enumerate(route, start=1):
        node = by_id[node_id]
        lines.append(
            f"{index}. {node.get('qualified_name') or node['symbol_name']} "
            f"[{node['direction']} hop {node['hop']}] {node['path']}:{node['start_line']}-{node['end_line']}"
        )
        sources.append({
            "path": node["path"],
            "start_line": node["start_line"],
            "end_line": node["end_line"],
            "symbol_name": node["symbol_name"],
            "qualified_name": node.get("qualified_name"),
            "relation": f"{node['direction']} hop {node['hop']}",
            "evidence_type": "call_guide",
            "provider": ENGINE_NAME,
            "content": str(node.get("content") or "")[:2200],
            "score": 100 - index,
        })
    return "\n".join(lines), sources
