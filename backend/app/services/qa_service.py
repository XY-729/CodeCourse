from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from app.models.schemas import QAAskRequest
from app.services.generation_service import project_course_dir
from app.services.prompt_store import load_prompt
from app.services.llm_client import call_openai_compatible_chat
from app.services.storage import (
    QARecord,
    create_qa_record,
    delete_qa_record,
    get_llm_settings,
    get_qa_record,
    list_qa_records,
    set_qa_favorite,
    update_qa_record,
)


def _generate_title_from_question(question: str) -> str:
    text = question.strip()
    for prefix in [
        "请解释这段内容：", "请解释：", "请解释",
        "解释这段内容：", "解释：", "解释",
        "请问：", "请问", "问：", "问题：",
        "这段代码是做什么的：", "这段代码",
    ]:
        if text.startswith(prefix):
            text = text[len(prefix):].strip()
            break
    text = re.sub(r'\s+', ' ', text)
    if len(text) > 50:
        text = text[:50].rstrip()
    if not text:
        return "选区问答说明"
    if not any(text.endswith(s) for s in ["分析", "说明", "解释", "介绍", "实现", "原理", "流程"]):
        text = text + "说明"
    return text


def _safe_filename(title: str, record_id: int, max_len: int = 80) -> str:
    safe = re.sub(r'[^\w一-鿿\s-]', '', title)
    safe = re.sub(r'[\s_]+', '_', safe).strip('_')
    if len(safe) > max_len:
        safe = safe[:max_len].rstrip('_')
    return f"{safe or 'qa_record'}_{record_id:04d}"


def _selection_answers_dir(project_id: int) -> Path:
    return project_course_dir(project_id) / "selection_answers"


def _resolve_output_path(project_id: int, relative_output_path: str) -> Path:
    course_dir = project_course_dir(project_id)
    return (course_dir / relative_output_path).resolve()


def _format_record_markdown(record: QARecord) -> str:
    source_path = record.source_path or "(无路径)"
    favorite = "true" if record.favorite else "false"
    title = record.display_title or f"问答记录 #{record.id}"
    selected_text = record.selected_text or "无选区内容"
    return f"""# {title}

> 来源类型：{record.source_type}
> 来源路径：{source_path}
> 模型：{record.model}
> 收藏：{favorite}
> 创建时间：{record.created_at}
> 更新时间：{record.updated_at}

## 问题

{record.question}

## 选中内容

```text
{selected_text}
```

## 回答

{record.answer_md}
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
    settings = _settings_for_request(payload)
    selected_text = payload.selected_text.strip()
    question = payload.question.strip()
    if not question:
        raise RuntimeError("问题为空，无法提问。")
    selected_text_for_prompt = selected_text or "无选区内容。请优先回答用户问题，并说明由于没有选区，只能基于问题本身给出通用学习建议。"

    prompt = f"""请基于用户选中的代码或课件片段回答问题。目标是教学，不是泛泛解释。

来源类型：{payload.source_type}
来源路径：{payload.source_path or "(无路径)"}
用户问题：
{question}

选中内容：
```text
{selected_text_for_prompt}
```

输出要求：
1. 先直接回答用户问题。
2. 引用选中内容中的关键符号、语句或概念作为证据。
3. 如果需要联系上下文，请明确说明哪些信息缺失，不要编造。
4. 给出 1-3 个下一步阅读建议。
5. 输出 Markdown。
"""
    answer = call_openai_compatible_chat(
        settings["base_url"],
        settings["api_key"],
        settings["model"],
        [
            {"role": "system", "content": load_prompt("prompt.system")},
            {"role": "user", "content": prompt},
        ],
        timeout=90,
    ).strip()
    if not answer:
        raise RuntimeError("模型返回为空内容，未创建问答记录。")

    title = _generate_title_from_question(question)

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
    )

    safe_name = _safe_filename(title, record.id)
    relative_path = f"selection_answers/{safe_name}.md"
    record_with_path = update_qa_record(project_id, record.id, output_path=Path(relative_path))
    if record_with_path is None:
        raise RuntimeError("QA record disappeared during path update")

    return _write_record_markdown(record_with_path)


def search_records(project_id: int, query: str = "", favorite: Optional[bool] = None) -> list[QARecord]:
    return list_qa_records(project_id, query=query, favorite=favorite)


def read_record(project_id: int, record_id: int) -> Optional[QARecord]:
    return get_qa_record(project_id, record_id)


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
    return _write_record_markdown(record)


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
