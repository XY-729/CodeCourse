from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Iterable, Optional

from app.core.config import GENERATED_ROOT
from app.services.storage import (
    DocumentTerm,
    get_qa_record,
    get_qa_record_by_output_path,
    list_code_chunks,
    list_document_terms,
    upsert_document_term,
)


TERMS_LINE_RE = re.compile(r"^\s*(?:TERMS|术语)\s*[:：]\s*(\[.*\])\s*$", re.IGNORECASE)
CODE_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
INLINE_CODE_RE = re.compile(r"`([^`\n]{2,80})`")
IDENTIFIER_RE = re.compile(
    r"\b(?:[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]*)+|[A-Z]{2,}[A-Z0-9_-]*|[A-Za-z]+\.[A-Za-z0-9_.-]+)\b"
)

KNOWN_TECH_TERMS = (
    "FastAPI",
    "Pydantic",
    "Uvicorn",
    "React",
    "TypeScript",
    "JavaScript",
    "Electron",
    "SQLite",
    "FTS5",
    "Cytoscape",
    "Monaco",
    "Markdown",
    "Tree-sitter",
    "Docker",
    "CMake",
    "Cargo",
    "WebSocket",
    "REST",
    "RAG",
    "LLM",
    "API",
    "GitHub",
    "Git",
    "依赖注入",
    "异步任务",
    "全文检索",
    "知识图谱",
    "调用关系",
    "路由",
    "中间件",
)

STOP_TERMS = {
    "Markdown",
    "GitHub",
    "CodeCourse",
    "README",
    "TODO",
    "true",
    "false",
    "null",
    "项目",
    "文件",
    "代码",
    "课件",
    "回答",
    "问题",
    "学习",
    "用户",
    "模型",
    "内容",
}
STOP_TERMS_NORMALIZED = {item.casefold() for item in STOP_TERMS}


def _clean_term(term: str) -> str:
    cleaned = re.sub(r"\s+", " ", term.strip().strip("`*_#[](){}<>，。；：、"))
    if len(cleaned) < 2 or len(cleaned) > 80 or cleaned.isdigit():
        return ""
    if cleaned.casefold() in STOP_TERMS_NORMALIZED:
        return ""
    return cleaned


def parse_term_metadata(raw_content: str) -> tuple[str, list[str]]:
    """Remove TERMS metadata from model output and return normalized candidates."""
    terms: list[str] = []
    kept: list[str] = []
    for line in raw_content.splitlines():
        match = TERMS_LINE_RE.match(line)
        if not match:
            kept.append(line)
            continue
        try:
            values = json.loads(match.group(1))
        except json.JSONDecodeError:
            values = []
        if isinstance(values, list):
            for value in values:
                if isinstance(value, str):
                    term = _clean_term(value)
                    if term and term not in terms:
                        terms.append(term)
    return "\n".join(kept).strip(), terms[:20]


def term_metadata_instruction() -> str:
    return """

术语元数据要求：
- 在正文第一行之前输出一行：TERMS: ["术语1", "术语2"]。
- 只列出初学者可能陌生、且值得继续解释的技术名词、架构概念、框架、协议或项目关键符号。
- 最多 12 个，不要列普通词、文件名、标题中的泛词或完整句子。
- 每个术语必须实际出现在正文中，便于阅读器建立精确链接。
- TERMS 行是机器元数据，不要在正文中解释这行。"""


def _local_candidates(project_id: int, content: str) -> list[tuple[str, str, float]]:
    without_fences = CODE_FENCE_RE.sub(" ", content)
    candidates: list[tuple[str, str, float]] = []

    def add(term: str, source: str, confidence: float) -> None:
        cleaned = _clean_term(term)
        if cleaned and cleaned in content and all(existing[0].casefold() != cleaned.casefold() for existing in candidates):
            candidates.append((cleaned, source, confidence))

    for match in INLINE_CODE_RE.finditer(without_fences):
        add(match.group(1), "rule", 0.76)
    for term in KNOWN_TECH_TERMS:
        if term in without_fences:
            add(term, "rule", 0.84)
    for match in IDENTIFIER_RE.finditer(without_fences):
        add(match.group(0), "rule", 0.72)
    for chunk in list_code_chunks(project_id, limit=1000):
        if chunk.symbol_name and chunk.symbol_name in without_fences:
            add(chunk.symbol_name, "index", 0.88)
        if len(candidates) >= 30:
            break
    return candidates


def register_document_terms(
    project_id: int,
    source_type: str,
    source_path: str,
    content: str,
    model_terms: Optional[Iterable[str]] = None,
) -> list[DocumentTerm]:
    weighted: list[tuple[str, str, float]] = []
    for value in model_terms or []:
        term = _clean_term(value)
        if term and term in content:
            weighted.append((term, "model", 0.94))
    weighted.extend(_local_candidates(project_id, content))
    seen: set[str] = set()
    for term, source, confidence in sorted(weighted, key=lambda item: (-len(item[0]), -item[2])):
        normalized = term.casefold()
        if normalized in seen:
            continue
        seen.add(normalized)
        upsert_document_term(project_id, source_type, source_path, term, source, confidence)
        if len(seen) >= 20:
            break
    return list_document_terms(project_id, source_type, source_path)


def ensure_document_terms(project_id: int, source_type: str, source_path: str) -> list[DocumentTerm]:
    existing = list_document_terms(project_id, source_type, source_path)
    if existing:
        return existing
    content = ""
    if source_type == "course":
        target = (GENERATED_ROOT / str(project_id) / source_path).resolve()
        root = (GENERATED_ROOT / str(project_id)).resolve()
        if target.is_file() and (target == root or root in target.parents):
            content = target.read_text(encoding="utf-8", errors="ignore")
    elif source_type == "qa":
        try:
            qa_id = int(source_path)
        except ValueError:
            qa_id = 0
        record = get_qa_record(project_id, qa_id) if qa_id else get_qa_record_by_output_path(project_id, source_path)
        if record:
            content = record.answer_md
    if content:
        return register_document_terms(project_id, source_type, source_path, content)
    return []
