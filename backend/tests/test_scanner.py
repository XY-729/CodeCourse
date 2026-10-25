from pathlib import Path
import unittest

from fastapi import HTTPException

from app.services.scanner import infer_language, read_text_file, safe_join


class ScannerTests(unittest.TestCase):
    def test_infer_language_detects_cc_as_cpp(self):
        for name in ("src/main.cc", "src/MAIN.CC", "src/main.cpp", "include/main.hpp"):
            with self.subTest(name=name):
                self.assertEqual(infer_language(Path(name)), "cpp")
        self.assertEqual(infer_language(Path("main.c")), "c")
        self.assertEqual(infer_language(Path("main.unknown")), "plaintext")

    def test_read_cc_file_returns_cpp_language_and_original_content(self):
        import tempfile

        content = '#include <string>\nconst std::string message = "hello";\n'
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "main.cc").write_text(content, encoding="utf-8")
            self.assertEqual(read_text_file(root, "main.cc"), (content, "cpp"))

    def test_safe_join_rejects_path_traversal(self):
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaises(HTTPException) as caught:
                safe_join(Path(temp_dir), "../outside.txt")

        self.assertEqual(caught.exception.status_code, 400)

    def test_read_text_file_rejects_non_utf8(self):
        import tempfile

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            target = root / "binary.dat"
            target.write_bytes(b"\xff\xfe\x00")

            with self.assertRaises(HTTPException) as caught:
                read_text_file(root, "binary.dat")

        self.assertEqual(caught.exception.status_code, 415)


if __name__ == "__main__":
    unittest.main()
