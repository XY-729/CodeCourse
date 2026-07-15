from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from app.core.config import GENERATED_ROOT, PROMPT_VERSION
from app.services.prompt_store import load_prompt, save_prompt
from app.models.schemas import CourseFile, LearningScopeRequest
from app.services.course_generator import (
    generate_course,
    list_course_files_from_dir,
    read_course_file,
)
from app.services.llm_client import call_openai_compatible_chat
from app.services.term_service import parse_term_metadata, register_document_terms, term_metadata_instruction
from app.services.scanner import list_key_files, read_text_file, safe_join, scan_tree
from app.services.storage import (
    create_knowledge_node,
    GenerationTask,
    cleanup_course_artifacts,
    create_generation_task,
    find_knowledge_node,
    find_completed_task,
    get_generation_task,
    get_llm_settings,
    get_project,
    update_generation_task,
    update_project_status,
)




def project_course_dir(project_id: int) -> Path:
    return (GENERATED_ROOT / str(project_id)).resolve()


def list_project_course_files(repo_root: Path, project_id: int) -> list[CourseFile]:
    files = list_course_files_from_dir(project_course_dir(project_id))
    if files:
        return files
    project = get_project(project_id)
    if project is not None and project.project_type == "learning_plan":
        return []
    return generate_rule_course(project_id, repo_root)


def read_project_course_file(repo_root: Path, project_id: int, filename: str) -> str:
    content = read_course_file(repo_root, filename, project_course_dir(project_id))
    # 兼容此前已生成的总纲：不需要再次调用模型，也能补回按课生成入口。
    if filename == "outline.md":
        decorated = add_outline_lesson_links(content)
        if decorated != content:
            _atomic_write(project_course_dir(project_id) / filename, decorated)
        return decorated
    return content


def resolve_project_course_file(project_id: int, filename: str) -> Path:
    root = project_course_dir(project_id).resolve()
    target = (root / filename).resolve()
    if target == root or root not in target.parents:
        raise ValueError("Invalid file path")
    return target


def delete_project_course_file(project_id: int, filename: str) -> bool:
    target = resolve_project_course_file(project_id, filename)
    deleted = target.exists() and target.is_file()
    if deleted:
        target.unlink()
    # A stale course entry can outlive its file after an interrupted task or
    # an older graph deletion. Deletion must still clear all related metadata.
    cleanup_course_artifacts(project_id, filename)
    try:
        parent = target.parent
        root = project_course_dir(project_id).resolve()
        if parent != root and parent.exists() and not any(parent.iterdir()):
            parent.rmdir()
    except OSError:
        pass
    return deleted
def create_empty_course_document(project_id: int, title: str) -> CourseFile:
    """Create an empty markdown course document and a corresponding knowledge node."""
    safe = re.sub(r'[\\/]', '_', title.strip())
    filename = f'{safe}.md'
    course_dir = project_course_dir(project_id)
    course_dir.mkdir(parents=True, exist_ok=True)
    filepath = course_dir / filename
    if filepath.exists():
        raise FileExistsError(f'Document already exists: {filename}')
    _atomic_write(filepath, f'# {title.strip()}\n')
    create_knowledge_node(
        project_id=project_id,
        node_type='course',
        title=title.strip(),
        ref_type='course',
        ref_path=filename,
    )
    return CourseFile(filename=filename, title=title.strip(), group='')



def generate_rule_course(project_id: int, repo_root: Path, scope: str = "full_project") -> list[CourseFile]:
    project = get_project(project_id)
    if project is not None and project.project_type == "learning_plan":
        return []
    return generate_course(repo_root, course_dir=project_course_dir(project_id), scope=scope)


def hash_inputs(*parts: str) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.encode("utf-8", errors="replace"))
        digest.update(b"\0")
    return digest.hexdigest()


def _tree_lines(repo_root: Path, max_lines: int = 260) -> list[str]:
    tree = scan_tree(repo_root)
    lines: list[str] = []

    def walk(node, depth: int) -> None:
        if len(lines) >= max_lines:
            return
        if node.path:
            marker = "/" if node.type == "directory" else ""
            lines.append(f"{'  ' * depth}- {node.path}{marker}")
        for child in node.children:
            walk(child, depth + 1)

    walk(tree, 0)
    return lines


def _read_first_existing(repo_root: Path, names: list[str], limit: int = 7000) -> str:
    for name in names:
        path = repo_root / name
        if path.is_file():
            try:
                return path.read_text(encoding="utf-8")[:limit]
            except UnicodeDecodeError:
                return ""
    return ""


def _key_file_summaries(repo_root: Path, limit_per_file: int = 1600) -> str:
    lines: list[str] = []
    for path in list_key_files(repo_root)[:24]:
        try:
            snippet = path.read_text(encoding="utf-8")[:limit_per_file]
        except UnicodeDecodeError:
            snippet = ""
        rel = path.relative_to(repo_root).as_posix()
        lines.append(f"### {rel}\n```text\n{snippet}\n```")
    return "\n\n".join(lines)


def _scope_to_text(scope: LearningScopeRequest) -> str:
    if scope.type == "full_project":
        return "full_project"
    if scope.type == "learning_plan":
        return "learning_plan"
    paths = ", ".join(scope.paths[:80]) if scope.paths else "(未选择路径)"
    return f"{scope.type}: {paths}"


def _clean_instructions(instructions: str) -> str:
    return instructions.strip()[:4000]


def build_outline_input(repo_root: Path, scope: LearningScopeRequest, instructions: str = "") -> tuple[str, str]:
    if scope.type == "learning_plan":
        user_instructions = _clean_instructions(instructions)
        prompt_input = f"""学习范围：
learning_plan

用户学习计划要求：
{user_instructions or "无"}

说明：
这是一个不绑定 GitHub 仓库的自定义学习计划项目。不要假设存在 README、目录树或源码文件。
"""
        return prompt_input, hash_inputs(PROMPT_VERSION, "outline", "learning_plan", user_instructions)

    readme = _read_first_existing(repo_root, ["README.md", "readme.md", "README.rst", "README.txt"])
    tree = "\n".join(_tree_lines(repo_root))
    key_files = _key_file_summaries(repo_root)
    scope_text = _scope_to_text(scope)
    user_instructions = _clean_instructions(instructions)
    prompt_input = f"""学习范围：
{scope_text}

用户补充要求：
{user_instructions or "无"}

README 摘要：
```text
{readme}
```

目录树：
```text
{tree}
```

关键文件摘要：
{key_files}
"""
    return prompt_input, hash_inputs(PROMPT_VERSION, "outline", scope_text, user_instructions, readme, tree, key_files)


def _llm_settings_or_error() -> dict[str, str]:
    settings = get_llm_settings()
    if settings.get("enabled") != "true" or not settings.get("api_key"):
        raise RuntimeError('模型 API 未配置或未启用。不会自动生成 AI 内容，请先在“模型 API”中配置并启用。')
    return settings


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(content, encoding="utf-8")
    temp_path.replace(path)


def _require_markdown(content: str) -> str:
    normalized = content.strip()
    if not normalized:
        raise RuntimeError("模型返回为空内容。旧课件已保留。")
    if "#" not in normalized and "|" not in normalized and "```" not in normalized:
        raise RuntimeError("模型返回不像 Markdown，已拒绝覆盖旧课件。")
    return normalized + "\n"


def _parse_outline_files(content: str) -> tuple[str, str]:
    normalized = _require_markdown(content)
    pattern = re.compile(r"^## FILE:\s*(project_map\.md|outline\.md)\s*$", re.MULTILINE)
    matches = list(pattern.finditer(normalized))
    sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(normalized)
        sections[match.group(1)] = normalized[start:end].strip() + "\n"
    if "outline.md" not in sections or "project_map.md" not in sections:
        raise RuntimeError("模型未按 project_map.md / outline.md 双文件格式返回，已拒绝覆盖旧课件。")
    return sections["project_map.md"], sections["outline.md"]


LESSON_LINKS_START = "<!-- CODECOURSE_LESSON_LINKS_START -->"
LESSON_LINKS_END = "<!-- CODECOURSE_LESSON_LINKS_END -->"
LESSON_HEADING_PATTERN = re.compile(r"^###\s*第\s*(\d+)\s*课\s*[：:]\s*(.+?)\s*$", re.MULTILINE)
LESSON_TABLE_PATTERN = re.compile(r"^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|", re.MULTILINE)


def extract_outline_lessons(outline: str) -> list[tuple[int, str]]:
    lessons = [(int(match.group(1)), match.group(2).strip()) for match in LESSON_HEADING_PATTERN.finditer(outline)]
    if not lessons:
        for match in LESSON_TABLE_PATTERN.finditer(outline):
            title = match.group(2).strip()
            if title and title not in {"课程名称", "课程"}:
                lessons.append((int(match.group(1)), title))
    seen: set[int] = set()
    return [(number, title) for number, title in lessons if not (number in seen or seen.add(number))][:12]


def add_outline_lesson_links(outline: str) -> str:
    cleaned = re.sub(
        rf"\n?{re.escape(LESSON_LINKS_START)}.*?{re.escape(LESSON_LINKS_END)}\n?",
        "\n",
        outline,
        flags=re.DOTALL,
    ).rstrip()
    lessons = extract_outline_lessons(cleaned)
    if not lessons:
        return cleaned + "\n"
    lines = [
        LESSON_LINKS_START,
        "## 按课生成课件",
        "> 课件按需生成。点击一节课后会请求模型，并优先使用项目索引中的相关代码片段。",
        "",
    ]
    for number, title in lessons:
        lines.append(f"- [生成第 {number} 课：{title}](https://codecourse.local/generate-lesson/{number}?title={quote(title, safe='')})")
    lines.extend([LESSON_LINKS_END, ""])
    return cleaned + "\n\n" + "\n".join(lines)


def _lesson_outline_section(outline: str, lesson_number: int, fallback_title: str) -> tuple[str, str]:
    matches = list(LESSON_HEADING_PATTERN.finditer(outline))
    for index, match in enumerate(matches):
        if int(match.group(1)) == lesson_number:
            end = matches[index + 1].start() if index + 1 < len(matches) else len(outline)
            return match.group(2).strip(), outline[match.start():end].strip()
    return fallback_title.strip(), f"### 第 {lesson_number} 课：{fallback_title.strip()}"


def _outline_lesson_filename(lesson_number: int) -> str:
    return f"lessons/lesson_{lesson_number:02d}.md"


def build_outline_lesson_input(
    project_id: int,
    repo_root: Path,
    lesson_number: int,
    requested_title: str,
    instructions: str = "",
) -> tuple[str, str, str]:
    outline_path = project_course_dir(project_id) / "outline.md"
    if not outline_path.is_file():
        raise RuntimeError("请先生成项目学习总纲，再生成课件。")
    outline = outline_path.read_text(encoding="utf-8")
    lesson_title, lesson_section = _lesson_outline_section(outline, lesson_number, requested_title)
    project = get_project(project_id)
    user_instructions = _clean_instructions(instructions)
    if project is not None and project.project_type == "learning_plan":
        lesson_input = "\n\n".join(
            [
                "学习计划总纲：\n```markdown\n" + outline[:10000] + "\n```",
                "本课计划：\n```markdown\n" + lesson_section + "\n```",
            ]
        )
        input_hash = hash_inputs(
            PROMPT_VERSION,
            "learning_plan_lesson",
            str(lesson_number),
            lesson_title,
            user_instructions,
            outline,
        )
        return lesson_title, lesson_input, input_hash

    search_query = f"{lesson_title} {lesson_section[:1200]}".strip()
    rag_context = "索引中没有匹配片段。"
    try:
        # 延迟导入以避开 index_service 与本模块之间的循环依赖。
        from app.services.index_service import search_project

        results = search_project(project_id, search_query, limit=10)
        if results:
            rag_context = "\n\n".join(
                f"### {item.path}:{item.start_line}-{item.end_line}\n```{item.language}\n{item.content[:3600]}\n```"
                for item in results
            )
    except Exception:
        pass
    lesson_input = "\n\n".join(
        [
            "项目总纲摘要：\n```markdown\n" + outline[:7000] + "\n```",
            "本课计划：\n```markdown\n" + lesson_section + "\n```",
            "RAG 索引检索片段：\n" + rag_context,
        ]
    )
    input_hash = hash_inputs(
        PROMPT_VERSION,
        "outline_lesson",
        str(lesson_number),
        lesson_title,
        user_instructions,
        outline,
        rag_context,
    )
    return lesson_title, lesson_input, input_hash


def run_outline_generation_task(project_id: int, task_id: int, scope: LearningScopeRequest, instructions: str = "") -> None:
    project = get_project(project_id)
    if project is None:
        update_generation_task(task_id, "failed", error_message="Project not found")
        return
    repo_root = Path(project.local_path).resolve()
    try:
        settings = _llm_settings_or_error()
        update_generation_task(task_id, "running")
        update_project_status(project_id, "generating_outline")
        prompt_input, _ = build_outline_input(repo_root, scope, instructions)
        scope_text = _scope_to_text(scope)
        user_instructions = _clean_instructions(instructions)
        if scope.type == "learning_plan":
            learning_plan_prompt = load_prompt("prompt.learning_plan.outline").format(
                model=settings["model"],
                user_instructions=user_instructions or "无",
            )
            messages = [
                {"role": "system", "content": load_prompt("prompt.system")},
                {
                    "role": "user",
                    "content": learning_plan_prompt + term_metadata_instruction(),
                },
            ]
            content = call_openai_compatible_chat(settings["base_url"], settings["api_key"], settings["model"], messages, timeout=90)
            content, model_terms = parse_term_metadata(content)
            outline = _require_markdown(content)
            output_dir = project_course_dir(project_id)
            _atomic_write(output_dir / "outline.md", add_outline_lesson_links(outline))
            register_document_terms(project_id, "course", "outline.md", outline, model_terms)
            update_generation_task(task_id, "completed", output_path=output_dir)
            update_project_status(project_id, "outline_ready")
            return

        outline_prompt = load_prompt("prompt.outline").format(
            model=settings["model"],
            scope_text=scope_text,
            user_instructions=user_instructions or "无",
            prompt_input=prompt_input,
        ) + term_metadata_instruction()

        messages = [
            {
                "role": "system",
                "content": load_prompt("prompt.system"),
            },
            {
                "role": "user",
                "content": outline_prompt,
            },
        ]
        content = call_openai_compatible_chat(settings["base_url"], settings["api_key"], settings["model"], messages, timeout=90)
        content, model_terms = parse_term_metadata(content)
        project_map, outline = _parse_outline_files(content)
        output_dir = project_course_dir(project_id)
        _atomic_write(output_dir / "project_map.md", project_map)
        _atomic_write(output_dir / "outline.md", add_outline_lesson_links(outline))
        register_document_terms(project_id, "course", "project_map.md", project_map, model_terms)
        register_document_terms(project_id, "course", "outline.md", outline, model_terms)
        update_generation_task(task_id, "completed", output_path=output_dir)
        update_project_status(project_id, "outline_ready")
    except Exception as exc:  # noqa: BLE001
        update_generation_task(task_id, "failed", error_message=str(exc))
        update_project_status(project_id, "outline_failed")


SYMBOL_PATTERNS = [
    re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][\w]*)", re.MULTILINE),
    re.compile(r"^\s*(?:export\s+)?class\s+([A-Za-z_][\w]*)", re.MULTILINE),
    re.compile(r"^\s*(?:export\s+)?interface\s+([A-Za-z_][\w]*)", re.MULTILINE),
    re.compile(r"^\s*def\s+([A-Za-z_][\w]*)", re.MULTILINE),
    re.compile(r"^\s*class\s+([A-Za-z_][\w]*)", re.MULTILINE),
    re.compile(r"^\s*(?:struct|enum)\s+([A-Za-z_][\w]*)", re.MULTILINE),
    re.compile(r"^\s*(?:const|let|var)\s+([A-Za-z_][\w]*)\s*=", re.MULTILINE),
]


def extract_file_signals(content: str) -> tuple[list[str], list[str]]:
    imports: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith(("import ", "from ", "#include", "using ", "require(")) and len(imports) < 50:
            imports.append(stripped[:260])
    symbols: list[str] = []
    for pattern in SYMBOL_PATTERNS:
        for match in pattern.finditer(content):
            name = match.group(1)
            if name not in symbols:
                symbols.append(name)
            if len(symbols) >= 100:
                break
    return imports, symbols[:100]


def build_file_lesson_input(project_id: int, repo_root: Path, relative_path: str, mode: str, instructions: str = "") -> tuple[str, str, str]:
    content, language = read_text_file(repo_root, relative_path)
    path = safe_join(repo_root, relative_path)
    imports, symbols = extract_file_signals(content)
    outline_summary = ""
    outline_path = project_course_dir(project_id) / "outline.md"
    if outline_path.is_file():
        outline_summary = outline_path.read_text(encoding="utf-8")[:5000]
    head = content[:2600]
    tail = content[-2600:] if len(content) > 2600 else ""
    full_content = content if mode == "detailed" and len(content) <= 50000 else ""
    user_instructions = _clean_instructions(instructions)
    sample = f"""文件路径：{relative_path}
语言：{language}
大小：{path.stat().st_size} bytes
所在目录：{Path(relative_path).parent.as_posix()}
生成模式：{mode}
用户补充要求：{user_instructions or "无"}

项目总纲摘要：
```markdown
{outline_summary}
```

import/include 区域：
```text
{chr(10).join(imports)}
```

函数/类/配置项名称：
```text
{chr(10).join(symbols)}
```

文件头部采样：
```{language}
{head}
```

文件尾部采样：
```{language}
{tail}
```
"""
    if full_content:
        sample += f"\n完整文件内容：\n```{language}\n{full_content}\n```\n"
    return sample, language, hash_inputs(PROMPT_VERSION, "file_lesson", relative_path, mode, user_instructions, content, outline_summary)


def _safe_lesson_filename(relative_path: str, mode: str) -> str:
    base = re.sub(r"[^A-Za-z0-9_.-]+", "_", relative_path).strip("_") or "file"
    suffix = "brief" if mode == "brief" else "detailed"
    return f"files/{base}_{suffix}.md"


def run_file_lesson_task(project_id: int, task_id: int, relative_path: str, mode: str, instructions: str = "") -> None:
    project = get_project(project_id)
    if project is None:
        update_generation_task(task_id, "failed", error_message="Project not found")
        return
    repo_root = Path(project.local_path).resolve()
    try:
        settings = _llm_settings_or_error()
        update_generation_task(task_id, "running")
        prompt_input, _, _ = build_file_lesson_input(project_id, repo_root, relative_path, mode, instructions)
        user_instructions = _clean_instructions(instructions)
        mode_label = "粗略介绍" if mode == "brief" else "详细分析"
        expected = load_prompt(f"prompt.file_lesson.{mode}_expected")
        user_prompt = load_prompt("prompt.file_lesson.template").format(
            mode_label=mode_label,
            relative_path=relative_path,
            user_instructions=user_instructions or "无",
            model=settings["model"],
            expected=expected,
            prompt_input=prompt_input,
        ) + term_metadata_instruction()
        messages = [
            {"role": "system", "content": load_prompt("prompt.system")},
            {"role": "user", "content": user_prompt},
        ]
        content = call_openai_compatible_chat(settings["base_url"], settings["api_key"], settings["model"], messages, timeout=90)
        content, model_terms = parse_term_metadata(content)
        lesson = _require_markdown(content)
        if not lesson.lstrip().startswith("#"):
            title = "粗略介绍" if mode == "brief" else "详细分析"
            lesson = f"# {Path(relative_path).name} {title}\n\n{lesson}"
        output_path = project_course_dir(project_id) / _safe_lesson_filename(relative_path, mode)
        _atomic_write(output_path, lesson)
        register_document_terms(project_id, "course", _safe_lesson_filename(relative_path, mode), lesson, model_terms)
        update_generation_task(task_id, "completed", output_path=output_path)
    except Exception as exc:  # noqa: BLE001
        update_generation_task(task_id, "failed", error_message=str(exc))


def _parse_lesson_plan(content: str) -> dict:
    normalized = content.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", normalized, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        normalized = fenced.group(1)
    else:
        start = normalized.find("{")
        end = normalized.rfind("}")
        if start >= 0 and end > start:
            normalized = normalized[start : end + 1]
    try:
        plan = json.loads(normalized)
    except json.JSONDecodeError as exc:
        raise RuntimeError("模型返回的课件章节计划不是有效 JSON，旧课件已保留。") from exc
    if not isinstance(plan, dict):
        raise RuntimeError("模型返回的课件章节计划格式无效，旧课件已保留。")
    sections = plan.get("sections")
    if not isinstance(sections, list) or not 4 <= len(sections) <= 10:
        raise RuntimeError("课件章节计划必须包含 4-10 个章节，旧课件已保留。")
    normalized_sections: list[dict] = []
    for section in sections:
        if not isinstance(section, dict) or not str(section.get("title", "")).strip():
            raise RuntimeError("课件章节计划存在无标题章节，旧课件已保留。")
        raw_items = section.get("items")
        if not isinstance(raw_items, list) or not raw_items:
            raise RuntimeError("课件章节计划中的每个章节都必须列出知识项，旧课件已保留。")
        items: list[dict[str, str]] = []
        for raw_item in raw_items[:24]:
            if isinstance(raw_item, str):
                name = raw_item.strip()
                kind = "concept"
                focus = ""
            elif isinstance(raw_item, dict):
                name = str(raw_item.get("name", "")).strip()
                kind = str(raw_item.get("kind", "concept")).strip() or "concept"
                focus = str(raw_item.get("focus", "")).strip()
            else:
                continue
            if name:
                items.append({"name": name, "kind": kind, "focus": focus})
        if not items:
            raise RuntimeError("课件章节计划存在空知识项，旧课件已保留。")
        normalized_sections.append({"title": str(section["title"]).strip(), "items": items})
    plan["sections"] = normalized_sections
    return plan


def _normalized_coverage_text(value: str) -> str:
    return re.sub(r"[\s`*_#：:（）()\[\]{}<>]+", "", value).casefold()


def _missing_lesson_items(markdown: str, sections: list[dict]) -> list[dict[str, str]]:
    haystack = _normalized_coverage_text(markdown)
    missing: list[dict[str, str]] = []
    for section in sections:
        for item in section["items"]:
            if _normalized_coverage_text(item["name"]) not in haystack:
                missing.append(item)
    return missing


def _lesson_textbook_markdown(plan: dict) -> str:
    textbooks = plan.get("textbooks")
    if not isinstance(textbooks, list) or not textbooks:
        return "## 教材参照\n\n本课未列出能够确认书目信息的教材。"
    lines = [
        "## 教材参照",
        "",
        "> 以下书目来自模型已知的正式出版物，仅作为建议参阅；课件未直接读取教材原文。",
        "",
    ]
    for book in textbooks[:12]:
        if not isinstance(book, dict):
            continue
        title = str(book.get("title", "")).strip()
        author = str(book.get("author", "")).strip()
        topics = str(book.get("topics", "")).strip()
        if title and author:
            detail = f"；相关主题：{topics}" if topics else ""
            lines.append(f"- 《{title}》— {author}{detail}")
    if len(lines) == 4:
        lines.append("本课未列出能够确认书目信息的教材。")
    return "\n".join(lines)


def _run_learning_plan_lesson_task(
    project_id: int,
    task_id: int,
    lesson_number: int,
    lesson_title: str,
    lesson_input: str,
    instructions: str,
    settings: dict[str, str],
) -> tuple[str, str]:
    base_prompt = load_prompt("prompt.learning_plan.lesson")
    user_instructions = _clean_instructions(instructions) or "无"
    update_generation_task(
        task_id,
        "running",
        progress_current=0,
        progress_total=12,
        stage_label="正在规划课件",
    )
    planner_prompt = f"""{base_prompt}

请先为第 {lesson_number} 课“{lesson_title}”制定章节计划。只输出一个 JSON 对象，不要输出 Markdown 或额外解释。

JSON 结构：
{{
  "lesson_title": "课程标题",
  "position": "本课在学习路线中的位置",
  "objectives": ["可验证目标"],
  "sections": [
    {{
      "title": "章节标题",
      "items": [
        {{"name": "必须逐项讲解的函数、API、语法、概念、公式或方法", "kind": "function 或 concept", "focus": "讲解重点"}}
      ]
    }}
  ],
  "textbooks": [
    {{"title": "确信存在的书名", "author": "作者", "topics": "相关章节主题"}}
  ]
}}

章节必须为 4-10 个。知识项应覆盖本课计划中出现的全部关键内容，不能用“其他相关知识”等笼统项。教材不确定时返回空数组，不编造页码、版次或书目。

用户补充要求：{user_instructions}

学习材料：
{lesson_input}
"""
    plan_content = call_openai_compatible_chat(
        settings["base_url"],
        settings["api_key"],
        settings["model"],
        [
            {"role": "system", "content": load_prompt("prompt.system")},
            {"role": "user", "content": planner_prompt},
        ],
        timeout=180,
    )
    plan = _parse_lesson_plan(plan_content)
    sections: list[dict] = plan["sections"]
    total_calls = 1 + len(sections)
    update_generation_task(
        task_id,
        "running",
        progress_current=1,
        progress_total=total_calls,
        stage_label="章节计划已完成",
    )

    staging_dir = project_course_dir(project_id) / ".tasks" / f"task-{task_id}"
    staging_dir.mkdir(parents=True, exist_ok=True)
    generated_sections: list[str] = []
    try:
        for index, section in enumerate(sections, start=1):
            item_lines = "\n".join(
                f"- {item['name']}（类型：{item['kind']}；重点：{item['focus'] or '完整讲清'}）"
                for item in section["items"]
            )
            update_generation_task(
                task_id,
                "running",
                progress_current=index,
                progress_total=total_calls,
                stage_label=f"正在生成 {index}/{len(sections)}：{section['title']}",
            )
            section_prompt = f"""{base_prompt}

现在只生成第 {lesson_number} 课“{lesson_title}”中的一个章节。

章节标题：{section['title']}
本章必须逐项讲解：
{item_lines}

输出要求：
- 直接以 `## {section['title']}` 开始，只输出本章 Markdown。
- 每个知识项必须以包含其完整名称的 `###` 小节单独展开。
- 不能省略任何知识项，不能用一句定义代替讲解。
- 不要输出教材原文长引文，不要声称访问了教材全文。

用户补充要求：{user_instructions}

学习材料：
{lesson_input}
"""
            content = call_openai_compatible_chat(
                settings["base_url"],
                settings["api_key"],
                settings["model"],
                [
                    {"role": "system", "content": load_prompt("prompt.system")},
                    {"role": "user", "content": section_prompt},
                ],
                timeout=240,
            )
            section_markdown = _require_markdown(content)
            if not section_markdown.lstrip().startswith("##"):
                section_markdown = f"## {section['title']}\n\n{section_markdown}"
            _atomic_write(staging_dir / f"section-{index:02d}.part", section_markdown)
            generated_sections.append(section_markdown.strip())
            update_generation_task(
                task_id,
                "running",
                progress_current=index + 1,
                progress_total=total_calls,
                stage_label=f"已完成 {index}/{len(sections)}：{section['title']}",
            )

        joined_sections = "\n\n".join(generated_sections)
        missing = _missing_lesson_items(joined_sections, sections)
        if missing:
            total_calls += 1
            if total_calls > 12:
                raise RuntimeError("课件仍有遗漏知识项，但已达到 12 次 API 调用上限，旧课件已保留。")
            update_generation_task(
                task_id,
                "running",
                progress_current=total_calls - 1,
                progress_total=total_calls,
                stage_label=f"正在补全 {len(missing)} 个遗漏项",
            )
            missing_lines = "\n".join(f"- {item['name']}（{item['kind']}）：{item['focus']}" for item in missing)
            supplement_prompt = f"""{base_prompt}

以下知识项在第 {lesson_number} 课“{lesson_title}”正文中遗漏。请输出 `## 遗漏知识补全`，并为每个知识项建立包含完整名称的独立 `###` 小节，按课件要求完整讲解。

{missing_lines}

用户补充要求：{user_instructions}
"""
            supplement = _require_markdown(
                call_openai_compatible_chat(
                    settings["base_url"],
                    settings["api_key"],
                    settings["model"],
                    [
                        {"role": "system", "content": load_prompt("prompt.system")},
                        {"role": "user", "content": supplement_prompt},
                    ],
                    timeout=240,
                )
            )
            if not supplement.lstrip().startswith("##"):
                supplement = "## 遗漏知识补全\n\n" + supplement
            _atomic_write(staging_dir / "section-supplement.part", supplement)
            generated_sections.append(supplement.strip())
            joined_sections = "\n\n".join(generated_sections)
            if _missing_lesson_items(joined_sections, sections):
                raise RuntimeError("模型补全后仍未覆盖全部规划知识项，旧课件已保留。")

        resolved_title = str(plan.get("lesson_title", "")).strip() or lesson_title
        position = str(plan.get("position", "")).strip() or "本课承接学习总纲中的对应阶段。"
        objectives = plan.get("objectives") if isinstance(plan.get("objectives"), list) else []
        objective_lines = [f"- {str(item).strip()}" for item in objectives if str(item).strip()]
        map_lines = ["| 章节 | 必须掌握的知识项 |", "|---|---|"]
        for section in sections:
            map_lines.append(f"| {section['title']} | {'、'.join(item['name'] for item in section['items'])} |")
        lesson = "\n\n".join(
            [
                f"# 第 {lesson_number} 课：{resolved_title}",
                "> 生成方式：AI 分章节生成  \n> 教材说明：书目仅作为建议参阅，模型未直接读取教材原文。",
                f"## 本课定位\n\n{position}",
                "## 本课目标\n\n" + ("\n".join(objective_lines) if objective_lines else "- 完成本课知识地图中的全部项目。"),
                "## 知识地图\n\n" + "\n".join(map_lines),
                joined_sections,
                _lesson_textbook_markdown(plan),
            ]
        ).strip() + "\n"
        return resolved_title, lesson
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)


def run_outline_lesson_task(
    project_id: int,
    task_id: int,
    lesson_number: int,
    requested_title: str,
    instructions: str = "",
) -> None:
    project = get_project(project_id)
    if project is None:
        update_generation_task(task_id, "failed", error_message="Project not found")
        return
    repo_root = Path(project.local_path).resolve()
    try:
        settings = _llm_settings_or_error()
        update_generation_task(task_id, "running")
        lesson_title, lesson_input, _ = build_outline_lesson_input(
            project_id,
            repo_root,
            lesson_number,
            requested_title,
            instructions,
        )
        if project.project_type == "learning_plan":
            lesson_title, lesson = _run_learning_plan_lesson_task(
                project_id,
                task_id,
                lesson_number,
                lesson_title,
                lesson_input,
                instructions,
                settings,
            )
            relative_path = _outline_lesson_filename(lesson_number)
            output_path = project_course_dir(project_id) / relative_path
            _atomic_write(output_path, lesson)
            register_document_terms(project_id, "course", relative_path, lesson, [])
            node_title = f"第{lesson_number}课"
            existing = find_knowledge_node(
                project_id,
                node_type="course",
                title=node_title,
                ref_type="course",
                ref_path=relative_path,
            )
            if existing is None:
                create_knowledge_node(
                    project_id=project_id,
                    node_type="course",
                    title=node_title,
                    ref_type="course",
                    ref_path=relative_path,
                    summary=lesson_title,
                )
            current_task = get_generation_task(task_id)
            update_generation_task(
                task_id,
                "completed",
                output_path=output_path,
                progress_current=current_task.progress_total if current_task else 0,
                stage_label="生成完成",
            )
            return
        prompt = load_prompt("prompt.outline_lesson").format(
            lesson_number=lesson_number,
            lesson_title=lesson_title,
            user_instructions=_clean_instructions(instructions) or "无",
            lesson_input=lesson_input,
        ) + term_metadata_instruction()
        content = call_openai_compatible_chat(
            settings["base_url"],
            settings["api_key"],
            settings["model"],
            [
                {"role": "system", "content": load_prompt("prompt.system")},
                {"role": "user", "content": prompt},
            ],
            timeout=120,
        )
        content, model_terms = parse_term_metadata(content)
        lesson = _require_markdown(content)
        if not lesson.lstrip().startswith("#"):
            lesson = f"# 第 {lesson_number} 课：{lesson_title}\n\n{lesson}"
        relative_path = _outline_lesson_filename(lesson_number)
        output_path = project_course_dir(project_id) / relative_path
        _atomic_write(output_path, lesson)
        register_document_terms(project_id, "course", relative_path, lesson, model_terms)
        node_title = f"第{lesson_number}课"
        existing = find_knowledge_node(
            project_id,
            node_type="course",
            title=node_title,
            ref_type="course",
            ref_path=relative_path,
        )
        if existing is None:
            create_knowledge_node(
                project_id=project_id,
                node_type="course",
                title=node_title,
                ref_type="course",
                ref_path=relative_path,
                summary=lesson_title,
            )
        update_generation_task(task_id, "completed", output_path=output_path)
    except Exception as exc:  # noqa: BLE001
        update_generation_task(task_id, "failed", error_message=str(exc), stage_label="生成失败")


def create_or_reuse_outline_lesson_task(
    project_id: int,
    repo_root: Path,
    lesson_number: int,
    title: str,
    model: Optional[str],
    instructions: str = "",
) -> tuple[GenerationTask, bool]:
    _, _, input_hash = build_outline_lesson_input(project_id, repo_root, lesson_number, title, instructions)
    project = get_project(project_id)
    prompt_key = "prompt.learning_plan.lesson" if project is not None and project.project_type == "learning_plan" else "prompt.outline_lesson"
    prompt_hash = hash_inputs(input_hash, load_prompt(prompt_key), load_prompt("prompt.system"))
    mode = f"lesson-{lesson_number:02d}"
    cached = find_completed_task(project_id, "outline_lesson", prompt_hash, PROMPT_VERSION, source_path="outline.md", mode=mode)
    if cached and cached.output_path and Path(cached.output_path).exists():
        return cached, True
    output_path = project_course_dir(project_id) / _outline_lesson_filename(lesson_number)
    task = create_generation_task(
        project_id=project_id,
        task_type="outline_lesson",
        input_hash=prompt_hash,
        prompt_version=PROMPT_VERSION,
        source_path="outline.md",
        mode=mode,
        model=model,
        output_path=output_path,
    )
    return task, False


def create_or_reuse_outline_task(
    project_id: int,
    repo_root: Path,
    scope: LearningScopeRequest,
    model: Optional[str],
    instructions: str = "",
) -> tuple[GenerationTask, bool]:
    _, input_hash = build_outline_input(repo_root, scope, instructions)
    prompt_key = "prompt.learning_plan.outline" if scope.type == "learning_plan" else "prompt.outline"
    prompt_hash = hash_inputs(input_hash, load_prompt(prompt_key), load_prompt("prompt.system"))
    cached = find_completed_task(project_id, "outline", prompt_hash, PROMPT_VERSION, mode=scope.type)
    if cached and cached.output_path and Path(cached.output_path).exists():
        return cached, True
    task = create_generation_task(
        project_id=project_id,
        task_type="outline",
        input_hash=prompt_hash,
        prompt_version=PROMPT_VERSION,
        source_path=None,
        mode=scope.type,
        model=model,
        output_path=project_course_dir(project_id),
    )
    return task, False


def create_or_reuse_file_lesson_task(
    project_id: int,
    repo_root: Path,
    relative_path: str,
    mode: str,
    model: Optional[str],
    instructions: str = "",
) -> tuple[GenerationTask, bool]:
    _, _, input_hash = build_file_lesson_input(project_id, repo_root, relative_path, mode, instructions)
    cached = find_completed_task(project_id, "file_lesson", input_hash, PROMPT_VERSION, source_path=relative_path, mode=mode)
    if cached and cached.output_path and Path(cached.output_path).exists():
        return cached, True
    output_path = project_course_dir(project_id) / _safe_lesson_filename(relative_path, mode)
    task = create_generation_task(
        project_id=project_id,
        task_type="file_lesson",
        input_hash=input_hash,
        prompt_version=PROMPT_VERSION,
        source_path=relative_path,
        mode=mode,
        model=model,
        output_path=output_path,
    )
    return task, False
