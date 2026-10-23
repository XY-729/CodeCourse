"""Immutable, versioned ownership of lesson teaching ranges.

The planner proposes ownership; the local validator freezes it before any writer
starts. A range is a concept identity + aspect + dimension, never just a name.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from app.services.personalization.teaching.generation_context import stable_json


DIMENSIONS = {"conceptual", "code_reading", "implementation", "debugging", "transfer"}
MODES = {"first_explanation", "new_application", "necessary_review"}

PLANNER_CONTRACT = """
<lesson_responsibility_contract>
章节计划必须使用不可变职责：每章 section_id（本计划稳定且唯一）、depends_on（章节 ID 数组）、
reference_only（只引用范围数组）、avoid_repeat（不负责重复展开的范围数组）。
每个 items 项除 name/kind/focus 外必须返回 concept_ref、existing_id（知识树提供的编号或 null）、
aspect（本章负责的具体范围）、dimension、owner_section_id、teaching_mode、reference_section_ids。
concept_ref 为计划内稳定概念引用；同概念始终复用同一引用。优先匹配完整树提供的编号。
dimension 为 conceptual/code_reading/implementation/debugging/transfer。
若 items 或 reference_only/avoid_repeat 对应树中已有具体范围，带上该范围的 aspect_id 并复用规范 aspect；新的应用范围不填 aspect_id。不要为同一范围换词重新规划。
teaching_mode 为 first_explanation/new_application/necessary_review。
每个 concept + aspect + dimension 只能有一个 owner，引用的章节必须存在且不能引用自身。
同概念的新应用、边界条件和用户明确要求重讲可以独立负责，不能按名称去重。
reference_only/avoid_repeat 每项为 {concept_ref,existing_id,aspect,dimension,owner_section_id}。
不要输出用户熟悉度，不把其他章将讲的内容当作已经学会。正文 writer 沿用同版计划，
清单中属于本章职责的概念使用计划 concept_ref（已有节点同时保留 existing_id）。
</lesson_responsibility_contract>
"""


@dataclass(frozen=True)
class LessonResponsibilityMap:
    # Strings prevent a caller from mutating nested dicts after the plan freezes.
    plan_json: str

    @property
    def data(self) -> dict:
        return json.loads(self.plan_json)

    @property
    def version(self) -> str:
        return self.data["version"]

    def render(self) -> str:
        return "<lesson_responsibility_map>\n" + self.plan_json + "\n</lesson_responsibility_map>"


def _identity(item: dict) -> str:
    return str(item.get("existing_id") or item.get("concept_ref") or "").strip()


def _range(item: dict) -> tuple[str, str, str]:
    return _identity(item), str(item.get("aspect", "")).strip(), str(item.get("dimension", "")).strip()


def freeze_responsibility_map(plan: dict, tree_snapshot: dict, *, available_ids: set[str] | None = None) -> LessonResponsibilityMap:
    sections = plan["sections"]
    ids = [str(section.get("section_id", "")).strip() for section in sections]
    if not all(ids) or len(set(ids)) != len(ids):
        raise ValueError("章节职责缺少唯一 section_id；旧课件已保留。")
    versions = {key: tree_snapshot.get(key) for key in ("topology_version", "state_version")}
    if any(type(value) is not int or value < 0 for value in versions.values()):
        raise ValueError("章节职责缺少有效树版本。")
    owners: dict[tuple[str, str, str], str] = {}
    canonical_ids: dict[str, str | None] = {}
    for section in sections:
        section_id = section["section_id"]
        for item in section["items"]:
            identity, aspect, dimension = _range(item)
            ref = item.get("concept_ref")
            if not isinstance(ref, str) or not ref.strip() or not identity or not aspect or dimension not in DIMENSIONS:
                raise ValueError("章节职责必须明确 concept_ref、aspect 和 dimension。")
            existing = item.get("existing_id")
            if existing is not None and (not isinstance(existing, str) or available_ids is not None and existing not in available_ids):
                raise ValueError("章节职责引用了知识树之外的概念 ID。")
            if ref in canonical_ids and canonical_ids[ref] != existing:
                raise ValueError("同一计划概念引用对应了冲突的身份。")
            canonical_ids[ref] = existing
            if item.get("owner_section_id") != section_id:
                raise ValueError("章节职责缺少 owner 或 owner 与所属章节不符。")
            if item.get("teaching_mode") not in MODES:
                raise ValueError("章节职责缺少首次解释、新应用或必要复习类型。")
            key = identity, aspect, dimension
            if key in owners:
                raise ValueError("同一概念与范围存在重复章节责任。")
            owners[key] = section_id
            references = item.get("reference_section_ids", [])
            if not isinstance(references, list) or any(ref_id not in ids or ref_id == section_id for ref_id in references):
                raise ValueError("章节职责存在无效引用目标。")
        for key in ("reference_only", "avoid_repeat"):
            ranges = section.get(key, [])
            if not isinstance(ranges, list):
                raise ValueError("章节引用/避免重复职责必须为数组。")
            for item in ranges:
                if not isinstance(item, dict) or not all(_range(item)) or item.get("dimension") not in DIMENSIONS or item.get("owner_section_id") not in ids:
                    raise ValueError("章节引用/避免重复职责范围无效。")
        dependencies = section.get("depends_on", [])
        if not isinstance(dependencies, list) or any(dep not in ids or dep == section_id for dep in dependencies):
            raise ValueError("章节职责存在无效依赖。")
    for section in sections:
        for key in ("reference_only", "avoid_repeat"):
            for item in section.get(key, []):
                if owners.get(_range(item)) != item["owner_section_id"]:
                    raise ValueError("章节引用目标没有对应的范围责任。")
    dependencies = {section["section_id"]: section.get("depends_on", []) for section in sections}
    def visit(node, active, completed):
        if node in active:
            raise ValueError("章节职责存在循环依赖。")
        if node in completed:
            return
        for dep in dependencies[node]:
            visit(dep, active | {node}, completed)
        completed.add(node)
    completed: set[str] = set()
    for node in ids:
        visit(node, set(), completed)
    payload = {"tree_version": versions, "sections": sections}
    digest = hashlib.sha256(stable_json(payload).encode("utf-8")).hexdigest()
    return LessonResponsibilityMap(stable_json({"plan_id": digest[:24], "version": digest,
                                               **payload}))


def audit_section_manifest(responsibilities: LessonResponsibilityMap, section_id: str, manifest: dict,
                           *, plan_version: str, tree_version: dict) -> list[dict]:
    """Reject mixed versions and expanded ownership; return missing ranges."""
    plan = responsibilities.data
    if plan_version != plan["version"] or tree_version != plan["tree_version"]:
        raise ValueError("章节结果与冻结的计划或知识树版本不一致；旧结果已失效。")
    section = next((section for section in plan["sections"] if section["section_id"] == section_id), None)
    if section is None:
        raise ValueError("章节结果不属于本计划。")
    concepts = {concept["ref"]: concept for concept in manifest.get("concepts", [])}
    owned = {_range(item) for item in section["items"]}
    observed = set()
    for coverage in manifest.get("coverage", []):
        if coverage.get("kind") not in {"brief", "explained"}:
            continue
        concept = concepts.get(coverage.get("concept_ref"), {})
        key = (str(concept.get("existing_id") or coverage.get("concept_ref") or ""),
               str(coverage.get("aspect", "")).strip(), coverage.get("dimension"))
        if key not in owned:
            raise ValueError(f"章节 {section_id} 实际清单扩大了冻结职责：{key}。")
        observed.add(key)
    return [item for item in section["items"] if _range(item) not in observed]


def audit_synthesis_manifest(responsibilities: LessonResponsibilityMap, manifest: dict, missing: list[dict]) -> None:
    """Synthesis may fill missing ranges or add new connections, not re-own one."""
    owners = {_range(item) for section in responsibilities.data["sections"] for item in section["items"]}
    missing_keys = {_range(item) for item in missing}
    concepts = {concept["ref"]: concept for concept in manifest.get("concepts", [])}
    for coverage in manifest.get("coverage", []):
        if coverage.get("kind") not in {"brief", "explained"}:
            continue
        concept = concepts.get(coverage.get("concept_ref"), {})
        key = (str(concept.get("existing_id") or coverage.get("concept_ref") or ""),
               str(coverage.get("aspect", "")).strip(), coverage.get("dimension"))
        if key in owners and key not in missing_keys:
            raise ValueError("统一整合重复解释了已由章节完成的同一概念范围。")
        missing_keys.discard(key)
    if missing_keys:
        raise ValueError("统一整合后仍有冻结职责范围未覆盖；旧课件已保留。")
