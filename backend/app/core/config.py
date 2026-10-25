from pathlib import Path
import os

PROJECT_ROOT = Path(__file__).resolve().parents[3]
WORKSPACE_ROOT = Path(os.getenv("GPL_WORKSPACE_ROOT", PROJECT_ROOT / "workspace")).resolve()
REPOS_ROOT = WORKSPACE_ROOT / "repos"
GENERATED_ROOT = WORKSPACE_ROOT / "generated"
CODE_INTELLIGENCE_ROOT = WORKSPACE_ROOT / "code-intelligence"
CODE_INTELLIGENCE_SNAPSHOTS_ROOT = CODE_INTELLIGENCE_ROOT / "snapshots"
CODE_INTELLIGENCE_CACHE_ROOT = CODE_INTELLIGENCE_ROOT / "cache"
CODE_INTELLIGENCE_BINARY = os.getenv("CODECOURSE_CBM_BIN", "").strip()
DB_PATH = Path(os.getenv("GPL_DB_PATH", WORKSPACE_ROOT / "app.db")).resolve()
LLM_PROVIDER = os.getenv("GPL_LLM_PROVIDER", "template")
LLM_API_KEY = os.getenv("GPL_LLM_API_KEY", "")
PROMPT_VERSION = os.getenv("GPL_PROMPT_VERSION", "coursegen-v1")

# Chapter writers are high-volume, low-ambiguity calls. DeepSeek enables
# thinking at "high" by default, which measured 25k-45k reasoning tokens per
# section and dominated both latency and cost. Planning, synthesis and audit
# keep the provider default; only the section writers are dialed down.
REASONING_EFFORT_VALUES = ("default", "low", "high", "max", "disabled")
DEFAULT_SECTION_REASONING_EFFORT = "low"


def normalize_reasoning_effort(value: object, *, default: str = DEFAULT_SECTION_REASONING_EFFORT) -> str:
    text = str(value or "").strip().lower()
    if text in REASONING_EFFORT_VALUES:
        return text
    if text in {"off", "none", "false", "0"}:
        return "disabled"
    if text in {"minimal", "medium"}:
        return "low"
    return default


def section_reasoning_effort_default() -> str:
    return normalize_reasoning_effort(os.getenv("GPL_SECTION_REASONING_EFFORT"), default=DEFAULT_SECTION_REASONING_EFFORT)

IGNORED_DIRS = {
    ".git",
    "node_modules",
    "build",
    "dist",
    "target",
    "__pycache__",
    ".venv",
    "venv",
    ".next",
    "coverage",
    ".pytest_cache",
    ".mypy_cache",
    ".idea",
    ".vscode",
}

KEY_FILES = {
    "README.md",
    "readme.md",
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "CMakeLists.txt",
    "Cargo.toml",
    "go.mod",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "Makefile",
}

MAX_TEXT_BYTES = 512 * 1024

INDEX_SCHEMA_VERSION = 2
CHUNK_ALGORITHM_VERSION = 2
IGNORE_RULES_VERSION = 1
STRUCTURAL_ENGINE_VERSION = 1
STRUCTURAL_INDEX_SCHEMA_VERSION = 1
PARSER_GRAMMAR_VERSION = 1
