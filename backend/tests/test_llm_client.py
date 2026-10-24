"""Tests for llm_client response parsing and payload construction."""
from __future__ import annotations

import asyncio
import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from app.services.llm_client import (
    call_openai_compatible_chat_result,
    stream_openai_compatible_chat,
    use_system_proxy,
    _new_async_client,
    _new_sync_client,
)


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
    def test_incomplete_response_reports_reason_and_usage_without_retrying(self, client: MagicMock) -> None:
        for reason, label in [('length', '长度上限'), ('content_filter', '服务端过滤')]:
            with self.subTest(reason=reason):
                client.reset_mock()
                response = _ok_response({'content': 'unfinished'})
                response.json.return_value['choices'][0]['finish_reason'] = reason
                client.post.return_value = response
                with self.assertLogs('app.services.llm_client', level='WARNING') as logs:
                    with self.assertRaisesRegex(RuntimeError, label):
                        call_openai_compatible_chat_result('http://x', 'k', 'm', [{'role': 'user', 'content': 'hi'}])
                self.assertIn(f'finish_reason={reason}', logs.output[0])
                self.assertIn('output_tokens=5', logs.output[0])
                self.assertEqual(client.post.call_count, 1)
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
    def test_long_input_uses_remaining_output_budget_and_preserves_every_message(self, client: MagicMock) -> None:
        # Match the reported 76k input failure with a deterministic large request.
        messages = [{'role': 'user', 'content': '概' * 31660 + 'x'}]
        client.post.return_value = _ok_response({'content': '完整回答'})
        with patch.dict(os.environ, {'GPL_LLM_CONTEXT_TOKENS': '131072'}):
            result = call_openai_compatible_chat_result('http://x', 'k', 'm', messages)
        payload = client.post.call_args.kwargs['json']
        self.assertEqual(payload['messages'], messages)
        self.assertEqual(payload['max_tokens'], 55046)
        self.assertEqual(result.content, '完整回答')
        self.assertEqual(client.post.call_count, 1)

    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_smaller_context_is_respected_and_explicit_smaller_output_is_not_increased(self, client: MagicMock) -> None:
        messages = [{'role': 'user', 'content': '概' * 31660 + 'x'}]
        client.post.return_value = _ok_response({'content': '完整回答'})
        with patch.dict(os.environ, {'GPL_LLM_CONTEXT_TOKENS': '100000'}):
            call_openai_compatible_chat_result('http://x', 'k', 'm', messages)
            self.assertEqual(client.post.call_args.kwargs['json']['max_tokens'], 23974)
            call_openai_compatible_chat_result('http://x', 'k', 'm', messages, max_tokens=8192)
            self.assertEqual(client.post.call_args.kwargs['json']['max_tokens'], 8192)

    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_insufficient_output_space_still_stops_before_network(self, client: MagicMock) -> None:
        for characters in (54000, 60000):
            with self.subTest(characters=characters), patch.dict(os.environ, {'GPL_LLM_CONTEXT_TOKENS': '131072'}):
                with self.assertRaisesRegex(ValueError, '最低输出预留 4096'):
                    call_openai_compatible_chat_result('http://x', 'k', 'm', [{'role': 'user', 'content': '概' * characters}])
        client.post.assert_not_called()

    @patch("app.services.llm_client._SYNC_CLIENT")
    def test_sync_payload_uses_65536(self, client: MagicMock) -> None:
        client.post.return_value = _ok_response({"role": "assistant", "content": "回答"})
        call_openai_compatible_chat_result("http://x", "k", "m", [{"role": "user", "content": "hi"}])
        payload = client.post.call_args.kwargs["json"]
        self.assertEqual(payload["max_tokens"], 65536)
        self.assertIs(payload["stream"], False)

    @patch("app.services.llm_client._async_client")
    def test_stream_payload_respects_available_output_window(self, async_client_factory: MagicMock) -> None:
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

        async def consume(messages):
            collected: list[str] = []
            async for chunk in stream_openai_compatible_chat("http://x", "k", "m", messages):
                collected.append(chunk)
            return ''.join(collected)

        for text, expected in [('hi', 65536), ('概' * 31660 + 'x', 55046)]:
            messages = [{'role': 'user', 'content': text}]
            with self.subTest(expected=expected), patch.dict(os.environ, {'GPL_LLM_CONTEXT_TOKENS': '131072'}):
                self.assertEqual(asyncio.run(consume(messages)), '你好')
                payload = client.stream.call_args.kwargs['json']
                self.assertEqual(payload['max_tokens'], expected)
                self.assertEqual(payload['messages'], messages)
                self.assertIs(payload['stream'], True)


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


class ProxyPolicyTests(unittest.TestCase):
    """系统代理默认关闭：国内 API 经代理出海会撞中间人自签证书（见 openspec/changes/llm-bypass-system-proxy）。"""

    def test_default_does_not_use_system_proxy(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(use_system_proxy())
            sync_client = _new_sync_client()
            async_client = _new_async_client()
            try:
                self.assertIs(sync_client.trust_env, False)
                self.assertIs(async_client.trust_env, False)
            finally:
                sync_client.close()

    def test_env_flag_restores_system_proxy(self) -> None:
        for value in ("1", "true", "YES", " On "):
            with self.subTest(value=value), patch.dict(os.environ, {"GPL_LLM_USE_SYSTEM_PROXY": value}):
                self.assertTrue(use_system_proxy())
                sync_client = _new_sync_client()
                async_client = _new_async_client()
                try:
                    self.assertIs(sync_client.trust_env, True)
                    self.assertIs(async_client.trust_env, True)
                finally:
                    sync_client.close()

    def test_falsy_env_flag_keeps_system_proxy_off(self) -> None:
        for value in ("", "0", "false", "no", "off"):
            with self.subTest(value=value), patch.dict(os.environ, {"GPL_LLM_USE_SYSTEM_PROXY": value}):
                self.assertFalse(use_system_proxy())


def _status_response(status_code: int) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.text = '{"error":"x"}'
    return response


if __name__ == "__main__":
    unittest.main()
