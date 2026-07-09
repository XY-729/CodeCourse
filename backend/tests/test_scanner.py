from pathlib import Path
import unittest

from fastapi import HTTPException

from app.services.scanner import read_text_file, safe_join


class ScannerTests(unittest.TestCase):
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
