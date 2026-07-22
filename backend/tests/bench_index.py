"""Incremental index performance benchmark.

Creates 1000 source files with ~10,000 chunks, modifies one file,
and measures the time each phase takes on the second build.

Usage:
    PYTHONPATH=. python tests/bench_index.py
"""

from __future__ import annotations

import hashlib
import os
import tempfile
import time
from pathlib import Path

import app.core.config as cfg
import app.services.storage as storage
from app.services.index_service import build_project_index, search_project


def benchmark() -> None:
    tmpdir = tempfile.TemporaryDirectory()
    workspace = Path(tmpdir.name)
    db_path = workspace / "app.db"
    repos = workspace / "repos"
    generated = workspace / "generated"

    cfg.DB_PATH = db_path
    cfg.WORKSPACE_ROOT = workspace
    cfg.REPOS_ROOT = repos
    cfg.GENERATED_ROOT = generated
    storage.DB_PATH = db_path
    storage.GENERATED_ROOT = generated
    storage.REPOS_ROOT = repos
    storage.WORKSPACE_ROOT = workspace
    storage.init_storage()

    repo_dir = repos / "bench_repo"
    repo_dir.mkdir(parents=True)

    NUM_FILES = 1000
    print(f"Creating {NUM_FILES} source files...")
    for i in range(NUM_FILES):
        subdir = repo_dir / f"mod{i % 20}"
        subdir.mkdir(exist_ok=True)
        (subdir / f"file_{i}.py").write_text(
            f"# Module {i}\n\n"
            + "\n".join(f"def func_{i}_{j}():\n    return {j}" for j in range(10))
            + "\n\nclass Module{i}:\n    pass\n",
            encoding="utf-8",
        )

    project = storage.upsert_project("bench", "https://github.com/bench/repo", repo_dir, "scanned")
    pid = project.id
    print(f"Project ID: {pid}")

    # First build
    t0 = time.monotonic()
    build_project_index(pid)
    t1 = time.monotonic()
    first_build_ms = (t1 - t0) * 1000
    print(f"First build: {first_build_ms:.0f} ms")

    status = storage.get_project_index_status(pid)
    print(f"  chunks: {status['chunk_count']}, gen: {status['active_generation']}")

    # Modify just one file — same size, different content
    # file_42.py is in mod2/ (42 % 20 = 2)
    target = repo_dir / "mod2" / "file_42.py"
    old_size = target.stat().st_size
    new_content = "# Modified!\n" + "\n".join(f"def func_42_{j}():\n    return {-j}" for j in range(10))
    target.write_text(new_content, encoding="utf-8")
    # Ensure same size
    actual_size = target.stat().st_size
    print(f"Modified file_42.py: {old_size} → {actual_size} bytes")

    # Second build — incremental
    t0 = time.monotonic()
    build_project_index(pid)
    t1 = time.monotonic()
    second_build_ms = (t1 - t0) * 1000
    print(f"Second build (incremental, 1 file changed): {second_build_ms:.0f} ms")
    print(f"  Speedup: {first_build_ms / max(1, second_build_ms):.1f}x")

    status2 = storage.get_project_index_status(pid)
    print(f"  chunks: {status2['chunk_count']}, gen: {status2['active_generation']}")
    print(f"  added: {status2['added_files']}, updated: {status2['updated_files']}, unchanged: {status2['unchanged_files']}")
    print(f"  duration_ms: {status2['duration_ms']}")

    # Verify search works
    results = search_project(pid, "Modified")
    print(f"  search 'Modified': {len(results)} results")

    # Third build — force_verify
    t0 = time.monotonic()
    build_project_index(pid, force_verify=True)
    t1 = time.monotonic()
    force_verify_ms = (t1 - t0) * 1000
    print(f"Third build (force_verify): {force_verify_ms:.0f} ms")

    # DB size
    db_size_mb = db_path.stat().st_size / (1024 * 1024)
    print(f"DB size: {db_size_mb:.1f} MB")

    tmpdir.cleanup()


if __name__ == "__main__":
    benchmark()
