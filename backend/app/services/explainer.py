from __future__ import annotations

from pathlib import Path
from typing import Optional

from app.core.config import LLM_API_KEY, LLM_PROVIDER
from app.services.scanner import infer_language


def explain(repo_root: Path, path: Optional[str], selection: Optional[str], mode: str) -> tuple[str, str]:
    provider = LLM_PROVIDER if LLM_PROVIDER and LLM_API_KEY else "template"
    target = path or "当前项目"
    selection_hint = ""
    if selection:
        trimmed = selection.strip().replace("\n", " ")[:300]
        selection_hint = f"\n\n选中文本摘要：{trimmed}"

    language = "markdown" if mode == "course" else "plaintext"
    if path and mode != "course":
        language = infer_language(Path(path))

    if provider != "template":
        return provider, "LLM provider 已配置，但 MVP 尚未绑定具体模型 SDK。当前先回退到规则解释。"

    explanation = f"""阅读对象：`{target}`

类型判断：{language}

建议阅读方式：
1. 先看文件名和所在目录，判断它是入口、配置、文档还是核心模块。
2. 如果是配置文件，优先关注依赖、脚本、构建目标和环境变量。
3. 如果是源码文件，先找导出的函数、类、路由或命令入口，再顺着调用关系阅读。
4. 对照左侧课程目录，把这个文件放回项目整体学习路径中。{selection_hint}
"""
    return "template", explanation
