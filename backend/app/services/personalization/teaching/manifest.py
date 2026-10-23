"""Portable TeachingManifest v2 parsing. Identity/persistence stay server owned.

This module is deliberately pure: parsing and section assembly never call a model
or infer learner familiarity. A damaged v2 response is never treated as legacy.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
import json
import re
from typing import Iterable, Mapping


MAX_METADATA_BYTES = 2_000_000
COMMENT_RE = re.compile(r"<!--\s*codecourse-teaching:\s*(.*?)\s*-->", re.S)
KINDS = {"mentioned", "brief", "explained", "planned"}
DIMENSIONS = {"conceptual", "code_reading", "implementation", "debugging", "transfer"}
MANIFEST_SOURCE = "teaching_manifest_v2"
# Characters a model may re-punctuate or omit when quoting its own prose. Only
# invisible formatting and punctuation are ignored: word and path characters
# (letters, digits, `_ - / . |` and CJK ideographs) stay significant.
QUOTE_NOISE = frozenset(
    " \t\r\n\u3000\u00a0"
    "，。、；：！？…·〃"
    "「」『』【】《》〈〉（）〔〕［］｛｝“”‘’"
    ",.;:!?\"'()[]{}<>~`*#"
)


class ManifestValidationError(ValueError):
    pass


@dataclass
class ManifestResult:
    body: str
    manifest: dict | None = None
    status: str = "absent"
    errors: list[str] = field(default_factory=list)
    legacy: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def require_valid(self) -> dict:
        if self.status != "valid" or self.manifest is None:
            raise ManifestValidationError("知识清单未就绪：" + "; ".join(self.errors or [self.status]))
        return self.manifest


def visible_body(content: str) -> str:
    return COMMENT_RE.sub(lambda match: "\n" * match[0].count("\n"), content)


def _quote_key(text: str) -> str:
    return "".join(char for char in text if char not in QUOTE_NOISE)


def _quote_positions(text: str) -> tuple[str, list[int]]:
    chars: list[str] = []
    positions: list[int] = []
    for position, char in enumerate(text):
        if char in QUOTE_NOISE:
            continue
        chars.append(char)
        positions.append(position)
    return "".join(chars), positions


def locate_quote(visible: str, quote: str, unique: str | None = None) -> str | None:
    """Return the literal body span a quote stands for, or None when ambiguous.

    A quote the model copied verbatim is used as-is. A quote repeated in the body
    is widened with its own surrounding text; a quote that differs only in
    punctuation or spacing is replaced by the exact body characters it covers.
    The returned value is therefore always a real, single region of `visible`.
    ``unique`` additionally requires that term text to occur once inside the span.
    """
    def fit(candidate: str, occurrences: int) -> bool:
        return occurrences == 1 and (unique is None or candidate.count(unique) == 1)

    if not isinstance(quote, str) or not quote:
        return None
    count = visible.count(quote)
    if fit(quote, count):
        return quote
    if count:
        start = visible.index(quote)
        end = start + len(quote)
        for width in (4, 8, 16, 32, 64, 96):
            for left, right in ((width, width), (0, width), (width, 0)):
                candidate = visible[max(0, start - left):min(len(visible), end + right)]
                if fit(candidate, visible.count(candidate)):
                    return candidate
        return None
    key = _quote_key(quote)
    if not key:
        return None
    normalized, positions = _quote_positions(visible)
    if normalized.count(key) != 1:
        return None
    start = normalized.index(key)
    located = visible[positions[start]:positions[start + len(key) - 1] + 1]
    return located if unique is None or located.count(unique) == 1 else None


def validate_manifest(manifest: object, body: str | None = None, *,
                      drop_unlocatable: bool = False,
                      warnings: list[str] | None = None) -> dict:
    """Validate shape, references and literal quotes; return an independent value."""
    if not isinstance(manifest, dict) or type(manifest.get("schema_version")) is not int or manifest["schema_version"] != 2:
        raise ManifestValidationError("TeachingManifest schema_version 必须为 2")
    value = deepcopy(manifest)
    for key in ("concepts", "coverage", "terms"):
        if not isinstance(value.get(key), list):
            raise ManifestValidationError(f"TeachingManifest {key} 必须为数组")
    changes = value.setdefault("placement_changes", [])
    if not isinstance(changes, list):
        raise ManifestValidationError("placement_changes 必须为数组")
    # Source/version fields cannot be supplied by a model.
    for key in ("source_type", "source_path", "artifact_kind", "content_hash", "tree_version", "tree_snapshot", "generation_id"):
        value.pop(key, None)
    concepts: dict[str, dict] = {}
    for item in value["concepts"]:
        if not isinstance(item, dict):
            raise ManifestValidationError("concepts 项必须为对象")
        ref = item.get("ref")
        if not isinstance(ref, str) or not ref.strip() or ref in concepts:
            raise ManifestValidationError("concept ref 缺失或重复")
        for key in ("name", "domain"):
            if not isinstance(item.get(key), str) or not item[key].strip():
                raise ManifestValidationError(f"concept {ref} 缺少 {key}")
        if item.get("scope") not in {"global", "project"}:
            raise ManifestValidationError(f"concept {ref} scope 无效")
        existing = item.setdefault("existing_id", None)
        if existing is not None and (not isinstance(existing, str) or not existing.strip()):
            raise ManifestValidationError(f"concept {ref} existing_id 无效")
        aliases = item.setdefault("aliases", [])
        if not isinstance(aliases, list) or any(not isinstance(alias, str) for alias in aliases):
            raise ManifestValidationError(f"concept {ref} aliases 无效")
        item.setdefault("parent_ref", None)
        for key in ("familiarity", "understood", "weight", "mastery"):
            if key in item:
                raise ManifestValidationError(f"concept {ref} 不得声明 {key}")
        concepts[ref] = item
    for ref, item in concepts.items():
        parent = item["parent_ref"]
        if parent is not None and (not isinstance(parent, str) or parent not in concepts):
            raise ManifestValidationError(f"concept {ref} parent_ref 不存在")
        if parent and item["scope"] == "global" and concepts[parent]["scope"] == "project":
            raise ManifestValidationError("global 概念不能依赖 project 父节点")
        visited = {ref}
        while parent is not None:
            if parent in visited:
                raise ManifestValidationError("概念父子关系存在循环")
            visited.add(parent)
            parent = concepts[parent]["parent_ref"]
    visible = visible_body(body) if body is not None else None
    for key in ("coverage", "terms"):
        kept: list[dict] = []
        for item in value[key]:
            if not isinstance(item, dict) or item.get("concept_ref") not in concepts:
                raise ManifestValidationError(f"{key} concept_ref 不存在")
            quote = item.get("quote")
            if not isinstance(quote, str) or not quote:
                raise ManifestValidationError(f"{key} quote 缺失")
            if key == "coverage":
                if not isinstance(item.get("aspect"), str) or not item["aspect"].strip():
                    raise ManifestValidationError("coverage aspect 缺失")
                if item.get("kind") not in KINDS or item.get("dimension") not in DIMENSIONS:
                    raise ManifestValidationError("coverage kind/dimension 无效")
                if not isinstance(item.get("core"), bool):
                    raise ManifestValidationError("coverage core 必须为布尔值")
            elif not isinstance(item.get("text"), str) or not item["text"].strip():
                raise ManifestValidationError("terms text 必须逐字出现在 quote 中")
            if visible is not None:
                if not drop_unlocatable:
                    if visible.count(quote) != 1:
                        raise ManifestValidationError(f"{key} quote 必须在最终正文唯一定位")
                else:
                    located = locate_quote(visible, quote,
                                           item.get("text") if key == "terms" else None)
                    if located is None:
                        if warnings is not None:
                            warnings.append(f"{key} quote 无法在正文唯一定位，已从知识清单移除")
                        continue
                    item["quote"] = located
            if key == "terms":
                quote = item["quote"]
                if quote.count(item["text"]) != 1:
                    if not drop_unlocatable:
                        raise ManifestValidationError(
                            "terms text 必须逐字出现在 quote 中" if not quote.count(item["text"])
                            else "术语原词必须能在 quote 中唯一定位")
                    if warnings is not None:
                        warnings.append("terms quote 无法唯一定位术语原词，已从知识清单移除")
                    continue
            kept.append(item)
        value[key] = kept
    changed: set[str] = set()
    for item in changes:
        if not isinstance(item, dict) or item.get("concept_ref") not in concepts or item.get("to_parent_ref") not in concepts:
            raise ManifestValidationError("placement_changes 引用不存在")
        if not concepts[item["concept_ref"]]["existing_id"]:
            raise ManifestValidationError("placement_changes 仅适用于已有概念")
        if item["concept_ref"] in changed:
            raise ManifestValidationError("placement_changes 概念重复")
        changed.add(item["concept_ref"])
        if "from_parent_id" not in item or (item["from_parent_id"] is not None and not isinstance(item["from_parent_id"], str)):
            raise ManifestValidationError("placement_changes from_parent_id 无效")
        if not isinstance(item.get("reason"), str) or not item["reason"].strip():
            raise ManifestValidationError("placement_changes reason 缺失")
    return value


def canonical_comment(manifest: Mapping | list) -> str:
    value = validate_manifest(dict(manifest)) if isinstance(manifest, Mapping) else manifest
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    payload = payload.replace("<", "\\u003c").replace(">", "\\u003e")
    if len(payload.encode("utf-8")) > MAX_METADATA_BYTES:
        raise ManifestValidationError("知识清单超过解析资源限制")
    return f"<!-- codecourse-teaching: {payload} -->"


def parse_manifest(raw: str, *, drop_unlocatable: bool = False) -> ManifestResult:
    """Consume TEACHING outside fenced examples, retaining invalid-v2 status.

    ``drop_unlocatable`` is for freshly generated documents: quotes that cannot be
    located in the body are repaired or dropped instead of discarding the whole
    document, so a readable body is never lost to one bad metadata row.
    """
    payloads: list[tuple[str, bool]] = []
    kept: list[str] = []
    fence = ""
    comment: list[str] | None = None
    for line in raw.splitlines(keepends=True):
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if fence:
            kept.append(line)
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence) and not line[marker.end():].strip():
                fence = ""
            continue
        if comment is not None:
            comment.append(line)
            if "-->" in line:
                joined = "".join(comment)
                match = COMMENT_RE.search(joined)
                payloads.append((match[1] if match else joined, "\n" not in joined.rstrip("\r\n")))
                comment = None
            continue
        if marker:
            fence = marker[1]
            kept.append(line)
            continue
        if re.match(r"^\s*<!--\s*codecourse-teaching:", line):
            match = COMMENT_RE.search(line)
            if match:
                payloads.append((match[1], True))
            else:
                comment = [line]
            continue
        match = re.match(r"^\s*TEACHING\s*[:：]\s*(.*?)\s*$", line, re.I)
        if match:
            payloads.append((match[1], True))
            continue
        kept.append(line)
    if comment is not None:
        payloads.append(("".join(comment), False))
    result = ManifestResult(body="".join(kept).strip())
    if not payloads:
        return result
    manifests: list[dict] = []
    for payload, single_line in payloads:
        try:
            if len(payload.encode("utf-8")) > MAX_METADATA_BYTES:
                raise ManifestValidationError("知识清单超过解析资源限制")
            value = json.loads(payload)
            if isinstance(value, list):
                result.legacy.extend(item for item in value if isinstance(item, dict))
                continue
            if not single_line:
                raise ManifestValidationError("TeachingManifest v2 必须为单行 JSON 对象")
            manifests.append(validate_manifest(value, result.body,
                                               drop_unlocatable=drop_unlocatable,
                                               warnings=result.warnings))
        except (ValueError, RecursionError) as exc:
            result.errors.append(str(exc))
    if result.errors:
        result.status = "invalid"
    elif len(manifests) > 1:
        result.status, result.errors = "invalid", ["多个 v2 清单必须先按响应命名空间合并"]
    elif manifests:
        result.status, result.manifest = "valid", manifests[0]
    else:
        result.status = "legacy"
    return result


def prepare_manifest(raw: str) -> str:
    result = parse_manifest(raw)
    if result.status == "invalid":
        result.require_valid()
    if result.manifest is not None:
        return result.body + "\n\n" + canonical_comment(result.manifest)
    if result.status == "legacy":
        return result.body + "\n\n" + canonical_comment(result.legacy)
    return raw


def namespace_manifest(manifest: dict, namespace: str) -> dict:
    if not namespace:
        raise ManifestValidationError("章节 namespace 不能为空")
    value = validate_manifest(manifest)
    refs = {item["ref"]: f"{namespace}::{item['ref']}" for item in value["concepts"]}
    for item in value["concepts"]:
        item["ref"] = refs[item["ref"]]
        if item["parent_ref"] is not None:
            item["parent_ref"] = refs[item["parent_ref"]]
    for key in ("coverage", "terms", "placement_changes"):
        for item in value[key]:
            item["concept_ref"] = refs[item["concept_ref"]]
            if key == "placement_changes":
                item["to_parent_ref"] = refs[item["to_parent_ref"]]
    return value


def merge_manifests(sections: Iterable[tuple[str, dict]], final_body: str, *, filter_unmatched: bool = False) -> dict:
    merged = {"schema_version": 2, "concepts": [], "coverage": [], "terms": [], "placement_changes": []}
    seen: set[str] = set()
    visible = visible_body(final_body)
    for namespace, manifest in sections:
        if namespace in seen:
            raise ManifestValidationError("章节 namespace 重复")
        seen.add(namespace)
        value = namespace_manifest(manifest, namespace)
        for key in ("concepts", "coverage", "terms", "placement_changes"):
            rows = value[key]
            if filter_unmatched and key in {"coverage", "terms"}:
                rows = [item for item in rows if visible.count(item["quote"]) == 1]
            merged[key].extend(rows)
    return validate_manifest(merged, final_body)


def manifest_terms(manifest: dict, body: str) -> list[dict]:
    value = validate_manifest(manifest, body)
    concepts = {item["ref"]: item for item in value["concepts"]}
    visible = visible_body(body)
    candidates = []
    for term in value["terms"]:
        concept = concepts[term["concept_ref"]]
        start = visible.index(term["quote"]) + term["quote"].index(term["text"])
        candidates.append({
            "display_name": term["text"], "canonical_name": concept["name"],
            "category": "concept", "confidence": 1.0,
            "source_span": {"text": term["text"], "start": start, "end": start + len(term["text"])},
            "concept_ref": concept["ref"], "existing_id": concept["existing_id"],
            "domain": concept["domain"], "scope": concept["scope"], "quote": term["quote"],
            "source": MANIFEST_SOURCE,
        })
    return candidates
