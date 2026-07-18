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
