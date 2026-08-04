"""Tests for llm_client response parsing and payload construction."""
from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

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


class RetryTests(unittest.TestCase):
    @patch("app.services.llm_client._retry_backoff")
    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_retries_transient_503_then_succeeds(self, client: MagicMock, backoff: MagicMock) -> None:
        busy = MagicMock()
        busy.raise_for_status = MagicMock(side_effect=httpx.HTTPStatusError(
            "busy", request=MagicMock(), response=_status_response(503),
        ))
        client.post.side_effect = [busy, busy, _ok_response({"role": "assistant", "content": "成功"})]
        result = call_openai_compatible_chat_result("http://x", "k", "m", [{"role": "user", "content": "hi"}])
        self.assertEqual(result.content, "成功")
        self.assertEqual(client.post.call_count, 3)
        self.assertEqual(backoff.call_count, 2)

    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_does_not_retry_401(self, client: MagicMock) -> None:
        unauthorized = MagicMock()
        unauthorized.raise_for_status = MagicMock(side_effect=httpx.HTTPStatusError(
            "unauthorized", request=MagicMock(), response=_status_response(401),
        ))
        client.post.return_value = unauthorized
        with self.assertRaisesRegex(RuntimeError, "LLM HTTP 401"):
            call_openai_compatible_chat_result("http://x", "k", "m", [{"role": "user", "content": "hi"}])
        self.assertEqual(client.post.call_count, 1)

    @patch("app.services.llm_client._retry_backoff")
    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_raises_after_all_attempts_fail(self, client: MagicMock, backoff: MagicMock) -> None:
        busy = MagicMock()
        busy.raise_for_status = MagicMock(side_effect=httpx.HTTPStatusError(
            "busy", request=MagicMock(), response=_status_response(503),
        ))
        client.post.return_value = busy
        with self.assertRaisesRegex(RuntimeError, "LLM HTTP 503"):
            call_openai_compatible_chat_result("http://x", "k", "m", [{"role": "user", "content": "hi"}])
        self.assertEqual(client.post.call_count, 3)

    @patch("app.services.llm_client._retry_backoff_async")
    @patch("app.services.llm_client._async_client")
    def test_stream_retries_transient_503_then_succeeds(
        self, async_client_factory: MagicMock, backoff: AsyncMock,
    ) -> None:
        lines = [
            'data: {"choices":[{"delta":{"content":"好"}}]}',
            "data: [DONE]",
        ]

        async def _lines():
            for line in lines:
                yield line

        ok_response = MagicMock()
        ok_response.status_code = 200
        ok_response.headers = {"content-type": "text/event-stream"}
        ok_response.aiter_lines = _lines

        busy_response = MagicMock()
        busy_response.status_code = 503
        busy_response.headers = {"content-type": "application/json"}
        busy_response.aread = AsyncMock(return_value=b'{"error":{"code":"service_unavailable_error"}}')

        def _make_cm(response):
            cm = MagicMock()
            cm.__aenter__ = AsyncMock(return_value=response)
            cm.__aexit__ = AsyncMock(return_value=False)
            return cm

        client = MagicMock()
        client.stream.side_effect = [_make_cm(busy_response), _make_cm(ok_response)]
        async_client_factory.return_value = client

        collected: list[str] = []

        async def consume():
            async for chunk in stream_openai_compatible_chat("http://x", "k", "m", [{"role": "user", "content": "hi"}]):
                collected.append(chunk)

        asyncio.run(consume())
        self.assertEqual("".join(collected), "好")
        self.assertEqual(client.stream.call_count, 2)


def _status_response(status_code: int) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.text = '{"error":"x"}'
    return response


if __name__ == "__main__":
    unittest.main()
