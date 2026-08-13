"""Periodic sweep that fails generation tasks stuck in 'running'.

A running task whose progress hasn't updated for longer than the threshold
(LLM stream silently stalled, thread wedged, backend killed mid-request)
would otherwise stay visible as "生成中" forever."""

from __future__ import annotations

import asyncio
import logging

from app.services.storage import fail_stale_generation_tasks

LOGGER = logging.getLogger(__name__)

WATCHDOG_INTERVAL_SECONDS = 60
STALE_TIMEOUT_MINUTES = 15

_watchdog_task: asyncio.Task | None = None


async def _sweep_loop() -> None:
    while True:
        try:
            marked = fail_stale_generation_tasks(STALE_TIMEOUT_MINUTES)
            if marked:
                LOGGER.warning("watchdog marked %d stale generation task(s) as failed", marked)
        except Exception:  # noqa: BLE001 - watchdog must never die
            LOGGER.exception("watchdog sweep failed")
        await asyncio.sleep(WATCHDOG_INTERVAL_SECONDS)


def start_watchdog() -> None:
    global _watchdog_task
    if _watchdog_task is None or _watchdog_task.done():
        _watchdog_task = asyncio.create_task(_sweep_loop())


async def stop_watchdog() -> None:
    global _watchdog_task
    task = _watchdog_task
    _watchdog_task = None
    if task is not None and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
