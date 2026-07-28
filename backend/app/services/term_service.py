from __future__ import annotations

import json
import hashlib
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Iterable, Optional
from app.core.config import GENERATED_ROOT
from app.services.personalization_service import resolve_concept
from app.services.storage import (
    DocumentTerm,
    delete_stale_document_term_candidates,
    get_qa_record,
    get_qa_record_by_output_path,
    list_code_chunks,
    list_document_terms,
    upsert_document_term,
)


TERMS_LINE_RE = re.compile(r"^\s*(?:TERMS|术语)\s*[:：]\s*(\[.*\])\s*$", re.IGNORECASE)
CODE_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
INLINE_CODE_RE = re.compile(r"`([^`\n]{2,80})`")
EMPHASIS_TERM_RE = re.compile(r"(?:\*\*|__)([^*_\n]{2,40})(?:\*\*|__)")
CHINESE_TECH_RE = re.compile(
    r"(?<![\u4e00-\u9fff])([\u4e00-\u9fff]{2,12}(?:算法|协议|框架|模型|索引|队列|缓存|路由|"
    r"线程|进程|协程|事务|依赖|接口|中间件|序列化|反序列化|调用链|事件循环))(?![\u4e00-\u9fff])"
)
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
_SCAN_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="codecourse-term-scan")
_SCAN_LOCK = threading.Lock()
_QUEUED_SCANS: set[str] = set()


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
    for match in EMPHASIS_TERM_RE.finditer(without_fences):
        add(match.group(1), "rule", 0.78)
    for match in CHINESE_TECH_RE.finditer(without_fences):
        add(match.group(1), "dictionary", 0.8)
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


def _resolve_concept(
    project_id: int,
    term: str,
    source: str,
    confidence: float,
) -> str:
    return resolve_concept(project_id, term, source, confidence).id


def register_document_terms(
    project_id: int,
    source_type: str,
    source_path: str,
    content: str,
    model_terms: Optional[Iterable[str]] = None,
    *,
    allow_model_scan: bool = True,
) -> list[DocumentTerm]:
    content_hash = hashlib.sha256(content.encode("utf-8", errors="ignore")).hexdigest()
    delete_stale_document_term_candidates(
        project_id,
        source_type,
        source_path,
        content_hash,
    )
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
        concept_id = _resolve_concept(project_id, term, source, confidence)
        upsert_document_term(
            project_id,
            source_type,
            source_path,
            term,
            source,
            confidence,
            concept_id=concept_id,
            content_hash=content_hash,
        )
        if len(seen) >= 20:
            break
    terms = list_document_terms(project_id, source_type, source_path)
    if allow_model_scan:
        high_confidence = sum(1 for item in terms if item.confidence >= 0.8)
        if len(terms) < 4 or high_confidence < 3:
            schedule_term_model_scan(
                project_id,
                source_type,
                source_path,
                content,
                content_hash,
            )
    return terms


def _term_scan_enabled() -> bool:
    try:
        from app.services.storage import get_setting
        return get_setting("personalization.observer.enabled") == "true"
    except Exception:
        return False


def _term_scan_messages(content: str) -> list[dict[str, str]]:
    compact = content if len(content) <= 18_000 else f"{content[:9_000]}\n\n...\n\n{content[-9_000:]}"
    return [
        {
            "role": "system",
            "content": (
                "你是技术教材术语分析器。只提取正文中实际出现、对当前学习者可能陌生且值得解释的技术术语。"
                "不要提取普通词、完整句子、标题泛词或代码块中的局部变量。只输出 JSON。"
            ),
        },
        {
            "role": "user",
            "content": (
                "返回格式：{\"terms\":[{\"text\":\"术语\",\"confidence\":0.0,\"reason\":\"简短原因\"}]}。"
                "最多 16 个，confidence 范围 0-1。\n\n正文：\n" + compact
            ),
        },
    ]


def _parse_term_scan(raw: str, content: str) -> list[str]:
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
    candidate = fenced.group(1).strip() if fenced else raw[raw.find("{"):raw.rfind("}") + 1]
    data = json.loads(candidate)
    rows = data.get("terms", []) if isinstance(data, dict) else []
    terms: list[str] = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or float(row.get("confidence", 0)) < 0.62:
            continue
        term = _clean_term(str(row.get("text", "")))
        if term and term in content and term.casefold() not in {item.casefold() for item in terms}:
            terms.append(term)
    return terms[:16]


def schedule_term_model_scan(
    project_id: int,
    source_type: str,
    source_path: str,
    content: str,
    content_hash: str,
) -> None:
    if not _term_scan_enabled():
        return
    key = f"{project_id}:{source_type}:{source_path}:{content_hash}"
    from app.services.storage import _connect
    with _connect() as conn:
        existing = conn.execute(
            """SELECT status FROM term_model_scans
               WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=?""",
            (project_id, source_type, source_path, content_hash),
        ).fetchone()
        if existing is not None:
            return
        stamp = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
        conn.execute(
            """INSERT INTO term_model_scans
               (project_id,source_type,source_path,content_hash,status,terms_json,created_at,updated_at)
               VALUES(?,?,?,?,?,'[]',?,?)""",
            (project_id, source_type, source_path, content_hash, "queued", stamp, stamp),
        )
        conn.commit()
    with _SCAN_LOCK:
        if key in _QUEUED_SCANS:
            return
        _QUEUED_SCANS.add(key)

    def run() -> None:
        started = time.time()
        settings: dict[str, str] = {}
        try:
            from app.services.storage import _connect, get_llm_settings
            from app.services.llm_client import call_openai_compatible_chat_result
            settings = get_llm_settings()
            if not settings.get("api_key") or not settings.get("base_url"):
                raise RuntimeError("No model API configured for term scan")
            with _connect() as conn:
                conn.execute(
                    """UPDATE term_model_scans SET status='running',updated_at=?
                       WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=?""",
                    (
                        __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
                        project_id, source_type, source_path, content_hash,
                    ),
                )
                conn.commit()
            call_result = call_openai_compatible_chat_result(
                base_url=settings["base_url"],
                api_key=settings["api_key"],
                model=settings["model"],
                messages=_term_scan_messages(content),
                timeout=30,
            )
            raw = call_result.content
            model_terms = _parse_term_scan(raw, content)
            register_document_terms(
                project_id,
                source_type,
                source_path,
                content,
                model_terms,
                allow_model_scan=False,
            )
            stamp = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
            with _connect() as conn:
                conn.execute(
                    """UPDATE term_model_scans
                       SET status='completed',terms_json=?,error_message=NULL,updated_at=?
                       WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=?""",
                    (
                        json.dumps(model_terms, ensure_ascii=False), stamp,
                        project_id, source_type, source_path, content_hash,
                    ),
                )
                from app.services.personalization.learner_inference_service import record_model_call
                record_model_call(
                    project_id=project_id,
                    purpose="term_scan",
                    provider=settings.get("provider"),
                    model=call_result.model,
                    status="completed",
                    latency_ms=call_result.latency_ms,
                    input_tokens=call_result.usage.get("input_tokens"),
                    output_tokens=call_result.usage.get("output_tokens"),
                    conn=conn,
                )
                conn.commit()
        except Exception as exc:
            from app.services.storage import _connect
            stamp = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
            with _connect() as conn:
                conn.execute(
                    """UPDATE term_model_scans
                       SET status='failed',error_message=?,updated_at=?
                       WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=?""",
                    (
                        str(exc)[:500], stamp,
                        project_id, source_type, source_path, content_hash,
                    ),
                )
                from app.services.personalization.learner_inference_service import record_model_call
                record_model_call(
                    project_id=project_id,
                    purpose="term_scan",
                    provider=settings.get("provider"),
                    model=settings.get("model"),
                    status="failed",
                    latency_ms=int((time.time() - started) * 1000),
                    error_message=str(exc),
                    conn=conn,
                )
                conn.commit()
        finally:
            with _SCAN_LOCK:
                _QUEUED_SCANS.discard(key)

    _SCAN_EXECUTOR.submit(run)


def ensure_document_terms(project_id: int, source_type: str, source_path: str) -> list[DocumentTerm]:
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
    return list_document_terms(project_id, source_type, source_path)
