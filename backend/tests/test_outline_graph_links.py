"""Tests for linking generated lessons to their outline node in the knowledge graph."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.generation_service import _link_lesson_to_outline
from app.services.storage import (
    create_knowledge_edge,
    create_knowledge_node,
    find_knowledge_edge,
    find_knowledge_node,
    get_knowledge_node,
    init_storage,
    set_setting,
    upsert_project,
)


def _setup_temp_workspace():
    import app.core.config as cfg
    import app.services.generation_service as generation_service
    import app.services.storage as storage

    tmpdir = tempfile.TemporaryDirectory()
    workspace = Path(tmpdir.name)
    db_path = workspace / "app.db"
    repos = workspace / "repos"
    generated = workspace / "generated"

    cfg.DB_PATH = db_path
    cfg.WORKSPACE_ROOT = workspace
    cfg.REPOS_ROOT = repos
    cfg.GENERATED_ROOT = generated

    storage.DB_PATH = db_path
    storage.GENERATED_ROOT = generated
    storage.REPOS_ROOT = repos
    storage.WORKSPACE_ROOT = workspace
    generation_service.GENERATED_ROOT = generated

    repos.mkdir(parents=True, exist_ok=True)
    generated.mkdir(parents=True, exist_ok=True)

    storage.init_storage()
    return tmpdir, workspace, generated


class OutlineGraphLinkTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir, self.workspace, self.generated = _setup_temp_workspace()
        repo_dir = self.workspace / "repos" / "repo"
        repo_dir.mkdir(parents=True)
        self.project = upsert_project("repo", "https://github.com/test/repo.git", repo_dir, "scanned")

    def tearDown(self):
        self._tmpdir.cleanup()

    def _make_lesson_node(self, filename="lessons/lesson_01.md", title="第1课"):
        return create_knowledge_node(
            project_id=self.project.id,
            node_type="course",
            title=title,
            ref_type="course",
            ref_path=filename,
            summary="test",
        )

    def test_link_creates_outline_node_and_parent_edge(self):
        lesson = self._make_lesson_node()
        self.assertIsNone(
            find_knowledge_node(self.project.id, node_type="course", ref_type="course", ref_path="outline.md")
        )

        _link_lesson_to_outline(self.project.id, lesson.id, "outline.md")

        outline = find_knowledge_node(self.project.id, node_type="course", ref_type="course", ref_path="outline.md")
        self.assertIsNotNone(outline, "总纲节点应被自动创建")
        self.assertEqual(outline.title, "总纲")
        edge = find_knowledge_edge(self.project.id, outline.id, lesson.id, "parent_of")
        self.assertIsNotNone(edge, "应建立 parent_of 边")
        self.assertEqual(edge.label, "属于总纲")

    def test_link_is_idempotent(self):
        lesson = self._make_lesson_node()
        _link_lesson_to_outline(self.project.id, lesson.id, "outline.md")
        _link_lesson_to_outline(self.project.id, lesson.id, "outline.md")

        outline = find_knowledge_node(self.project.id, node_type="course", ref_type="course", ref_path="outline.md")
        from app.services.storage import list_knowledge_edges

        edges = list_knowledge_edges(self.project.id)
        matches = [e for e in edges if e.source_node_id == outline.id and e.target_node_id == lesson.id and e.relation_type == "parent_of"]
        self.assertEqual(len(matches), 1, "重复调用不应产生重复边")

    def test_link_uses_sub_outline_path(self):
        lesson = self._make_lesson_node(filename="lessons/lesson_01.md")
        _link_lesson_to_outline(self.project.id, lesson.id, "sub-outline-1234abcd.md")

        sub = find_knowledge_node(self.project.id, node_type="course", ref_type="course", ref_path="sub-outline-1234abcd.md")
        self.assertIsNotNone(sub, "子总纲节点应被创建")
        self.assertEqual(sub.title, "sub-outline-1234abcd.md")
        edge = find_knowledge_edge(self.project.id, sub.id, lesson.id, "parent_of")
        self.assertIsNotNone(edge)

    def test_link_reuses_existing_outline_node(self):
        outline = create_knowledge_node(
            project_id=self.project.id,
            node_type="course",
            title="总纲",
            ref_type="course",
            ref_path="outline.md",
            summary="existing",
        )
        lesson = self._make_lesson_node()
        _link_lesson_to_outline(self.project.id, lesson.id, "outline.md")

        nodes = [n for n in [outline, find_knowledge_node(self.project.id, node_type="course", ref_type="course", ref_path="outline.md")] if n]
        self.assertEqual(len(set(n.id for n in nodes)), 1, "应复用已有总纲节点而非新建")


if __name__ == "__main__":
    unittest.main()
