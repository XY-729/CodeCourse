from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.models.schemas import (
    LearningAnchorRequest,
    LearningAnchorResponse,
    QAAskRequest,
    QAFavoriteRequest,
    QARecordResponse,
    QAUpdateRequest,
    RetrievalSourceResponse,
)
from app.services.qa_service import (
    ask_question,
    edit_record,
    favorite_record,
    read_record,
    read_session_tree,
    read_understanding,
    remove_understanding,
    save_understanding,
    search_records,
    finalize_question,
    prepare_question,
)
from app.services.llm_client import stream_openai_compatible_chat
from app.services.storage import LearningAnchor, QARecord, get_project, get_qa_record

router = APIRouter(prefix="/api/projects", tags=["qa"])
_PROJECT_SEMAPHORES: dict[int, asyncio.Semaphore] = {}
_SESSION_LOCKS: dict[tuple[int, int], asyncio.Lock] = {}


def _project_semaphore(project_id: int) -> asyncio.Semaphore:
    return _PROJECT_SEMAPHORES.setdefault(project_id, asyncio.Semaphore(2))


def _session_lock(project_id: int, session_id: Optional[int]) -> Optional[asyncio.Lock]:
    if session_id is None:
        return None
    return _SESSION_LOCKS.setdefault((project_id, session_id), asyncio.Lock())


def _requested_session_id(project_id: int, payload: QAAskRequest) -> Optional[int]:
    if payload.parent_qa_id:
        parent = get_qa_record(project_id, payload.parent_qa_id)
        if parent and parent.session_id:
            return parent.session_id
    return payload.session_id


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _require_project(project_id: int) -> None:
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if not Path(project.local_path).exists():
        raise HTTPException(status_code=404, detail="Project directory not found")


def _to_response(record: QARecord) -> QARecordResponse:
    try:
        raw_sources = json.loads(record.retrieval_sources_json or "[]")
    except (json.JSONDecodeError, TypeError):
        raw_sources = []
    retrieval_sources = []
    if isinstance(raw_sources, list):
        for source in raw_sources:
            if not isinstance(source, dict):
                continue
            try:
                retrieval_sources.append(RetrievalSourceResponse.model_validate(source))
            except Exception:
                continue
    return QARecordResponse(
        id=record.id,
        project_id=record.project_id,
        session_id=record.session_id,
        parent_qa_id=record.parent_qa_id,
        relation_type=record.relation_type,
        source_type=record.source_type,
        source_path=record.source_path,
        display_title=record.display_title,
        selected_text=record.selected_text,
        question=record.question,
        answer_md=record.answer_md,
        provider=record.provider,
        model=record.model,
        output_path=record.output_path,
        retrieval_trace=record.retrieval_trace,
        retrieval_sources=retrieval_sources,
        favorite=record.favorite,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _anchor_response(anchor: LearningAnchor) -> LearningAnchorResponse:
    return LearningAnchorResponse(**anchor.__dict__)


@router.post("/{project_id}/qa/ask", response_model=QARecordResponse)
async def ask(project_id: int, payload: QAAskRequest) -> QARecordResponse:
    _require_project(project_id)
    try:
        session_id = await asyncio.to_thread(_requested_session_id, project_id, payload)
        lock = _session_lock(project_id, session_id)
        async with _project_semaphore(project_id):
            if lock is None:
                record = await asyncio.to_thread(ask_question, project_id, payload)
            else:
                async with lock:
                    record = await asyncio.to_thread(ask_question, project_id, payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _to_response(record)


@router.post("/{project_id}/qa/stream")
async def ask_stream(project_id: int, payload: QAAskRequest) -> StreamingResponse:
    _require_project(project_id)

    async def generate():
        yield _sse("stage", {"stage": "queued", "label": "等待生成位置"})
        try:
            requested_session_id = await asyncio.to_thread(_requested_session_id, project_id, payload)
            lock = _session_lock(project_id, requested_session_id)
            async with _project_semaphore(project_id):
                async def run_stream():
                    yield _sse("stage", {"stage": "retrieving", "label": "检索上下文"})
                    prepared = await asyncio.to_thread(prepare_question, project_id, payload)
                    if prepared.existing_record is not None:
                        yield _sse("completed", _to_response(prepared.existing_record).model_dump(mode="json"))
                        return
                    yield _sse("stage", {"stage": "waiting_model", "label": "等待模型"})
                    chunks: list[str] = []
                    emitted_answer_stage = False
                    async for chunk in stream_openai_compatible_chat(
                        prepared.settings["base_url"],
                        prepared.settings["api_key"],
                        prepared.settings["model"],
                        prepared.messages,
                        timeout=90,
                    ):
                        if not emitted_answer_stage:
                            emitted_answer_stage = True
                            yield _sse("stage", {"stage": "answering", "label": "正在回答"})
                        chunks.append(chunk)
                        yield _sse("delta", {"text": chunk})
                    yield _sse("stage", {"stage": "saving", "label": "保存记录"})
                    record = await asyncio.to_thread(finalize_question, prepared, "".join(chunks))
                    yield _sse("completed", _to_response(record).model_dump(mode="json"))

                if lock is None:
                    async for event in run_stream():
                        yield event
                else:
                    async with lock:
                        async for event in run_stream():
                            yield event
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            yield _sse("error", {"message": str(exc)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{project_id}/qa", response_model=list[QARecordResponse])
def list_history(
    project_id: int,
    query: str = "",
    favorite: Optional[bool] = Query(default=None),
) -> list[QARecordResponse]:
    _require_project(project_id)
    return [_to_response(record) for record in search_records(project_id, query=query, favorite=favorite)]


@router.get("/{project_id}/qa/sessions/{session_id}/tree", response_model=list[QARecordResponse])
def get_session_tree(project_id: int, session_id: int) -> list[QARecordResponse]:
    _require_project(project_id)
    return [_to_response(record) for record in read_session_tree(project_id, session_id)]


@router.get("/{project_id}/qa/{qa_id}", response_model=QARecordResponse)
def get_history_item(project_id: int, qa_id: int) -> QARecordResponse:
    _require_project(project_id)
    record = read_record(project_id, qa_id)
    if record is None:
        raise HTTPException(status_code=404, detail="QA record not found")
    return _to_response(record)


@router.put("/{project_id}/qa/{qa_id}", response_model=QARecordResponse)
def update_history_item(project_id: int, qa_id: int, payload: QAUpdateRequest) -> QARecordResponse:
    _require_project(project_id)
    record = edit_record(project_id, qa_id, payload.question, payload.answer_md, payload.display_title)
    if record is None:
        raise HTTPException(status_code=404, detail="QA record not found")
    return _to_response(record)


@router.post("/{project_id}/qa/{qa_id}/favorite", response_model=QARecordResponse)
def toggle_favorite(project_id: int, qa_id: int, payload: QAFavoriteRequest) -> QARecordResponse:
    _require_project(project_id)
    record = favorite_record(project_id, qa_id, payload.favorite)
    if record is None:
        raise HTTPException(status_code=404, detail="QA record not found")
    return _to_response(record)


@router.get("/{project_id}/qa/{qa_id}/understanding", response_model=LearningAnchorResponse)
def get_understanding(project_id: int, qa_id: int) -> LearningAnchorResponse:
    _require_project(project_id)
    anchor = read_understanding(project_id, qa_id)
    if anchor is None:
        raise HTTPException(status_code=404, detail="Learning anchor not found")
    return _anchor_response(anchor)


@router.post("/{project_id}/qa/{qa_id}/understanding", response_model=LearningAnchorResponse)
def put_understanding(project_id: int, qa_id: int, payload: LearningAnchorRequest) -> LearningAnchorResponse:
    _require_project(project_id)
    try:
        anchor = save_understanding(project_id, qa_id, payload.summary, payload.term_text)
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _anchor_response(anchor)


@router.delete("/{project_id}/qa/{qa_id}/understanding")
def delete_understanding(project_id: int, qa_id: int):
    _require_project(project_id)
    if not remove_understanding(project_id, qa_id):
        raise HTTPException(status_code=404, detail="Learning anchor not found")
    return {"deleted": True, "qa_id": qa_id}


@router.delete("/{project_id}/qa/{qa_id}")
def delete_history_item(project_id: int, qa_id: int):
    _require_project(project_id)
    from app.services.qa_service import delete_record
    deleted = delete_record(project_id, qa_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="QA record not found")
    return {"deleted": True, "id": qa_id}
