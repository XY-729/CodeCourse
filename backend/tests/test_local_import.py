import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app.services import local_import_service


class LocalImportTests(unittest.TestCase):
    def setUp(self):
        self._temporary = tempfile.TemporaryDirectory()
        self.root = Path(self._temporary.name)
        self.repos = self.root / "repos"
        self.repos.mkdir()
        self._repos_patch = patch.object(local_import_service, "REPOS_ROOT", self.repos)
        self._repos_patch.start()

    def tearDown(self):
        self._repos_patch.stop()
        self._temporary.cleanup()

    def test_directory_import_copies_source_and_ignores_dependencies(self):
        source = self.root / "Atlas"
        source.mkdir()
        (source / "README.md").write_text("# Atlas", encoding="utf-8")
        (source / "node_modules").mkdir()
        (source / "node_modules" / "ignored.js").write_text("ignored", encoding="utf-8")

        name, destination, source_url = local_import_service.import_local_directory(str(source))

        self.assertEqual(name, "Atlas")
        self.assertTrue((destination / "README.md").is_file())
        self.assertFalse((destination / "node_modules").exists())
        self.assertTrue(source_url.startswith("local://"))

    def test_archive_import_uses_single_top_level_directory(self):
        archive_path = self.root / "Atlas.zip"
        with zipfile.ZipFile(archive_path, "w") as archive:
            archive.writestr("Atlas/README.md", "# Atlas")
            archive.writestr("Atlas/src/main.py", "print('hello')")

        name, destination, _source_url = local_import_service.import_local_archive(str(archive_path))

        self.assertEqual(name, "Atlas")
        self.assertTrue((destination / "README.md").is_file())
        self.assertTrue((destination / "src" / "main.py").is_file())

    def test_archive_import_rejects_path_traversal(self):
        archive_path = self.root / "unsafe.zip"
        with zipfile.ZipFile(archive_path, "w") as archive:
            archive.writestr("../outside.txt", "unsafe")

        with self.assertRaises(HTTPException) as caught:
            local_import_service.import_local_archive(str(archive_path))

        self.assertEqual(caught.exception.status_code, 400)
        self.assertFalse((self.root / "outside.txt").exists())


if __name__ == "__main__":
    unittest.main()
