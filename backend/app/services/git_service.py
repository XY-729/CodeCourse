from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from fastapi import HTTPException

from app.core.config import REPOS_ROOT

GITHUB_HTTPS_RE = re.compile(r"^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?/?$")
GITHUB_SSH_RE = re.compile(r"^git@github\.com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?$")


def normalize_github_repo_key(url: str) -> str:
    cleaned = url.strip().rstrip("/")
    if cleaned.endswith(".git"):
        cleaned = cleaned[:-4]
    https_match = re.match(r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$", cleaned)
    if https_match:
        return f"github.com/{https_match.group(1).lower()}/{https_match.group(2).lower()}"
    ssh_match = re.match(r"^git@github\.com:([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$", cleaned)
    if ssh_match:
        return f"github.com/{ssh_match.group(1).lower()}/{ssh_match.group(2).lower()}"
    return cleaned


def validate_git_url(url: str) -> str:
    cleaned = url.strip()
    if GITHUB_HTTPS_RE.match(cleaned) or GITHUB_SSH_RE.match(cleaned):
        return cleaned
    raise HTTPException(status_code=400, detail="Only GitHub repository URLs are supported in the MVP")


def https_to_ssh_url(url: str) -> str:
    cleaned = url.strip()
    if not GITHUB_HTTPS_RE.match(cleaned):
        return ""
    parsed = urlparse(cleaned)
    path = parsed.path.strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    return f"git@github.com:{path}.git"


def repo_name_from_url(url: str) -> str:
    if url.startswith("git@github.com:"):
        path = url.split(":", 1)[1]
    else:
        parsed = urlparse(url)
        path = parsed.path.strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    owner, repo = path.split("/", 1)
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", f"{owner}-{repo}")
    return safe[:120]


def clone_or_reuse(url: str) -> Path:
    git_executable = shutil.which("git")
    if not git_executable:
        raise HTTPException(
            status_code=500,
            detail="Git runtime was not found. The desktop build should include bundled Git, or install Git and restart CodeCourse.",
        )

    REPOS_ROOT.mkdir(parents=True, exist_ok=True)
    dest = (REPOS_ROOT / repo_name_from_url(url)).resolve()
    if dest.exists() and (dest / ".git").exists():
        return dest
    if dest.exists():
        shutil.rmtree(dest)
    try:
        result = subprocess.run(
            [git_executable, "clone", "--depth", "1", url, str(dest)],
            text=True,
            capture_output=True,
            timeout=180,
        )
    except subprocess.TimeoutExpired:
        suggestion = https_to_ssh_url(url)
        hint = f" Try SSH instead: {suggestion}" if suggestion else ""
        raise HTTPException(status_code=504, detail=f"git clone timed out.{hint}")
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        lower = detail.lower()
        suggestion = https_to_ssh_url(url)
        if "failed to connect" in lower or "connection timed out" in lower or "connection refused" in lower:
            hint = f" Try SSH instead: {suggestion}" if suggestion else " Check network access and repository URL."
            message = f"git clone failed: network error. {detail}{hint}"
        elif "permission denied" in lower or "publickey" in lower or "authentication failed" in lower:
            message = f"git clone failed: authentication error. Check your GitHub SSH key or repository permission. {detail}"
        elif "repository not found" in lower or "not found" in lower:
            message = f"git clone failed: repository not found. Check repository URL, casing, and permission. {detail}"
        else:
            message = f"git clone failed: {detail}"
        raise HTTPException(status_code=502, detail=message)
    return dest
