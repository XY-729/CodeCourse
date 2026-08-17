import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

# Ensure backend package is importable when running this file directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.core.config import IGNORED_DIRS, KEY_FILES  # noqa: E402
from app.services import lesson_files  # noqa: E402
from app.services.lesson_files import (  # noqa: E402
    EvidenceRange,
    assemble_file_code_blocks,
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

    def test_large_file_head_tail_with_real_line_ranges(self):
        lines = [f"line{i}" for i in range(1, 5001)]
        content = "\n".join(lines) + "\n"
        out = _compact_code(content, 12000)
        self.assertLess(len(out), 12000)
        self.assertIn("省略", out)
        # Fragments are anchored with their real line ranges so models never
        # have to extrapolate across the omission.
        self.assertTrue(out.startswith("# lines 1-"))
        self.assertIn("# lines 1-", out)
        self.assertRegex(out, r"# \.\.\. 省略 \d+-\d+ 行 \.\.\.")
        self.assertIn("line1", out)
        self.assertTrue(out.rstrip().endswith("line5000"))

    def test_omitted_range_is_accurate(self):
        content = "\n".join(f"line{i}" for i in range(1, 101)) + "\n"
        out = _compact_code(content, 200)
        match = __import__("re").search(r"省略 (\d+)-(\d+) 行", out)
        self.assertIsNotNone(match)
        omitted_start, omitted_end = int(match.group(1)), int(match.group(2))
        # Every line outside the omitted range must be absent from the sample.
        for line_no in range(1, 101):
            present = f"line{line_no}" in out
            if omitted_start <= line_no <= omitted_end:
                self.assertFalse(present, f"line {line_no} should be omitted")
            else:
                self.assertTrue(present, f"line {line_no} should be present")

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

    def test_strip_chunk_metadata_keeps_pure_code(self):
        from app.services.generation_service import _strip_chunk_metadata

        chunk = (
            "文件：src/sandbox_linux.cpp\n"
            "行号：442-444\n"
            "语言：cpp\n"
            "符号：make_linux_ns_sandbox\n"
            "\n"
            "std::unique_ptr<SandboxBackend> make_linux_ns_sandbox() {\n"
            "    return std::make_unique<LinuxNsSandbox>();\n"
            "}\n"
        )
        stripped = _strip_chunk_metadata(chunk)
        self.assertEqual(
            stripped,
            "std::unique_ptr<SandboxBackend> make_linux_ns_sandbox() {\n"
            "    return std::make_unique<LinuxNsSandbox>();\n"
            "}\n",
        )
        # Code that already has no metadata header is untouched.
        self.assertEqual(_strip_chunk_metadata("int main() {}\n"), "int main() {}\n")

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

    def test_budget_is_shared_before_ranked_files_get_extra_space(self):
        for name in ("a.py", "b.py", "c.py"):
            (self.repo / name).write_text((f"# {name}\n" + "value = 1\n" * 600), encoding="utf-8")
        assembly = assemble_file_code_blocks(
            self.repo,
            ["a.py", "b.py", "c.py"],
            budget=1800,
        )
        self.assertEqual(assembly.included, ["a.py", "b.py", "c.py"])
        self.assertEqual(set(assembly.truncated), {"a.py", "b.py", "c.py"})

    def test_status_reports_unreadable_files_without_hiding_good_evidence(self):
        assembly = assemble_file_code_blocks(self.repo, ["missing.py", "a.py"])
        self.assertEqual(assembly.read_failed, ["missing.py"])
        self.assertEqual(assembly.included, ["a.py"])

    def test_relevant_line_range_is_preferred_over_file_head(self):
        content = "\n".join([f"line_{index}" for index in range(1, 401)])
        (self.repo / "large.py").write_text(content, encoding="utf-8")
        assembly = assemble_file_code_blocks(
            self.repo,
            ["large.py"],
            relevant_ranges=[EvidenceRange("large.py", 250, 252)],
            budget=240,
        )
        self.assertIn("# lines 250-252", assembly.content)
        self.assertIn("line_250", assembly.content)
        self.assertNotIn("line_1\n", assembly.content)


class LessonFileRefreshTest(unittest.TestCase):
    def test_index_fingerprint_change_reselects_with_full_lesson_plan(self):
        from app.services.generation_service import _ensure_lesson_files

        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            (repo / "new.py").write_text("def new(): pass\n", encoding="utf-8")
            with (
                patch(
                    "app.services.generation_service.get_lesson_file_records",
                    return_value=[{"file_path": "old.py", "indexed_fingerprint": "old"}],
                ),
                patch("app.services.generation_service._current_index_fingerprint", return_value="new"),
                patch(
                    "app.services.generation_service.select_lesson_file_paths",
                    return_value=["new.py"],
                ) as select,
                patch("app.services.generation_service.upsert_lesson_files") as upsert,
            ):
                result = _ensure_lesson_files(3, repo, 2, "路由", "讲解注册和分发流程")

        self.assertEqual(result, ["new.py"])
        select.assert_called_once_with(3, repo, "路由", "讲解注册和分发流程")
        upsert.assert_called_once_with(3, 2, [("new.py", "index")], "new")

    def test_stale_index_text_cannot_replace_missing_repository_code(self):
        from app.services.generation_service import _repository_lesson_evidence

        stale_hit = SimpleNamespace(
            path="deleted.py",
            start_line=1,
            end_line=2,
            content="def deleted(): pass",
            language="python",
        )
        with tempfile.TemporaryDirectory() as temp, patch(
            "app.services.index_service.search_project",
            return_value=[stale_hit],
        ), patch(
            "app.services.generation_service._ensure_lesson_files",
            return_value=["deleted.py"],
        ):
            with self.assertRaisesRegex(RuntimeError, "重新构建索引"):
                _repository_lesson_evidence(7, Path(temp), 1, "删除文件", "讲解 deleted")


if __name__ == "__main__":
    unittest.main()
