from __future__ import annotations

from pathlib import Path

from app.models.schemas import CourseFile, TreeNode
from app.services.scanner import list_key_files, scan_tree

GENERATED_DIR = ".generated_course"


TECH_HINTS = {
    "cpp": {
        "name": "C/C++",
        "signals": {"CMakeLists.txt", "Makefile"},
        "lesson": "构建入口、源码目录、头文件边界和测试用例",
        "files": {"src", "include", "tests", "sandbox"},
    },
    "node": {
        "name": "Node/前端",
        "signals": {"package.json"},
        "lesson": "package scripts、组件结构、状态流和构建配置",
        "files": {"src", "components", "pages", "app"},
    },
    "python": {
        "name": "Python",
        "signals": {"pyproject.toml", "requirements.txt"},
        "lesson": "包结构、依赖声明、入口脚本和测试布局",
        "files": {"app", "src", "tests"},
    },
    "rust": {
        "name": "Rust",
        "signals": {"Cargo.toml"},
        "lesson": "crate 结构、模块声明、依赖和测试",
        "files": {"src", "tests", "examples"},
    },
    "go": {
        "name": "Go",
        "signals": {"go.mod"},
        "lesson": "module、package、cmd 入口和内部包边界",
        "files": {"cmd", "internal", "pkg"},
    },
    "docker": {
        "name": "容器化",
        "signals": {"Dockerfile", "docker-compose.yml", "docker-compose.yaml"},
        "lesson": "镜像构建、服务编排和运行环境",
        "files": {"deploy", "docker", "ops"},
    },
}


def _title_from_markdown(path: Path) -> str:
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("# "):
                return line[2:].strip()
    except UnicodeDecodeError:
        pass
    return path.stem.replace("_", " ").title()


def list_course_files(repo_root: Path) -> list[CourseFile]:
    course_dir = repo_root / GENERATED_DIR
    if not course_dir.exists():
        return []
    preferred = [
        "project_map.md",
        "outline.md",
        "lesson_01.md",
        "lesson_02.md",
        "lesson_03.md",
        "lesson_04.md",
        "lesson_05.md",
    ]
    files = [course_dir / name for name in preferred if (course_dir / name).is_file()]
    extras = sorted(path for path in course_dir.glob("*.md") if path.name not in preferred)
    return [CourseFile(filename=path.name, title=_title_from_markdown(path)) for path in [*files, *extras]]


def read_course_file(repo_root: Path, filename: str) -> str:
    if "/" in filename or "\\" in filename or not filename.endswith(".md"):
        raise FileNotFoundError(filename)
    path = repo_root / GENERATED_DIR / filename
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(filename)
    return path.read_text(encoding="utf-8")


def _collect_directories(tree: TreeNode) -> list[str]:
    directories: list[str] = []

    def walk(node: TreeNode) -> None:
        if node.type == "directory" and node.path:
            directories.append(node.path)
        for child in node.children:
            walk(child)

    walk(tree)
    return directories[:30]


def _collect_files(tree: TreeNode) -> list[str]:
    source_like = {".py", ".js", ".jsx", ".ts", ".tsx", ".go", ".rs", ".c", ".cpp", ".h", ".hpp", ".java", ".kt"}
    files: list[str] = []

    def walk(node: TreeNode) -> None:
        if node.type == "file":
            suffix = Path(node.path).suffix.lower()
            if suffix in source_like or any(name in node.name.lower() for name in ["main", "app", "server", "index"]):
                files.append(node.path)
        for child in node.children:
            walk(child)

    walk(tree)
    return files[:40]


def _detect_tech_profile(repo_root: Path, key_files: list[Path], directories: list[str]) -> list[dict[str, str]]:
    key_names = {path.name for path in key_files}
    dir_names = {Path(item).name for item in directories}
    matched: list[dict[str, str]] = []
    for hint in TECH_HINTS.values():
        if hint["signals"] & key_names or hint["files"] & dir_names:
            matched.append({"name": hint["name"], "lesson": hint["lesson"]})
    if matched:
        return matched
    return [{"name": "通用代码项目", "lesson": "README、目录结构、入口文件和测试样例"}]


def _format_tech_profile(profile: list[dict[str, str]]) -> str:
    return "\n".join(f"- {item['name']}: {item['lesson']}" for item in profile)


def _describe_key_file(path: Path) -> str:
    name = path.name
    if name.lower() == "readme.md":
        return "项目入口说明，通常包含定位、安装方式和快速开始。"
    if name == "package.json":
        return "前端或 Node.js 项目的依赖、脚本和包信息。"
    if name == "pyproject.toml":
        return "Python 项目的构建系统、依赖和工具配置。"
    if name == "requirements.txt":
        return "Python 依赖清单。"
    if name == "CMakeLists.txt":
        return "C/C++ 项目的构建入口。"
    if name == "Cargo.toml":
        return "Rust 项目的包、依赖和构建配置。"
    if name == "go.mod":
        return "Go 模块定义和依赖入口。"
    if name == "Dockerfile":
        return "容器镜像构建说明。"
    if name.startswith("docker-compose"):
        return "多服务本地编排配置。"
    if name == "Makefile":
        return "常用自动化命令和构建任务入口。"
    return "重要配置或说明文件。"


def generate_course(repo_root: Path) -> list[CourseFile]:
    repo_root = repo_root.resolve()
    course_dir = repo_root / GENERATED_DIR
    course_dir.mkdir(parents=True, exist_ok=True)

    tree = scan_tree(repo_root)
    key_files = list_key_files(repo_root)
    directories = _collect_directories(tree)
    files = _collect_files(tree)
    tech_profile = _detect_tech_profile(repo_root, key_files, directories)
    tech_names = "、".join(item["name"] for item in tech_profile)

    key_file_lines = [
        f"- `{path.relative_to(repo_root).as_posix()}`: {_describe_key_file(path)}"
        for path in key_files
    ] or ["- 暂未发现 MVP 规则内的关键文件，请先从 README 或源码入口开始阅读。"]

    directory_lines = [f"- `{item}`: 需要结合文件命名和关键配置进一步确认职责。" for item in directories]
    if not directory_lines:
        directory_lines = ["- 项目根目录文件较集中，建议先阅读关键文件再进入源码。"]

    project_map = f"""# 项目结构说明

## 目录概览
{chr(10).join(directory_lines)}

## 关键文件
{chr(10).join(key_file_lines)}

## 技术栈线索
{_format_tech_profile(tech_profile)}

## 推荐阅读路径
1. 先阅读 README 或项目说明文件，建立项目目标和使用场景。
2. 阅读依赖和构建配置，理解技术栈与启动方式。
3. 浏览源码目录，寻找入口文件、核心模块和测试样例。
4. 对照课程目录逐节阅读，记录不熟悉的概念和模块边界。
"""

    outline = f"""# 项目学习总纲

## 技术栈判断
当前规则分析识别到：{tech_names}。

| 课次 | 主题 | 学习目标 |
| --- | --- | --- |
| 1 | 项目定位与目录地图 | 了解项目解决什么问题，建立目录和关键文件的整体认知。 |
| 2 | 技术栈与构建配置 | 识别依赖、构建入口、运行约定和工程化工具。 |
| 3 | 核心源码阅读路线 | 按模块和入口文件组织代码阅读顺序。 |
| 4 | 测试、部署与运行边界 | 通过测试、脚本、容器或 CI 理解项目边界。 |
| 5 | 扩展与二次开发方向 | 总结可修改点、风险点和后续深入分析方向。 |

## 使用方式
每节课都以 Markdown 课件呈现。建议左侧打开相关文件，中间对照代码或课件阅读，右侧查看解释面板。
"""

    likely_files = files[:12]
    likely_file_lines = [f"- `{item}`" for item in likely_files] or ["- 暂无可展示文件。"]
    key_file_refs = [f"- `{path.relative_to(repo_root).as_posix()}`" for path in key_files[:10]] or ["- 暂无关键配置文件。"]

    lessons = {
        "lesson_01.md": f"""# 第 1 课：项目定位与目录地图

## 学习目标
- 说明项目的主要用途和适合的阅读入口。
- 认识顶层目录和关键配置文件。
- 建立第一轮代码阅读路线。

## 相关文件
{chr(10).join(key_file_refs)}

## 阅读顺序
1. 打开 README 或说明文件，提取项目目标。
2. 查看目录树，标记源码、测试、配置和文档目录。
3. 阅读 `project_map.md`，补齐目录职责假设。
4. 对照技术栈线索：{tech_names}，记录后续需要深入的模块。

## 练习问题
- 这个项目面向哪类用户或场景？
- 哪些目录最可能包含核心逻辑？
- 哪些文件决定了构建和依赖方式？
""",
        "lesson_02.md": f"""# 第 2 课：技术栈与构建配置

## 学习目标
- 识别项目语言、包管理器和构建工具。
- 理解关键配置文件如何影响项目结构。
- 区分源码文件和工程配置文件。

## 相关文件
{chr(10).join(key_file_refs)}

## 技术栈线索
{_format_tech_profile(tech_profile)}

## 关键概念
| 概念 | 阅读提示 |
| --- | --- |
| 依赖配置 | 查找 package、module、requirements、manifest 等文件。 |
| 构建入口 | 查找 scripts、Makefile、CMake、Docker 或 CI 配置。 |
| 环境约定 | 查找 env 示例、容器配置和开发文档。 |

## 练习问题
- 项目最依赖哪些外部库或框架？
- 哪个配置文件最能代表项目技术栈？
- 如果后续做 Tree-sitter 分析，哪些语言需要优先支持？
""",
        "lesson_03.md": f"""# 第 3 课：核心源码阅读路线

## 学习目标
- 从文件树中挑选第一批需要精读的源码文件。
- 按入口、核心模块、边界模块组织阅读顺序。
- 为后续函数和类级别分析保留问题清单。

## 候选文件
{chr(10).join(likely_file_lines)}

## 阅读方法
1. 先找入口文件，例如 main、app、server、index、cli 等命名。
2. 再找核心领域模块，例如 service、core、engine、model、parser 等目录。
3. 最后阅读测试或示例，验证你对行为的理解。
4. 如果项目是 {tech_names}，优先对照构建配置和源码目录之间的映射。

## 练习问题
- 哪个文件最像程序入口？
- 哪些模块承担了业务规则？
- 哪些边界依赖可以在第二阶段用调用关系进一步分析？
""",
        "lesson_04.md": f"""# 第 4 课：测试、部署与运行边界

## 学习目标
- 找到测试目录、脚本、CI、容器或部署配置。
- 理解项目如何验证核心行为。
- 在不运行代码的前提下，建立安全边界和运行环境认知。

## 重点观察
| 对象 | 阅读提示 |
| --- | --- |
| tests / test | 从测试命名和目录层级反推核心功能。 |
| scripts / Makefile | 观察自动化任务，但第一阶段不执行被导入项目代码。 |
| Docker / deploy | 理解运行环境、服务边界和外部依赖。 |
| CI 配置 | 看项目作者认为必须验证的质量门槛。 |

## 技术栈关联
{_format_tech_profile(tech_profile)}

## 练习问题
- 项目有哪些验证方式？
- 哪些脚本或配置暗示了部署流程？
- 哪些运行相关内容应该在学习器里只读展示，不能执行？
""",
        "lesson_05.md": """# 第 5 课：扩展与二次开发方向

## 学习目标
- 总结项目结构中的稳定点和可扩展点。
- 识别适合下一阶段深入分析的模块。
- 将阅读结论转化为学习笔记和改造计划。

## 扩展方向
| 方向 | 建议 |
| --- | --- |
| 结构分析 | 使用 Tree-sitter 提取函数、类和导入关系。 |
| 学习体验 | 给课程加入 Mermaid 图、测验和阅读进度。 |
| AI 解释 | 接入 LLM provider，基于文件片段生成更细解释。 |

## 练习问题
- 如果你要修改一个功能，应该先看哪些文件？
- 哪些模块的职责还不清晰？
- 下一阶段最值得自动化分析的对象是什么？
""",
    }

    (course_dir / "project_map.md").write_text(project_map, encoding="utf-8")
    (course_dir / "outline.md").write_text(outline, encoding="utf-8")
    for filename, content in lessons.items():
        (course_dir / filename).write_text(content, encoding="utf-8")

    return list_course_files(repo_root)
