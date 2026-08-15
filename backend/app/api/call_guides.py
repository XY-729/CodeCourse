from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    CallGuideCreateRequest,
    CallGuideResolveRequest,
    CallGuideResolveResponse,
    CallGuideResponse,
    CallGuideUpdateRequest,
)
from app.services.call_guide_service import (
    CallGuideError,
    create_persisted_call_guide,
    delete_persisted_call_guide,
    get_persisted_call_guide,
    list_persisted_call_guides,
    refresh_persisted_call_guide,
    resolve_call_guide_candidates,
    update_persisted_call_guide,
)

router = APIRouter(prefix="/api/projects", tags=["call-guides"])


def _bad_request(exc: CallGuideError) -> HTTPException:
    return HTTPException(status_code=409, detail=str(exc))


@router.post("/{project_id}/call-guides/resolve", response_model=CallGuideResolveResponse)
def resolve(project_id: int, payload: CallGuideResolveRequest) -> CallGuideResolveResponse:
    try:
        result = resolve_call_guide_candidates(
            project_id,
            source_path=payload.source_path,
            line=payload.line,
            selected_text=payload.selected_text,
            symbol_name=payload.symbol_name,
            qualified_name=payload.qualified_name,
        )
        return CallGuideResolveResponse.model_validate(result)
    except CallGuideError as exc:
        raise _bad_request(exc) from exc


@router.post("/{project_id}/call-guides", response_model=CallGuideResponse)
def create(project_id: int, payload: CallGuideCreateRequest) -> CallGuideResponse:
    try:
        return CallGuideResponse.model_validate(
            create_persisted_call_guide(project_id, payload.root, payload.title)
        )
    except CallGuideError as exc:
        raise _bad_request(exc) from exc


@router.get("/{project_id}/call-guides", response_model=list[CallGuideResponse])
def list_guides(project_id: int) -> list[CallGuideResponse]:
    return [CallGuideResponse.model_validate(item) for item in list_persisted_call_guides(project_id)]


@router.get("/{project_id}/call-guides/{guide_id}", response_model=CallGuideResponse)
def get_guide(project_id: int, guide_id: int) -> CallGuideResponse:
    guide = get_persisted_call_guide(project_id, guide_id)
    if guide is None:
        raise HTTPException(status_code=404, detail="调用链导览不存在")
    return CallGuideResponse.model_validate(guide)


@router.patch("/{project_id}/call-guides/{guide_id}", response_model=CallGuideResponse)
def update(project_id: int, guide_id: int, payload: CallGuideUpdateRequest) -> CallGuideResponse:
    try:
        guide = update_persisted_call_guide(
            project_id,
            guide_id,
            title=payload.title,
            current_node_id=payload.current_node_id,
            visited_node_ids=payload.visited_node_ids,
        )
    except CallGuideError as exc:
        raise _bad_request(exc) from exc
    if guide is None:
        raise HTTPException(status_code=404, detail="调用链导览不存在")
    return CallGuideResponse.model_validate(guide)


@router.delete("/{project_id}/call-guides/{guide_id}")
def delete(project_id: int, guide_id: int) -> dict[str, str]:
    if not delete_persisted_call_guide(project_id, guide_id):
        raise HTTPException(status_code=404, detail="调用链导览不存在")
    return {"status": "deleted"}


@router.post("/{project_id}/call-guides/{guide_id}/refresh", response_model=CallGuideResponse)
def refresh(project_id: int, guide_id: int) -> CallGuideResponse:
    try:
        guide = refresh_persisted_call_guide(project_id, guide_id)
    except CallGuideError as exc:
        raise _bad_request(exc) from exc
    if guide is None:
        raise HTTPException(status_code=404, detail="调用链导览不存在")
    return CallGuideResponse.model_validate(guide)
