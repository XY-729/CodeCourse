"""Tests for llm_client response parsing and payload construction."""
from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.llm_client import call_openai_compatible_chat_result, stream_openai_compatible_chat


def _ok_response(message: dict) -> MagicMock:
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json.return_value = {
        "choices": [{"message": message}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }
    return response


class MessageContentTests(unittest.TestCase):
    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_uses_content_when_present(self, client: MagicMock) -> None:
        client.post.return_value = _ok_response(
            {"role": "assistant", "content": "正式回答", "reasoning_content": "思考痕迹"}
        )
        result = call_openai_compatible_chat_result("http://x", "k", "m", [{"role": "user", "content": "hi"}])
        self.assertEqual(result.content, "正式回答")

    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_raises_when_content_empty_even_with_reasoning(self, client: MagicMock) -> None:
        client.post.return_value = _ok_response(
            {"role": "assistant", "content": "", "reasoning_content": "纯思考痕迹，不是可见回答"}
        )
        with self.assertRaisesRegex(RuntimeError, "no message content"):
            call_openai_compatible_chat_result("http://x", "k", "m", [{"role": "user", "content": "hi"}])

    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_raises_when_only_reasoning_content(self, client: MagicMock) -> None:
        client.post.return_value = _ok_response({"role": "assistant", "reasoning_content": "只有思考"})
        with self.assertRaisesRegex(RuntimeError, "no message content"):
            call_openai_compatible_chat_result("http://x", "k", "m", [{"role": "user", "content": "hi"}])

    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_raises_when_content_missing(self, client: MagicMock) -> None:
        client.post.return_value = _ok_response({"role": "assistant", "content": ""})
        with self.assertRaisesRegex(RuntimeError, "no message content"):
            call_openai_compatible_chat_result("http://x", "k", "m", [{"role": "user", "content": "hi"}])


class MaxTokensPayloadTests(unittest.TestCase):
    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_sync_payload_uses_65536(self, client: MagicMock) -> None:
        client.post.return_value = _ok_response({"role": "assistant", "content": "回答"})
        call_openai_compatible_chat_result("http://x", "k", "m", [{"role": "user", "content": "hi"}])
        payload = client.post.call_args.kwargs["json"]
        self.assertEqual(payload["max_tokens"], 65536)
        self.assertIs(payload["stream"], False)

    @patch("app.services.llm_client._async_client")
    def test_stream_payload_uses_65536(self, async_client_factory: MagicMock) -> None:
        lines = [
            'data: {"choices":[{"delta":{"content":"你"}}]}',
            'data: {"choices":[{"delta":{"content":"好"}}]}',
            "data: [DONE]",
        ]

        async def _lines():
            for line in lines:
                yield line

        response = MagicMock()
        response.status_code = 200
        response.headers = {"content-type": "text/event-stream"}
        response.aiter_lines = _lines
        cm = MagicMock()
        cm.__aenter__ = AsyncMock(return_value=response)
        cm.__aexit__ = AsyncMock(return_value=False)
        client = MagicMock()
        client.stream.return_value = cm
        async_client_factory.return_value = client

        collected: list[str] = []

        async def consume():
            async for chunk in stream_openai_compatible_chat("http://x", "k", "m", [{"role": "user", "content": "hi"}]):
                collected.append(chunk)

        import asyncio

        asyncio.run(consume())
        self.assertEqual("".join(collected), "你好")
        payload = client.stream.call_args.kwargs["json"]
        self.assertEqual(payload["max_tokens"], 65536)
        self.assertIs(payload["stream"], True)


if __name__ == "__main__":
    unittest.main()
