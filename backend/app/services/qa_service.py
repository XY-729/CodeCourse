from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from fastapi import HTTPException

from app.models.schemas import QAAskRequest
from app.services.generation_service import extract_file_signals, project_course_dir
from app.services.knowledge_service import attach_learning_anchor, attach_qa_record, remove_learning_anchor_node
from app.services.prompt_store import load_prompt
from app.services.llm_client import call_openai_compatible_chat
from app.services.scanner import read_text_file
from app.services.storage import (
    LearningAnchor,
    QARecord,
    create_qa_record,
    delete_learning_anchor,
    delete_qa_record,
    get_or_create_qa_session,
    get_project,
    get_document_term,
    get_learning_anchor,
    get_llm_settings,
    get_qa_record,
    list_recent_qa_records,
    list_qa_records,
    list_qa_session_records,
    search_learning_anchors,
    search_code_chunks,
    set_qa_favorite,
    update_qa_session_memory,
    update_qa_record,
    update_document_term_status,
    upsert_learning_anchor,
)
from app.services.term_service import parse_term_metadata, register_document_terms


TITLE_LINE_RE = re.compile(r"^\s*(?:TITLE|标题)\s*[:：]\s*(.+?)\s*$", re.IGNORECASE)
TITLE_SPLIT_RE = re.compile(r"[:：,，。；;、\s]+")


def _clean_title(text: str, max_len: int = 60) -> str:
    cleaned = re.sub(r"\s+", " ", text.strip().strip("#").strip())
    cleaned = cleaned.strip("「」『』[]【】`*_ ")
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rstrip()
    return cleaned


def _selection_title_fragment(selected_text: str) -> str:
    text = selected_text.strip()
    if not text:
        return ""
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    first_line = re.sub(r"[`*_#>\[\]{}()]+", " ", first_line)
    first_line = re.sub(r"\s+", " ", first_line).strip(" ：:，,。.;；")
    if len(first_line) > 24:
        first_line = first_line[:24].rstrip()
    return first_line


def _compact_title(candidate: str, selected_text: str) -> str:
    selected_fragment = _selection_title_fragment(selected_text)
    if selected_fragment and len(selected_fragment) <= 24:
        return selected_fragment
    title = _clean_title(candidate)
    if not title:
        return selected_fragment
    head = TITLE_SPLIT_RE.split(title, maxsplit=1)[0].strip()
    if 1 <= len(head) <= 24:
        return head
    if len(title) > 24:
        return title[:24].rstrip()
    return title


def _fallback_title(question: str, selected_text: str, source_path: Optional[str]) -> str:
    question_text = _clean_title(question, max_len=50)
    selected_fragment = _selection_title_fragment(selected_text)
    generic_questions = {
        "这是什么",
        "这是啥",
        "这个是什么",
        "什么意思",
        "这是什么意思",
        "解释",
        "请解释",
        "说明一下",
        "介绍一下",
    }
    is_generic = question_text in generic_questions or (len(question_text) <= 8 and "什么" in question_text)
    if is_generic and selected_fragment:
        return _compact_title(selected_fragment, selected_text)
    if selected_fragment and question_text:
        return _compact_title(selected_fragment, selected_text)
    if question_text:
        return _compact_title(question_text, selected_text)
    return "选区问答"


def _parse_answer_title(raw_answer: str, question: str, selected_text: str, source_path: Optional[str]) -> tuple[str, str]:
    lines = raw_answer.strip().splitlines()
    while lines and not lines[0].strip():
        lines.pop(0)
    if lines:
        match = TITLE_LINE_RE.match(lines[0])
        if match:
            title = _compact_title(match.group(1), selected_text) or _fallback_title(question, selected_text, source_path)
            answer = "\n".join(lines[1:]).strip()
            return title, answer
    return _fallback_title(question, selected_text, source_path), raw_answer.strip()


def _render_prompt_template(template: str, values: dict[str, str]) -> str:
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace("{" + key + "}", value)
    return rendered


def _safe_filename(title: str, record_id: int, max_len: int = 80) -> str:
    safe = re.sub(r"[^\w\u4e00-\u9fff\s-]", "", title)
    safe = re.sub(r'[\s_]+', '_', safe).strip('_')
    if len(safe) > max_len:
        safe = safe[:max_len].rstrip('_')
    return f"{safe or 'qa_record'}_{record_id:04d}"


def _selection_answers_dir(project_id: int) -> Path:
    return project_course_dir(project_id) / "selection_answers"


def _resolve_output_path(project_id: int, relative_output_path: str) -> Path:
    course_dir = project_course_dir(project_id)
    return (course_dir / relative_output_path).resolve()


def _shorten(text: str, limit: int = 5000) -> str:
    cleaned = text.strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rstrip() + "\n\n...[已截断]"


def _project_root(project_id: int) -> Optional[Path]:
    project = get_project(project_id)
    if project is None:
        return None
    return Path(project.local_path).resolve()


def _read_generated_markdown(project_id: int, relative_path: str, limit: int = 5000) -> str:
    course_dir = project_course_dir(project_id).resolve()
    target = (course_dir / relative_path).resolve()
    if target != course_dir and course_dir not in target.parents:
        return ""
    if not target.is_file():
        return ""
    try:
        return _shorten(target.read_text(encoding="utf-8"), limit)
    except UnicodeDecodeError:
        return ""


def _project_context(project_id: int) -> str:
    project_map = _read_generated_markdown(project_id, "project_map.md", 4000)
    outline = _read_generated_markdown(project_id, "outline.md", 4000)
    parts = ["上下文类型：项目级问题"]
    if project_map:
        parts.append(f"\n项目结构说明摘要：\n```markdown\n{project_map}\n```")
    if outline:
        parts.append(f"\n学习总纲摘要：\n```markdown\n{outline}\n```")
    if len(parts) == 1:
        parts.append("\n当前项目还没有可用的 project_map.md 或 outline.md，请基于项目名称和用户问题回答，并明确说明材料不足。")
    return "\n".join(parts)


def _file_context(project_id: int, source_path: Optional[str]) -> str:
    if not source_path:
        return _project_context(project_id)
    root = _project_root(project_id)
    if root is None:
        return f"上下文类型：当前代码文件\n文件路径：{source_path}\n无法读取项目记录。"
    try:
        content, language = read_text_file(root, source_path)
    except HTTPException as exc:
        return f"上下文类型：当前代码文件\n文件路径：{source_path}\n读取失败：{exc.detail}"
    imports, symbols = extract_file_signals(content)
    head = content[:2200]
    tail = content[-2200:] if len(content) > 2200 else ""
    return f"""上下文类型：当前代码文件
文件路径：{source_path}
语言：{language}
文件大小：{len(content.encode("utf-8"))} bytes

import/include/依赖线索：
{chr(10).join(imports[:30]) or "无明显 import/include"}

函数/类/配置项线索：
{", ".join(symbols[:60]) or "未从正则中提取到明显符号"}

文件开头摘要：
```text
{head}
```

文件结尾摘要：
```text
{tail or "(同文件开头，文件较短)"}
```"""


def _course_context(project_id: int, source_path: Optional[str]) -> str:
    if not source_path:
        return _project_context(project_id)
    content = _read_generated_markdown(project_id, source_path, 7000)
    if not content:
        return f"上下文类型：当前课件\n课件路径：{source_path}\n课件内容无法读取，请基于路径和用户问题回答。"
    return f"""上下文类型：当前课件或回答 Markdown
路径：{source_path}

内容摘要：
```markdown
{content}
```"""


def _qa_context(project_id: int, payload: QAAskRequest) -> str:
    record: Optional[QARecord] = None
    if payload.parent_qa_id:
        record = get_qa_record(project_id, payload.parent_qa_id)
    if record is None and payload.source_path:
        from app.services.storage import get_qa_record_by_output_path

        record = get_qa_record_by_output_path(project_id, payload.source_path)
    if record is None:
        return _project_context(project_id)
    return f"""上下文类型：已有 AI 回答
回答标题：{record.display_title or f'回答 #{record.id}'}
原问题：{record.question}
回答内容：
```markdown
{_shorten(record.answer_md, 6000)}
```"""


def _range_context(project_id: int, source_path: Optional[str], selection_range) -> str:
    if not source_path or selection_range is None:
        return ""
    root = _project_root(project_id)
    if root is None:
        return ""
    try:
        content, language = read_text_file(root, source_path)
    except HTTPException:
        return ""
    lines = content.splitlines()
    start = max(1, min(selection_range.start_line, len(lines) or 1))
    end = max(start, min(selection_range.end_line, len(lines) or start))
    window_start = max(1, start - 40)
    window_end = min(len(lines), end + 40)
    numbered = "\n".join(f"{idx}: {lines[idx - 1]}" for idx in range(window_start, window_end + 1))
    imports, symbols = extract_file_signals(content)
    return f"""选区所在文件上下文：
文件路径：{source_path}
语言：{language}
选区行号：{start}-{end}
上下文窗口：{window_start}-{window_end}

同文件 import/include：
{chr(10).join(imports[:20]) or "无明显 import/include"}

同文件符号线索：
{", ".join(symbols[:50]) or "未提取到明显符号"}

选区前后文：
```text
{numbered}
```"""


def _retrieval_query(payload: QAAskRequest, question: str, selected_text: str) -> str:
    parts = [question, selected_text, payload.source_path or ""]
    return "\n".join(part for part in parts if part.strip())


def _retrieval_context(project_id: int, payload: QAAskRequest, question: str, selected_text: str) -> tuple[str, str]:
    query = _retrieval_query(payload, question, selected_text)
    if not query.strip():
        return "", ""
    chunks = search_code_chunks(project_id, query, source_path=payload.source_path, limit=8)
    anchors = search_learning_anchors(project_id, query, limit=3)
    blocks: list[str] = []
    trace_lines: list[str] = []
    for index, chunk in enumerate(chunks, start=1):
        header = f"[{index}] {chunk.path}:{chunk.start_line}-{chunk.end_line}"
        if chunk.symbol_name:
            header += f" symbol={chunk.symbol_name}"
        header += f" type={chunk.chunk_type}"
        text = chunk.content[:2200]
        blocks.append(f"{header}\n```text\n{text}\n```")
        trace_lines.append(header)
    anchor_blocks = [
        f"[学习者已理解] {anchor.term_text or '个人总结'}\n{anchor.summary}"
        for anchor in anchors
    ]
    if not blocks and not anchor_blocks:
        return "", ""
    sections: list[str] = []
    if anchor_blocks:
        sections.append("学习者自己的理解（优先参考）：\n" + "\n\n".join(anchor_blocks))
        trace_lines.extend(f"[anchor] {anchor.term_text or anchor.id}" for anchor in anchors)
    if blocks:
        sections.append("RAG 检索参考片段：\n" + "\n\n".join(blocks))
    return "\n\n".join(sections), "\n".join(trace_lines)


def _session_context(project_id: int, session_id: int) -> str:
    session_records = list_recent_qa_records(project_id, session_id, limit=5)
    session = get_or_create_qa_session(project_id, session_id)
    parts = [f"当前会话记忆：\n{session.memory_summary or '暂无历史记忆。'}"]
    if session.active_source_path:
        parts.append(f"当前负责解释的文件/课件：{session.active_source_path}")
    if session_records:
        recent = []
        for record in reversed(session_records):
            recent.append(f"- Q: {record.question}\n  A: {_shorten(record.answer_md, 400)}")
        parts.append("最近几轮问答：\n" + "\n".join(recent))
    return "\n\n".join(parts)


def _refresh_session_memory(project_id: int, session_id: int, active_source_path: Optional[str]) -> None:
    project = get_project(project_id)
    records = list_recent_qa_records(project_id, session_id, limit=6)
    lines = [
        f"项目：{project.name if project else project_id}",
        f"项目类型：{project.project_type if project else 'unknown'}",
    ]
    if active_source_path:
        lines.append(f"当前负责解释：{active_source_path}")
    for record in reversed(records):
        lines.append(f"用户问：{record.question}")
        lines.append(f"回答要点：{_shorten(record.answer_md, 220)}")
    update_qa_session_memory(project_id, session_id, "\n".join(lines), active_source_path)


def _build_assistant_context(project_id: int, payload: QAAskRequest, selected_text: str) -> str:
    question = payload.question.strip()
    base_context = ""
    range_context = _range_context(project_id, payload.source_path, payload.selection_range)
    if selected_text:
        base_context = f"""上下文类型：用户附带上下文
来源类型：{payload.source_type}
来源路径：{payload.source_path or "(无路径)"}

附带上下文：
```text
{selected_text}
```"""
    elif payload.source_type == "file":
        base_context = _file_context(project_id, payload.source_path)
    elif payload.source_type == "course":
        base_context = _course_context(project_id, payload.source_path)
    elif payload.source_type == "qa":
        base_context = _qa_context(project_id, payload)
    else:
        base_context = _project_context(project_id)
    retrieval_context, _ = _retrieval_context(project_id, payload, question, selected_text)
    return "\n\n".join(part for part in [base_context, range_context, retrieval_context] if part.strip())


def _format_record_markdown(record: QARecord) -> str:
    source_path = record.source_path or "(无路径)"
    favorite = "true" if record.favorite else "false"
    title = record.display_title or f"问答记录 #{record.id}"
    context_text = record.selected_text or "无附带上下文，回答基于当前文件、课件或项目摘要。"
    reference_block = ""
    if record.retrieval_trace:
        reference_block = f"""## 参考片段

```text
{record.retrieval_trace}
```
"""
    return f"""# {title}

## 问题

{record.question}

## 附带上下文

```text
{context_text}
```

## 回答

{record.answer_md}

{reference_block}

---

## 记录信息

- 来源类型：{record.source_type}
- 来源路径：{source_path}
- 模型：{record.model}
- 收藏：{favorite}
- 创建时间：{record.created_at}
- 更新时间：{record.updated_at}
"""


def _write_record_markdown(record: QARecord) -> QARecord:
    if record.output_path:
        full_path = _resolve_output_path(record.project_id, record.output_path)
    else:
        safe_name = _safe_filename(record.display_title or "qa", record.id)
        full_path = _selection_answers_dir(record.project_id) / f"{safe_name}.md"
        rel_path = f"selection_answers/{safe_name}.md"
        updated = update_qa_record(record.project_id, record.id, output_path=Path(rel_path))
        if updated is None:
            raise RuntimeError("QA record disappeared during path update")
        record = updated

    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_text(_format_record_markdown(record), encoding="utf-8")
    return record


def _settings_for_request(payload: QAAskRequest) -> dict[str, str]:
    settings = get_llm_settings()
    if settings.get("enabled") != "true" or not settings.get("api_key"):
        raise RuntimeError("模型 API 未配置或未启用，无法生成选区问答。")
    return {
        "provider": payload.provider.strip() or settings.get("provider", "deepseek"),
        "base_url": payload.base_url.strip().rstrip("/") or settings.get("base_url", "https://api.deepseek.com"),
        "model": payload.model.strip() or settings.get("model", "deepseek-v4-flash"),
        "api_key": settings["api_key"],
    }


def ask_question(project_id: int, payload: QAAskRequest) -> QARecord:
    term = get_document_term(project_id, payload.term_candidate_id) if payload.term_candidate_id else None
    if term and term.qa_record_id:
        existing = get_qa_record(project_id, term.qa_record_id)
        if existing:
            return existing
    parent = get_qa_record(project_id, payload.parent_qa_id) if payload.parent_qa_id else None
    if payload.parent_qa_id and parent is None:
        raise RuntimeError("父级回答不存在，无法继续当前分支。")
    settings = _settings_for_request(payload)
    selected_text = (term.term_text if term else payload.selected_text).strip()
    question = payload.question.strip()
    if not question:
        raise RuntimeError("问题为空，无法提问。")
    session_id = parent.session_id if parent and parent.session_id else payload.session_id
    session = get_or_create_qa_session(project_id, session_id)
    context_text = _build_assistant_context(project_id, payload, selected_text)
    retrieval_context, retrieval_trace = _retrieval_context(project_id, payload, question, selected_text)
    session_context = _session_context(project_id, session.id)
    if retrieval_context and retrieval_context not in context_text:
        context_text = f"{context_text}\n\n{retrieval_context}"

    prompt = _render_prompt_template(
        load_prompt("prompt.qa.answer"),
        {
            "source_type": payload.source_type,
            "source_path": payload.source_path or "(无路径)",
            "question": question,
            "selected_text": selected_text,
            "context_text": context_text,
            "session_context": session_context,
        },
    )
    raw_answer = call_openai_compatible_chat(
        settings["base_url"],
        settings["api_key"],
        settings["model"],
        [
            {"role": "system", "content": load_prompt("prompt.system")},
            {"role": "user", "content": prompt},
        ],
        timeout=90,
    ).strip()
    answer_without_terms, model_terms = parse_term_metadata(raw_answer)
    title, answer = _parse_answer_title(answer_without_terms, question, selected_text, payload.source_path)
    if not answer:
        raise RuntimeError("模型返回为空内容，未创建问答记录。")

    record = create_qa_record(
        project_id=project_id,
        source_type=payload.source_type,
        source_path=payload.source_path,
        selected_text=selected_text,
        question=question,
        answer_md=answer,
        provider=settings["provider"],
        model=settings["model"],
        display_title=title,
        session_id=session.id,
        retrieval_trace=retrieval_trace,
        parent_qa_id=parent.id if parent else None,
        relation_type=payload.relation_type,
    )

    safe_name = _safe_filename(title, record.id)
    relative_path = f"selection_answers/{safe_name}.md"
    record_with_path = update_qa_record(project_id, record.id, output_path=Path(relative_path))
    if record_with_path is None:
        raise RuntimeError("QA record disappeared during path update")

    written = _write_record_markdown(record_with_path)
    attach_qa_record(written)
    register_document_terms(project_id, "qa", relative_path, written.answer_md, model_terms)
    if term:
        update_document_term_status(project_id, term.id, "linked", written.id)
    _refresh_session_memory(project_id, session.id, payload.source_path)
    return written


def search_records(project_id: int, query: str = "", favorite: Optional[bool] = None) -> list[QARecord]:
    return list_qa_records(project_id, query=query, favorite=favorite)


def read_record(project_id: int, record_id: int) -> Optional[QARecord]:
    return get_qa_record(project_id, record_id)


def read_session_tree(project_id: int, session_id: int) -> list[QARecord]:
    return list_qa_session_records(project_id, session_id)


def save_understanding(project_id: int, record_id: int, summary: str, term_text: Optional[str]) -> LearningAnchor:
    record = get_qa_record(project_id, record_id)
    if record is None:
        raise RuntimeError("问答记录不存在。")
    anchor = upsert_learning_anchor(project_id, record_id, summary.strip(), term_text.strip() if term_text else None)
    attach_learning_anchor(record, anchor)
    return anchor


def read_understanding(project_id: int, record_id: int) -> Optional[LearningAnchor]:
    return get_learning_anchor(project_id, record_id)


def remove_understanding(project_id: int, record_id: int) -> bool:
    removed = delete_learning_anchor(project_id, record_id)
    if removed:
        remove_learning_anchor_node(project_id, record_id)
    return removed


def edit_record(
    project_id: int,
    record_id: int,
    question: Optional[str],
    answer_md: Optional[str],
    display_title: Optional[str] = None,
) -> Optional[QARecord]:
    record = update_qa_record(project_id, record_id, question=question, answer_md=answer_md, display_title=display_title)
    if record is None:
        return None
    written = _write_record_markdown(record)
    if written.output_path:
        register_document_terms(project_id, "qa", written.output_path, written.answer_md)
    return written


def favorite_record(project_id: int, record_id: int, favorite: bool) -> Optional[QARecord]:
    record = set_qa_favorite(project_id, record_id, favorite)
    if record is None:
        return None
    return _write_record_markdown(record)


def delete_record(project_id: int, record_id: int) -> bool:
    record = get_qa_record(project_id, record_id)
    if record is None:
        return False
    if record.output_path:
        try:
            full_path = _resolve_output_path(project_id, record.output_path)
            if full_path.exists():
                full_path.unlink()
        except OSError:
            pass
    return delete_qa_record(project_id, record_id)
