from __future__ import annotations

from pathlib import Path
from typing import Optional

from app.core.config import LLM_API_KEY, LLM_PROVIDER
from app.services.llm_client import call_openai_compatible_chat
from app.services.scanner import infer_language, read_text_file
from app.services.storage import get_llm_settings


def _template_explanation(target: str, language: str, selection_hint: str) -> str:
    return f"""阅读对象：`{target}`

类型判断：{language}

建议阅读方式：
1. 先看文件名和所在目录，判断它是入口、配置、文档还是核心模块。
2. 如果是配置文件，优先关注依赖、脚本、构建目标和环境变量。
3. 如果是源码文件，先找导出的函数、类、路由或命令入口，再顺着调用关系阅读。
4. 对照左侧课程目录，把这个文件放回项目整体学习路径中。{selection_hint}
"""


def explain(repo_root: Path, path: Optional[str], selection: Optional[str], mode: str) -> tuple[str, str]:
    settings = get_llm_settings()
    configured = settings["enabled"] == "true" and bool(settings["api_key"])
    provider = settings["provider"] if configured else (LLM_PROVIDER if LLM_PROVIDER and LLM_API_KEY else "template")
    target = path or "当前项目"
    selection_hint = ""
    if selection:
        trimmed = selection.strip().replace("\n", " ")[:300]
        selection_hint = f"\n\n选中文本摘要：{trimmed}"

    language = "markdown" if mode == "course" else "plaintext"
    if path and mode != "course":
        language = infer_language(Path(path))

    template = _template_explanation(target, language, selection_hint)
    if configured:
        snippet = ""
        if path and mode == "file":
            try:
                content, _ = read_text_file(repo_root, path)
                snippet = content[:4000]
            except Exception:
                snippet = ""
        prompt = f"""你是一个面向代码学习的项目讲师。请用中文解释当前阅读对象，聚焦学习路径、文件职责、关键概念和下一步阅读建议。

阅读对象：{target}
类型：{language}
模式：{mode}
选中文本：{selection or ""}
文件片段：
{snippet}
"""
        try:
            explanation = call_openai_compatible_chat(
                settings["base_url"],
                settings["api_key"],
                settings["model"],
                [
                    {"role": "system", "content": "你是一个耐心、准确的代码学习导师。不要声称运行过代码。"},
                    {"role": "user", "content": prompt},
                ],
            )
            return provider, explanation
        except RuntimeError as exc:
            return "template", f"LLM 调用失败，已回退到规则解释。\n\n失败原因：{exc}\n\n{template}"

    return "template", template
