from __future__ import annotations

from pathlib import Path
from typing import Optional

from app.models.schemas import QAAskRequest
from app.services.generation_service import PROMPT_INJECTION_SYSTEM_PROMPT, project_course_dir
from app.services.llm_client import call_openai_compatible_chat
from app.services.storage import (
    QARecord,
    create_qa_record,
    get_llm_settings,
    get_qa_record,
    list_qa_records,
    set_qa_favorite,
    update_qa_record,
)


def _qa_dir(project_id: int) -> Path:
    return project_course_dir(project_id) / "qa"


def _record_path(project_id: int, record_id: int) -> Path:
    return _qa_dir(project_id) / f"qa_{record_id:04d}.md"


def _format_record_markdown(record: QARecord) -> str:
    source_path = record.source_path or "(无路径)"
    favorite = "true" if record.favorite else "false"
    title = record.display_title or f"选区问答 #{record.id}"
    selected_text = record.selected_text or "无选区内容"
    return f"""# {title}

> 来源类型：{record.source_type}
> 来源路径：{source_path}
> 显示标题：{title}
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
    path = _record_path(record.project_id, record.id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_format_record_markdown(record), encoding="utf-8")
    updated = update_qa_record(record.project_id, record.id, output_path=path)
    if updated is None:
        raise RuntimeError("QA record disappeared after markdown write")
    return updated


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
            {"role": "system", "content": PROMPT_INJECTION_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        timeout=90,
    ).strip()
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
    )
    return _write_record_markdown(record)


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
