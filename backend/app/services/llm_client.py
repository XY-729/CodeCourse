from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from time import perf_counter, sleep
from typing import Any

import httpx


_SYNC_CLIENT = httpx.Client(
    limits=httpx.Limits(max_connections=12, max_keepalive_connections=6),
    follow_redirects=True,
)
_ASYNC_CLIENT: httpx.AsyncClient | None = None

# 瞬态错误：服务过载/限流/网关故障，重试可能成功；4xx 等不可恢复错误不重试。
_TRANSIENT_STATUS = {408, 429, 500, 502, 503, 504}
_MAX_ATTEMPTS = 3
_RETRY_BASE_SECONDS = 1.5

# 流式响应没有整体截止时间时，服务端只要缓慢吐数据就能让请求无限挂起
# （read 超时是每阶段超时，不限制总时长）。total = read + 缓冲 作为硬上限。
_TOTAL_TIMEOUT_BUFFER_SECONDS = 30


def _retry_backoff(attempt: int) -> None:
    # attempt 从 0 开始，第 0/1 次失败后等待 1.5s / 3s，第 2 次失败后不再等待。
    if attempt < _MAX_ATTEMPTS - 1:
        sleep(_RETRY_BASE_SECONDS * (2 ** attempt))


async def _retry_backoff_async(attempt: int) -> None:
    if attempt < _MAX_ATTEMPTS - 1:
        await asyncio.sleep(_RETRY_BASE_SECONDS * (2 ** attempt))


@dataclass(frozen=True)
class LLMCallResult:
    content: str
    usage: dict[str, int]
    model: str
    latency_ms: int


def _async_client() -> httpx.AsyncClient:
    global _ASYNC_CLIENT
    if _ASYNC_CLIENT is None or _ASYNC_CLIENT.is_closed:
        _ASYNC_CLIENT = httpx.AsyncClient(
            limits=httpx.Limits(max_connections=12, max_keepalive_connections=6),
            follow_redirects=True,
        )
    return _ASYNC_CLIENT


def mask_api_key(api_key: str) -> str:
    if not api_key:
        return ""
    if len(api_key) <= 8:
        return "*" * len(api_key)
    return f"{api_key[:4]}...{api_key[-4:]}"


def _message_content(data: dict[str, Any]) -> str:
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("LLM response has no choices")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if not content:
        raise RuntimeError("LLM response has no message content")
    return str(content)


def call_openai_compatible_chat_result(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    timeout: int = 30,
) -> LLMCallResult:
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
        "max_tokens": 65536,
    }
    last_error: BaseException | None = None
    for attempt in range(_MAX_ATTEMPTS):
        started = perf_counter()
        try:
            response = _SYNC_CLIENT.post(
                endpoint,
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=timeout,
            )
            response.raise_for_status()
            data = response.json()
            usage = data.get("usage") or {}
            return LLMCallResult(
                content=_message_content(data),
                usage={
                    "input_tokens": int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
                    "output_tokens": int(usage.get("completion_tokens") or usage.get("output_tokens") or 0),
                    "total_tokens": int(usage.get("total_tokens") or 0),
                },
                model=str(data.get("model") or model),
                latency_ms=int((perf_counter() - started) * 1000),
            )
        except httpx.HTTPStatusError as exc:
            last_error = exc
            if exc.response.status_code not in _TRANSIENT_STATUS:
                raise RuntimeError(f"LLM HTTP {exc.response.status_code}: {exc.response.text[:500]}") from exc
        except httpx.HTTPError as exc:
            last_error = exc
        except (ValueError, TypeError) as exc:
            raise RuntimeError("LLM response is not valid JSON") from exc
        _retry_backoff(attempt)
    if isinstance(last_error, httpx.HTTPStatusError):
        raise RuntimeError(f"LLM HTTP {last_error.response.status_code}: {last_error.response.text[:500]}") from last_error
    raise RuntimeError(f"LLM network error: {last_error}") from last_error


def call_openai_compatible_chat(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    timeout: int = 30,
) -> str:
    """Compatibility text API for existing generation and QA callers."""
    return call_openai_compatible_chat_result(
        base_url,
        api_key,
        model,
        messages,
        timeout,
    ).content


async def stream_openai_compatible_chat(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    timeout: int = 90,
) -> AsyncIterator[str]:
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": True,
        "max_tokens": 65536,
    }
    client = _async_client()
    last_error: BaseException | None = None
    # 流式响应没有整体截止时间时，服务端只要缓慢吐数据就能让请求无限挂起
    # （httpx 的 read timeout 是每阶段超时，不限制总时长）。用 asyncio.timeout
    # 作为硬上限，超出即抛 TimeoutError（不重试——停滞的重试无意义，交由
    # 上层任务失败路径处理）。
    deadline = timeout + _TOTAL_TIMEOUT_BUFFER_SECONDS
    try:
        async with asyncio.timeout(deadline):
            for attempt in range(_MAX_ATTEMPTS):
                try:
                    async with client.stream(
                        "POST",
                        endpoint,
                        json=payload,
                        headers={"Authorization": f"Bearer {api_key}"},
                        timeout=httpx.Timeout(timeout),
                    ) as response:
                        if response.status_code >= 400:
                            detail = (await response.aread()).decode("utf-8", errors="replace")
                            error = RuntimeError(f"LLM HTTP {response.status_code}: {detail[:500]}")
                            if response.status_code in _TRANSIENT_STATUS:
                                last_error = error
                                await _retry_backoff_async(attempt)
                                continue
                            raise error

                        content_type = response.headers.get("content-type", "").lower()
                        if "text/event-stream" not in content_type:
                            body = await response.aread()
                            try:
                                content = _message_content(json.loads(body.decode("utf-8")))
                            except (ValueError, TypeError, UnicodeDecodeError) as exc:
                                raise RuntimeError("LLM response is neither SSE nor valid JSON") from exc
                            if content:
                                yield content
                            return

                        async for line in response.aiter_lines():
                            if not line or not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if not data or data == "[DONE]":
                                if data == "[DONE]":
                                    break
                                continue
                            try:
                                event = json.loads(data)
                            except ValueError:
                                continue
                            choices = event.get("choices") or []
                            if not choices:
                                continue
                            delta = choices[0].get("delta") or {}
                            content = delta.get("content")
                            if content:
                                yield str(content)
                        return
                except httpx.HTTPError as exc:
                    last_error = exc
                    await _retry_backoff_async(attempt)
    except TimeoutError as exc:
        raise RuntimeError(f"LLM stream exceeded overall deadline of {deadline}s") from exc
    if isinstance(last_error, httpx.HTTPError):
        raise RuntimeError(f"LLM network error: {last_error}") from last_error
    raise last_error if isinstance(last_error, RuntimeError) else RuntimeError(f"LLM network error: {last_error}") from last_error
