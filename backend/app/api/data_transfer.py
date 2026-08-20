from __future__ import annotations

import io
import sqlite3

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.services.data_transfer import (
    MAX_ARCHIVE_BYTES,
    DataTransferBusy,
    DataTransferError,
    export_data_archive,
    import_data_archive,
)


router = APIRouter(prefix="/api/data-transfer", tags=["data-transfer"])


@router.get("/export")
def export_archive() -> StreamingResponse:
    try:
        payload, filename = export_data_archive()
    except DataTransferBusy as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except DataTransferError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return StreamingResponse(
        io.BytesIO(payload),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(payload)),
        },
    )


@router.post("/import")
async def import_archive(request: Request) -> dict[str, object]:
    try:
        declared_length = int(request.headers.get("content-length") or 0)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="数据包长度无效。") from error
    if declared_length > MAX_ARCHIVE_BYTES:
        raise HTTPException(status_code=413, detail="CodeCourse 数据包超过 250 MB。")
    payload = await request.body()
    try:
        return import_data_archive(payload)
    except DataTransferBusy as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except DataTransferError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except (OSError, sqlite3.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail=f"数据包导入失败：{error}") from error
