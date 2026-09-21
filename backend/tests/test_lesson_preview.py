import json
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import test_lesson_concurrency as fixtures
from app.services.lesson_preview import LessonPreview, read_preview


class SnapshotTests(unittest.TestCase):
    def test_only_contiguous_sections_are_published_and_versions_track_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            preview = LessonPreview(root, 1, {"lesson_number": 1})
            preview.sections("课程", ["", "## 第二章", ""])
            before = read_preview(root, 1)
            self.assertEqual(before["completed_sections"], 1)
            self.assertEqual(before["markdown"], "")
            preview.sections("课程", ["", "## 第二章", "## 第三章"])
            self.assertEqual(read_preview(root, 1)["version"], before["version"])
            preview.sections("课程", ["## 第一章", "## 第二章", "## 第三章"])
            ready = read_preview(root, 1)
            self.assertEqual(ready["readable_sections"], 3)
            self.assertIn("first_readable", ready["timings"])
            preview.finish("failed")
            self.assertEqual(read_preview(root, 1)["markdown"], ready["markdown"])
            from app.services.course_generator import list_course_files_from_dir
            self.assertEqual(list_course_files_from_dir(root), [])


class PreviewIntegrationTests(unittest.TestCase):
    setUp = fixtures.RepositoryLessonConcurrencyTests.setUp
    tearDown = fixtures.RepositoryLessonConcurrencyTests.tearDown
    _plan = fixtures.RepositoryLessonConcurrencyTests._plan
    _responses = fixtures.RepositoryLessonConcurrencyTests._responses
    def test_learning_plan_and_sub_outline_have_preview_and_timing(self):
        from app.services.storage import create_learning_plan_project
        learning = create_learning_plan_project("学习计划", self.workspace / "learning")
        learning_root = self.generated / str(learning.id)
        learning_root.mkdir()
        (learning_root / "outline.md").write_text("# 总纲\n\n### 第 1 课：入口与启动\n\n学习 start。", encoding="utf-8")
        root = self.generated / str(self.project.id)
        sub_path = "sub-outline-1234abcd.md"
        (root / sub_path).write_text((root / "outline.md").read_text(encoding="utf-8"), encoding="utf-8")
        for project_id, outline_path in [(learning.id, None), (self.project.id, sub_path)]:
            with self.subTest(project_id=project_id), patch("app.services.generation_service.call_openai_compatible_chat", side_effect=self._responses()):
                result = self.client.post(f"/api/projects/{project_id}/lessons/outline", json={"lesson_number": 1, "title": "入口与启动", "outline_path": outline_path})
                self.assertEqual(result.status_code, 200, result.text)
                task_id = result.json()["id"]
                preview = self.client.get(f"/api/projects/{project_id}/tasks/{task_id}/preview").json()
                self.assertEqual(preview["status"], "completed", preview)
                self.assertEqual(preview["readable_sections"], 4)
                saved = read_preview(self.generated / str(project_id), task_id)
                for phase in ("preparing", "planning", "sections", "synthesis", "saving", "first_readable", "total"):
                    self.assertIn(phase, saved["timings"])
                self.assertEqual(saved["request"]["outline_path"], outline_path)

    def test_first_section_readable_before_synthesis_and_failure_preserves_old_course(self):
        from app.services.generation_service import create_or_reuse_outline_lesson_task, run_outline_lesson_task
        from app.services.storage import upsert_lesson_files
        upsert_lesson_files(self.project.id, 1, [("src/main.py", "index")])
        root = self.generated / str(self.project.id)
        output = root / "lessons/lesson_01.md"
        output.parent.mkdir()
        output.write_text("# 旧版", encoding="utf-8")
        task, reused = create_or_reuse_outline_lesson_task(self.project.id, Path(self.project.local_path), 1, "入口与启动", "test", "保留参数")
        self.assertFalse(reused)
        release_first = threading.Event()
        release_synthesis = threading.Event()
        synthesis_started = threading.Event()
        plan = json.loads(self._plan())
        responses = self._responses()

        def model(*args, **kwargs):
            prompt = args[3][1]["content"]
            if "核心正文章节" in prompt:
                index = next(i for i, section in enumerate(plan["sections"]) if f"章节标题：{section['title']}" in prompt)
                if index == 0:
                    if not release_first.wait(8): raise RuntimeError("test first-section timeout")
                return responses[index + 1]
            if "章节规划" in prompt:
                return responses[0]
            synthesis_started.set()
            if not release_synthesis.wait(8): raise RuntimeError("test synthesis timeout")
            raise RuntimeError("controlled synthesis failure")

        def snapshot():
            return self.client.get(f"/api/projects/{self.project.id}/tasks/{task.id}/preview").json()

        with patch("app.services.generation_service.call_openai_compatible_chat", side_effect=model), ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(run_outline_lesson_task, self.project.id, task.id, 1, "入口与启动", "保留参数")
            try:
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline and snapshot()["completed_sections"] < 3:
                    time.sleep(.02)
                early = snapshot()
                self.assertEqual(early["completed_sections"], 3, self.client.get(f"/api/projects/{self.project.id}/tasks/{task.id}").json())
                self.assertEqual(early["readable_sections"], 0)
                release_first.set()
                self.assertTrue(synthesis_started.wait(5))
                ready = snapshot()
                self.assertEqual(ready["status"], "running")
                self.assertEqual(ready["readable_sections"], 4)
                self.assertIn("启动入口", ready["markdown"])
                self.assertEqual(output.read_text(encoding="utf-8"), "# 旧版")
                task_data = self.client.get(f"/api/projects/{self.project.id}/tasks/{task.id}").json()
                self.assertLess(task_data["progress_current"], task_data["progress_total"])
                self.assertEqual(task_data["progress_phase"], "synthesis")
            finally:
                release_first.set()
                release_synthesis.set()
                future.result(timeout=8)
        failed = snapshot()
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["markdown"], ready["markdown"])
        self.assertFalse((root / ".tasks" / f"task-{task.id}").exists())
        self.assertEqual(output.read_text(encoding="utf-8"), "# 旧版")
        with patch("app.api.projects.run_outline_lesson_task") as rerun:
            response = self.client.post(f"/api/projects/{self.project.id}/tasks/{task.id}/retry")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(snapshot()["markdown"], "")
            self.assertEqual(rerun.call_args.kwargs["instructions"], "保留参数")
        self.assertEqual(self.client.post(f"/api/projects/{self.project.id}/tasks/{task.id}/retry").status_code, 409)

    def test_preview_rejects_cross_project_and_unknown_tasks(self):
        from app.services.storage import create_generation_task, upsert_project
        other = upsert_project("other", "https://example.com/other", Path(self.project.local_path), "scanned")
        task = create_generation_task(project_id=other.id, task_type="outline_lesson", input_hash="abc", prompt_version="test")
        for task_id in (task.id, 99999):
            self.assertEqual(self.client.get(f"/api/projects/{self.project.id}/tasks/{task_id}/preview").status_code, 404)

    def test_completed_cache_retains_preview_without_model_calls(self):
        with patch("app.services.generation_service.call_openai_compatible_chat", side_effect=self._responses()):
            request = {"lesson_number": 1, "title": "入口与启动", "instructions": "缓存"}
            first = self.client.post(f"/api/projects/{self.project.id}/lessons/outline", json=request)
        task_id = first.json()["id"]
        before = self.client.get(f"/api/projects/{self.project.id}/tasks/{task_id}/preview").json()
        with patch("app.services.generation_service.call_openai_compatible_chat") as model:
            second = self.client.post(f"/api/projects/{self.project.id}/lessons/outline", json=request)
        self.assertEqual(second.json()["id"], task_id)
        model.assert_not_called()
        self.assertEqual(before["status"], "completed")
        self.assertEqual(before["readable_sections"], 4)
