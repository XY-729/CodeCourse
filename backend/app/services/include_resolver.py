"""Resolve C/C++ quoted includes to repo-relative paths.

Lesson file selection is search-ranked, so a header that a selected source
file depends on (e.g. `#include "cppjudge/sandbox_internal.h"`) often falls
below the top-8 cut. The generated courseware then shows only the `#include`
line and never the header content. These helpers expand a lesson's file set
to pull in transitively quoted-included headers that actually exist.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from app.core.config import IGNORED_DIRS

QUOTED_INCLUDE = re.compile(r'^\s*#\s*include\s*"([^"]+)"', re.MULTILINE)

# Directories project headers commonly live under, tried after the including
# file's own directory. Configurable include roots via a single source.
INCLUDE_ROOTS = ("include", "src", "src/include", "inc", "headers", "lib")

# Extra dirs the suffix-match walk skips beyond app.core.config.IGNORED_DIRS.
_WALK_SKIP_DIRS = {".svn", ".hg", ".gradle", ".cache", ".clangd", ".ccls-cache"}

C_CPP_SUFFIXES = {".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx"}


def is_c_cpp(relative_path: str) -> bool:
    return Path(relative_path).suffix.lower() in C_CPP_SUFFIXES


def extract_quoted_includes(content: str) -> list[str]:
    """Return quoted include paths in order of appearance, deduped."""
    seen: set[str] = set()
    result: list[str] = []
    for path in QUOTED_INCLUDE.findall(content):
        if path not in seen:
            seen.add(path)
            result.append(path)
    return result


def _candidate_rel(root: Path, candidate: Path) -> str | None:
    """Repo-relative posix path if candidate resolves inside root, else None."""
    try:
        return candidate.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return None


def _resolve_candidate_roots(repo_root: Path, including_rel: str, include_path: str) -> str | None:
    root = repo_root.resolve()
    candidates: list[Path] = []
    parent = Path(including_rel).parent
    if str(parent) != ".":
        candidates.append(root / parent / include_path)
    for prefix in INCLUDE_ROOTS:
        candidates.append(root / prefix / include_path)
    candidates.append(root / include_path)

    for candidate in candidates:
        if not candidate.is_file():
            continue
        rel = _candidate_rel(root, candidate)
        if rel is None or not is_c_cpp(rel):
            continue
        return rel
    return None


def walk_source_files(repo_root: Path) -> list[str]:
    """Relative posix paths of C/C++ files under root, skipping ignored dirs."""
    root = repo_root.resolve()
    found: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS and d not in _WALK_SKIP_DIRS]
        for name in filenames:
            if Path(name).suffix.lower() not in C_CPP_SUFFIXES:
                continue
            rel = Path(dirpath).relative_to(root) / name
            found.append(rel.as_posix())
    found.sort()
    return found


def _suffix_match(source_files: list[str], include_path: str) -> str | None:
    """Shallowest existing file whose path ends with /<include_path>."""
    suffix = f"/{include_path}"
    best: tuple[int, str] | None = None
    for relative in source_files:
        if not relative.endswith(suffix):
            continue
        key = (relative.count("/"), relative)
        if best is None or key < best:
            best = key
    return best[1] if best is not None else None


def resolve_include(
    repo_root: Path,
    including_rel: str,
    include_path: str,
    source_files: list[str] | None = None,
) -> str | None:
    """Resolve a quoted include to a repo-relative C/C++ path, or None.

    Tries the including file's directory, common include roots, and the repo
    root, then a suffix-match fallback over `source_files` (a precomputed
    ``walk_source_files`` result) for headers under custom include dirs.
    """
    rel = _resolve_candidate_roots(repo_root, including_rel, include_path)
    if rel is not None:
        return rel
    if source_files is None:
        return None
    return _suffix_match(source_files, include_path)
