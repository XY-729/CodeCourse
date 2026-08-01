"""Per-lesson involved-file selection and code-block construction.

The lesson generation pipeline must never hand the LLM an empty code
context. After the outline is generated, each lesson gets a persisted list
of involved files (index search first, key-file heuristics as fallback);
lesson input then includes real code sampled from those files.
"""

from __future__ import annotations

from pathlib import Path

from app.services.scanner import list_key_files, read_text_file

MIN_FILES_PER_LESSON = 2
MAX_FILES_PER_LESSON = 10
DEFAULT_BUDGET = 24000
PER_FILE_CAP = 12000
HEAD_CHARS = 4000
TAIL_CHARS = 4000

ENTRY_POINT_NAMES = {
    "main.c", "main.cc", "main.cpp", "main.py", "main.js", "main.ts",
    "main.tsx", "main.go", "main.rs", "main.java", "main.kt",
}


def _fallback_key_files(repo_root: Path) -> list[str]:
    """Ordered fallback list: README first, then key files by path, then entry points."""
    key = [p.relative_to(repo_root).as_posix() for p in list_key_files(repo_root)]
    key.sort(key=lambda rel: (rel.lower() != "readme.md", rel.lower()))
    entry: list[str] = []
    for pattern in ["main.*", "src/main.*", "app/main.*"]:
        for path in repo_root.glob(pattern):
            if path.is_file() and path.name in ENTRY_POINT_NAMES:
                rel = path.relative_to(repo_root).as_posix()
                if rel not in key and rel not in entry:
                    entry.append(rel)
    return key + entry


def _search_files(project_id: int, query: str) -> list[str]:
    # Lazy import: index_service imports generation_service, and
    # generation_service imports this module at module load.
    from app.services.index_service import search_project

    try:
        results = search_project(project_id, query, limit=8)
    except Exception:
        return []
    seen: list[str] = []
    for item in results:
        if item.path not in seen:
            seen.append(item.path)
    return seen


def select_lesson_files(project_id: int, repo_root: Path, outline: str) -> dict[int, list[str]]:
    """Pick involved files for every lesson in the outline.

    Returns {lesson_number: [relative paths]}. Never returns an empty list
    for a repository lesson as long as the repo has any key/entry file.
    """
    from app.services.generation_service import extract_outline_lessons

    lessons = extract_outline_lessons(outline)
    fallback = _fallback_key_files(repo_root)
    result: dict[int, list[str]] = {}
    for number, title in lessons:
        files = _search_files(project_id, title)
        if len(files) < MIN_FILES_PER_LESSON:
            for rel in fallback:
                if rel not in files:
                    files.append(rel)
                if len(files) >= MIN_FILES_PER_LESSON:
                    break
        result[number] = files[:MAX_FILES_PER_LESSON]
    return result


def _compact_code(content: str, cap: int) -> str:
    """Sample a file into <= cap chars: full when small, head+tail when large."""
    if len(content) <= cap:
        return content
    lines = content.split("\n")
    total = len(lines)
    head_lines: list[str] = []
    head_chars = 0
    for line in lines:
        if head_chars + len(line) + 1 > HEAD_CHARS:
            break
        head_lines.append(line)
        head_chars += len(line) + 1
    omitted = total - len(head_lines)
    tail: list[str] = []
    tail_chars = 0
    for line in reversed(lines):
        if tail_chars + len(line) + 1 > TAIL_CHARS:
            break
        tail.append(line)
        tail_chars += len(line) + 1
    tail.reverse()
    excerpt = "\n".join(head_lines) + f"\n# ... (省略 {omitted} 行) ...\n" + "\n".join(tail)
    return excerpt[:cap]


def build_file_code_blocks(repo_root: Path, files: list[str], budget: int = DEFAULT_BUDGET) -> str:
    """Build a '### <path>\\n```\\n<code>\\n```' block per file, within budget."""
    blocks: list[str] = []
    remaining = budget
    for relative in files:
        if remaining <= 0:
            break
        try:
            content, _language = read_text_file(repo_root, relative)
        except Exception:
            continue
        framing = len(f"### {relative}\n```\n```\n\n")
        excerpt = _compact_code(content, min(PER_FILE_CAP, remaining - framing))
        block = f"### {relative}\n```\n{excerpt}\n```"
        remaining -= len(block) + 2  # +2 for the join separator
        blocks.append(block)
    return "\n\n".join(blocks)
