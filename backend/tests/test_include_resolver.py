import sys
import tempfile
import unittest
from pathlib import Path

# Ensure backend package is importable when running this file directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.services.include_resolver import (  # noqa: E402
    extract_quoted_includes,
    resolve_include,
    walk_source_files,
)


class ExtractQuotedIncludesTest(unittest.TestCase):
    def test_quoted_only_and_deduped(self):
        content = '#include "a.h"\n#include <system.h>\n#include "b.h"\n#include "a.h"\n'
        self.assertEqual(extract_quoted_includes(content), ["a.h", "b.h"])

    def test_indented_include(self):
        content = "  #   include  \"spaced.h\"\n"
        self.assertEqual(extract_quoted_includes(content), ["spaced.h"])

    def test_no_includes(self):
        self.assertEqual(extract_quoted_includes("int main() {}\n"), [])


class ResolveIncludeTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "root"
        self.root.mkdir()
        (self.root / "src").mkdir()
        (self.root / "include").mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def _touch(self, rel: str) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")

    def test_same_directory(self):
        self._touch("src/util.h")
        self.assertEqual(resolve_include(self.root, "src/util.cpp", "util.h"), "src/util.h")

    def test_include_root(self):
        # mikuOJ-style: src/*.cpp includes "cppjudge/sandbox_internal.h" which
        # lives under include/.
        self._touch("include/cppjudge/sandbox_internal.h")
        self.assertEqual(
            resolve_include(self.root, "src/sandbox_common.cpp", "cppjudge/sandbox_internal.h"),
            "include/cppjudge/sandbox_internal.h",
        )

    def test_repo_root(self):
        self._touch("app.h")
        self.assertEqual(resolve_include(self.root, "src/main.cpp", "app.h"), "app.h")

    def test_suffix_fallback_for_custom_include_dir(self):
        self._touch("deps/sandbox/internal.h")
        source_files = walk_source_files(self.root)
        self.assertEqual(
            resolve_include(self.root, "src/main.cpp", "sandbox/internal.h", source_files),
            "deps/sandbox/internal.h",
        )

    def test_parent_traversal_blocked(self):
        self._touch("../outside.h")
        self.assertIsNone(resolve_include(self.root, "src/main.cpp", "../outside.h"))

    def test_absolute_system_path_blocked(self):
        self.assertIsNone(resolve_include(self.root, "src/main.cpp", "/usr/include/stdio.h"))

    def test_non_ccpp_extension_not_returned(self):
        self._touch("include/notes.txt")
        self.assertIsNone(resolve_include(self.root, "src/main.cpp", "notes.txt"))


class WalkSourceFilesTest(unittest.TestCase):
    def test_only_ccpp_and_skips_ignored_dirs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "a.cpp").write_text("", encoding="utf-8")
            (root / "b.h").write_text("", encoding="utf-8")
            (root / "c.py").write_text("", encoding="utf-8")
            (root / "node_modules").mkdir()
            (root / "node_modules" / "x.h").write_text("", encoding="utf-8")
            sub = root / "sub"
            sub.mkdir()
            (sub / "d.hpp").write_text("", encoding="utf-8")
            found = walk_source_files(root)
            self.assertEqual(found, ["a.cpp", "b.h", "sub/d.hpp"])


if __name__ == "__main__":
    unittest.main()
