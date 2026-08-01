"""Tests for llm_client response parsing, incl. reasoning-model fallback."""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.services.llm_client import call_openai_compatible_chat_result


def _ok_response(message: dict) -> MagicMock:
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json.return_value = {
        "choices": [{"message": message}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }
    return response


class MessageContentFallbackTests(unittest.TestCase):
    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_uses_content_when_present(self, client: MagicMock) -> None:
        client.post.return_value = _ok_response({"role": "assistant", "content": "正常回答"})
        result = call_openai_compatible_chat_result("http://x", "k", "m", [{"role": "user", "content": "hi"}])
        self.assertEqual(result.content, "正常回答")

    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_falls_back_to_reasoning_content_when_content_empty(self, client: MagicMock) -> None:
        client.post.return_value = _ok_response(
            {"role": "assistant", "content": "", "reasoning_content": "推理模型把回答放在这里"}
        )
        result = call_openai_compatible_chat_result("http://x", "k", "m", [{"role": "user", "content": "hi"}])
        self.assertEqual(result.content, "推理模型把回答放在这里")

    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_falls_back_when_content_missing(self, client: MagicMock) -> None:
        client.post.return_value = _ok_response({"role": "assistant", "reasoning_content": "只有 reasoning"})
        result = call_openai_compatible_chat_result("http://x", "k", "m", [{"role": "user", "content": "hi"}])
        self.assertEqual(result.content, "只有 reasoning")

    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_raises_when_both_empty(self, client: MagicMock) -> None:
        client.post.return_value = _ok_response({"role": "assistant", "content": ""})
        with self.assertRaisesRegex(RuntimeError, "no message content"):
            call_openai_compatible_chat_result("http://x", "k", "m", [{"role": "user", "content": "hi"}])

    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_prefers_content_over_reasoning_when_both_present(self, client: MagicMock) -> None:
        client.post.return_value = _ok_response(
            {"role": "assistant", "content": "正式回答", "reasoning_content": "思考痕迹"}
        )
        result = call_openai_compatible_chat_result("http://x", "k", "m", [{"role": "user", "content": "hi"}])
        self.assertEqual(result.content, "正式回答")


if __name__ == "__main__":
    unittest.main()
