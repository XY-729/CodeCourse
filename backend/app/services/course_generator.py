from __future__ import annotations

from pathlib import Path
from typing import Optional

from app.models.schemas import CourseFile

GENERATED_DIR = ".generated_course"

PREFERRED_COURSE_FILES = [
    "project_map.md",
    "outline.md",
]


def _title_from_markdown(path: Path) -> str:
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("# "):
                return line[2:].strip()
    except UnicodeDecodeError:
        pass
    return path.stem.replace("_", " ").replace("-", " ").title()


def list_course_files_from_dir(course_dir: Path) -> list[CourseFile]:
    if not course_dir.exists():
        return []
    preferred = [course_dir / name for name in PREFERRED_COURSE_FILES if (course_dir / name).is_file()]
    extras = sorted(path for path in course_dir.rglob("*.md") if path.name not in PREFERRED_COURSE_FILES)
    return [
        CourseFile(filename=path.relative_to(course_dir).as_posix(), title=_title_from_markdown(path))
        for path in [*preferred, *extras]
    ]


def list_course_files(repo_root: Path, course_dir: Optional[Path] = None) -> list[CourseFile]:
    return list_course_files_from_dir(course_dir or (repo_root / GENERATED_DIR))


def read_course_file(repo_root: Path, filename: str, course_dir: Optional[Path] = None) -> str:
    if "\\" in filename or not filename.endswith(".md"):
        raise FileNotFoundError(filename)
    root = (course_dir or (repo_root / GENERATED_DIR)).resolve()
    path = (root / filename).resolve()
    if path != root and root not in path.parents:
        raise FileNotFoundError(filename)
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(filename)
    return path.read_text(encoding="utf-8")


def _pending_markdown(title: str, target: str) -> str:
    return f"""# {title}

> 生成状态：待生成
> 说明：导入项目时不会自动调用模型 API。请在页面上选择学习范围、填写要求，并确认后生成。

## 待生成

这里还没有课程内容。

建议先确认：

- 学习范围：全项目、指定目录或指定文件
- 生成目标：项目总纲、粗略介绍或详细分析
- 你的补充要求：例如“面向 C++ 初学者”“重点讲判题核心”“先讲数据流”

点击“生成 AI 总纲”或文件课件按钮后，系统会在确认后调用模型 API，并将结果写入 `{target}`。
"""


def generate_course(
    repo_root: Path,
    course_dir: Optional[Path] = None,
    generation_method: str = "待生成",
    model: str = "none",
    scope: str = "full_project",
) -> list[CourseFile]:
    target_dir = (course_dir or (repo_root / GENERATED_DIR)).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)

    (target_dir / "project_map.md").write_text(
        _pending_markdown("项目结构说明", "project_map.md"),
        encoding="utf-8",
    )
    (target_dir / "outline.md").write_text(
        _pending_markdown("项目学习总纲", "outline.md"),
        encoding="utf-8",
    )

    return list_course_files(repo_root, target_dir)
