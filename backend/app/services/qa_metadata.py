"""Deterministic parsing of metadata from the answer's original response.

This module deliberately has no model client. Missing or invalid manifests are
pending metadata; recovery never commissions a second response.
"""
from __future__ import annotations


def body_only_template(template: str) -> str:
    """Compatibility: deferred requests use the same output protocol."""
    return template


def extract_answer_metadata(record, payload, authorized_snapshot: str = "") -> dict:
    """Read only metadata already stored with an answer, including recovery."""
    from app.services.continuity_service import existing_qa_topics, parse_handoff_metadata
    from app.services.personalization.teaching.manifest import parse_manifest
    from app.services.term_service import parse_term_metadata

    raw, handoff = parse_handoff_metadata(
        record.answer_md,
        source_type=record.source_type,
        source_path=record.source_path,
        existing_topics=existing_qa_topics(record.project_id),
    )
    parsed = parse_manifest(raw)
    errors = list(parsed.errors)
    try:
        _, terms = parse_term_metadata(raw, record.project_id, record.question)
    except ValueError as exc:
        terms = []
        errors.append(str(exc))
    return {"terms": terms, "handoff": handoff, "manifest": parsed.manifest,
            "metadata_status": "invalid" if errors else "validated" if parsed.manifest else "missing",
            "content_status": "draft" if errors or not parsed.manifest else "published",
            "errors": errors}
