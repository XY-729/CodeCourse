from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, AsyncIterator, Optional
from urllib.parse import quote

from app.core.config import GENERATED_ROOT, PROMPT_VERSION
from app.services.llm_client import stream_openai_compatible_chat

import datetime as _dt

def _debug_dump(filename, text):
    try:
        debug_dir = Path(GENERATED_ROOT).parent / ".debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        ts = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        (debug_dir / (ts + "_" + filename)).write_text(text, encoding="utf-8")
    except Exception:
        pass
from app.services.prompt_store import load_prompt, save_prompt
from app.services.prompt_contracts import compose_system_prompt
from app.services.bibliography import (
    append_validated_bibliography,
    bibliography_for_prompt,
    bibliography_markdown,
    bibliography_metadata_instruction,
    parse_bibliography_metadata,
    validate_bibliography_selections,
)
from app.models.schemas import CourseFile, LearningScopeRequest
from app.services.course_generator import (
    generate_course,
    list_course_files_from_dir,
    read_course_file,
)
from app.services.lesson_files import (
    EvidenceRange,
    assemble_file_code_blocks,
    select_lesson_file_paths,
    select_lesson_files,
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
    get_lesson_file_records,
    get_llm_settings,
    get_project,
    get_project_index_status,
    update_generation_task,
    upsert_lesson_files,
    update_project_status,
)


LOGGER = logging.getLogger(__name__)



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


def _current_index_fingerprint(project_id: int) -> Optional[str]:
    status = get_project_index_status(project_id)
    value = status.get("indexed_fingerprint") or status.get("active_generation")
    return str(value) if value not in (None, "") else None


def _ensure_lesson_files(
    project_id: int,
    repo_root: Path,
    lesson_number: int,
    lesson_title: str,
    lesson_section: str,
) -> list[str]:
    """Refresh missing, stale, or invalid lesson-file references before use."""
    records = get_lesson_file_records(project_id, lesson_number)
    fingerprint = _current_index_fingerprint(project_id)
    stale = not records
    if not stale and fingerprint is not None:
        stale = any(row.get("indexed_fingerprint") != fingerprint for row in records)
    if not stale:
        stale = any(not (repo_root / str(row["file_path"])).is_file() for row in records)

    if stale:
        selected = select_lesson_file_paths(
            project_id,
            repo_root,
            lesson_title,
            lesson_section,
        )
        upsert_lesson_files(
            project_id,
            lesson_number,
            [(path, "index") for path in selected],
            fingerprint,
        )
        return selected
    return [str(row["file_path"]) for row in records]


def _repository_lesson_evidence(
    project_id: int,
    repo_root: Path,
    lesson_number: int,
    lesson_title: str,
    lesson_section: str,
) -> tuple[str, str, dict[str, Any]]:
    """Resolve fresh file samples and ranked RAG snippets for one lesson."""
    search_query = f"{lesson_title} {lesson_section[:2000]}".strip()
    results: list[Any] = []
    try:
        from app.services.index_service import search_project

        results = [item for item in search_project(project_id, search_query, limit=10) if item.content.strip()]
    except Exception as exc:
        LOGGER.warning("Lesson evidence search failed for project %s lesson %s: %s", project_id, lesson_number, exc)

    lesson_files = _ensure_lesson_files(
        project_id,
        repo_root,
        lesson_number,
        lesson_title,
        lesson_section,
    )
    ranges = [
        EvidenceRange(item.path, item.start_line, item.end_line)
        for item in results
        if item.path in lesson_files
    ]
    assembly = assemble_file_code_blocks(repo_root, lesson_files, relevant_ranges=ranges)

    seen: set[tuple[str, int, int, str]] = set()
    rag_blocks: list[str] = []
    valid_results = [item for item in results if item.path in assembly.included]
    for item in valid_results:
        key = (
            item.path,
            item.start_line,
            item.end_line,
            hashlib.sha256(item.content.encode("utf-8")).hexdigest(),
        )
        if key in seen:
            continue
        seen.add(key)
        rag_blocks.append(
            f"### {item.path}:{item.start_line}-{item.end_line}\n"
            f"```{item.language}\n{item.content[:3600]}\n```"
        )
    rag_context = "\n\n".join(rag_blocks)
    if not assembly.content.strip() and not rag_context.strip():
        raise RuntimeError(
            "本课没有可用的真实代码内容。请刷新仓库文件并重新构建索引后再生成课件。"
        )

    rag_paths = {item.path for item in valid_results}
    preview = {
        **assembly.as_dict(),
        "file_count": len(assembly.included),
        "snippet_count": len(rag_blocks) + sum(path not in rag_paths for path in assembly.included),
        "ready": True,
    }
    return assembly.content, rag_context, preview


def preview_outline_lesson_evidence(
    project_id: int,
    lesson_number: int,
    requested_title: str,
) -> dict[str, Any]:
    project = get_project(project_id)
    if project is None:
        raise RuntimeError("Project not found")
    if project.project_type == "learning_plan":
        return {
            "file_count": 0,
            "snippet_count": 0,
            "included": [],
            "truncated": [],
            "read_failed": [],
            "budget_skipped": [],
            "ready": True,
        }
    outline_path = project_course_dir(project_id) / "outline.md"
    if not outline_path.is_file():
        raise RuntimeError("请先生成项目学习总纲，再生成课件。")
    outline = outline_path.read_text(encoding="utf-8")
    lesson_title, lesson_section = _lesson_outline_section(outline, lesson_number, requested_title)
    _, _, preview = _repository_lesson_evidence(
        project_id,
        Path(project.local_path).resolve(),
        lesson_number,
        lesson_title,
        lesson_section,
    )
    return preview


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

    file_blocks, rag_context, _preview = _repository_lesson_evidence(
        project_id,
        repo_root,
        lesson_number,
        lesson_title,
        lesson_section,
    )
    lesson_input = "\n\n".join(
        [
            "项目总纲摘要：\n```markdown\n" + outline[:7000] + "\n```",
            "本课计划：\n```markdown\n" + lesson_section + "\n```",
            "涉及文件代码：\n" + file_blocks,
            "RAG 索引检索片段：\n" + (rag_context or "（相关文件正文已加载，索引没有额外命中片段。）"),
        ]
    )
    input_hash = hash_inputs(
        PROMPT_VERSION,
        "outline_lesson",
        str(lesson_number),
        lesson_title,
        user_instructions,
        outline,
        file_blocks,
        rag_context,
    )
    return lesson_title, lesson_input, input_hash


def _select_and_persist_lesson_files(project_id: int, repo_root: Path, outline: str) -> None:
    """Select involved files per lesson after the outline lands. Failure must
    not fail the outline task - lesson input falls back to key files."""
    try:
        selected = select_lesson_files(project_id, repo_root, outline)
        fingerprint = _current_index_fingerprint(project_id)
        for lesson_number, files in selected.items():
            upsert_lesson_files(
                project_id,
                lesson_number,
                [(rel, "index") for rel in files],
                fingerprint,
            )
    except Exception as exc:
        LOGGER.warning("Failed to persist lesson files for project %s: %s", project_id, exc)


def run_outline_generation_task(project_id: int, task_id: int, scope: LearningScopeRequest, instructions: str = "", survey_answers: Optional[list] = None) -> None:
    project = get_project(project_id)
    if project is None:
        update_generation_task(task_id, "failed", error_message="Project not found")
        return
    if survey_answers:
        from app.services.outline_questionnaire import serialize_learning_intent

        intent = serialize_learning_intent(survey_answers)
        if intent:
            instructions = instructions + "\n\n" + intent
    repo_root = Path(project.local_path).resolve()
    try:
        settings = _llm_settings_or_error()
        update_generation_task(
            task_id,
            "running",
            progress_current=0,
            progress_total=4,
            stage_label="正在分析项目",
        )
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
                {
                    "role": "system",
                    "content": compose_system_prompt(load_prompt("prompt.system"), "markdown"),
                },
                {
                    "role": "user",
                    "content": (
                        learning_plan_prompt
                        + bibliography_metadata_instruction()
                        + term_metadata_instruction()
                    ),
                },
            ]
            update_generation_task(
                task_id,
                "running",
                progress_current=1,
                progress_total=4,
                stage_label="正在生成总纲",
            )
            content = call_openai_compatible_chat(settings["base_url"], settings["api_key"], settings["model"], messages, timeout=180)
            update_generation_task(
                task_id,
                "running",
                progress_current=2,
                progress_total=4,
                stage_label="正在解析与归档",
            )
            content, model_terms = parse_term_metadata(content)
            content, bibliography = parse_bibliography_metadata(content)
            outline = append_validated_bibliography(
                _require_markdown(content), bibliography
            )
            output_dir = project_course_dir(project_id)
            _atomic_write(output_dir / "outline.md", add_outline_lesson_links(outline))
            register_document_terms(project_id, "course", "outline.md", outline, model_terms)
            update_generation_task(
                task_id,
                "completed",
                output_path=output_dir,
                progress_current=4,
                progress_total=4,
                stage_label="生成完成",
            )
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
                "content": compose_system_prompt(load_prompt("prompt.system"), "markdown"),
            },
            {
                "role": "user",
                "content": outline_prompt,
            },
        ]
        update_generation_task(
            task_id,
            "running",
            progress_current=1,
            progress_total=4,
            stage_label="正在生成总纲",
        )
        content = call_openai_compatible_chat(settings["base_url"], settings["api_key"], settings["model"], messages, timeout=180)
        update_generation_task(
            task_id,
            "running",
            progress_current=2,
            progress_total=4,
            stage_label="正在解析与归档",
        )
        content, model_terms = parse_term_metadata(content)
        project_map, outline = _parse_outline_files(content)
        output_dir = project_course_dir(project_id)
        _atomic_write(output_dir / "project_map.md", project_map)
        _atomic_write(output_dir / "outline.md", add_outline_lesson_links(outline))
        register_document_terms(project_id, "course", "project_map.md", project_map, model_terms)
        register_document_terms(project_id, "course", "outline.md", outline, model_terms)
        _select_and_persist_lesson_files(project_id, repo_root, outline)
        update_generation_task(
            task_id,
            "completed",
            output_path=output_dir,
            progress_current=4,
            progress_total=4,
            stage_label="生成完成",
        )
        update_project_status(project_id, "outline_ready")
    except Exception as exc:  # noqa: BLE001
        update_generation_task(task_id, "failed", error_message=str(exc), stage_label="生成失败")
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
        update_generation_task(
            task_id,
            "running",
            progress_current=0,
            progress_total=3,
            stage_label="正在读取文件",
        )
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
            {
                "role": "system",
                "content": compose_system_prompt(load_prompt("prompt.system"), "markdown"),
            },
            {"role": "user", "content": user_prompt},
        ]
        update_generation_task(
            task_id,
            "running",
            progress_current=1,
            progress_total=3,
            stage_label="正在生成课件",
        )
        content = call_openai_compatible_chat(settings["base_url"], settings["api_key"], settings["model"], messages, timeout=180)
        content, model_terms = parse_term_metadata(content)
        lesson = _require_markdown(content)
        if not lesson.lstrip().startswith("#"):
            title = "粗略介绍" if mode == "brief" else "详细分析"
            lesson = f"# {Path(relative_path).name} {title}\n\n{lesson}"
        output_path = project_course_dir(project_id) / _safe_lesson_filename(relative_path, mode)
        _atomic_write(output_path, lesson)
        register_document_terms(project_id, "course", _safe_lesson_filename(relative_path, mode), lesson, model_terms)
        update_generation_task(
            task_id,
            "completed",
            output_path=output_path,
            progress_current=3,
            progress_total=3,
            stage_label="生成完成",
        )
    except Exception as exc:  # noqa: BLE001
        update_generation_task(task_id, "failed", error_message=str(exc), stage_label="生成失败")


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
    plan["textbooks"] = validate_bibliography_selections(plan.get("textbooks"))
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


def _dedupe_lesson_markdown(markdown: str) -> str:
    """Remove exact repeated prose and duplicate lesson-level headings."""
    blocks = re.split(r"\n{2,}", markdown.strip())
    seen_prose: set[str] = set()
    seen_lesson_headings: set[str] = set()
    kept: list[str] = []
    for block in blocks:
        stripped = block.strip()
        if not stripped:
            continue
        heading = re.fullmatch(r"##\s+(.+)", stripped)
        if heading:
            key = _normalized_coverage_text(heading.group(1))
            if key in seen_lesson_headings:
                continue
            seen_lesson_headings.add(key)
            kept.append(stripped)
            continue
        normalized = re.sub(r"\s+", " ", stripped).strip().casefold()
        is_prose = (
            len(normalized) >= 100
            and not stripped.startswith("```")
            and not stripped.startswith("|")
            and not stripped.startswith(">")
        )
        if is_prose and normalized in seen_prose:
            continue
        if is_prose:
            seen_prose.add(normalized)
        kept.append(stripped)
    return "\n\n".join(kept).strip()


def _lesson_textbook_markdown(plan: dict) -> str:
    return bibliography_markdown(plan.get("textbooks"))


def _run_learning_plan_lesson_task(
    project_id: int,
    task_id: int,
    lesson_number: int,
    lesson_title: str,
    lesson_input: str,
    instructions: str,
    settings: dict[str, str],
) -> tuple[str, str]:
    lesson_policy = load_prompt("prompt.learning_plan.lesson")
    user_instructions = _clean_instructions(instructions) or "无"
    update_generation_task(
        task_id,
        "running",
        progress_current=0,
        progress_total=12,
        stage_label="正在规划课件",
    )
    planner_prompt = f"""你是一位课程设计师。现在要根据一份学习计划，为其中一课制定详细的章节规划。

本课名称：{lesson_title}
本课是学习计划中的第 {lesson_number} 课。

你的任务：阅读下方学习材料中的“本课计划”，从中提取本课应该覆盖的全部知识内容，并将其组织为 4-10 个章节。每个章节必须列出明确的知识项（函数、API、语法、概念、公式或方法）。不能使用“其他相关知识”等笼统项。

只输出一个 JSON 对象，不要输出 Markdown 或额外解释：

{{
  "lesson_title": "{lesson_title}",
  "position": "本课在学习路线中的位置（从学习材料中的总纲推断）",
  "objectives": ["3-5 条可验证的学习目标"],
  "sections": [
    {{
      "title": "章节标题",
      "items": [
        {{"name": "具体的知识项名称", "kind": "function 或 concept", "focus": "讲解重点（可选，可为空字符串）"}}
      ]
    }}
  ],
  "textbooks": [
    {{"id": "只能从允许书目中选择的 ID", "topics": ["只能逐字选择该书允许的主题"]}}
  ]
}}

允许书目：
{bibliography_for_prompt()}

教材不确定或没有直接匹配时 textbooks 返回空数组。不要自行输出书名、作者、章节号、页码、版次或未列出的主题。

用户补充要求：{user_instructions}

学习材料：
{lesson_input}
"""
    _debug_dump("L" + str(lesson_number) + "-planner-prompt.txt", planner_prompt)
    plan_content = call_openai_compatible_chat(
        settings["base_url"],
        settings["api_key"],
        settings["model"],
        [
            {
                "role": "system",
                "content": compose_system_prompt(load_prompt("prompt.system"), "json"),
            },
            {"role": "user", "content": planner_prompt},
        ],
        timeout=180,
    )
    plan = _parse_lesson_plan(plan_content)
    _debug_dump("L" + str(lesson_number) + "-plan-response.json", json.dumps(plan, ensure_ascii=False, indent=2))
    sections: list[dict] = plan["sections"]
    total_calls = 2 + len(sections)
    update_generation_task(
        task_id,
        "running",
        progress_current=1,
        progress_total=total_calls,
        stage_label="章节计划已完成",
    )

    staging_dir = project_course_dir(project_id) / ".tasks" / f"task-{task_id}"
    staging_dir.mkdir(parents=True, exist_ok=True)
    generated_sections = [""] * len(sections)
    completed_count = 0

    def _gen_section(idx, sec):
        ls = "\n".join("-" + it.get("name", "") + "（类型：" + it.get("kind", "") + "；重点：" + (it.get("focus") or "完整讲清") + "）" for it in sec.get("items", []))
        sp = lesson_policy + "\n\n"
        sp += "你正在编写一节课中的一个核心正文章节，而不是完整课件。\n\n"
        sp += "本课：" + str(lesson_number) + "“" + lesson_title + "”\n"
        sp += "章节标题：" + sec.get("title", "") + "\n"
        sp += "本章知识项：\n" + ls + "\n\n"
        sp += "输出要求：\n"
        sp += "- 直接以 `## " + sec.get("title", "") + "` 开始，只输出本章 Markdown。\n"
        sp += "- 每个知识项必须以包含其完整名称的 `###` 小节单独展开。\n"
        sp += "- 围绕知识项解释直觉、机制和必要示例；深度以讲清为准，不设置固定段落或示例数量。\n"
        sp += "- 不要输出本课定位、目标、知识地图、前置知识总表、综合案例、全课练习、自测、常见误区、总结或教材参照；这些由统一整合阶段生成。\n"
        sp += "- 不要重复其他章节应负责的知识；无法由材料确认的内容明确标注证据不足。\n"
        sp += "- 不要输出教材原文长引文，不要声称访问了教材全文。\n\n"
        sp += "用户补充要求：" + user_instructions + "\n\n"
        sp += "学习材料：\n" + lesson_input + "\n"
        if idx == 1:
            _debug_dump("L" + str(lesson_number) + "-section-1-prompt.txt", sp)
        c = call_openai_compatible_chat(
            settings["base_url"], settings["api_key"], settings["model"],
            [{"role": "system", "content": compose_system_prompt(load_prompt("prompt.system"), "markdown")},
             {"role": "user", "content": sp}], timeout=240)
        md = _require_markdown(c)
        if not md.lstrip().startswith("##"):
            md = "## " + sec.get("title", "") + "\n\n" + md
        _atomic_write(staging_dir / ("section-" + str(idx).zfill(2) + ".part"), md)
        return idx, md.strip()

    try:
        update_generation_task(task_id, "running",
            progress_current=1, progress_total=total_calls,
            stage_label="并发生成 " + str(len(sections)) + " 个章节中…")
        max_workers = min(len(sections), 4)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(_gen_section, i + 1, sec): i for i, sec in enumerate(sections)}
            for future in as_completed(futures):
                idx, md = future.result()
                generated_sections[idx - 1] = md
                completed_count += 1
                st = sections[idx - 1].get("title", "")
                update_generation_task(task_id, "running",
                    progress_current=1 + completed_count, progress_total=total_calls,
                    stage_label="已完成 " + str(completed_count) + "/" + str(len(sections)) + "：" + st)

        joined_sections = "\n\n".join(generated_sections)
        missing = _missing_lesson_items(joined_sections, sections)
        update_generation_task(
            task_id,
            "running",
            progress_current=total_calls - 1,
            progress_total=total_calls,
            stage_label="正在统一整合课件",
        )
        plan_lines = "\n".join(
            f"- {section['title']}：{'、'.join(item['name'] for item in section['items'])}"
            for section in sections
        )
        missing_lines = (
            "\n".join(
                f"- {item['name']}（{item['kind']}）：{item['focus']}"
                for item in missing
            )
            if missing
            else "- 无"
        )
        section_excerpts = "\n\n".join(
            f"### {sections[index]['title']} 摘要\n{markdown[:1600]}"
            for index, markdown in enumerate(generated_sections)
        )
        synthesis_prompt = f"""{lesson_policy}

你是本课的责任编辑。核心章节已经分别生成，请只补充一次全课公共部分，不要重写章节正文。

本课：第 {lesson_number} 课“{lesson_title}”
章节与知识项：
{plan_lines}

章节正文摘要：
{section_excerpts}

尚未被正文明确覆盖的知识项：
{missing_lines}

只输出以下适用的 Markdown 二级章节：
- `## 必要补充`：仅在存在遗漏知识项时逐项补足。
- `## 综合串联`：用一个连贯流程或案例把章节连接起来，不重复各节定义和完整代码。
- `## 常见误区`：只列对本课确有价值、能够解释原因和验证方式的误区，不设数量要求。
- `## 练习与自测`：全课只生成一组练习与答案要点，每题写明完成或判断标准。
- `## 本课小结`：简短总结目标之间的关系，不逐节复述。

禁止输出教材参照、前置知识总表、课程目标或知识地图。不要为了凑齐标题输出空泛内容。
用户补充要求：{user_instructions}
"""
        synthesis = _require_markdown(
            call_openai_compatible_chat(
                settings["base_url"],
                settings["api_key"],
                settings["model"],
                [
                    {
                        "role": "system",
                        "content": compose_system_prompt(
                            load_prompt("prompt.system"), "markdown"
                        ),
                    },
                    {"role": "user", "content": synthesis_prompt},
                ],
                timeout=240,
            )
        ).strip()
        _atomic_write(staging_dir / "lesson-synthesis.part", synthesis)
        joined_sections = _dedupe_lesson_markdown(
            "\n\n".join([*generated_sections, synthesis])
        )
        if _missing_lesson_items(joined_sections, sections):
            raise RuntimeError("统一整合后仍有规划知识项未覆盖，旧课件已保留。")

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
                "> 生成方式：AI 分章节生成并统一整合  \n> 教材说明：书目来自 CodeCourse 内置校验目录，课件未读取教材原文。",
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


def _run_repository_lesson_task(
    project_id: int,
    task_id: int,
    lesson_number: int,
    lesson_title: str,
    lesson_input: str,
    instructions: str,
    settings: dict[str, str],
) -> tuple[str, str]:
    lesson_policy = load_prompt("prompt.outline_lesson")
    user_instructions = _clean_instructions(instructions) or "无"
    update_generation_task(
        task_id,
        "running",
        progress_current=0,
        progress_total=12,
        stage_label="正在规划课件",
    )
    planner_prompt = f"""你是一位严谨的软件工程讲师。现在要把项目学习总纲中的“第 {lesson_number} 课”拆分为可并发编写的详细课件章节规划。

本课名称：{lesson_title}
用户补充要求：{user_instructions}

你会得到三类材料：
1. 项目学习总纲：用于理解本课在整体路线中的位置；
2. 本课计划：用于确定本课应该解决什么问题；
3. RAG 索引检索片段：来自真实项目文件，带有路径和行号，是讲解代码的主要证据。

你的任务：阅读下方课程材料，提取本课应该覆盖的全部知识内容，并将其组织为 4-10 个章节。每个章节必须列出明确的知识项（函数、API、语法、概念或代码阅读动作）。不能使用“其他相关知识”等笼统项。

只输出一个 JSON 对象，不要输出 Markdown 或额外解释：

{{
  "lesson_title": "{lesson_title}",
  "position": "本课在学习路线中的位置（从总纲推断）",
  "objectives": ["3-5 条可验证的学习目标"],
  "sections": [
    {{
      "title": "章节标题",
      "items": [
        {{"name": "具体的知识项名称", "kind": "function 或 concept", "focus": "讲解重点（可选，可为空字符串）"}}
      ]
    }}
  ]
}}

用户补充要求：{user_instructions}

课程材料：
{lesson_input}
"""
    _debug_dump("L" + str(lesson_number) + "-repo-planner-prompt.txt", planner_prompt)
    plan_content = call_openai_compatible_chat(
        settings["base_url"],
        settings["api_key"],
        settings["model"],
        [
            {
                "role": "system",
                "content": compose_system_prompt(load_prompt("prompt.system"), "json"),
            },
            {"role": "user", "content": planner_prompt},
        ],
        timeout=180,
    )
    plan = _parse_lesson_plan(plan_content)
    _debug_dump("L" + str(lesson_number) + "-repo-plan-response.json", json.dumps(plan, ensure_ascii=False, indent=2))
    sections: list[dict] = plan["sections"]
    total_calls = 2 + len(sections)
    update_generation_task(
        task_id,
        "running",
        progress_current=1,
        progress_total=total_calls,
        stage_label="章节计划已完成",
    )

    staging_dir = project_course_dir(project_id) / ".tasks" / f"task-{task_id}"
    staging_dir.mkdir(parents=True, exist_ok=True)
    generated_sections = [""] * len(sections)
    completed_count = 0

    def _gen_section(idx, sec):
        ls = "\n".join("-" + it.get("name", "") + "（类型：" + it.get("kind", "") + "；重点：" + (it.get("focus") or "完整讲清") + "）" for it in sec.get("items", []))
        sp = lesson_policy + "\n\n"
        sp += "你正在编写一节课中的一个核心正文章节，而不是完整课件。\n\n"
        sp += "本课：第 " + str(lesson_number) + " 课“" + lesson_title + "”\n"
        sp += "章节标题：" + sec.get("title", "") + "\n"
        sp += "本章知识项：\n" + ls + "\n\n"
        sp += "输出要求：\n"
        sp += "- 直接以 `## " + sec.get("title", "") + "` 开始，只输出本章 Markdown。\n"
        sp += "- 每个知识项必须以包含其完整名称的 `###` 小节单独展开。\n"
        sp += "- 依据下方课程材料中的真实路径、符号、配置和代码片段讲解，需要时标明 `路径:行号范围`；无法确认的内容明确标注证据不足，不得编造。\n"
        sp += "- 不要输出本课定位、目标、阅读地图、综合案例、全课练习、自测、总结、教材参照或知识地图；这些由统一整合阶段生成。\n"
        sp += "- 不要重复其他章节应负责的知识。\n\n"
        sp += "用户补充要求：" + user_instructions + "\n\n"
        sp += "课程材料：\n" + lesson_input + "\n"
        if idx == 1:
            _debug_dump("L" + str(lesson_number) + "-repo-section-1-prompt.txt", sp)
        c = call_openai_compatible_chat(
            settings["base_url"], settings["api_key"], settings["model"],
            [{"role": "system", "content": compose_system_prompt(load_prompt("prompt.system"), "markdown")},
             {"role": "user", "content": sp}], timeout=240)
        md = _require_markdown(c)
        if not md.lstrip().startswith("##"):
            md = "## " + sec.get("title", "") + "\n\n" + md
        _atomic_write(staging_dir / ("section-" + str(idx).zfill(2) + ".part"), md)
        return idx, md.strip()

    try:
        update_generation_task(task_id, "running",
            progress_current=1, progress_total=total_calls,
            stage_label="并发生成 " + str(len(sections)) + " 个章节中…")
        max_workers = min(len(sections), 4)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(_gen_section, i + 1, sec): i for i, sec in enumerate(sections)}
            for future in as_completed(futures):
                idx, md = future.result()
                generated_sections[idx - 1] = md
                completed_count += 1
                st = sections[idx - 1].get("title", "")
                update_generation_task(task_id, "running",
                    progress_current=1 + completed_count, progress_total=total_calls,
                    stage_label="已完成 " + str(completed_count) + "/" + str(len(sections)) + "：" + st)

        joined_sections = "\n\n".join(generated_sections)
        missing = _missing_lesson_items(joined_sections, sections)
        update_generation_task(
            task_id,
            "running",
            progress_current=total_calls - 1,
            progress_total=total_calls,
            stage_label="正在统一整合课件",
        )
        plan_lines = "\n".join(
            f"- {section['title']}：{'、'.join(item['name'] for item in section['items'])}"
            for section in sections
        )
        missing_lines = (
            "\n".join(
                f"- {item['name']}（{item['kind']}）：{item['focus']}"
                for item in missing
            )
            if missing
            else "- 无"
        )
        section_excerpts = "\n\n".join(
            f"### {sections[index]['title']} 摘要\n{markdown[:1600]}"
            for index, markdown in enumerate(generated_sections)
        )
        synthesis_prompt = f"""{lesson_policy}

你是本课的责任编辑。核心章节已经分别生成，请只补充一次全课公共部分，不要重写章节正文。

本课：第 {lesson_number} 课“{lesson_title}”
章节与知识项：
{plan_lines}

章节正文摘要：
{section_excerpts}

尚未被正文明确覆盖的知识项：
{missing_lines}

只输出以下适用的 Markdown 二级章节：
- `## 综合串联`：用一个连贯流程或案例把章节连接起来，不重复各节定义和完整代码。
- `## 易错点与调试`：仅列能够由当前代码、类型、生命周期、边界条件或测试证实的问题，并给出定位与验证方法。
- `## 动手检查`：给出少量能够用当前材料完成的定位、追踪、比较或修改任务；每项写明完成标准。
- `## 待确认事项`：集中列出会影响本课结论的证据缺口；没有则写“无”。
- `## 本课小结`：简短总结目标之间的关系，不逐节复述。

禁止输出教材参照、前置知识总表、课程目标、阅读地图或知识地图。不要为了凑齐标题输出空泛内容。
用户补充要求：{user_instructions}
"""
        synthesis = _require_markdown(
            call_openai_compatible_chat(
                settings["base_url"],
                settings["api_key"],
                settings["model"],
                [
                    {
                        "role": "system",
                        "content": compose_system_prompt(
                            load_prompt("prompt.system"), "markdown"
                        ),
                    },
                    {"role": "user", "content": synthesis_prompt},
                ],
                timeout=240,
            )
        ).strip()
        _atomic_write(staging_dir / "lesson-synthesis.part", synthesis)
        joined_sections = _dedupe_lesson_markdown(
            "\n\n".join([*generated_sections, synthesis])
        )
        if _missing_lesson_items(joined_sections, sections):
            raise RuntimeError("统一整合后仍有规划知识项未覆盖，旧课件已保留。")

        resolved_title = str(plan.get("lesson_title", "")).strip() or lesson_title
        position = str(plan.get("position", "")).strip() or "本课承接学习总纲中的对应阶段。"
        objectives = plan.get("objectives") if isinstance(plan.get("objectives"), list) else []
        objective_lines = [f"- {str(item).strip()}" for item in objectives if str(item).strip()]
        lesson = "\n\n".join(
            [
                f"# 第 {lesson_number} 课：{resolved_title}",
                f"> 本课定位：{position}",
                f"> 生成方式：AI 分章节生成并统一整合",
                "## 本课目标\n\n" + ("\n".join(objective_lines) if objective_lines else "- 完成本课知识地图中的全部项目。"),
                joined_sections,
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
        _debug_dump("L" + str(lesson_number) + "-build-input.txt",
                     "lesson_number=" + str(lesson_number) + "\nrequested_title=" + requested_title + "\n"
                     "lesson_title=" + lesson_title + "\n\n=== lesson_input ===\n" + lesson_input)
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
        lesson_title, lesson = _run_repository_lesson_task(
            project_id,
            task_id,
            lesson_number,
            lesson_title,
            lesson_input,
            instructions,
            settings,
        )
        content, model_terms = parse_term_metadata(lesson)
        relative_path = _outline_lesson_filename(lesson_number)
        output_path = project_course_dir(project_id) / relative_path
        _atomic_write(output_path, content)
        register_document_terms(project_id, "course", relative_path, content, model_terms)
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


def _serialize_survey_intent(survey_answers: Optional[list]) -> str:
    if not survey_answers:
        return ""
    try:
        from app.services.outline_questionnaire import serialize_learning_intent

        return serialize_learning_intent(survey_answers)
    except Exception:
        return ""


def create_or_reuse_outline_task(
    project_id: int,
    repo_root: Path,
    scope: LearningScopeRequest,
    model: Optional[str],
    instructions: str = "",
    survey_answers: Optional[list] = None,
) -> tuple[GenerationTask, bool]:
    _, input_hash = build_outline_input(repo_root, scope, instructions)
    intent = _serialize_survey_intent(survey_answers)
    if intent:
        input_hash = hash_inputs(input_hash, intent)
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


# ---------------------------------------------------------------------------
# Streaming generation helpers
# ---------------------------------------------------------------------------

def _sse_event(event: str, data: dict[str, Any]) -> dict[str, Any]:
    return {"event": event, "data": data}


def _incremental_open(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("", encoding="utf-8")


def _remove_outline_placeholders(output_dir: Path, filename: str) -> None:
    """Clean up outline artifacts after a failed generation.

    `_incremental_open` truncates `filename` at run start, so any leftover is
    this run's partial output. `project_map.md` is only written atomically on
    success, so only an empty leftover is garbage (stale valid files kept).
    """
    for name in (filename, "project_map.md"):
        candidate = output_dir / name
        if not candidate.exists():
            continue
        if name == filename or candidate.stat().st_size == 0:
            try:
                candidate.unlink()
            except OSError:
                pass


def _incremental_append(path: Path, chunk: str) -> None:
    with open(path, "a", encoding="utf-8") as f:
        f.write(chunk)


async def _stream_and_accumulate(
    settings: dict[str, str],
    messages: list[dict[str, str]],
    output_path: Path,
    timeout: int = 120,
) -> AsyncIterator[dict[str, Any]]:
    """Stream LLM chunks as SSE delta events, appending each chunk to file."""
    chunks: list[str] = []
    async for chunk in stream_openai_compatible_chat(
        settings["base_url"],
        settings["api_key"],
        settings["model"],
        messages,
        timeout=timeout,
    ):
        chunks.append(chunk)
        _incremental_append(output_path, chunk)
        yield _sse_event("delta", {"text": chunk})
    yield _sse_event("accumulated", {"text": "".join(chunks)})


def _learning_plan_lesson_messages(settings: dict[str, str], lesson_number: int, lesson_title: str, lesson_input: str, instructions: str) -> list[dict[str, str]]:
    user_instructions = _clean_instructions(instructions) or "无"
    user_prompt = f"""{load_prompt("prompt.learning_plan.lesson")}

请为第 {lesson_number} 课"{lesson_title}"生成完整课件。

用户补充要求：{user_instructions}

学习材料：
{lesson_input}
    """ + term_metadata_instruction()
    return [
        {
            "role": "system",
            "content": compose_system_prompt(load_prompt("prompt.system"), "markdown"),
        },
        {"role": "user", "content": user_prompt},
    ]


# ---------------------------------------------------------------------------
# Streaming outline generation
# ---------------------------------------------------------------------------

async def stream_outline_generation(
    project_id: int,
    scope: LearningScopeRequest,
    instructions: str = "",
    survey_answers: Optional[list] = None,
) -> AsyncIterator[dict[str, Any]]:
    from app.services.storage import (
        GenerationTask,
        create_generation_task,
        find_completed_task,
        get_project,
        update_generation_task,
        update_project_status,
    )

    if survey_answers:
        from app.services.outline_questionnaire import serialize_learning_intent

        intent = serialize_learning_intent(survey_answers)
        if intent:
            instructions = instructions + "\n\n" + intent

    project = get_project(project_id)
    if project is None:
        yield _sse_event("error", {"message": "Project not found"})
        return
    repo_root = Path(project.local_path).resolve()
    settings = _llm_settings_or_error()
    output_dir = project_course_dir(project_id)

    # Build messages (reuse existing logic)
    if scope.type == "learning_plan":
        user_instructions = _clean_instructions(instructions)
        prompt = load_prompt("prompt.learning_plan.outline").format(
            model=settings["model"],
            user_instructions=user_instructions or "无",
        ) + bibliography_metadata_instruction() + term_metadata_instruction()
        messages = [
            {
                "role": "system",
                "content": compose_system_prompt(load_prompt("prompt.system"), "markdown"),
            },
            {"role": "user", "content": prompt},
        ]
        filename = "outline.md"
    else:
        user_instructions = _clean_instructions(instructions)
        prompt_input, _ = build_outline_input(repo_root, scope, instructions)
        scope_text = _scope_to_text(scope)
        outline_prompt = load_prompt("prompt.outline").format(
            model=settings["model"],
            scope_text=scope_text,
            user_instructions=user_instructions or "无",
            prompt_input=prompt_input,
        ) + term_metadata_instruction()
        messages = [
            {
                "role": "system",
                "content": compose_system_prompt(load_prompt("prompt.system"), "markdown"),
            },
            {"role": "user", "content": outline_prompt},
        ]
        filename = "outline.md"

    # Create task
    input_hash = hashlib.sha256(json.dumps(messages, sort_keys=True).encode()).hexdigest()[:16]
    cached = find_completed_task(project_id, "outline", input_hash, PROMPT_VERSION)
    if cached and cached.output_path and Path(cached.output_path).exists():
        yield _sse_event("completed", {
            "filename": "outline.md",
            "task_id": cached.id,
            "cached": True,
        })
        return

    task = create_generation_task(
        project_id=project_id,
        task_type="outline",
        input_hash=input_hash,
        prompt_version=PROMPT_VERSION,
        source_path=None,
        mode=None,
        model=settings.get("model"),
        output_path=output_dir,
    )

    output_path = output_dir / filename
    _incremental_open(output_path)
    update_generation_task(task.id, "running", stage_label="生成总纲中")
    update_project_status(project_id, "generating_outline")

    yield _sse_event("task_created", {"filename": filename, "task_id": task.id})
    yield _sse_event("stage", {"stage": "generating", "label": "生成总纲中"})

    try:
        full_text = ""
        async for event in _stream_and_accumulate(settings, messages, output_path, timeout=180):
            if event["event"] == "accumulated":
                full_text = event["data"]["text"]
            else:
                yield event

        content, model_terms = parse_term_metadata(full_text)

        if scope.type == "learning_plan":
            content, bibliography = parse_bibliography_metadata(content)
            outline = append_validated_bibliography(
                _require_markdown(content), bibliography
            )
            _atomic_write(output_path, add_outline_lesson_links(outline))
            register_document_terms(project_id, "course", filename, outline, model_terms)
        else:
            project_map, outline = _parse_outline_files(content)
            _atomic_write(output_dir / "project_map.md", project_map)
            _atomic_write(output_path, add_outline_lesson_links(outline))
            register_document_terms(project_id, "course", "project_map.md", project_map, model_terms)
            register_document_terms(project_id, "course", filename, outline, model_terms)
            _select_and_persist_lesson_files(project_id, repo_root, outline)
            yield _sse_event("file_created", {"filename": "project_map.md"})

        update_generation_task(task.id, "completed", output_path=output_dir)
        update_project_status(project_id, "outline_ready")
        yield _sse_event("completed", {"filename": filename, "task_id": task.id})

    except asyncio.CancelledError:
        update_generation_task(task.id, "failed", error_message="生成已取消", stage_label="已取消")
        _remove_outline_placeholders(output_dir, filename)
        raise
    except Exception as exc:
        update_generation_task(task.id, "failed", error_message=str(exc), stage_label="生成失败")
        update_project_status(project_id, "outline_failed")
        _remove_outline_placeholders(output_dir, filename)
        yield _sse_event("error", {"message": str(exc)})


# ---------------------------------------------------------------------------
# Streaming file lesson generation
# ---------------------------------------------------------------------------

async def stream_file_lesson_generation(
    project_id: int,
    relative_path: str,
    mode: str,
    instructions: str = "",
) -> AsyncIterator[dict[str, Any]]:
    from app.services.storage import (
        GenerationTask,
        create_generation_task,
        find_completed_task,
        get_project,
        update_generation_task,
    )

    project = get_project(project_id)
    if project is None:
        yield _sse_event("error", {"message": "Project not found"})
        return
    repo_root = Path(project.local_path).resolve()
    settings = _llm_settings_or_error()

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
        {
            "role": "system",
            "content": compose_system_prompt(load_prompt("prompt.system"), "markdown"),
        },
        {"role": "user", "content": user_prompt},
    ]

    input_hash = hashlib.sha256(json.dumps(messages, sort_keys=True).encode()).hexdigest()[:16]
    cached = find_completed_task(project_id, "file_lesson", input_hash, PROMPT_VERSION, source_path=relative_path, mode=mode)
    if cached and cached.output_path and Path(cached.output_path).exists():
        filename = cached.output_path.split("/")[-1] if cached.output_path else _safe_lesson_filename(relative_path, mode)
        yield _sse_event("completed", {"filename": filename, "task_id": cached.id, "cached": True})
        return

    filename = _safe_lesson_filename(relative_path, mode)
    output_path = project_course_dir(project_id) / filename
    _incremental_open(output_path)

    task = create_generation_task(
        project_id=project_id,
        task_type="file_lesson",
        input_hash=input_hash,
        prompt_version=PROMPT_VERSION,
        source_path=relative_path,
        mode=mode,
        model=settings.get("model"),
        output_path=output_path,
    )
    update_generation_task(task.id, "running", stage_label="生成课件中")

    yield _sse_event("task_created", {"filename": filename, "task_id": task.id})
    yield _sse_event("stage", {"stage": "generating", "label": "生成课件中"})

    try:
        full_text = ""
        async for event in _stream_and_accumulate(settings, messages, output_path, timeout=180):
            if event["event"] == "accumulated":
                full_text = event["data"]["text"]
            else:
                yield event

        content, model_terms = parse_term_metadata(full_text)
        lesson = _require_markdown(content)
        if not lesson.lstrip().startswith("#"):
            title = "粗略介绍" if mode == "brief" else "详细分析"
            lesson = f"# {Path(relative_path).name} {title}\n\n{lesson}"
        _atomic_write(output_path, lesson)
        register_document_terms(project_id, "course", filename, lesson, model_terms)
        update_generation_task(task.id, "completed", output_path=output_path)
        yield _sse_event("completed", {"filename": filename, "task_id": task.id})

    except asyncio.CancelledError:
        update_generation_task(task.id, "failed", error_message="生成已取消", stage_label="已取消")
        if output_path.exists():
            output_path.unlink()
        raise
    except Exception as exc:
        update_generation_task(task.id, "failed", error_message=str(exc), stage_label="生成失败")
        if output_path.exists():
            output_path.unlink()
        yield _sse_event("error", {"message": str(exc)})


# ---------------------------------------------------------------------------
# Streaming outline lesson generation
# ---------------------------------------------------------------------------

async def stream_outline_lesson_generation(
    project_id: int,
    lesson_number: int,
    requested_title: str,
    instructions: str = "",
) -> AsyncIterator[dict[str, Any]]:
    from app.services.storage import (
        GenerationTask,
        create_generation_task,
        find_completed_task,
        get_project,
        update_generation_task,
        find_knowledge_node,
        create_knowledge_node,
    )

    project = get_project(project_id)
    if project is None:
        yield _sse_event("error", {"message": "Project not found"})
        return
    repo_root = Path(project.local_path).resolve()
    settings = _llm_settings_or_error()

    lesson_title, lesson_input, outline_context = build_outline_lesson_input(
        project_id, repo_root, lesson_number, requested_title, instructions,
    )

    filename = _outline_lesson_filename(lesson_number)
    output_path = project_course_dir(project_id) / filename
    _incremental_open(output_path)

    if project.project_type == "learning_plan":
        messages = _learning_plan_lesson_messages(settings, lesson_number, lesson_title, lesson_input, instructions)
        task_type = "outline_lesson"
    else:
        prompt = load_prompt("prompt.outline_lesson").format(
            lesson_number=lesson_number,
            lesson_title=lesson_title,
            user_instructions=_clean_instructions(instructions) or "无",
            lesson_input=lesson_input,
        ) + term_metadata_instruction()
        messages = [
            {
                "role": "system",
                "content": compose_system_prompt(load_prompt("prompt.system"), "markdown"),
            },
            {"role": "user", "content": prompt},
        ]
        task_type = "outline_lesson"

    input_hash = hashlib.sha256(json.dumps(messages, sort_keys=True).encode()).hexdigest()[:16]
    cached = find_completed_task(project_id, "outline_lesson", input_hash, PROMPT_VERSION, source_path=str(lesson_number))
    if cached and cached.output_path and Path(cached.output_path).exists():
        yield _sse_event("completed", {"filename": filename, "task_id": cached.id, "cached": True})
        return

    task = create_generation_task(
        project_id=project_id,
        task_type=task_type,
        input_hash=input_hash,
        prompt_version=PROMPT_VERSION,
        source_path=str(lesson_number),
        mode=None,
        model=settings.get("model"),
        output_path=output_path,
    )
    update_generation_task(task.id, "running", stage_label="生成课件中")

    yield _sse_event("task_created", {"filename": filename, "task_id": task.id})
    yield _sse_event("stage", {"stage": "generating", "label": "生成课件中"})

    try:
        full_text = ""
        async for event in _stream_and_accumulate(settings, messages, output_path, timeout=180):
            if event["event"] == "accumulated":
                full_text = event["data"]["text"]
            else:
                yield event

        content, model_terms = parse_term_metadata(full_text)
        lesson = _require_markdown(content)
        if not lesson.lstrip().startswith("#"):
            lesson = f"# 第 {lesson_number} 课：{lesson_title}\n\n{lesson}"
        _atomic_write(output_path, lesson)
        register_document_terms(project_id, "course", filename, lesson, model_terms)

        node_title = f"第{lesson_number}课"
        existing = find_knowledge_node(
            project_id, node_type="course", title=node_title, ref_type="course", ref_path=filename,
        )
        if existing is None:
            create_knowledge_node(
                project_id=project_id, node_type="course", title=node_title,
                ref_type="course", ref_path=filename, summary=lesson_title,
            )

        update_generation_task(task.id, "completed", output_path=output_path)
        yield _sse_event("completed", {"filename": filename, "task_id": task.id})

    except asyncio.CancelledError:
        update_generation_task(task.id, "failed", error_message="生成已取消", stage_label="已取消")
        if output_path.exists():
            output_path.unlink()
        raise
    except Exception as exc:
        update_generation_task(task.id, "failed", error_message=str(exc), stage_label="生成失败")
        if output_path.exists():
            output_path.unlink()
        yield _sse_event("error", {"message": str(exc)})
