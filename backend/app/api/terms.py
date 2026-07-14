from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import DocumentTermResponse
from app.services.storage import DocumentTerm, get_project, update_document_term_status
from app.services.term_service import ensure_document_terms


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
    return [_response(term) for term in ensure_document_terms(project_id, source_type, source_path)]


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
