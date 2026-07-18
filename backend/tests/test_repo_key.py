"""Tests for repo_key normalization, project deduplication, and course error responses."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


class RepoKeyTests(unittest.TestCase):
    """Test URL normalization and project deduplication logic."""

    def test_normalize_https_with_git_suffix(self):
        from app.services.git_service import normalize_github_repo_key

        result = normalize_github_repo_key("https://github.com/Octocat/Hello-World.git")
        self.assertEqual(result, "github.com/octocat/hello-world")

    def test_normalize_https_without_git_suffix(self):
        from app.services.git_service import normalize_github_repo_key

        result = normalize_github_repo_key("https://github.com/owner/repo")
        self.assertEqual(result, "github.com/owner/repo")

    def test_normalize_ssh_url(self):
        from app.services.git_service import normalize_github_repo_key

        result = normalize_github_repo_key("git@github.com:Owner/Repo.git")
        self.assertEqual(result, "github.com/owner/repo")

    def test_normalize_trailing_slash(self):
        from app.services.git_service import normalize_github_repo_key

        result = normalize_github_repo_key("https://github.com/owner/repo/")
        self.assertEqual(result, "github.com/owner/repo")

    def test_normalize_non_github_url_passthrough(self):
        from app.services.git_service import normalize_github_repo_key

        result = normalize_github_repo_key("https://gitlab.com/user/project.git")
        self.assertEqual(result, "https://gitlab.com/user/project")

    def test_ssh_without_git_suffix(self):
        from app.services.git_service import normalize_github_repo_key

        result = normalize_github_repo_key("git@github.com:user/repo")
        self.assertEqual(result, "github.com/user/repo")


def _setup_temp_db():
    """Set up a temporary database for isolated testing.

    Patches both config and storage module references to ensure
    all code paths use the isolated temp DB.
    """
    import app.core.config as cfg
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

    storage.init_storage()
    return tmpdir


class ProjectDedupTests(unittest.TestCase):
    """Tests for project deduplication via upsert_project."""

    def setUp(self):
        self._tmpdir = _setup_temp_db()

    def tearDown(self):
        self._tmpdir.cleanup()

    def test_import_same_repo_https_and_ssh_dedup(self):
        """Importing HTTPS then SSH URL for the same repo should result in 1 project record."""
        from app.services.storage import list_projects, upsert_project

        fake_path = Path(self._tmpdir.name) / "test-repo"
        fake_path.mkdir(parents=True, exist_ok=True)

        # Import via HTTPS
        p1 = upsert_project("test-repo", "https://github.com/octocat/hello-world.git", fake_path, "scanned")

        # Import same repo via SSH
        p2 = upsert_project("test-repo-ssh", "git@github.com:octocat/hello-world.git", fake_path, "scanned")

        # Should be the same project (same id)
        self.assertEqual(p1.id, p2.id)

        # list_projects should return exactly 1 project
        projects = list_projects()
        self.assertEqual(len(projects), 1)
        self.assertEqual(projects[0].id, p1.id)

    def test_different_repos_create_separate_records(self):
        """Different repos should create separate project records."""
        from app.services.storage import list_projects, upsert_project

        fake_path = Path(self._tmpdir.name) / "test-repo2"
        fake_path.mkdir(parents=True, exist_ok=True)

        p1 = upsert_project("repo-a", "https://github.com/owner/repo-a.git", fake_path, "scanned")
        p2 = upsert_project("repo-b", "https://github.com/owner/repo-b.git", fake_path, "scanned")

        self.assertNotEqual(p1.id, p2.id)
        projects = list_projects()
        repos = [p for p in projects if p.id in (p1.id, p2.id)]
        self.assertEqual(len(repos), 2)


class CourseEndpointTests(unittest.TestCase):
    """Tests for course endpoint responses."""

    def setUp(self):
        self._tmpdir = _setup_temp_db()
        self.workspace = self._tmpdir.name
        import app.core.config as cfg
        self._cfg = cfg

        from app.main import app
        self.client = TestClient(app)

    def tearDown(self):
        self._tmpdir.cleanup()

    def _create_project_with_course(self):
        """Create a project record and generate a course file for it."""
        from app.services.storage import upsert_project
        from pathlib import Path

        repo_dir = Path(self.workspace) / "repos" / "test-repo"
        repo_dir.mkdir(parents=True, exist_ok=True)
        (repo_dir / ".git").mkdir(exist_ok=True)
        (repo_dir / "README.md").write_text("# Test\n")

        project = upsert_project(
            "test-repo",
            "https://github.com/test/repo.git",
            repo_dir,
            "scanned",
        )

        # Generate course
        from app.services.generation_service import generate_rule_course

        generate_rule_course(project.id, repo_dir)
        return project

    def test_course_outline_returns_content(self):
        """GET /api/projects/{id}/course/outline.md should return 200 with content."""
        project = self._create_project_with_course()

        resp = self.client.get(f"/api/projects/{project.id}/course/outline.md")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["filename"], "outline.md")
        self.assertIn("content", data)
        self.assertTrue(len(data["content"]) > 0)

    def test_missing_course_file_returns_structured_error(self):
        """GET /api/projects/{id}/course/nonexistent.md returns 404 with detail."""
        project = self._create_project_with_course()

        resp = self.client.get(f"/api/projects/{project.id}/course/nonexistent.md")
        self.assertEqual(resp.status_code, 404)
        data = resp.json()
        self.assertIn("detail", data)
        self.assertIn("Course file not found", data["detail"])
        self.assertIn("nonexistent.md", data["detail"])
        # Ensure it's not a bare "Not Found"
        self.assertNotEqual(data["detail"], "Not Found")

    def test_project_not_found_returns_proper_error(self):
        """GET /api/projects/99999/course/outline.md returns 404 with Project not found."""
        resp = self.client.get("/api/projects/99999/course/outline.md")
        self.assertEqual(resp.status_code, 404)
        data = resp.json()
        self.assertIn("Project not found", data["detail"])


if __name__ == "__main__":
    unittest.main()
