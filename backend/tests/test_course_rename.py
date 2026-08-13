import sqlite3
import tempfile
import unittest
from pathlib import Path
from urllib.parse import quote

from fastapi.testclient import TestClient


def _setup_workspace():
    import app.core.config as cfg
    import app.services.generation_service as generation_service
    import app.services.storage as storage

    tmpdir = tempfile.TemporaryDirectory()
    workspace = Path(tmpdir.name)
    cfg.DB_PATH = workspace / "app.db"
    cfg.WORKSPACE_ROOT = workspace
    cfg.REPOS_ROOT = workspace / "repos"
    cfg.GENERATED_ROOT = workspace / "generated"
    storage.DB_PATH = cfg.DB_PATH
    storage.WORKSPACE_ROOT = cfg.WORKSPACE_ROOT
    storage.REPOS_ROOT = cfg.REPOS_ROOT
    storage.GENERATED_ROOT = cfg.GENERATED_ROOT
    generation_service.GENERATED_ROOT = cfg.GENERATED_ROOT
    storage.init_storage()
    return tmpdir, cfg.DB_PATH, cfg.GENERATED_ROOT


class CourseRenameTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir, self.db_path, self.generated = _setup_workspace()
        from app.main import app

        self.client = TestClient(app)
        self.project = self.client.post("/api/projects/learning-plan", json={"name": "Rename test"}).json()
        self.project_id = self.project["id"]
        self.course_dir = self.generated / str(self.project_id)
        self.course_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_rename_sub_outline_keeps_graph_edges_and_moves_references(self):
        from app.services.storage import (
            create_highlight,
            create_knowledge_edge,
            create_knowledge_node,
            upsert_learning_state,
        )

        old_name = "sub-outline-ab12cd34.md"
        new_name = "支付模块总纲.md"
        source = self.course_dir / old_name
        source.write_text(
            "# Old outline\n\n<!-- CODECOURSE_LESSON_LINKS_START -->\n"
            f"[Generate](https://codecourse.local/generate-lesson/1?outline_path={quote(old_name, safe='')})\n"
            "<!-- CODECOURSE_LESSON_LINKS_END -->\n",
            encoding="utf-8",
        )
        related = self.course_dir / "related.md"
        related.write_text(
            f"[Generate](https://codecourse.local/generate-lesson/1?outline_path={quote(old_name, safe='')})\n",
            encoding="utf-8",
        )
        outline_node = create_knowledge_node(
            self.project_id, "course", "Old outline", ref_type="course", ref_path=old_name,
        )
        lesson_node = create_knowledge_node(
            self.project_id, "course", "Lesson", ref_type="course", ref_path="lessons/lesson_01.md",
        )
        edge = create_knowledge_edge(self.project_id, outline_node.id, lesson_node.id, "parent_of")
        create_highlight(self.project_id, "course", old_name, "term", "yellow")
        upsert_learning_state(self.project_id, "course", old_name, "in_progress", "scroll_ratio", 0.4)

        response = self.client.patch(
            f"/api/projects/{self.project_id}/course/{old_name}",
            json={"name": "支付模块总纲"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["filename"], new_name)
        self.assertTrue(response.json()["is_outline"])
        self.assertFalse(source.exists())
        self.assertTrue((self.course_dir / new_name).exists())
        self.assertIn("# 支付模块总纲", (self.course_dir / new_name).read_text(encoding="utf-8"))
        self.assertIn(f"outline_path={quote(new_name, safe='')}", related.read_text(encoding="utf-8"))

        graph = self.client.get(f"/api/projects/{self.project_id}/knowledge/graph").json()
        renamed_node = next(node for node in graph["nodes"] if node["id"] == outline_node.id)
        self.assertEqual(renamed_node["ref_path"], new_name)
        self.assertEqual(renamed_node["title"], "支付模块总纲")
        self.assertTrue(any(item["id"] == edge.id for item in graph["edges"]))
        states = self.client.get(f"/api/projects/{self.project_id}/learning-state").json()
        self.assertEqual(states[0]["source_path"], new_name)
        highlights = self.client.get(
            f"/api/projects/{self.project_id}/highlights?source_type=course&source_path={quote(new_name, safe='')}"
        ).json()
        self.assertEqual(len(highlights), 1)

        courses = self.client.get(f"/api/projects/{self.project_id}/course").json()
        renamed_course = next(item for item in courses if item["filename"] == new_name)
        self.assertTrue(renamed_course["is_outline"])

    def test_rejects_reserved_path_and_duplicate_name(self):
        (self.course_dir / "outline.md").write_text("# Outline\n", encoding="utf-8")
        (self.course_dir / "one.md").write_text("# One\n", encoding="utf-8")
        (self.course_dir / "two.md").write_text("# Two\n", encoding="utf-8")

        reserved = self.client.patch(
            f"/api/projects/{self.project_id}/course/outline.md", json={"name": "Renamed"},
        )
        duplicate = self.client.patch(
            f"/api/projects/{self.project_id}/course/one.md", json={"name": "two"},
        )
        self.assertEqual(reserved.status_code, 400)
        self.assertEqual(duplicate.status_code, 409)


if __name__ == "__main__":
    unittest.main()
