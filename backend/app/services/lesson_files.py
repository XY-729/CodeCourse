"""Per-lesson file selection and observable code-evidence assembly."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from app.services.scanner import list_key_files, read_text_file

MIN_FILES_PER_LESSON = 2
MAX_FILES_PER_LESSON = 10
DEFAULT_BUDGET = 24000
PER_FILE_CAP = 12000
MIN_FILE_SAMPLE = 1600

ENTRY_POINT_NAMES = {
    "main.c", "main.cc", "main.cpp", "main.py", "main.js", "main.ts",
    "main.tsx", "main.go", "main.rs", "main.java", "main.kt",
}


@dataclass(frozen=True)
class EvidenceRange:
    path: str
    start_line: int
    end_line: int


@dataclass
class CodeEvidenceAssembly:
    content: str = ""
    included: list[str] = field(default_factory=list)
    truncated: list[str] = field(default_factory=list)
    read_failed: list[str] = field(default_factory=list)
    budget_skipped: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "included": self.included,
            "truncated": self.truncated,
            "read_failed": self.read_failed,
            "budget_skipped": self.budget_skipped,
        }


def _fallback_key_files(repo_root: Path) -> list[str]:
    """Return a stable fallback list with README and entry points first."""
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
    # Lazy import avoids the index/generation service import cycle.
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


def select_lesson_file_paths(
    project_id: int,
    repo_root: Path,
    lesson_title: str,
    lesson_section: str = "",
) -> list[str]:
    """Select ranked, existing files using the full lesson plan as the query."""
    query = f"{lesson_title} {lesson_section[:2000]}".strip()
    files = [rel for rel in _search_files(project_id, query) if (repo_root / rel).is_file()]
    if len(files) < MIN_FILES_PER_LESSON:
        for rel in _fallback_key_files(repo_root):
            if rel not in files and (repo_root / rel).is_file():
                files.append(rel)
            if len(files) >= MIN_FILES_PER_LESSON:
                break
    return files[:MAX_FILES_PER_LESSON]


def select_lesson_files(project_id: int, repo_root: Path, outline: str) -> dict[int, list[str]]:
    """Select ranked involved files for every repository lesson."""
    from app.services.generation_service import LESSON_HEADING_PATTERN, extract_outline_lessons

    matches = list(LESSON_HEADING_PATTERN.finditer(outline))
    sections: dict[int, str] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(outline)
        sections[int(match.group(1))] = outline[match.start():end].strip()

    result: dict[int, list[str]] = {}
    for number, title in extract_outline_lessons(outline):
        result[number] = select_lesson_file_paths(
            project_id,
            repo_root,
            title,
            sections.get(number, ""),
        )
    return result


def _compact_code(content: str, cap: int) -> str:
    """Sample both ends of a file while respecting even very small caps."""
    if cap <= 0:
        return ""
    if len(content) <= cap:
        return content
    effective_cap = max(0, cap - 1)
    marker = "\n# ... 省略 ...\n"
    if effective_cap <= len(marker) + 2:
        return content[:effective_cap]
    available = effective_cap - len(marker)
    head_chars = max(1, int(available * 0.58))
    tail_chars = max(1, available - head_chars)
    return content[:head_chars] + marker + content[-tail_chars:]


def _range_excerpt(content: str, ranges: Iterable[EvidenceRange], cap: int) -> str:
    """Read fresh line ranges from disk rather than trusting stale index text."""
    lines = content.splitlines()
    parts: list[str] = []
    seen: set[tuple[int, int]] = set()
    for item in ranges:
        start = max(1, item.start_line)
        end = min(len(lines), max(start, item.end_line))
        key = (start, end)
        if key in seen or start > len(lines):
            continue
        seen.add(key)
        part = f"# lines {start}-{end}\n" + "\n".join(lines[start - 1:end])
        candidate = "\n\n".join([*parts, part])
        if len(candidate) > cap:
            if not parts:
                return _compact_code(part, cap)
            break
        parts.append(part)
    return "\n\n".join(parts)


def assemble_file_code_blocks(
    repo_root: Path,
    files: list[str],
    *,
    relevant_ranges: Iterable[EvidenceRange] = (),
    budget: int = DEFAULT_BUDGET,
) -> CodeEvidenceAssembly:
    """Build ranked code blocks with fair per-file allocation and diagnostics."""
    assembly = CodeEvidenceAssembly()
    ranges_by_path: dict[str, list[EvidenceRange]] = {}
    for item in relevant_ranges:
        ranges_by_path.setdefault(item.path, []).append(item)

    readable: list[tuple[str, str, str]] = []
    for relative in files:
        try:
            content, language = read_text_file(repo_root, relative)
            if not content.strip():
                assembly.read_failed.append(relative)
                continue
            readable.append((relative, content, language))
        except Exception:
            assembly.read_failed.append(relative)

    if not readable or budget <= 0:
        assembly.budget_skipped.extend(path for path, _, _ in readable)
        return assembly

    framing_sizes = [len(f"### {path}\n```{language}\n\n```\n\n") for path, _, language in readable]
    available = budget - sum(framing_sizes)
    if available <= 0:
        assembly.budget_skipped.extend(path for path, _, _ in readable)
        return assembly

    base = min(MIN_FILE_SAMPLE, max(1, available // len(readable)))
    allocations = [min(len(content), base, PER_FILE_CAP) for _, content, _ in readable]
    remaining = available - sum(allocations)
    for index, (_, content, _) in enumerate(readable):
        if remaining <= 0:
            break
        extra = min(max(0, len(content) - allocations[index]), PER_FILE_CAP - allocations[index], remaining)
        allocations[index] += extra
        remaining -= extra

    blocks: list[str] = []
    used = 0
    for (relative, content, language), cap in zip(readable, allocations):
        if cap <= 0:
            assembly.budget_skipped.append(relative)
            continue
        ranges = ranges_by_path.get(relative, [])
        excerpt = _range_excerpt(content, ranges, cap) if ranges else ""
        if not excerpt:
            excerpt = _compact_code(content, cap)
        block = f"### {relative}\n```{language}\n{excerpt}\n```"
        separator = 2 if blocks else 0
        if used + separator + len(block) > budget:
            assembly.budget_skipped.append(relative)
            continue
        blocks.append(block)
        used += separator + len(block)
        assembly.included.append(relative)
        if len(excerpt) < len(content):
            assembly.truncated.append(relative)

    assembly.content = "\n\n".join(blocks)
    return assembly


def build_file_code_blocks(repo_root: Path, files: list[str], budget: int = DEFAULT_BUDGET) -> str:
    """Compatibility wrapper for callers that only need rendered content."""
    return assemble_file_code_blocks(repo_root, files, budget=budget).content
