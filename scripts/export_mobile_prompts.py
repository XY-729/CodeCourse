from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.prompt_store import PROMPT_DEFAULTS  # noqa: E402


def main() -> None:
    content = json.dumps(PROMPT_DEFAULTS, ensure_ascii=False, indent=2) + "\n"
    targets = (
        ROOT / "shared" / "default-prompts.json",
        ROOT / "frontend" / "src" / "platform" / "android" / "default-prompts.json",
    )
    for target in targets:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
