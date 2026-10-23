"""Compact model-only forest encoding; persistent identities stay unchanged."""
from __future__ import annotations

import copy
import base64
import hashlib
from collections import Counter
from typing import Iterable


PROMPT_FOREST_INSTRUCTION = (
    "知识树采用 compact-v2：columns 定义每行各列，末列可省略；省略属性使用 defaults。"
    "parent_index 是 nodes 中父节点的从 0 开始行号，null 表示无父；行号只在本次快照有效。"
    "id 为稳定短编号，完整包含所有可见概念；返回的 existing_id、from_parent_id "
    "直接使用这些短编号，软件在校验时还原真实身份。不要凭编号推断含义。"
    "knowledge_state 未列出的节点使用默认状态；空范围不表示已掌握。"
)


def prompt_id(identity: str) -> str:
    return "c_" + base64.urlsafe_b64encode(hashlib.sha256(identity.encode("utf-8")).digest()[:6]).decode("ascii")


def prompt_id_lookup(identities: Iterable[str]) -> dict[str, str]:
    identities = set(identities)
    lookup = {}
    for identity in sorted(identities):
        short = prompt_id(identity)
        if short in lookup or short in identities:
            raise ValueError("知识树短编号冲突，已停止发送，原身份未改变")
        lookup[short] = identity
    return lookup


def expand_prompt_references(value, identities: Iterable[str]):
    """Expand only structured identity fields, never text, refs or quotes.

    Unknown aliases remain unknown and are rejected by the existing identity/
    scope/version validators. Full IDs remain supported for checkpoints/clients.
    """
    lookup = prompt_id_lookup(identities)
    def visit(item):
        if isinstance(item, list):
            return [visit(child) for child in item]
        if isinstance(item, dict):
            return {key: lookup.get(child, child) if key in {"existing_id", "from_parent_id"}
                    and isinstance(child, str) else visit(child) for key, child in item.items()}
        return item
    return visit(value)


def compact_forest(topology: dict, state: dict) -> tuple[dict, dict]:
    nodes = sorted(topology["nodes"], key=lambda node: node["id"])
    prompt_id_lookup(node["id"] for node in nodes)  # collision guard
    indices = {node['id']: index for index, node in enumerate(nodes)}
    defaults = {"domain": Counter(node["domain"] for node in nodes).most_common(1)[0][0] if nodes else "general",
                "scope": "global", "scope_id": "local-user", "identity_status": "resolved", "aliases": []}
    rows = []
    for node in nodes:
        options = {key: value for key, value in node.items()
                   if key not in {"id", "name", "parent_id"} and value != defaults.get(key)}
        row = [prompt_id(node["id"]), node["name"], indices[node['parent_id']] if node["parent_id"] else None]
        rows.append([*row, options] if options else row)
    state_defaults = {"familiarity": "unrecorded", "ranges": [], "coverage": [], "range_catalog": []}
    states = []
    for node in sorted(state["nodes"], key=lambda node: node["id"]):
        options = {key: value for key, value in node.items()
                   if key != "id" and value != state_defaults.get(key)}
        if options:
            states.append([prompt_id(node["id"]), options])
    # Versions are suffixes: a state update cannot invalidate the topology prefix.
    return ({"format": "compact-v2", "columns": ["id", "name", "parent_index", "optional_fields"],
             "defaults": defaults, "nodes": rows, "topology_status": topology["topology_status"],
             "topology_version": topology["topology_version"]},
            {"defaults": state_defaults, "nodes": states, "state_version": state["state_version"]})


def expand_compact_forest(topology: dict, state: dict, identities: Iterable[str]) -> tuple[dict, dict]:
    """Lossless decoder for validation and round-trip tests, not model output."""
    lookup = prompt_id_lookup(identities)
    rows, states = [], []
    for short, name, parent, *options in topology["nodes"]:
        parent_short = topology['nodes'][parent][0] if topology.get('format') == 'compact-v2' and parent is not None else parent
        rows.append({**copy.deepcopy(topology["defaults"]), **(options[0] if options else {}),
                     "id": lookup[short], "name": name, "parent_id": lookup[parent_short] if parent_short is not None else None})
    overrides = dict(state["nodes"])
    for short, identity in lookup.items():
        states.append({**copy.deepcopy(state["defaults"]), **overrides.get(short, {}), "id": identity})
    return ({"nodes": sorted(rows, key=lambda n: n["id"]), "topology_status": topology["topology_status"],
             "topology_version": topology["topology_version"]},
            {"nodes": sorted(states, key=lambda n: n["id"]), "state_version": state["state_version"]})
