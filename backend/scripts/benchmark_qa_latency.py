"""Measure real-provider QA latency in an isolated workspace; never print keys."""
import argparse
import asyncio
import json
import math
import os
from pathlib import Path
import sqlite3
import statistics
import sys
import tempfile
import time
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
parser = argparse.ArgumentParser()
parser.add_argument("--settings-db", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--count", type=int, default=30)
parser.add_argument("--defer-metadata", action="store_true", help="Measure the desktop body-only path")
args = parser.parse_args()

# Resolve the same environment/.env/database precedence as the installed app.
os.environ["GPL_WORKSPACE_ROOT"] = str(args.settings_db.parent)
os.environ["GPL_DB_PATH"] = str(args.settings_db)
from app.services.storage import get_llm_settings
settings = get_llm_settings()
if settings.get("enabled") != "true" or not settings.get("api_key"):
    raise SystemExit("Current model is not configured/enabled")

CASES = [
    ("return a + b", "这行代码做什么？"),
    ("const [count, setCount] = useState(0)", "解释状态更新机制。"),
    ("async def load(): return await fetch()", "await 在这里起什么作用？"),
    ("SELECT name FROM users WHERE active = 1", "解释查询条件。"),
    ("items.map(x => x.id)", "这和 forEach 有什么区别？"),
    ("with open(path) as f: data = f.read()", "with 怎样释放资源？"),
    ("try: run()\nexcept ValueError: pass", "这里吞掉异常有什么问题？"),
    ("const value = input ?? 0", "解释这个运算符。"),
    ("git diff --staged", "解释这条命令检查什么。"),
    ("def f(items=[]): items.append(1); return items", "这段代码的隐患是什么？"),
]

async def run():
    import app.core.config as cfg
    from app.services import storage, generation_service, qa_service
    from app.api.qa import ask_stream
    from app.models.schemas import QAAskRequest
    rows = []
    with tempfile.TemporaryDirectory(prefix="qa-latency-") as directory:
        root = Path(directory)
        for module in (cfg, storage):
            module.DB_PATH = root / "app.db"
            module.WORKSPACE_ROOT = root
            module.REPOS_ROOT = root / "repos"
            module.GENERATED_ROOT = root / "generated"
        generation_service.GENERATED_ROOT = root / "generated"
        storage.init_storage()
        repo = root / "repos" / "latency"
        repo.mkdir(parents=True)
        project = storage.upsert_project("latency-test", "https://example.com/latency", repo, "scanned")
        with (patch.object(qa_service, "get_llm_settings", return_value=settings),
              patch("app.services.qa_background.dispatch_answer")):
            for index in range(args.count):
                selected, question = CASES[index % len(CASES)]
                payload = QAAskRequest(source_type="selection", selected_text=selected,
                    question=question + "请用2至4句话回答。", provider=settings["provider"],
                    base_url=settings["base_url"], model=settings["model"], defer_metadata=args.defer_metadata)
                start = time.perf_counter()
                row = {"case": index + 1, "first_text_ms": None, "prepare_ms": None, "completed_ms": None}
                response = await ask_stream(project.id, payload)
                async for event in response.body_iterator:
                    kind = event.split("\n", 1)[0][7:]
                    data = json.loads(event.split("\ndata: ", 1)[1])
                    elapsed = round((time.perf_counter() - start) * 1000, 1)
                    if kind == "stage" and data["stage"] == "waiting_model":
                        row["prepare_ms"] = elapsed
                    if kind == "delta" and data.get("text", "").strip() and row["first_text_ms"] is None:
                        row["first_text_ms"] = elapsed
                    if kind == "completed":
                        row["completed_ms"] = elapsed
                    if kind == "error":
                        row["error"] = data["message"][:200]
                rows.append(row)
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps({"model": settings["model"], "runs": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
                print(json.dumps(row, ensure_ascii=False), flush=True)
                # Repeated authentication/configuration failure should not incur 30 retries.
                if index >= 2 and all(r.get("error") for r in rows[-3:]):
                    break
    latencies = sorted(r["first_text_ms"] for r in rows if r["first_text_ms"] is not None and r["completed_ms"] is not None)
    summary = {"model": settings["model"], "defer_metadata": args.defer_metadata, "attempts": len(rows), "successes": len(latencies),
        "metric": "server request to first non-whitespace visible SSE body; excludes browser paint",
        "median_ms": statistics.median(latencies) if latencies else None,
        "p95_ms": latencies[math.ceil(len(latencies) * .95) - 1] if latencies else None,
        "within_3s_percent": round(100 * sum(x <= 3000 for x in latencies) / len(rows), 1),
        "max_prepare_ms": max((r["prepare_ms"] or 0 for r in rows), default=0)}
    args.output.write_text(json.dumps({"summary": summary, "runs": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False), flush=True)

asyncio.run(run())
