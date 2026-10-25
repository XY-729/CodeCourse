import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app.services import git_service


URL = "https://github.com/XY-729/cpp-kv-workbench"


class GitImportProxyTests(unittest.TestCase):
    def setUp(self):
        self.patches = [
            patch.dict(os.environ, {}, clear=True),
            patch.object(git_service.sys, "platform", "win32"),
            patch.object(git_service, "getproxies", return_value={"https": "http://127.0.0.1:7890"}),
            patch.object(git_service, "proxy_bypass", return_value=False),
            patch.object(git_service.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, b"", b"")),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def test_windows_system_proxy_reaches_clone_process_without_global_changes(self):
        with tempfile.TemporaryDirectory() as root, patch.object(git_service, "REPOS_ROOT", Path(root)), patch.object(git_service.shutil, "which", return_value="git"):
            git_service.subprocess.run.side_effect = [
                subprocess.CompletedProcess([], 1, b"", b""),
                subprocess.CompletedProcess([], 0, "", ""),
            ]
            git_service.clone_or_reuse(URL)
        clone = git_service.subprocess.run.call_args
        self.assertIn("clone", clone.args[0])
        self.assertEqual(clone.kwargs["env"]["https_proxy"], "http://127.0.0.1:7890")
        self.assertEqual(clone.kwargs["env"]["GIT_TERMINAL_PROMPT"], "0")
        self.assertNotIn("https_proxy", os.environ)

    def test_explicit_git_proxy_or_disabled_proxy_is_preserved(self):
        for value in (b"http://custom:8080", b""):
            with self.subTest(value=value):
                git_service.subprocess.run.return_value = subprocess.CompletedProcess([], 0, value, b"")
                self.assertNotIn("https_proxy", git_service._clone_environment("git", URL))

    def test_environment_proxy_is_preserved(self):
        for key in ("HTTPS_PROXY", "https_proxy", "ALL_PROXY"):
            with self.subTest(key=key), patch.dict(os.environ, {key: "http://custom:8080"}, clear=True):
                env = {name.lower(): value for name, value in git_service._clone_environment("git", URL).items()}
                self.assertEqual(env[key.lower()], "http://custom:8080")
        git_service.subprocess.run.assert_not_called()

    def test_proxy_bypass_is_respected(self):
        git_service.proxy_bypass.return_value = True
        self.assertNotIn("https_proxy", git_service._clone_environment("git", URL))

    def test_ssh_and_non_windows_do_not_use_windows_proxy(self):
        self.assertNotIn("https_proxy", git_service._clone_environment("git", "git@github.com:XY-729/cpp-kv-workbench.git"))
        with patch.object(git_service.sys, "platform", "linux"):
            self.assertNotIn("https_proxy", git_service._clone_environment("git", URL))
        git_service.subprocess.run.assert_not_called()

    def test_missing_or_unreadable_proxy_settings_do_not_block_clone(self):
        git_service.getproxies.return_value = {}
        self.assertNotIn("https_proxy", git_service._clone_environment("git", URL))
        git_service.subprocess.run.side_effect = subprocess.TimeoutExpired("git config", 10)
        self.assertNotIn("https_proxy", git_service._clone_environment("git", URL))

    def test_reset_error_is_classified_and_logged(self):
        with tempfile.TemporaryDirectory() as root, patch.object(git_service, "REPOS_ROOT", Path(root)), patch.object(git_service.shutil, "which", return_value="git"), patch.object(git_service, "_clone_environment", return_value={}):
            git_service.subprocess.run.return_value = subprocess.CompletedProcess([], 128, "", "Recv failure: Connection was reset")
            with self.assertLogs(git_service.logger, level="WARNING") as logged, self.assertRaises(HTTPException) as raised:
                git_service.clone_or_reuse(URL)
        self.assertEqual(raised.exception.status_code, 502)
        self.assertIn("network error", raised.exception.detail)
        self.assertIn("Connection was reset", logged.output[0])
