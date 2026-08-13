from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import course, files, highlights, index, knowledge, learning, personalization, projects, qa, settings, terms
from app.services.storage import init_storage

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_storage()
    from app.services.personalization.interaction_observer import (
        recover_pending_observer_jobs,
        shutdown_observer,
    )
    from app.services.storage import fail_stale_generation_tasks
    from app.services.task_watchdog import start_watchdog, stop_watchdog

    recover_pending_observer_jobs()
    marked = fail_stale_generation_tasks(
        timeout_minutes=0,
        error_message="上次生成中断，请重新生成",
    )
    if marked:
        logger.warning("startup cleanup: %d orphaned running task(s) marked as failed", marked)
    start_watchdog()
    yield
    await stop_watchdog()
    shutdown_observer(wait=False)


app = FastAPI(title="GitHub Project Learner", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://0.0.0.0:5173", "null"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(files.router)
app.include_router(course.router)
app.include_router(qa.router)
app.include_router(highlights.router)
app.include_router(index.router)
app.include_router(knowledge.router)
app.include_router(learning.router)
app.include_router(terms.router)
app.include_router(personalization.router)
app.include_router(settings.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
