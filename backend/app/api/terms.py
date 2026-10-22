from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import DocumentTermResponse, TermScanStatusResponse
from app.services.storage import DocumentTerm, get_project, update_document_term_status
from app.services.term_service import (
    ensure_document_terms,
    get_document_term_status,
    rescan_document_terms,
)


router = APIRouter(prefix="/api/projects", tags=["terms"])


def _response(term: DocumentTerm) -> DocumentTermResponse:
    return DocumentTermResponse(**term.__dict__)


def _require_project(project_id: int) -> None:
    if get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")


@router.get("/{project_id}/terms", response_model=list[DocumentTermResponse])
def list_terms(
    project_id: int,
    source_type: str = Query(min_length=1, max_length=20),
    source_path: str = Query(min_length=1, max_length=1000),
) -> list[DocumentTermResponse]:
    _require_project(project_id)
    if source_type not in {"course", "qa"}:
        raise HTTPException(status_code=400, detail="Terms are only supported for course and qa documents")
    legacy = ensure_document_terms(project_id, source_type, source_path)
    from app.services.term_service import get_document_term_annotations
    try:
        annotations = get_document_term_annotations(project_id, source_type, source_path)
    except ValueError:
        # Tree/document changed while reading: the historical text list stays a
        # safe fallback rather than failing the reader.
        annotations = None
    if not annotations or not annotations.get("candidates"):
        # Documents without a v2 manifest only have the historical text-keyed
        # candidates; that table is still the only record for them.
        return [_response(term) for term in legacy]
    # The authoritative candidate set is the span- and identity-keyed sidecar;
    # the legacy text-unique table only contributes ids/status for actions.
    legacy_by_identity: dict[tuple[str, str], DocumentTerm] = {}
    legacy_by_text: dict[str, DocumentTerm] = {}
    for term in legacy:
        legacy_by_identity.setdefault((term.term_text, term.concept_id or ""), term)
        legacy_by_text.setdefault(term.term_text, term)
    items: list[DocumentTermResponse] = []
    for candidate in annotations.get("candidates", []):
        concept_id = candidate.get("concept_id")
        text = str(candidate.get("text") or "")
        row = legacy_by_identity.get((text, concept_id or ""))
        same_concept = row is not None and (row.concept_id or "") == (concept_id or "")
        if same_concept and row.status == "dismissed":
            continue
        span = candidate.get("source_span") or {}
        items.append(DocumentTermResponse(
            id=row.id if same_concept else 0,
            project_id=project_id,
            source_type=source_type,
            source_path=source_path,
            term_text=text,
            detection_source=str(candidate.get("source") or "teaching_manifest_v2"),
            confidence=float(row.confidence) if same_concept else 0.95,
            status=row.status if same_concept else "candidate",
            concept_id=concept_id,
            content_hash=annotations.get("content_hash"),
            canonical_name=(row.canonical_name if same_concept else None) or text,
            category=(row.category if same_concept else None) or "concept",
            source_span=dict(span),
            quote=candidate.get("quote"),
            familiarity=candidate.get("familiarity"),
            offer_explanation=candidate.get("offer_explanation"),
            tree_snapshot=annotations.get("tree_snapshot"),
            link_origin=(row.link_origin if same_concept else None) or "automatic",
            created_at=row.created_at if same_concept else "",
            updated_at=row.updated_at if same_concept else "",
        ))
    return items


def _validate_source(source_type: str) -> None:
    if source_type not in {"course", "qa"}:
        raise HTTPException(status_code=400, detail="Terms are only supported for course and qa documents")


@router.get("/{project_id}/terms/status", response_model=TermScanStatusResponse)
def term_status(
    project_id: int,
    source_type: str = Query(min_length=1, max_length=20),
    source_path: str = Query(min_length=1, max_length=1000),
) -> TermScanStatusResponse:
    _require_project(project_id)
    _validate_source(source_type)
    return TermScanStatusResponse(**get_document_term_status(project_id, source_type, source_path))


@router.post("/{project_id}/terms/rescan", response_model=TermScanStatusResponse)
def rescan_terms(
    project_id: int,
    source_type: str = Query(min_length=1, max_length=20),
    source_path: str = Query(min_length=1, max_length=1000),
) -> TermScanStatusResponse:
    _require_project(project_id)
    _validate_source(source_type)
    return TermScanStatusResponse(**rescan_document_terms(project_id, source_type, source_path))


def _set_status(project_id: int, term_id: int, status: str) -> DocumentTermResponse:
    _require_project(project_id)
    term = update_document_term_status(project_id, term_id, status)
    if term is None:
        raise HTTPException(status_code=404, detail="Term candidate not found")
    return _response(term)


@router.post("/{project_id}/terms/{term_id}/known", response_model=DocumentTermResponse)
def mark_known(project_id: int, term_id: int) -> DocumentTermResponse:
    return _set_status(project_id, term_id, "known")


@router.post("/{project_id}/terms/{term_id}/dismiss", response_model=DocumentTermResponse)
def dismiss(project_id: int, term_id: int) -> DocumentTermResponse:
    return _set_status(project_id, term_id, "dismissed")
