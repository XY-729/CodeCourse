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
