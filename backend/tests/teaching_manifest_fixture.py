"""Helpers that build valid TeachingManifest v2 trailers for mocked model output."""
from __future__ import annotations

import json
from typing import Iterable, Sequence


def manifest_trailer(
    entries: Sequence[object],
    *,
    terms: Iterable[tuple[str, str, str]] | None = None,
    domain: str = "general",
) -> str:
    """entries: dict or (concept name, quote[, aspect[, kind]]).

    A dict entry may set ref/name/quote/aspect/dimension/kind so a section
    manifest can reuse the frozen responsibility refs from a lesson plan.
    """
    concepts: list[dict] = []
    coverage: list[dict] = []
    for index, entry in enumerate(entries, start=1):
        if isinstance(entry, dict):
            name = str(entry["name"])
            quote = str(entry["quote"])
            aspect = str(entry.get("aspect", "核心范围"))
            kind = str(entry.get("kind", "explained"))
            dimension = str(entry.get("dimension", "conceptual"))
            ref = str(entry.get("ref", f"c{index}"))
        else:
            name, quote = str(entry[0]), str(entry[1])
            aspect = str(entry[2]) if len(entry) > 2 else "核心范围"
            kind = str(entry[3]) if len(entry) > 3 else "explained"
            dimension = "conceptual"
            ref = f"c{index}"
        concepts.append({
            "ref": ref, "existing_id": None, "name": name, "domain": domain,
            "scope": "global", "parent_ref": None, "aliases": [],
        })
        coverage.append({
            "concept_ref": ref, "aspect": aspect, "kind": kind,
            "dimension": dimension, "core": True, "quote": quote,
        })
    term_rows = [
        {"concept_ref": f"c{ref}", "text": text, "quote": quote}
        for ref, text, quote in (terms or ())
    ]
    payload = {"schema_version": 2, "concepts": concepts, "coverage": coverage,
               "terms": term_rows, "placement_changes": []}
    return "\n\n<!-- codecourse-teaching: " + json.dumps(
        payload, ensure_ascii=False, separators=(",", ":")) + " -->"


def with_manifest(body: str, entries: Sequence[tuple], **kwargs) -> str:
    return body.rstrip("\n") + manifest_trailer(entries, **kwargs) + "\n"
