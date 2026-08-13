"""Tests for stuck-generation-task recovery: streaming total timeout,
stale-task watchdog, and startup cleanup of orphaned running tasks."""
from __future__ import annotations

import asyncio
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from app.services.llm_client import stream_openai_compatible_chat


def _setup_workspace():
    import app.core.config as cfg
    import app.services.storage as storage

    tmpdir = tempfile.TemporaryDirectory()
    workspace = Path(tmpdir.name)
    cfg.DB_PATH = workspace / "app.db"
    cfg.WORKSPACE_ROOT = workspace
    cfg.REPOS_ROOT = workspace / "repos"
    cfg.GENERATED_ROOT = workspace / "generated"
    storage.DB_PATH = cfg.DB_PATH
    storage.WORKSPACE_ROOT = cfg.WORKSPACE_ROOT
    storage.REPOS_ROOT = cfg.REPOS_ROOT
    storage.GENERATED_ROOT = cfg.GENERATED_ROOT
    storage.init_storage()
    return tmpdir


def _create_task(storage, project_id: int, status: str, updated_minutes_ago: int) -> int:
    import app.services.storage as storage_mod

    task = storage_mod.create_generation_task(
        project_id=project_id,
        task_type="outline_lesson",
        input_hash="hash",
        prompt_version="1",
        status=status,
    )
    now = datetime.now(timezone.utc)
    updated = (now - timedelta(minutes=updated_minutes_ago)).isoformat()
    with storage_mod._connect() as conn:
        conn.execute(
            "UPDATE generation_tasks SET updated_at = ? WHERE id = ?",
            (updated, task.id),
        )
        conn.commit()
    return task.id


class StreamingTotalTimeoutTests(unittest.TestCase):
    @patch("app.services.llm_client._TOTAL_TIMEOUT_BUFFER_SECONDS", 0)
    @patch("app.services.llm_client._async_client")
    def test_stream_hits_overall_deadline_when_stalled(self, async_client_factory: MagicMock) -> None:
        """A stream that trickles data forever must be cut off by the overall deadline."""
        async def _lines():
            yield 'data: {"choices":[{"delta":{"content":"你"}}]}'
            # 之后永远停滞：不再 yield，模拟服务端挂起
            await asyncio.sleep(3600)

        response = MagicMock()
        response.status_code = 200
        response.headers = {"content-type": "text/event-stream"}
        response.aiter_lines = _lines

        cm = MagicMock()
        cm.__aenter__ = AsyncMock(return_value=response)
        cm.__aexit__ = AsyncMock(return_value=False)
        client = MagicMock()
        client.stream.return_value = cm
        async_client_factory.return_value = client

        async def consume():
            async for _ in stream_openai_compatible_chat("http://x", "k", "m", [{"role": "user", "content": "hi"}], timeout=2):
                pass

        with self.assertRaisesRegex(RuntimeError, "exceeded overall deadline"):
            asyncio.run(consume())

        # httpx 超时仍保持 read=timeout（每阶段），整体截止由 asyncio.timeout 承担
        passed = client.stream.call_args.kwargs["timeout"]
        self.assertEqual(passed.read, 2)


class WatchdogTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = _setup_workspace()
        from app.main import app
        from fastapi.testclient import TestClient

        self.client = TestClient(app)
        self.project = self.client.post("/api/projects/learning-plan", json={"name": "Watchdog test"}).json()
        self.project_id = self.project["id"]

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_fails_stale_running_tasks_only(self):
        import app.services.storage as storage

        stale = _create_task(storage, self.project_id, "running", updated_minutes_ago=20)
        fresh = _create_task(storage, self.project_id, "running", updated_minutes_ago=1)
        done = _create_task(storage, self.project_id, "completed", updated_minutes_ago=30)

        marked = storage.fail_stale_generation_tasks(timeout_minutes=15)
        self.assertEqual(marked, 1)

        self.assertEqual(storage.get_generation_task(stale).status, "failed")
        self.assertIn("生成超时", storage.get_generation_task(stale).error_message)
        self.assertEqual(storage.get_generation_task(fresh).status, "running")
        self.assertEqual(storage.get_generation_task(done).status, "completed")

    def test_no_stale_tasks_returns_zero(self):
        import app.services.storage as storage

        _create_task(storage, self.project_id, "running", updated_minutes_ago=1)
        marked = storage.fail_stale_generation_tasks(timeout_minutes=15)
        self.assertEqual(marked, 0)


class StartupCleanupTests(unittest.TestCase):
    def test_orphaned_running_task_is_failed_at_startup(self):
        tmpdir = _setup_workspace()
        try:
            import app.services.storage as storage

            project = storage.create_learning_plan_project(
                name="Startup cleanup", local_path=Path(tmpdir.name) / "repo"
            )
            task = storage.create_generation_task(
                project_id=project.id,
                task_type="outline_lesson",
                input_hash="hash",
                prompt_version="1",
                status="running",
            )
            # Simulate an orphaned running task from a previous dead backend.
            with storage._connect() as conn:
                conn.execute("UPDATE generation_tasks SET updated_at = ? WHERE id = ?",
                             ((datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(), task.id))
                conn.commit()

            from app.main import app
            from fastapi.testclient import TestClient

            with TestClient(app) as client:
                pass

            result = storage.get_generation_task(task.id)
            self.assertEqual(result.status, "failed")
            self.assertIn("上次生成中断", result.error_message)
        finally:
            tmpdir.cleanup()


if __name__ == "__main__":
    unittest.main()
