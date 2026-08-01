import os
import sys
import tempfile
import unittest
from pathlib import Path

# Ensure backend package is importable when running this file directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.core.config import IGNORED_DIRS, KEY_FILES  # noqa: E402
from app.services import lesson_files  # noqa: E402
from app.services.lesson_files import (  # noqa: E402
    build_file_code_blocks,
    _compact_code,
)


class LessonFileSelectionTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name) / "repo"
        self.repo.mkdir()
        (self.repo / "README.md").write_text("# demo\n", encoding="utf-8")
        (self.repo / "CMakeLists.txt").write_text("cmake_minimum_required", encoding="utf-8")
        src = self.repo / "src"
        src.mkdir()
        (src / "main.cpp").write_text("int main() {}", encoding="utf-8")
        (src / "util.cpp").write_text("int util() {}", encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def test_fallback_key_files_orders_keys_first(self):
        found = lesson_files._fallback_key_files(self.repo)
        self.assertIn("README.md", found)
        self.assertIn("CMakeLists.txt", found)
        self.assertIn("src/main.cpp", found)

    def test_select_lessons_without_index_uses_fallback(self):
        # No index available in this environment: selection must fall back to
        # key files and stay non-empty for every repository lesson.
        outline = "# 总纲\n\n### 第 1 课：入门\n\n### 第 2 课：进阶\n"
        selected = lesson_files.select_lesson_files(9999, self.repo, outline)
        self.assertEqual(set(selected.keys()), {1, 2})
        for files in selected.values():
            self.assertGreaterEqual(len(files), 2)
            self.assertIn("README.md", files[0])

    def test_select_lessons_deduplicates_and_caps(self):
        outline = "### 第 1 课：构建\n" + "### 第 2 课：构建\n" * 5
        selected = lesson_files.select_lesson_files(9999, self.repo, outline)
        for files in selected.values():
            self.assertEqual(len(files), len(set(files)))
            self.assertLessEqual(len(files), lesson_files.MAX_FILES_PER_LESSON)


class CompactCodeTest(unittest.TestCase):
    def test_small_file_kept_whole(self):
        content = "line1\nline2\n"
        self.assertEqual(_compact_code(content, 12000), content)

    def test_large_file_head_tail(self):
        lines = [f"line{i}" for i in range(1, 5001)]
        content = "\n".join(lines) + "\n"
        out = _compact_code(content, 12000)
        self.assertLess(len(out), 12000)
        self.assertIn("省略", out)
        self.assertTrue(out.startswith("line1"))
        self.assertTrue(out.rstrip().endswith("line5000"))

    def test_budget_enforced(self):
        lines = [f"line{i}" for i in range(1, 5001)]
        content = "\n".join(lines) + "\n"
        out = _compact_code(content, 2000)
        self.assertLessEqual(len(out), 2000)


class BuildBlocksTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name) / "repo"
        self.repo.mkdir()
        (self.repo / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
        (self.repo / "b.py").write_text("def b():\n    return 2\n", encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def test_builds_blocks_with_paths(self):
        out = build_file_code_blocks(self.repo, ["a.py", "b.py"])
        self.assertIn("### a.py", out)
        self.assertIn("### b.py", out)
        self.assertIn("def a()", out)
        self.assertIn("def b()", out)

    def test_missing_file_skipped(self):
        out = build_file_code_blocks(self.repo, ["a.py", "missing.py", "b.py"])
        self.assertIn("### a.py", out)
        self.assertIn("### b.py", out)
        self.assertNotIn("missing.py", out)

    def test_budget_truncates_later_files(self):
        small = build_file_code_blocks(self.repo, ["a.py", "b.py"], budget=60)
        self.assertLessEqual(len(small), 60)


if __name__ == "__main__":
    unittest.main()
