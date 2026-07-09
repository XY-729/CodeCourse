from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import HTTPException

from app.core.config import IGNORED_DIRS, KEY_FILES, MAX_TEXT_BYTES
from app.models.schemas import TreeNode

LANGUAGE_BY_SUFFIX = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".json": "json",
    ".md": "markdown",
    ".toml": "toml",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".kt": "kotlin",
    ".sh": "shell",
    ".sql": "sql",
}


def safe_join(root: Path, relative_path: Optional[str] = None) -> Path:
    root = root.resolve()
    candidate = root if not relative_path else (root / relative_path).resolve()
    if candidate != root and root not in candidate.parents:
        raise HTTPException(status_code=400, detail="Path is outside the imported project")
    return candidate


def is_key_file(path: Path) -> bool:
    return path.name in KEY_FILES


def infer_language(path: Path) -> str:
    if path.name == "Dockerfile":
        return "dockerfile"
    if path.name == "Makefile":
        return "makefile"
    if path.name == "CMakeLists.txt":
        return "cmake"
    return LANGUAGE_BY_SUFFIX.get(path.suffix.lower(), "plaintext")


def scan_tree(root: Path, max_depth: int = 8) -> TreeNode:
    root = root.resolve()

    def build(path: Path, depth: int) -> TreeNode:
        rel = "" if path == root else path.relative_to(root).as_posix()
        if path.is_dir():
            children: list[TreeNode] = []
            if depth < max_depth:
                entries = sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
                for child in entries:
                    if child.is_dir() and child.name in IGNORED_DIRS:
                        continue
                    if child.name == ".generated_course":
                        continue
                    children.append(build(child, depth + 1))
            return TreeNode(name=path.name, path=rel, type="directory", children=children)
        return TreeNode(name=path.name, path=rel, type="file", is_key_file=is_key_file(path))

    return build(root, 0)


def list_key_files(root: Path) -> list[Path]:
    found: list[Path] = []
    for path in root.rglob("*"):
        if any(part in IGNORED_DIRS for part in path.relative_to(root).parts):
            continue
        if path.is_file() and is_key_file(path):
            found.append(path)
    return sorted(found, key=lambda p: p.relative_to(root).as_posix())


def read_text_file(root: Path, relative_path: str) -> tuple[str, str]:
    target = safe_join(root, relative_path)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if target.stat().st_size > MAX_TEXT_BYTES:
        raise HTTPException(status_code=413, detail="File is too large for MVP text preview")
    try:
        return target.read_text(encoding="utf-8"), infer_language(target)
    except UnicodeDecodeError:
        raise HTTPException(status_code=415, detail="Only UTF-8 text files are supported in the MVP")
