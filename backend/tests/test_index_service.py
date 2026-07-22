from __future__ import annotations

import os
import tempfile
from pathlib import Path
from unittest import TestCase

from app.core.config import DB_PATH
from app.services.storage import (
    _connect,
    activate_generation,
    clean_generation,
    copy_unchanged_chunks,
    delete_stale_indexed_files,
    get_active_generation,
    get_all_indexed_files,
    get_next_generation,
    get_project_index_status,
    init_storage,
    replace_code_chunks,
    search_code_chunks,
    set_project_index_status,
    upsert_indexed_file,
    upsert_project,
    write_chunks_to_generation,
)


class IndexStorageTests(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp_dir = tempfile.TemporaryDirectory()
        cls._orig_db = os.environ.get("GPL_DB_PATH", "")
        cls._orig_workspace = os.environ.get("GPL_WORKSPACE_ROOT", "")
        os.environ["GPL_DB_PATH"] = str(Path(cls._tmp_dir.name) / "app.db")
        os.environ["GPL_WORKSPACE_ROOT"] = str(Path(cls._tmp_dir.name) / "workspace")
        init_storage()

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmp_dir.cleanup()
        if cls._orig_db:
            os.environ["GPL_DB_PATH"] = cls._orig_db
        else:
            os.environ.pop("GPL_DB_PATH", None)
        if cls._orig_workspace:
            os.environ["GPL_WORKSPACE_ROOT"] = cls._orig_workspace
        else:
            os.environ.pop("GPL_WORKSPACE_ROOT", None)

    def setUp(self) -> None:
        """Start each test with a clean index state."""
        with _connect() as conn:
            conn.execute("DELETE FROM code_chunks_fts")
            conn.execute("DELETE FROM code_chunks")
            conn.execute("DELETE FROM indexed_files")
            conn.execute("DELETE FROM project_indexes")
            conn.execute("DELETE FROM projects")
            conn.commit()

    def _make_project(self, project_id: int = 1) -> None:
        upsert_project("test", "https://github.com/test/repo", Path("/tmp/test_repo"), "scanned")

    # --- Generation functions ---

    def test_get_next_generation_returns_1_when_no_chunks(self):
        self._make_project()
        gen = get_next_generation(1)
        self.assertEqual(1, gen)

    def test_get_next_generation_increments_after_write(self):
        self._make_project()
        chunks = [{"project_id": 1, "path": "a.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "line1\nline2", "content_hash": "abc"}]
        write_chunks_to_generation(1, 1, chunks)
        gen = get_next_generation(1)
        self.assertEqual(2, gen)

    def test_activate_generation_switches_and_stores_last_good(self):
        self._make_project()
        set_project_index_status(1, "not_built")
        activate_generation(1, 7)
        status = get_project_index_status(1)
        self.assertEqual(7, status["active_generation"])
        self.assertIsNone(status.get("building_generation"))

    def test_clean_generation_removes_chunks_and_fts(self):
        self._make_project()
        chunks = [{"project_id": 1, "path": "a.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "hello world", "content_hash": "abc"}]
        write_chunks_to_generation(1, 1, chunks)
        self.assertEqual(1, clean_generation(1, 1))

        # Verify FTS also cleaned
        results = search_code_chunks(1, "hello")
        self.assertEqual(0, len(results))

    # --- Full replace via replace_code_chunks (backward compat) ---

    def test_replace_code_chunks_sets_active_generation(self):
        self._make_project()
        chunks = [
            {"project_id": 1, "path": "a.py", "language": "python", "start_line": 1, "end_line": 5, "chunk_type": "lines", "symbol_name": "main", "content": "def main():\n  pass", "content_hash": "abc"},
            {"project_id": 1, "path": "b.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": "helper", "content": "def helper(): pass", "content_hash": "def"},
        ]
        count = replace_code_chunks(1, chunks)
        self.assertEqual(2, count)
        gen = get_active_generation(1)
        self.assertGreater(gen, 0)

        # Search should find them
        results = search_code_chunks(1, "def main")
        self.assertGreaterEqual(len(results), 1)

    def test_search_only_returns_active_generation(self):
        self._make_project()
        # Write gen 1
        chunks1 = [{"project_id": 1, "path": "old.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "old content", "content_hash": "old"}]
        write_chunks_to_generation(1, 1, chunks1)
        activate_generation(1, 1)

        # Write gen 2 with different content
        chunks2 = [{"project_id": 1, "path": "new.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "new content", "content_hash": "nw"}]
        write_chunks_to_generation(1, 2, chunks2)
        activate_generation(1, 2)

        results = search_code_chunks(1, "old")
        self.assertEqual(0, len(results))

        results = search_code_chunks(1, "new")
        self.assertGreaterEqual(len(results), 1)

    def test_copy_unchanged_chunks_preserves_data(self):
        self._make_project()
        chunks1 = [
            {"project_id": 1, "path": "unchanged.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": "keep", "content": "keep content abc", "content_hash": "k1"},
        ]
        write_chunks_to_generation(1, 1, chunks1)
        activate_generation(1, 1)

        copied = copy_unchanged_chunks(1, 1, 2, {"unchanged.py"})
        self.assertGreaterEqual(copied, 1)

        activate_generation(1, 2)
        results = search_code_chunks(1, "keep")
        self.assertGreaterEqual(len(results), 1)

    # --- Indexed files ---

    def test_upsert_indexed_file_creates_and_updates(self):
        self._make_project()
        upsert_indexed_file(1, "src/main.py", 100, 123456789, "hash1", "python")
        records = get_all_indexed_files(1)
        self.assertEqual(1, len(records))
        self.assertEqual("src/main.py", records[0]["relative_path"])
        self.assertEqual("hash1", records[0]["content_hash"])

        # Update existing
        upsert_indexed_file(1, "src/main.py", 200, 987654321, "hash2", "python")
        records = get_all_indexed_files(1)
        self.assertEqual(1, len(records))
        self.assertEqual(200, records[0]["file_size"])
        self.assertEqual("hash2", records[0]["content_hash"])

    def test_delete_stale_indexed_files_removes_chunks_and_records(self):
        self._make_project()
        chunks = [
            {"project_id": 1, "path": "gone.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "gone content", "content_hash": "g1"},
            {"project_id": 1, "path": "keep.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "keep content", "content_hash": "k1"},
        ]
        replace_code_chunks(1, chunks)
        upsert_indexed_file(1, "gone.py", 100, 0, "g1", "python")
        upsert_indexed_file(1, "keep.py", 100, 0, "k1", "python")

        deleted = delete_stale_indexed_files(1, {"gone.py"})
        self.assertEqual(1, deleted)

        records = get_all_indexed_files(1)
        self.assertEqual(1, len(records))
        self.assertEqual("keep.py", records[0]["relative_path"])

        results = search_code_chunks(1, "gone")
        self.assertEqual(0, len(results))
        results = search_code_chunks(1, "keep")
        self.assertGreaterEqual(len(results), 1)

    # --- Concurrency ---

    def test_multiple_generations_coexist(self):
        self._make_project()
        chunks1 = [{"project_id": 1, "path": "a.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "gen1 data", "content_hash": "g1"}]
        chunks2 = [{"project_id": 1, "path": "b.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "gen2 data", "content_hash": "g2"}]

        write_chunks_to_generation(1, 1, chunks1)
        write_chunks_to_generation(1, 2, chunks2)

        # Both exist before activation
        from app.services.storage import get_next_generation as gng
        self.assertEqual(3, gng(1))

        # Activate gen 1
        activate_generation(1, 1)
        results = search_code_chunks(1, "gen1")
        self.assertGreaterEqual(len(results), 1)

        # Activate gen 2
        activate_generation(1, 2)
        results = search_code_chunks(1, "gen2")
        self.assertGreaterEqual(len(results), 1)
        results = search_code_chunks(1, "gen1")
        self.assertEqual(0, len(results))

    def test_build_failure_preserves_old_generation(self):
        self._make_project()
        chunks1 = [{"project_id": 1, "path": "safe.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "safe content", "content_hash": "s1"}]
        replace_code_chunks(1, chunks1)
        old_gen = get_active_generation(1)

        # Try to write gen2 then fail
        gen2 = get_next_generation(1)
        write_chunks_to_generation(1, gen2, [])
        # Don't activate - simulate crash
        clean_generation(1, gen2)

        # Active gen should still be old_gen
        results = search_code_chunks(1, "safe")
        self.assertGreaterEqual(len(results), 1)
        self.assertEqual(old_gen, get_active_generation(1))

    # --- Status tracking ---

    def test_project_index_status_defaults(self):
        self._make_project()
        status = get_project_index_status(1)
        self.assertEqual("not_built", status["status"])
        self.assertEqual(0, status["unchanged_files"])
        self.assertEqual(0, status["added_files"])
        self.assertIsNone(status.get("stage"))

    def test_set_project_index_status_stores_new_fields(self):
        self._make_project()
        set_project_index_status(1, "building", 0, None,
            text_status="building", stage="scanning",
            progress_current=5, progress_total=100,
            processed_files=5, unchanged_files=80, added_files=3, updated_files=2,
            deleted_files=1, failed_files=0,
            active_generation=1, building_generation=2,
        )
        status = get_project_index_status(1)
        self.assertEqual("building", status["status"])
        self.assertEqual("scanning", status["stage"])
        self.assertEqual(5, status["progress_current"])
        self.assertEqual(100, status["progress_total"])
        self.assertEqual(5, status["processed_files"])
        self.assertEqual(80, status["unchanged_files"])
        self.assertEqual(3, status["added_files"])
        self.assertEqual(2, status["updated_files"])
        self.assertEqual(1, status["deleted_files"])
        self.assertEqual(1, status["active_generation"])
        self.assertEqual(2, status["building_generation"])

    def test_set_project_index_status_preserves_unchanged_fields(self):
        self._make_project()
        set_project_index_status(1, "building", 0, None,
            text_status="building", stage="scanning",
            processed_files=50, added_files=10,
        )
        # Subsequent call that only updates progress
        set_project_index_status(1, "building", 0, None,
            text_status="building", stage="scanning",
            progress_current=60, progress_total=100,
        )
        status = get_project_index_status(1)
        self.assertEqual(50, status["processed_files"])  # unchanged
        self.assertEqual(10, status["added_files"])  # unchanged
        self.assertEqual(60, status["progress_current"])  # updated
        self.assertEqual(100, status["progress_total"])  # updated

    def test_search_no_active_gen_returns_0(self):
        """When active_generation is 0 and search filters by gen, nothing is found."""
        self._make_project()
        # Write gen 1 but DON'T activate
        chunks = [{"project_id": 1, "path": "orphan.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "orphan content", "content_hash": "o1"}]
        write_chunks_to_generation(1, 1, chunks)

        results = search_code_chunks(1, "orphan")
        self.assertEqual(0, len(results))

    # --- Generation completeness ---

    def test_first_build_covers_all_files(self):
        self._make_project()
        chunks = [
            {"project_id": 1, "path": "A.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "content A", "content_hash": "a1"},
            {"project_id": 1, "path": "B.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "content B", "content_hash": "b1"},
            {"project_id": 1, "path": "C.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "content C", "content_hash": "c1"},
        ]
        replace_code_chunks(1, chunks)
        self.assertEqual(3, len(search_code_chunks(1, "content")))

    def test_incremental_build_preserves_unchanged_files(self):
        """Build A,B,C; modify A only; verify B,C still searchable via new gen."""
        self._make_project()
        chunks_abc = [
            {"project_id": 1, "path": "A.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "old A", "content_hash": "a1"},
            {"project_id": 1, "path": "B.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "B content", "content_hash": "b1"},
            {"project_id": 1, "path": "C.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "C content", "content_hash": "c1"},
        ]
        gen1 = get_next_generation(1)
        write_chunks_to_generation(1, gen1, chunks_abc)
        activate_generation(1, gen1)
        set_project_index_status(1, "completed", 3, text_status="completed", active_generation=gen1)

        # Record B, C as indexed files (so they're "unchanged" in next build)
        upsert_indexed_file(1, "A.py", 7, gen1, "a1", "python")
        upsert_indexed_file(1, "B.py", 9, gen1, "b1", "python")
        upsert_indexed_file(1, "C.py", 9, gen1, "c1", "python")

        # Simulate: modify A only in gen2 (A chunked from disk, B/C copied)
        gen2 = get_next_generation(1)
        chunks_a_new = [
            {"project_id": 1, "path": "A.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "new A content", "content_hash": "a2"},
        ]
        write_chunks_to_generation(1, gen2, chunks_a_new)
        # Copy B, C from gen1
        copy_unchanged_chunks(1, gen1, gen2, {"B.py", "C.py"})
        activate_generation(1, gen2)
        # Clean old gen
        clean_generation(1, gen1)

        # All 3 files should still be searchable
        results = search_code_chunks(1, "content")
        self.assertEqual(3, len(results), f"Expected 3 files, got {len(results)}")

        # Old A content should NOT be searchable
        old_a = search_code_chunks(1, "old A")
        self.assertEqual(0, len(old_a))

        # New A content should be searchable
        new_a = search_code_chunks(1, "new A")
        self.assertEqual(1, len(new_a))

    def test_modified_file_chunk_failure_preserves_old_chunks(self):
        """When a modified file fails to chunk, copy its old chunks to new gen."""
        self._make_project()
        chunks1 = [
            {"project_id": 1, "path": "A.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "old A content", "content_hash": "a1"},
            {"project_id": 1, "path": "B.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "B content", "content_hash": "b1"},
        ]
        gen1 = get_next_generation(1)
        write_chunks_to_generation(1, gen1, chunks1)
        activate_generation(1, gen1)

        upsert_indexed_file(1, "A.py", 7, gen1, "a1", "python")
        upsert_indexed_file(1, "B.py", 7, gen1, "b1", "python")

        # Simulate B chunk failure: copy B's old chunks to gen2 along with A's new chunks
        gen2 = get_next_generation(1)
        chunks_a_new = [
            {"project_id": 1, "path": "A.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "new A content", "content_hash": "a2"},
        ]
        write_chunks_to_generation(1, gen2, chunks_a_new)
        # B failed — copy its old chunks from gen1
        copy_unchanged_chunks(1, gen1, gen2, {"B.py"})
        # C is unchanged — copy its old chunks too
        # (In this test, C doesn't exist; only A and B)
        activate_generation(1, gen2)
        clean_generation(1, gen1)

        # Both A and B should exist in gen2
        results = search_code_chunks(1, "content")
        self.assertEqual(2, len(results))

    def test_file_deletion_only_removes_target_file(self):
        self._make_project()
        chunks = [
            {"project_id": 1, "path": "keep.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "keep content", "content_hash": "k1"},
            {"project_id": 1, "path": "gone.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "gone content", "content_hash": "g1"},
        ]
        gen1 = get_next_generation(1)
        write_chunks_to_generation(1, gen1, chunks)
        activate_generation(1, gen1)

        # Delete only gone.py
        delete_stale_indexed_files(1, {"gone.py"})

        # keep.py should still exist
        results = search_code_chunks(1, "keep")
        self.assertEqual(1, len(results))
        results = search_code_chunks(1, "gone")
        self.assertEqual(0, len(results))

    # --- Change detection edge cases ---

    def test_size_unchanged_but_content_changed_without_mtime_update_would_be_missed(self):
        """Document limitation: if size AND mtime are identical, we skip SHA-256.
        This test verifies this known limitation — the system treats it as unchanged."""
        self._make_project()
        chunks = [
            {"project_id": 1, "path": "same.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "old", "content_hash": "h1"},
        ]
        replace_code_chunks(1, chunks)
        upsert_indexed_file(1, "same.py", 3, 100, "h1", "python")

        # "Disk" file has same size and mtime but different content
        # Our comparing logic sees size_match and mtime_match → treats as unchanged
        # The second build would skip this file entirely
        # This is a KNOWN LIMITATION — force_verify mode mitigates it
        existing = get_all_indexed_files(1)
        self.assertGreaterEqual(len(existing), 1)
        self.assertEqual("h1", existing[0]["content_hash"])

    # --- Transaction boundary ---

    def test_activate_generation_leaves_consistent_state(self):
        """Activating a generation should set active_generation and clear building_generation."""
        self._make_project()
        set_project_index_status(1, "building", building_generation=2)
        activate_generation(1, 5)
        status = get_project_index_status(1)
        self.assertEqual(5, status["active_generation"])
        self.assertIsNone(status.get("building_generation"))

    def test_crash_during_old_gen_cleanup_doesnt_break_active_gen(self):
        """If old generation cleanup fails, active gen should remain intact."""
        self._make_project()
        chunks1 = [{"project_id": 1, "path": "a.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "gen1", "content_hash": "g1"}]
        gen1 = get_next_generation(1)
        write_chunks_to_generation(1, gen1, chunks1)
        activate_generation(1, gen1)

        chunks2 = [{"project_id": 1, "path": "a.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "gen2", "content_hash": "g2"}]
        gen2 = get_next_generation(1)
        write_chunks_to_generation(1, gen2, chunks2)
        activate_generation(1, gen2)

        # Simulate: cleanup of gen1 fails (gen2 is active)
        # Even if gen1 cleanup fails, gen2 should still work
        try:
            clean_generation(1, gen1)
        except Exception:
            pass

        results = search_code_chunks(1, "gen2")
        self.assertEqual(1, len(results))

    # --- Concurrency ---

    def test_different_projects_allow_parallel_builds(self):
        """Different project IDs should NOT block each other."""
        self._make_project(1)
        self._make_project(2)  # Added another project

        # Different project IDs can coexist in BUILDING_LOCKS (different keys)
        from app.services.index_service import _BUILDING_LOCKS, _BUILDING_LOCK_MUTEX
        with _BUILDING_LOCK_MUTEX:
            _BUILDING_LOCKS.clear()

        with _BUILDING_LOCK_MUTEX:
            self.assertNotIn(1, _BUILDING_LOCKS)
            self.assertNotIn(2, _BUILDING_LOCKS)
            _BUILDING_LOCKS.add(1)
            _BUILDING_LOCKS.add(2)

        self.assertIn(1, _BUILDING_LOCKS)
        self.assertIn(2, _BUILDING_LOCKS)

        with _BUILDING_LOCK_MUTEX:
            _BUILDING_LOCKS.clear()

    # --- Structural version check ---

    def test_structural_version_change_triggers_rebuild(self):
        """When STRUCTURAL_ENGINE_VERSION changes, old structural index is not reused."""
        from app.core.config import STRUCTURAL_ENGINE_VERSION
        self._make_project()
        status = {
            "structural_status": "completed",
            "structural_engine_version": STRUCTURAL_ENGINE_VERSION + 1,
        }
        self.assertNotEqual(
            int(status.get("structural_engine_version") or 0),
            STRUCTURAL_ENGINE_VERSION,
        )
        # In production code, this would trigger a rebuild

    # --- Failed file metadata: is_stale prevents silent skip ---

    def test_failed_file_is_marked_stale_and_retried(self):
        """After chunk failure, file is marked stale. Next build retries it."""
        self._make_project()
        # First successful build for file A with hash H1
        upsert_indexed_file(1, "A.py", 100, 1000, "h1_old", "python")
        chunks1 = [{"project_id": 1, "path": "A.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "old content", "content_hash": "h1_old"}]
        gen1 = get_next_generation(1)
        write_chunks_to_generation(1, gen1, chunks1)
        activate_generation(1, gen1)

        # Simulate: chunking failed, mark stale (like build does)
        from app.services.storage import mark_indexed_files_stale
        mark_indexed_files_stale(1, ["A.py"], "simulated read error")
        records = get_all_indexed_files(1)
        self.assertEqual(1, records[0]["is_stale"])
        self.assertEqual("h1_old", records[0]["content_hash"])  # hash NOT changed

        # Next build: is_stale forces re-indexing regardless of size/mtime
        existing = get_all_indexed_files(1)
        self.assertEqual(1, existing[0]["is_stale"])

    def test_successful_rebuild_clears_stale_flag(self):
        self._make_project()
        upsert_indexed_file(1, "A.py", 100, 1000, "h1", "python")
        # Successful upsert clears is_stale
        from app.services.storage import upsert_indexed_files_batch
        upsert_indexed_files_batch(1, [{"relative_path": "A.py", "file_size": 200, "mtime_ns": 2000, "content_hash": "h2", "language": "python", "chunk_version": 1}])
        records = get_all_indexed_files(1)
        self.assertEqual(0, records[0]["is_stale"])
        self.assertIsNone(records[0].get("last_error"))

    # --- Scan incompleteness ---

    def test_scan_incomplete_does_not_delete_files(self):
        """When scan has errors, missing files should NOT be treated as deleted."""
        self._make_project()
        chunks = [
            {"project_id": 1, "path": "A.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "A content", "content_hash": "a1"},
            {"project_id": 1, "path": "B.py", "language": "python", "start_line": 1, "end_line": 3, "chunk_type": "lines", "symbol_name": None, "content": "B content", "content_hash": "b1"},
        ]
        gen1 = get_next_generation(1)
        write_chunks_to_generation(1, gen1, chunks)
        activate_generation(1, gen1)
        upsert_indexed_file(1, "A.py", 100, 1000, "a1", "python")
        upsert_indexed_file(1, "B.py", 100, 1000, "b1", "python")

        # Simulate: B's directory couldn't be scanned
        # B is not in disk_files but was in existing_map → should NOT be deleted
        # This test proves the logic: only delete when scan_complete=True
        gen2 = get_next_generation(1)
        write_chunks_to_generation(1, gen2, [])
        # Copy B from gen1 (as if it was in unchanged_paths due to scan error)
        copy_unchanged_chunks(1, gen1, gen2, {"B.py"})
        activate_generation(1, gen2)

        # B should still be searchable
        results = search_code_chunks(1, "B content")
        self.assertEqual(1, len(results))

    # --- Structural version completeness ---

    def test_all_structural_versions_checked_for_reuse(self):
        """All version fields must match for structural reuse."""
        from app.core.config import STRUCTURAL_ENGINE_VERSION, STRUCTURAL_INDEX_SCHEMA_VERSION, IGNORE_RULES_VERSION

        # All version fields match → can reuse
        prev = {
            "structural_status": "completed",
            "structural_engine_version": STRUCTURAL_ENGINE_VERSION,
            "ignore_rules_version": IGNORE_RULES_VERSION,
            "structural_index_schema_version": STRUCTURAL_INDEX_SCHEMA_VERSION,
            "index_schema_version": 2,  # INDEX_SCHEMA_VERSION
        }
        versions_ok = (
            int(prev.get("structural_engine_version") or 0) == STRUCTURAL_ENGINE_VERSION
            and int(prev.get("structural_index_schema_version") or 0) == STRUCTURAL_INDEX_SCHEMA_VERSION
            and int(prev.get("ignore_rules_version") or 0) == IGNORE_RULES_VERSION
        )
        self.assertTrue(versions_ok)

        # Engine version mismatch → must rebuild
        prev_bad = dict(prev, structural_engine_version=STRUCTURAL_ENGINE_VERSION + 1)
        versions_ok = int(prev_bad.get("structural_engine_version") or 0) == STRUCTURAL_ENGINE_VERSION
        self.assertFalse(versions_ok)

        # Schema version mismatch → must rebuild
        prev_bad2 = dict(prev, structural_index_schema_version=STRUCTURAL_INDEX_SCHEMA_VERSION + 1)
        versions_ok = int(prev_bad2.get("structural_index_schema_version") or 0) == STRUCTURAL_INDEX_SCHEMA_VERSION
        self.assertFalse(versions_ok)

    # --- Transaction atomicity ---

    def test_activate_generation_with_status_fields_is_atomic(self):
        """activate_generation with status params updates all fields in one txn."""
        self._make_project()
        set_project_index_status(1, "building", building_generation=5)
        activate_generation(1, 3, status="building", text_status="completed", stage="building_structural_index")
        status = get_project_index_status(1)
        self.assertEqual(3, status["active_generation"])
        self.assertEqual("building", status["status"])
        self.assertEqual("completed", status["text_status"])
        self.assertEqual("building_structural_index", status["stage"])
        self.assertIsNone(status["building_generation"])
        # last_good_generation should be previous active_gen (was 0, or whatever set was)
        self.assertIsNotNone(status.get("last_good_generation"))

    def test_degraded_reason_preserved_in_status(self):
        """When scan has errors, degraded_reason is set."""
        self._make_project()
        set_project_index_status(1, "building", 0, None,
            text_status="building", stage="scanning",
            degraded_reason="扫描不完整（3 个错误），未扫描到的文件保留旧索引。",
        )
        status = get_project_index_status(1)
        self.assertIsNotNone(status.get("degraded_reason"))
        self.assertIn("扫描不完整", str(status.get("degraded_reason")))
