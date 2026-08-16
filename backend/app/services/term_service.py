from __future__ import annotations

import json
import hashlib
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Iterable, Mapping, Optional
from app.core.config import GENERATED_ROOT
from app.services.personalization_service import resolve_concept
from app.services.storage import (
    DocumentTerm,
    delete_term_scan_state,
    delete_document_term_candidates_by_id,
    delete_stale_document_term_candidates,
    get_term_scan_state,
    get_qa_record,
    get_qa_record_by_output_path,
    list_code_chunks,
    list_document_terms,
    upsert_document_term,
)


TERMS_LINE_RE = re.compile(r"^\s*(?:TERMS|术语)\s*[:：]\s*(\[.*\])\s*$", re.IGNORECASE)
CODE_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
INLINE_CODE_RE = re.compile(r"`([^`\n]{2,80})`")
# Bold spans used as inline emphasis can carry real terms ("**数据竞争**：C++…").
# Generated documents also use **bold** for section headings on their own line
# ("**一句话大白话**"), which are not terms — the trailing lookahead rejects
# bold that is followed by a line break (i.e. stands on its own line).
EMPHASIS_TERM_RE = re.compile(r"(?:\*\*|__)([^*_\n]{2,40})(?:\*\*|__)(?!\s*\n)")
# Chinese technical dictionary words (线程, 进程, 缓存, 事件循环, 中间件…).
# The match IS the dictionary word itself — never the surrounding phrase, so
# whole sentences like "轮流分给各个进程" can no longer become candidates
# (only 进程 would). No word boundaries are used because Chinese has no spaces
# between words; _clean_term and STOP_TERMS filter the results.
CHINESE_TECH_RE = re.compile(
    r"(?:算法|协议|框架|模型|索引|队列|缓存|路由|"
    r"线程|进程|协程|事务|依赖|接口|中间件|序列化|反序列化|调用链|事件循环)"
)
IDENTIFIER_RE = re.compile(
    r"\b(?:[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]*)+|[A-Z]{2,}[A-Z0-9_-]*|[A-Za-z]+\.[A-Za-z0-9_.-]+)\b"
)
MARKDOWN_LINK_RE = re.compile(r"!?\[[^\]\n]+\]\([^)]+\)")
COMMAND_RE = re.compile(
    r"^(?:sudo\s+|(?:apt|apt-get|npm|pnpm|yarn|pip|pip3|git|cmake|gradle|"
    r"mvn|cargo|docker|kubectl|adb)\s+)",
    re.IGNORECASE,
)
FILE_PATH_RE = re.compile(
    r"(?:[A-Za-z]:[\\/]|(?:^|[\s`])(?:\.\.?[\\/]|[/\\])|"
    r"\.(?:py|pyi|ts|tsx|js|jsx|java|kt|cpp|cc|cxx|c|h|hpp|cs|go|rs|"
    r"json|ya?ml|toml|md|txt|sh|bat|ps1)(?:$|[\s`]))",
    re.IGNORECASE,
)
ERROR_MESSAGE_RE = re.compile(
    r"(?:\b(?:fatal\s+)?error\s*:|\bwarning\s*:|traceback|exception\s*:|"
    r"unrecognized command line option|undefined reference)",
    re.IGNORECASE,
)
MARKDOWN_FRAGMENT_RE = re.compile(
    r"(?:```|^\s{0,3}(?:#{1,6}|[-+*>])\s|\[[^\]]*\]\([^)]*\)|!\[[^\]]*\])",
    re.MULTILINE,
)
SENTENCE_PUNCTUATION_RE = re.compile(r"[。！？!?；;，,]\s*$|[。！？!?；;]")
# Section headings in generated documents use imperative/heading phrasing that
# is never a term (e.g. "**下一步学习建议**", "**一句话大白话**"). Belt and
# suspenders on top of the EMPHASIS_TERM_RE inline-only fix.
HEADING_PREFIX_RE = re.compile(
    r"^(?:为什么|怎么|如何|如果|不要|不能|必须|应该|以为|下一步|常见|一句话|逐步|最小|"
    r"注意|总结|提醒|补充|示例|例子|建议|思考|练习|请|帮我)"
)
SENTENCE_MARKER_RE = re.compile(r"不要|不能|必须|应该|可以|直接|还要|就能|因为|所以|为了")
ALLOWED_TERM_CATEGORIES = {
    "concept",
    "api",
    "library",
    "framework",
    "protocol",
    "type",
    "symbol",
    "tool",
    "configuration",
    "algorithm",
    "data_structure",
    "other",
}

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


def _normalize_source_path(source_path: str) -> str:
    """QA answer paths may be stored with backslashes on Windows; every term
    row must key on the same forward-slash form so a document is scanned and
    deduplicated once."""
    return source_path.replace("\\", "/")


def _balanced_delimiters(value: str) -> bool:
    pairs = {")": "(", "]": "[", "}": "{", ">": "<"}
    stack: list[str] = []
    for char in value:
        if char in "([{<":
            stack.append(char)
        elif char in pairs:
            if not stack or stack.pop() != pairs[char]:
                return False
    return not stack


def _clean_term(term: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(term).strip().strip("`*_#，。；：、"))
    if len(cleaned) < 2 or len(cleaned) > 64 or cleaned.isdigit():
        return ""
    if cleaned.casefold() in STOP_TERMS_NORMALIZED:
        return ""
    if "\n" in term or "\r" in term:
        return ""
    if not _balanced_delimiters(cleaned):
        return ""
    if SENTENCE_PUNCTUATION_RE.search(cleaned):
        return ""
    if COMMAND_RE.search(cleaned) or FILE_PATH_RE.search(cleaned):
        return ""
    if "/" in cleaned or "\\" in cleaned:
        return ""
    if ERROR_MESSAGE_RE.search(cleaned) or MARKDOWN_FRAGMENT_RE.search(cleaned):
        return ""
    if any(char in cleaned for char in ("=", "|", "$", "+")):
        return ""
    # Parentheses (ASCII or full-width) and embedded quotes usually introduce
    # glosses/definitions or quoted phrases, e.g. "时间片（time slice）",
    # '精确地按“系统调用”级别过滤' — not a term itself.
    if any(char in cleaned for char in ("(", ")", "（", "）")):
        return ""
    if re.search(r"[\"'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]", cleaned):
        return ""
    if HEADING_PREFIX_RE.search(cleaned) or SENTENCE_MARKER_RE.search(cleaned):
        return ""
    if cleaned.casefold().startswith(("template ", "class ", "struct ", "def ")):
        return ""
    latin_words = re.findall(r"[A-Za-z][A-Za-z0-9_.:+#-]*", cleaned)
    if len(latin_words) > 5:
        return ""
    chinese_count = len(re.findall(r"[\u4e00-\u9fff]", cleaned))
    if chinese_count > 16:
        return ""
    return cleaned


def _excluded_ranges(content: str) -> list[tuple[int, int]]:
    ranges = [(match.start(), match.end()) for match in CODE_FENCE_RE.finditer(content)]
    ranges.extend(
        (match.start(), match.end()) for match in MARKDOWN_LINK_RE.finditer(content)
    )
    return sorted(ranges)


def _range_is_visible(
    start: int,
    end: int,
    excluded: list[tuple[int, int]],
) -> bool:
    return all(end <= left or start >= right for left, right in excluded)


def _visible_source_span(
    content: str,
    text: str,
    requested: Mapping[str, object] | None = None,
) -> dict[str, object] | None:
    excluded = _excluded_ranges(content)
    if requested and ("start" in requested or "end" in requested):
        try:
            start = int(requested.get("start", -1))
            end = int(requested.get("end", -1))
        except (TypeError, ValueError):
            return None
        if (
            start < 0
            or end != start + len(text)
            or content[start:end] != text
            or not _range_is_visible(start, end, excluded)
        ):
            return None
        return {"text": text, "start": start, "end": end}

    for match in re.finditer(re.escape(text), content):
        if _range_is_visible(match.start(), match.end(), excluded):
            return {"text": text, "start": match.start(), "end": match.end()}
    return None


def normalize_term_candidate(
    value: object,
    content: str,
    *,
    default_source: str = "model",
    default_confidence: float = 0.7,
) -> dict[str, object] | None:
    """Validate a legacy string or structured term against exact visible source text."""
    if isinstance(value, str):
        display_name = value
        canonical_name = value
        category = "other"
        confidence = default_confidence
        requested_span = None
    elif isinstance(value, Mapping):
        display_name = str(value.get("display_name") or value.get("text") or "")
        canonical_name = str(value.get("canonical_name") or display_name)
        category = str(value.get("category") or "other").strip().casefold()
        try:
            confidence = float(value.get("confidence", default_confidence))
        except (TypeError, ValueError):
            return None
        raw_span = value.get("source_span")
        requested_span = raw_span if isinstance(raw_span, Mapping) else None
        if requested_span is not None:
            span_text = str(requested_span.get("text") or "")
            if span_text != display_name.strip():
                return None
    else:
        return None

    display_name = _clean_term(display_name)
    canonical_name = _clean_term(canonical_name)
    if not display_name or not canonical_name:
        return None
    if category not in ALLOWED_TERM_CATEGORIES:
        category = "other"
    source_span = _visible_source_span(content, display_name, requested_span)
    if source_span is None:
        return None
    return {
        "display_name": display_name,
        "canonical_name": canonical_name,
        "category": category,
        "confidence": max(0.0, min(1.0, confidence)),
        "source_span": source_span,
        "source": default_source,
    }


def parse_term_metadata(raw_content: str) -> tuple[str, list[dict[str, object]]]:
    """Remove TERMS metadata and validate candidates against the remaining body."""
    raw_terms: list[object] = []
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
            raw_terms.extend(values)
    content = "\n".join(kept).strip()
    terms: list[dict[str, object]] = []
    seen: set[str] = set()
    for value in raw_terms:
        candidate = normalize_term_candidate(
            value,
            content,
            default_source="model",
            default_confidence=0.94,
        )
        if not candidate:
            continue
        key = str(candidate["canonical_name"]).casefold()
        if key in seen:
            continue
        seen.add(key)
        terms.append(candidate)
    return content, terms[:20]


def term_metadata_instruction() -> str:
    return """

术语元数据要求：
- 在正文第一行之前输出一行：
  TERMS: [{"display_name":"正文中的原词","canonical_name":"规范名称","category":"concept","confidence":0.9,"source_span":{"text":"正文中的原词"}}]
- 只列出初学者可能陌生、且值得继续解释的技术名词、架构概念、框架、协议或项目关键符号。
- 最多 12 个，不要列普通词、文件名、标题中的泛词或完整句子。
- display_name 与 source_span.text 必须完全相同，并且逐字实际出现在正文可见文本中。
- 不要列命令、路径、函数调用、函数签名、编译错误、Markdown 片段或只在代码块中出现的文本。
- category 只能使用 concept/api/library/framework/protocol/type/symbol/tool/configuration/algorithm/data_structure/other。
- TERMS 行是机器元数据，不要在正文中解释这行。"""


def _local_candidates(project_id: int, content: str) -> list[dict[str, object]]:
    without_fences = CODE_FENCE_RE.sub(" ", content)
    candidates: list[dict[str, object]] = []

    def add(term: str, source: str, confidence: float, category: str = "other") -> None:
        candidate = normalize_term_candidate(
            {
                "display_name": term,
                "canonical_name": term,
                "category": category,
                "confidence": confidence,
            },
            content,
            default_source=source,
            default_confidence=confidence,
        )
        if candidate and all(
            str(existing["canonical_name"]).casefold()
            != str(candidate["canonical_name"]).casefold()
            for existing in candidates
        ):
            candidates.append(candidate)

    for match in INLINE_CODE_RE.finditer(without_fences):
        add(match.group(1), "rule", 0.76, "symbol")
    for match in EMPHASIS_TERM_RE.finditer(without_fences):
        add(match.group(1), "rule", 0.78, "concept")
    for match in CHINESE_TECH_RE.finditer(without_fences):
        add(match.group(0), "dictionary", 0.8, "concept")
    for term in KNOWN_TECH_TERMS:
        if term in without_fences:
            add(term, "rule", 0.84, "library")
    for match in IDENTIFIER_RE.finditer(without_fences):
        add(match.group(0), "rule", 0.72, "symbol")
    for chunk in list_code_chunks(project_id, limit=1000):
        if chunk.symbol_name and chunk.symbol_name in without_fences:
            add(chunk.symbol_name, "index", 0.88, "symbol")
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
    model_terms: Optional[Iterable[object]] = None,
    *,
    allow_model_scan: bool = True,
) -> list[DocumentTerm]:
    source_path = _normalize_source_path(source_path)
    content_hash = hashlib.sha256(content.encode("utf-8", errors="ignore")).hexdigest()
    delete_stale_document_term_candidates(
        project_id,
        source_type,
        source_path,
        content_hash,
    )
    weighted: list[dict[str, object]] = []
    for value in model_terms or []:
        candidate = normalize_term_candidate(
            value,
            content,
            default_source="model",
            default_confidence=0.94,
        )
        if candidate:
            weighted.append(candidate)
    weighted.extend(_local_candidates(project_id, content))
    seen: set[str] = set()
    for candidate in sorted(
        weighted,
        key=lambda item: (
            -len(str(item["display_name"])),
            -float(item["confidence"]),
        ),
    ):
        term = str(candidate["display_name"])
        canonical_name = str(candidate["canonical_name"])
        source = str(candidate["source"])
        confidence = float(candidate["confidence"])
        normalized = canonical_name.casefold()
        if normalized in seen:
            continue
        seen.add(normalized)
        concept_id = _resolve_concept(
            project_id, canonical_name, source, confidence
        )
        upsert_document_term(
            project_id,
            source_type,
            source_path,
            term,
            source,
            confidence,
            concept_id=concept_id,
            content_hash=content_hash,
            canonical_name=canonical_name,
            category=str(candidate["category"]),
            source_span=dict(candidate["source_span"]),
        )
        if len(seen) >= 20:
            break
    terms = _clean_historical_candidates(
        project_id,
        list_document_terms(project_id, source_type, source_path),
        content,
    )
    if allow_model_scan:
        high_confidence = sum(1 for item in terms if item.confidence >= 0.8)
        if len(terms) < 4 or high_confidence < 3:
            schedule_term_model_scan(
                project_id,
                source_type,
                source_path,
                content,
                content_hash,
                local_candidate_count=len(terms),
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
                "不要提取普通词、完整句子、命令、路径、函数调用、函数签名、编译错误、Markdown 片段或代码块局部变量。只输出 JSON。"
            ),
        },
        {
            "role": "user",
            "content": (
                "返回格式：{\"terms\":[{\"display_name\":\"正文原词\",\"canonical_name\":\"规范名称\","
                "\"category\":\"concept\",\"confidence\":0.0,"
                "\"source_span\":{\"text\":\"正文原词\"}}]}。"
                "最多 16 个，confidence 范围 0-1。\n\n正文：\n" + compact
            ),
        },
    ]


def _parse_term_scan(raw: str, content: str) -> list[dict[str, object]]:
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
    candidate = fenced.group(1).strip() if fenced else raw[raw.find("{"):raw.rfind("}") + 1]
    data = json.loads(candidate)
    rows = data.get("terms", []) if isinstance(data, dict) else []
    terms: list[dict[str, object]] = []
    seen: set[str] = set()
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or float(row.get("confidence", 0)) < 0.62:
            continue
        candidate = normalize_term_candidate(
            row,
            content,
            default_source="model",
            default_confidence=float(row.get("confidence", 0)),
        )
        if not candidate:
            continue
        key = str(candidate["canonical_name"]).casefold()
        if key not in seen:
            seen.add(key)
            terms.append(candidate)
    return terms[:16]


def _clean_historical_candidates(
    project_id: int,
    terms: list[DocumentTerm],
    content: str,
) -> list[DocumentTerm]:
    invalid_ids: list[int] = []
    valid: list[DocumentTerm] = []
    for term in terms:
        if term.status != "candidate":
            valid.append(term)
            continue
        candidate = normalize_term_candidate(
            {
                "display_name": term.term_text,
                "canonical_name": term.canonical_name or term.term_text,
                "category": term.category or "other",
                "confidence": term.confidence,
                "source_span": term.source_span,
            },
            content,
            default_source=term.detection_source,
            default_confidence=term.confidence,
        )
        if candidate is None:
            invalid_ids.append(term.id)
        else:
            valid.append(term)
    delete_document_term_candidates_by_id(project_id, invalid_ids)
    return valid


def schedule_term_model_scan(
    project_id: int,
    source_type: str,
    source_path: str,
    content: str,
    content_hash: str,
    *,
    local_candidate_count: int = 0,
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
               (project_id,source_type,source_path,content_hash,status,terms_json,
                local_candidate_count,model_candidate_count,created_at,updated_at)
               VALUES(?,?,?,?,?,'[]',?,0,?,?)""",
            (
                project_id, source_type, source_path, content_hash, "queued",
                max(0, int(local_candidate_count)), stamp, stamp,
            ),
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
                       SET status='completed',terms_json=?,model_candidate_count=?,
                           error_message=NULL,updated_at=?
                       WHERE project_id=? AND source_type=? AND source_path=? AND content_hash=?""",
                    (
                        json.dumps(model_terms, ensure_ascii=False), len(model_terms), stamp,
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


def _load_document_content(project_id: int, source_type: str, source_path: str) -> str:
    source_path = _normalize_source_path(source_path)
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
    return content


def get_document_term_status(
    project_id: int,
    source_type: str,
    source_path: str,
) -> dict[str, object]:
    source_path = _normalize_source_path(source_path)
    content = _load_document_content(project_id, source_type, source_path)
    if not content:
        return {
            "source_type": source_type,
            "source_path": source_path,
            "content_hash": "",
            "scan_status": "missing_source",
            "model_scan_authorized": _term_scan_enabled(),
            "candidate_count": 0,
            "high_confidence_count": 0,
            "local_candidate_count": 0,
            "model_candidate_count": 0,
            "error_message": "Document content is unavailable",
            "updated_at": None,
        }

    terms = register_document_terms(project_id, source_type, source_path, content)
    content_hash = hashlib.sha256(content.encode("utf-8", errors="ignore")).hexdigest()
    state = get_term_scan_state(project_id, source_type, source_path, content_hash)
    authorized = _term_scan_enabled()
    high_confidence_count = sum(1 for term in terms if term.confidence >= 0.8)
    needs_model_scan = len(terms) < 4 or high_confidence_count < 3
    return {
        "source_type": source_type,
        "source_path": source_path,
        "content_hash": content_hash,
        "scan_status": state.status if state else (
            "local_only" if not authorized else "idle" if needs_model_scan else "completed"
        ),
        "model_scan_authorized": authorized,
        "candidate_count": len(terms),
        "high_confidence_count": high_confidence_count,
        "local_candidate_count": state.local_candidate_count if state else len(terms),
        "model_candidate_count": state.model_candidate_count if state else 0,
        "error_message": state.error_message if state else None,
        "updated_at": state.updated_at if state else None,
    }


def rescan_document_terms(
    project_id: int,
    source_type: str,
    source_path: str,
) -> dict[str, object]:
    source_path = _normalize_source_path(source_path)
    content = _load_document_content(project_id, source_type, source_path)
    if content:
        content_hash = hashlib.sha256(content.encode("utf-8", errors="ignore")).hexdigest()
        delete_term_scan_state(project_id, source_type, source_path, content_hash)
        register_document_terms(project_id, source_type, source_path, content)
    return get_document_term_status(project_id, source_type, source_path)


def ensure_document_terms(project_id: int, source_type: str, source_path: str) -> list[DocumentTerm]:
    source_path = _normalize_source_path(source_path)
    content = _load_document_content(project_id, source_type, source_path)
    if content:
        return register_document_terms(project_id, source_type, source_path, content)
    return list_document_terms(project_id, source_type, source_path)
