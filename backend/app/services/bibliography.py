from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
BIBLIOGRAPHY_PATH = ROOT / "shared" / "curated-bibliography.json"
BIBLIOGRAPHY_LINE_RE = re.compile(
    r"^\s*BIBLIOGRAPHY\s*[:：]\s*(\[.*\])\s*$",
    re.IGNORECASE,
)


@lru_cache(maxsize=1)
def curated_bibliography() -> tuple[dict[str, Any], ...]:
    raw = json.loads(BIBLIOGRAPHY_PATH.read_text(encoding="utf-8"))
    return tuple(item for item in raw if isinstance(item, dict) and item.get("id"))


def bibliography_for_prompt() -> str:
    rows = []
    for item in curated_bibliography():
        topics = ", ".join(str(topic) for topic in item.get("topics", []))
        rows.append(f"- {item['id']}: {item['title']} | allowed topics: {topics}")
    return "\n".join(rows)


def bibliography_metadata_instruction() -> str:
    return f"""

教材元数据要求：
- 正文中不要自行写书名、作者、章节号、页码或版次。
- 在正文最后输出一行 `BIBLIOGRAPHY: [...]`。
- 数组元素格式为 `{{"id":"允许书目 ID","topics":["该书允许主题中的原文"]}}`。
- 只能从下列目录逐字选择 ID 和主题；没有匹配时输出 `BIBLIOGRAPHY: []`。

{bibliography_for_prompt()}"""


def validate_bibliography_selections(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    books_by_id = {str(item["id"]): item for item in curated_bibliography()}
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in value[:8]:
        if not isinstance(raw, dict):
            continue
        book_id = str(raw.get("id", "")).strip()
        book = books_by_id.get(book_id)
        if not book or book_id in seen:
            continue
        allowed = {str(topic).casefold(): str(topic) for topic in book.get("topics", [])}
        requested = raw.get("topics")
        if isinstance(requested, str):
            requested_topics = [requested]
        elif isinstance(requested, list):
            requested_topics = [str(topic) for topic in requested]
        else:
            requested_topics = []
        topics = [
            allowed[topic.strip().casefold()]
            for topic in requested_topics
            if topic.strip().casefold() in allowed
        ][:4]
        result.append(
            {
                "id": book_id,
                "title": str(book["title"]),
                "edition": str(book.get("edition", "")),
                "authors": [str(author) for author in book.get("authors", [])],
                "topics": topics,
            }
        )
        seen.add(book_id)
    return result


def bibliography_markdown(value: object) -> str:
    selections = validate_bibliography_selections(value)
    if not selections:
        return "## 教材参照\n\n本课未列出能够由内置书目确认的教材。"
    lines = [
        "## 教材参照",
        "",
        "> 书名、作者和主题来自 CodeCourse 内置校验书目；课件未读取教材原文。",
        "",
    ]
    for book in selections:
        edition = f"，{book['edition']}" if book["edition"] else ""
        authors = ", ".join(book["authors"])
        topics = f"；相关主题：{'、'.join(book['topics'])}" if book["topics"] else ""
        lines.append(f"- 《{book['title']}》{edition} — {authors}{topics}")
    return "\n".join(lines)


def parse_bibliography_metadata(raw_content: str) -> tuple[str, list[dict[str, Any]]]:
    raw_values: object = []
    kept: list[str] = []
    for line in raw_content.splitlines():
        match = BIBLIOGRAPHY_LINE_RE.match(line)
        if not match:
            kept.append(line)
            continue
        try:
            raw_values = json.loads(match.group(1))
        except json.JSONDecodeError:
            raw_values = []
    return "\n".join(kept).strip(), validate_bibliography_selections(raw_values)


def append_validated_bibliography(markdown: str, selections: object) -> str:
    """Remove free-form book citations and append a locally rendered bibliography."""
    lines: list[str] = []
    skip_level: int | None = None
    for line in markdown.splitlines():
        heading = re.match(r"^(#{1,3})\s+(.+)$", line.strip())
        if heading:
            level = len(heading.group(1))
            title = heading.group(2)
            if "教材" in title or "参考书" in title:
                skip_level = level
                continue
            if skip_level is not None and level <= skip_level:
                skip_level = None
        if skip_level is not None:
            continue
        if "《" in line and "》" in line:
            continue
        lines.append(line)
    cleaned = "\n".join(lines).strip()
    section = bibliography_markdown(selections).replace(
        "## 教材参照", "## 总体教材参照", 1
    )
    return f"{cleaned}\n\n{section}\n"
