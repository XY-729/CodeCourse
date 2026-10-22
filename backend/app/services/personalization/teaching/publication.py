"""Recoverable file publication using A's authoritative manifest/index service."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from uuid import uuid4

from .manifest import parse_manifest


def publish_course_document(project_id: int, source_path: str, content: str, *,
                            tree_snapshot: dict | None = None, generation_id: str | None = None) -> str:
    from app.services.storage import GENERATED_ROOT, run_in_transaction, _connect
    from app.services.knowledge_tree_service import apply_manifest
    from app.services.teaching_index import index_document
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    parsed = parse_manifest(content)
    manifest = parsed.require_valid()
    root = (GENERATED_ROOT / str(project_id)).resolve()
    target = (root / source_path).resolve()
    if root not in target.parents:
        raise ValueError("生成文档必须位于当前项目目录")
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    artifact_kind = "outline" if "outline" in source_path or "project_map" in source_path else "lesson"
    generation_id = generation_id or str(uuid4())
    # Validate identity/parent/scope proposals without publishing any state.
    def validate(conn):
        conn.execute("SAVEPOINT generation_preflight")
        try:
            apply_manifest(project_id, manifest, source_type="course", source_path=source_path,
                           artifact_kind=artifact_kind, content_hash=digest,
                           tree_snapshot=tree_snapshot, generation_id=generation_id, conn=conn)
        finally:
            conn.execute("ROLLBACK TO generation_preflight")
            conn.execute("RELEASE generation_preflight")
    run_in_transaction(validate)
    directory = root / ".publications"
    directory.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256((source_path + digest).encode()).hexdigest()
    staged, backup, outbox = (directory / (key + suffix) for suffix in (".draft", ".backup", ".json"))
    staged.write_text(content, encoding="utf-8", newline="\n")
    existed = target.exists()
    if existed:
        backup.write_bytes(target.read_bytes())
    event = {"source_path": source_path, "content_hash": digest, "tree_snapshot": tree_snapshot,
             "generation_id": generation_id, "status": "staged", "had_previous": existed}
    outbox.write_text(json.dumps(event, ensure_ascii=False), encoding="utf-8", newline="\n")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        staged.replace(target)
        identity = index_document(project_id, "course", source_path, content, artifact_kind=artifact_kind,
                                  tree_snapshot=tree_snapshot, generation_id=generation_id)
        with _connect() as conn:
            row = conn.execute("SELECT metadata_status,content_status,metadata_errors_json FROM teaching_documents WHERE id=?", (identity,)).fetchone()
        if not row or row["metadata_status"] != "valid" or row["content_status"] != "published":
            raise ValueError("知识清单发布失败：" + (row["metadata_errors_json"] if row else "无索引"))
        event["status"] = "published"
        outbox.write_text(json.dumps(event, ensure_ascii=False), encoding="utf-8", newline="\n")
        backup.unlink(missing_ok=True)
        return content
    except Exception:
        # Preserve both old material and the failed draft for explicit repair.
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == digest:
            target.replace(staged)
            if existed and backup.exists():
                backup.replace(target)
                with target.open("r", encoding="utf-8", newline="") as stream:
                    index_document(project_id, "course", source_path, stream.read())
        event["status"] = "failed"
        outbox.write_text(json.dumps(event, ensure_ascii=False), encoding="utf-8", newline="\n")
        raise


def recover_course_publications(project_id: int) -> None:
    """Finish local indexing after a crash; never call a model or revive old text."""
    from app.services.storage import GENERATED_ROOT
    from app.services.teaching_index import index_document
    root = (GENERATED_ROOT / str(project_id)).resolve()
    for path in sorted((root / ".publications").glob("*.json")):
        event = json.loads(path.read_text(encoding="utf-8"))
        if event.get("status") != "staged":
            continue
        target = (root / event["source_path"]).resolve()
        if root not in target.parents or not target.is_file():
            continue
        if hashlib.sha256(target.read_bytes()).hexdigest() != event["content_hash"]:
            event["status"] = "superseded"
        else:
            with target.open("r", encoding="utf-8", newline="") as stream:
                index_document(project_id, "course", event["source_path"], stream.read(),
                               tree_snapshot=event.get("tree_snapshot"), generation_id=event.get("generation_id"))
            event["status"] = "recovered"
        path.write_text(json.dumps(event, ensure_ascii=False), encoding="utf-8", newline="\n")
